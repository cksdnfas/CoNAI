import path from 'path';
import { AIMetadata } from './types';

export type WebPMetadataParserHint = 'webui' | 'novelai' | 'comfyui' | 'unknown';
export type ConaiImageMetadataSchema = 'conai.image-metadata/v1' | 'conai.webp-metadata/v1';

export interface ConaiWebPXmpPayload {
  schema: ConaiImageMetadataSchema;
  version: 1;
  createdAt: string;
  source: {
    fileExt?: string;
    format?: string;
    mimeType?: string;
    originalFileName?: string;
    originalBaseName?: string;
  };
  parserHint: WebPMetadataParserHint;
  rawData?: Record<string, any>;
  aiInfo?: AIMetadata;
}

const CONAI_XMP_NAMESPACE = 'https://conai.local/ns/image-metadata/1.0/';
const PAYLOAD_TAG = 'conai:payload';
const PRIMARY_TEXT_TAG = 'conai:primaryText';
const CREATOR_TOOL = 'CoNAI';
const SUPPORTED_SCHEMAS = new Set<ConaiImageMetadataSchema>([
  'conai.image-metadata/v1',
  'conai.webp-metadata/v1',
]);

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlUnescape(value: string): string {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}

function isNonEmptyObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && Object.keys(value as Record<string, any>).length > 0;
}

function formatScalarOption(label: string, value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return `${label}: ${value}`;
}

function buildWebUIParametersFromAiInfo(aiInfo: AIMetadata | undefined): string | null {
  if (!aiInfo) {
    return null;
  }

  const positivePrompt = String(aiInfo.positive_prompt || aiInfo.prompt || '').trim();
  if (!positivePrompt) {
    return null;
  }

  const negativePrompt = String(aiInfo.negative_prompt || '').trim();
  const optionParts = [
    formatScalarOption('Steps', aiInfo.steps),
    formatScalarOption('Sampler', aiInfo.sampler),
    formatScalarOption('CFG scale', aiInfo.cfg_scale),
    formatScalarOption('Seed', aiInfo.seed),
    aiInfo.width && aiInfo.height ? `Size: ${aiInfo.width}x${aiInfo.height}` : null,
    formatScalarOption('Model', aiInfo.model),
    formatScalarOption('Model hash', aiInfo.model_hash),
    formatScalarOption('Denoising strength', aiInfo.denoising_strength),
    formatScalarOption('Clip skip', aiInfo.clip_skip),
    formatScalarOption('LoRA hashes', aiInfo.lora_hashes),
    formatScalarOption('Version', aiInfo.version),
    formatScalarOption('Scheduler', aiInfo.scheduler),
  ].filter((value): value is string => Boolean(value));

  if (optionParts.length === 0) {
    return negativePrompt
      ? `${positivePrompt}\nNegative prompt: ${negativePrompt}`
      : positivePrompt;
  }

  return [
    positivePrompt,
    `Negative prompt: ${negativePrompt}`,
    optionParts.join(', '),
  ].join('\n');
}

export function detectWebPMetadataParserHint(rawData: unknown, aiInfo: AIMetadata | undefined): WebPMetadataParserHint {
  const objectRawData = typeof rawData === 'object' && rawData !== null
    ? rawData as Record<string, any>
    : null;

  if (objectRawData?.parameters || aiInfo?.parameters) {
    return 'webui';
  }

  if (objectRawData?.Comment || objectRawData?.Source || aiInfo?.raw_nai_parameters || aiInfo?.ai_tool === 'NovelAI') {
    return 'novelai';
  }

  if (objectRawData?.comfyui_workflow || aiInfo?.comfyui_workflow || aiInfo?.ai_tool === 'ComfyUI') {
    return 'comfyui';
  }

  return 'unknown';
}

/** Build a primary metadata text string that travels across EXIF/XMP carriers. */
export function buildPrimaryMetadataText(
  rawData: unknown,
  aiInfo: AIMetadata | undefined,
  parserHint: WebPMetadataParserHint = detectWebPMetadataParserHint(rawData, aiInfo)
): string | null {
  const objectRawData = typeof rawData === 'object' && rawData !== null
    ? rawData as Record<string, any>
    : null;

  if (typeof objectRawData?.parameters === 'string' && objectRawData.parameters.trim()) {
    return objectRawData.parameters.trim();
  }

  if (parserHint === 'novelai' && typeof objectRawData?.Comment === 'string' && objectRawData.Comment.trim()) {
    return objectRawData.Comment.trim();
  }

  if (parserHint === 'comfyui' && typeof objectRawData?.comfyui_workflow === 'string' && objectRawData.comfyui_workflow.trim()) {
    return objectRawData.comfyui_workflow.trim();
  }

  if (typeof aiInfo?.parameters === 'string' && aiInfo.parameters.trim()) {
    return aiInfo.parameters.trim();
  }

  if (parserHint === 'novelai' && typeof aiInfo?.raw_nai_parameters === 'string' && aiInfo.raw_nai_parameters.trim()) {
    return aiInfo.raw_nai_parameters.trim();
  }

  if (parserHint === 'comfyui' && typeof aiInfo?.comfyui_workflow === 'string' && aiInfo.comfyui_workflow.trim()) {
    return aiInfo.comfyui_workflow.trim();
  }

  const parameters = buildWebUIParametersFromAiInfo(aiInfo);
  if (parameters) {
    return parameters;
  }

  if (typeof objectRawData?.Comment === 'string' && objectRawData.Comment.trim()) {
    return objectRawData.Comment.trim();
  }

  if (typeof objectRawData?.comfyui_workflow === 'string' && objectRawData.comfyui_workflow.trim()) {
    return objectRawData.comfyui_workflow.trim();
  }

  return null;
}

export function createConaiWebPXmpPayload(input: {
  sourcePath?: string;
  originalFileName?: string;
  mimeType?: string;
  rawData?: Record<string, any> | null;
  aiInfo?: AIMetadata;
  createdAt?: string;
}): ConaiWebPXmpPayload {
  const originalFileName = input.originalFileName || (input.sourcePath ? path.basename(input.sourcePath) : undefined);
  const sourcePath = input.sourcePath;
  const fileExt = sourcePath ? path.extname(sourcePath).toLowerCase() : (originalFileName ? path.extname(originalFileName).toLowerCase() : undefined);
  const format = fileExt ? fileExt.replace(/^\./, '') : undefined;
  const safeRawData = isNonEmptyObject(input.rawData) ? stripUndefined(input.rawData) : undefined;
  const safeAiInfo = isNonEmptyObject(input.aiInfo) ? stripUndefined(input.aiInfo) : undefined;

  return {
    schema: 'conai.image-metadata/v1',
    version: 1,
    createdAt: input.createdAt || new Date().toISOString(),
    source: {
      fileExt,
      format,
      mimeType: input.mimeType,
      originalFileName,
      originalBaseName: originalFileName ? path.basename(originalFileName, path.extname(originalFileName)) : undefined,
    },
    parserHint: detectWebPMetadataParserHint(safeRawData, safeAiInfo),
    ...(safeRawData ? { rawData: safeRawData } : {}),
    ...(safeAiInfo ? { aiInfo: safeAiInfo } : {}),
  };
}

export function buildConaiWebPXmp(payload: ConaiWebPXmpPayload): string {
  const safePayload = stripUndefined(payload);
  const encodedPayload = xmlEscape(JSON.stringify(safePayload));
  const primaryText = buildPrimaryMetadataText(safePayload.rawData, safePayload.aiInfo, safePayload.parserHint);

  const descriptionBlock = primaryText
    ? [
        '      <dc:description>',
        '        <rdf:Alt>',
        `          <rdf:li xml:lang="x-default">${xmlEscape(primaryText)}</rdf:li>`,
        '        </rdf:Alt>',
        '      </dc:description>',
      ].join('')
    : '';

  const primaryTextBlock = primaryText
    ? `      <${PRIMARY_TEXT_TAG}>${xmlEscape(primaryText)}</${PRIMARY_TEXT_TAG}>`
    : '';

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="${CREATOR_TOOL} Image Metadata">`,
    '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    `    <rdf:Description rdf:about="" xmlns:conai="${CONAI_XMP_NAMESPACE}" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">`,
    `      <xmp:CreatorTool>${CREATOR_TOOL}</xmp:CreatorTool>`,
    descriptionBlock,
    primaryTextBlock,
    `      <${PAYLOAD_TAG}>${encodedPayload}</${PAYLOAD_TAG}>`,
    '    </rdf:Description>',
    '  </rdf:RDF>',
    '</x:xmpmeta>',
  ].filter(Boolean).join('');
}

export function parseConaiWebPXmp(xmp: string): ConaiWebPXmpPayload | null {
  const match = xmp.match(/<conai:payload>([\s\S]*?)<\/conai:payload>/i);
  if (!match) {
    return null;
  }

  try {
    const parsed = JSON.parse(xmlUnescape(match[1])) as ConaiWebPXmpPayload;
    if (!SUPPORTED_SCHEMAS.has(parsed?.schema)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function rebuildRawDataFromAiInfo(aiInfo: AIMetadata | undefined, parserHint: WebPMetadataParserHint): Record<string, any> {
  if (!aiInfo) {
    return {};
  }

  if (parserHint === 'novelai' && aiInfo.raw_nai_parameters) {
    return {
      Comment: aiInfo.raw_nai_parameters,
      ...(aiInfo.software ? { Software: aiInfo.software } : {}),
      ...(aiInfo.Source ? { Source: aiInfo.Source } : {}),
    };
  }

  if (parserHint === 'comfyui' && aiInfo.comfyui_workflow) {
    return {
      comfyui_workflow: aiInfo.comfyui_workflow,
    };
  }

  if (aiInfo.parameters) {
    return {
      parameters: aiInfo.parameters,
    };
  }

  const parameters = buildWebUIParametersFromAiInfo(aiInfo);
  if (parameters) {
    return {
      parameters,
      ...(aiInfo.comfyui_workflow ? { comfyui_workflow: aiInfo.comfyui_workflow } : {}),
    };
  }

  if (aiInfo.raw_nai_parameters) {
    return {
      Comment: aiInfo.raw_nai_parameters,
    };
  }

  if (aiInfo.comfyui_workflow) {
    return {
      comfyui_workflow: aiInfo.comfyui_workflow,
    };
  }

  return {};
}

/** Extract human-readable AI metadata text from XMP when no payload-specific parser is available. */
export function extractLikelyAiMetadataTextFromXmp(xmp: string): string | null {
  const payload = parseConaiWebPXmp(xmp);
  if (payload) {
    const fromPayload = buildPrimaryMetadataText(payload.rawData, payload.aiInfo, payload.parserHint);
    if (fromPayload) {
      return fromPayload;
    }
  }

  const primaryMatch = xmp.match(/<conai:primaryText>([\s\S]*?)<\/conai:primaryText>/i);
  if (primaryMatch?.[1]) {
    return xmlUnescape(primaryMatch[1]).trim();
  }

  const descriptionMatch = xmp.match(/<rdf:li[^>]*xml:lang="x-default"[^>]*>([\s\S]*?)<\/rdf:li>/i)
    || xmp.match(/<dc:description[^>]*>([\s\S]*?)<\/dc:description>/i);

  if (descriptionMatch?.[1]) {
    return xmlUnescape(descriptionMatch[1].replace(/<[^>]+>/g, '')).trim();
  }

  return null;
}

export function restoreRawDataFromConaiWebPXmp(payload: ConaiWebPXmpPayload): Record<string, any> {
  if (isNonEmptyObject(payload.rawData)) {
    return payload.rawData;
  }

  return rebuildRawDataFromAiInfo(payload.aiInfo, payload.parserHint);
}
