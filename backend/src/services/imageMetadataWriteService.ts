import fs from 'fs';
import sharp from 'sharp';
import { MetadataExtractor } from './metadata';
import { AIMetadata } from './metadata/types';
import { buildConaiWebPXmp, buildPrimaryMetadataText, createConaiWebPXmpPayload, ConaiWebPXmpPayload } from './metadata/webpMetadata';
import { toWindowsLongPathIfNeeded } from '../utils/pathResolver';

export type ImageOutputFormat = 'png' | 'jpeg' | 'webp';

export interface ImageMetadataWriteOptions {
  format: ImageOutputFormat;
  quality?: number;
  lossless?: boolean;
  sourcePathForMetadata?: string;
  originalFileName?: string;
  mimeType?: string;
  metadataPatch?: Partial<AIMetadata>;
  maxWidth?: number;
  maxHeight?: number;
}

interface ImageMetadataArtifacts {
  payload: ConaiWebPXmpPayload | null;
  xmp: string | null;
  exif: sharp.Exif | null;
}

export interface ImageMetadataWriteResult {
  buffer: Buffer;
  info: sharp.OutputInfo;
  embeddedPayload: ConaiWebPXmpPayload | null;
  xmpApplied: boolean;
  exifApplied: boolean;
}

function clampQuality(quality: number | undefined): number {
  if (typeof quality !== 'number' || Number.isNaN(quality)) {
    return 90;
  }

  return Math.min(100, Math.max(1, Math.round(quality)));
}

/** Apply a metadata patch on top of extracted AI metadata. */
function applyMetadataPatch(baseAiInfo: AIMetadata | undefined, metadataPatch: Partial<AIMetadata> | undefined): AIMetadata | undefined {
  if (!metadataPatch || Object.keys(metadataPatch).length === 0) {
    return baseAiInfo;
  }

  const nextAiInfo: AIMetadata = {
    ...(baseAiInfo || {}),
  };

  for (const [key, value] of Object.entries(metadataPatch)) {
    if (value === null) {
      delete nextAiInfo[key];
      continue;
    }

    if (value !== undefined) {
      nextAiInfo[key] = value;
    }
  }

  if (metadataPatch.prompt !== undefined) {
    if (metadataPatch.prompt === null) {
      delete nextAiInfo.positive_prompt;
    } else {
      nextAiInfo.positive_prompt = metadataPatch.prompt;
    }
  }

  if (metadataPatch.positive_prompt !== undefined) {
    if (metadataPatch.positive_prompt === null) {
      delete nextAiInfo.prompt;
    } else {
      nextAiInfo.prompt = metadataPatch.positive_prompt;
    }
  }

  return Object.keys(nextAiInfo).length > 0 ? nextAiInfo : undefined;
}

/** Build standard EXIF/XMP carriers from extracted source metadata. */
async function buildMetadataArtifacts(options: Pick<ImageMetadataWriteOptions, 'sourcePathForMetadata' | 'originalFileName' | 'mimeType' | 'metadataPatch'>): Promise<ImageMetadataArtifacts> {
  if (!options.sourcePathForMetadata) {
    return {
      payload: null,
      xmp: null,
      exif: null,
    };
  }

  const extracted = await MetadataExtractor.extractPreservableData(options.sourcePathForMetadata);
  const extractedRawData = extracted.rawData && Object.keys(extracted.rawData).length > 0
    ? extracted.rawData
    : undefined;
  const extractedAiInfo = extracted.metadata.ai_info && Object.keys(extracted.metadata.ai_info).length > 0
    ? extracted.metadata.ai_info
    : undefined;
  const aiInfo = applyMetadataPatch(extractedAiInfo, options.metadataPatch);
  const rawData = options.metadataPatch && Object.keys(options.metadataPatch).length > 0
    ? undefined
    : extractedRawData;

  if (!rawData && !aiInfo) {
    return {
      payload: null,
      xmp: null,
      exif: null,
    };
  }

  const payload = createConaiWebPXmpPayload({
    sourcePath: options.sourcePathForMetadata,
    originalFileName: options.originalFileName,
    mimeType: options.mimeType,
    rawData,
    aiInfo,
    createdAt: extracted.metadata.extractedAt,
  });

  const primaryText = buildPrimaryMetadataText(rawData, aiInfo, payload.parserHint);
  const softwareValue = aiInfo?.ai_tool ? `CoNAI (${aiInfo.ai_tool})` : 'CoNAI';

  return {
    payload,
    xmp: buildConaiWebPXmp(payload),
    exif: {
      IFD0: {
        Software: softwareValue,
        ...(primaryText ? { ImageDescription: primaryText } : {}),
      },
      ...(primaryText ? {
        IFD2: {
          UserComment: primaryText,
        },
      } : {}),
    },
  };
}

/** Build a format-specific Sharp pipeline for metadata-aware image output. */
function buildFormatPipeline(input: string | Buffer, options: ImageMetadataWriteOptions): sharp.Sharp {
  let pipeline = typeof input === 'string'
    ? sharp(toWindowsLongPathIfNeeded(input))
    : sharp(input);

  const maxWidth = typeof options.maxWidth === 'number' && Number.isFinite(options.maxWidth) ? Math.max(1, Math.round(options.maxWidth)) : null;
  const maxHeight = typeof options.maxHeight === 'number' && Number.isFinite(options.maxHeight) ? Math.max(1, Math.round(options.maxHeight)) : null;
  if (maxWidth || maxHeight) {
    pipeline = pipeline.resize({
      width: maxWidth ?? undefined,
      height: maxHeight ?? undefined,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  if (options.format === 'png') {
    return pipeline.png();
  }

  if (options.format === 'jpeg') {
    return pipeline.jpeg({
      quality: clampQuality(options.quality),
    });
  }

  return pipeline.webp({
    quality: clampQuality(options.quality),
    lossless: options.lossless ?? false,
  });
}

/** Apply EXIF/XMP carriers onto an output pipeline when available. */
function applyMetadataArtifacts(pipeline: sharp.Sharp, artifacts: ImageMetadataArtifacts): sharp.Sharp {
  let nextPipeline = pipeline;

  if (artifacts.exif) {
    nextPipeline = nextPipeline.withExif(artifacts.exif);
  }

  if (artifacts.xmp) {
    nextPipeline = nextPipeline.withXmp(artifacts.xmp);
  }

  return nextPipeline;
}

export class ImageMetadataWriteService {
  /** Load one source image into memory first to avoid holding a path-based file handle during save. */
  static async writeFileAsFormatBuffer(inputPath: string, options: ImageMetadataWriteOptions): Promise<ImageMetadataWriteResult> {
    const inputBuffer = await fs.promises.readFile(toWindowsLongPathIfNeeded(inputPath));

    return this.writeBufferAsFormatBuffer(inputBuffer, {
      ...options,
      sourcePathForMetadata: options.sourcePathForMetadata || inputPath,
    });
  }

  static async writeBufferAsFormatBuffer(inputBuffer: Buffer, options: ImageMetadataWriteOptions): Promise<ImageMetadataWriteResult> {
    const artifacts = await buildMetadataArtifacts({
      sourcePathForMetadata: options.sourcePathForMetadata,
      originalFileName: options.originalFileName,
      mimeType: options.mimeType,
      metadataPatch: options.metadataPatch,
    });

    const pipelineInput = options.metadataPatch && Object.keys(options.metadataPatch).length > 0
      ? await sharp(inputBuffer).toBuffer()
      : inputBuffer;
    const pipeline = applyMetadataArtifacts(buildFormatPipeline(pipelineInput, options), artifacts);
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

    return {
      buffer: data,
      info,
      embeddedPayload: artifacts.payload,
      xmpApplied: Boolean(artifacts.xmp),
      exifApplied: Boolean(artifacts.exif),
    };
  }
}
