import { AIMetadata } from '../types';
import { NovelAIParser } from './novelaiParser';
import { WebUIParser } from './webuiParser';
import { ComfyUIParser } from './comfyuiParser';
import { logger } from '../../../utils/logger';

/**
 * Parse a single structured raw metadata payload with ordered parser priority.
 */
function parseStructuredRawMetadata(rawData: any): AIMetadata | null {
  if (!rawData) {
    return null;
  }

  if (NovelAIParser.isNovelAIFormat(rawData)) {
    logger.debug('📦 [MetadataExtractor] Parsing as NovelAI format');
    return NovelAIParser.parse(rawData);
  }

  if (WebUIParser.isWebUIFormat(rawData)) {
    logger.debug('📦 [MetadataExtractor] Parsing as WebUI format');
    const result = WebUIParser.parse(rawData);

    if (rawData.comfyui_workflow && !result.ai_tool) {
      logger.debug('ℹ️ [MetadataExtractor] ComfyUI workflow detected - marking as ComfyUI');
      result.ai_tool = 'ComfyUI';
    }

    return result;
  }

  if (rawData.comfyui_workflow) {
    logger.debug('📦 [MetadataExtractor] Parsing as ComfyUI workflow format (fallback)');
    return ComfyUIParser.parse(rawData);
  }

  return null;
}

/**
 * Parse raw metadata with support for nested stealth payloads.
 */
export function parseRawMetadata(rawData: any): AIMetadata {
  logger.debug('🔍 [parseRawData] Input type:', typeof rawData, {
    hasStealthData: !!rawData?.stealthData,
    stealthDataLength: rawData?.stealthData?.length || 0,
    stealthDataPreview: rawData?.stealthData ? String(rawData.stealthData).substring(0, 100) : undefined,
    hasComfyUIWorkflow: !!rawData?.comfyui_workflow,
    hasParameters: !!rawData?.parameters
  });

  const parsedStructuredData = parseStructuredRawMetadata(rawData);
  if (parsedStructuredData) {
    return parsedStructuredData;
  }

  if (rawData?.stealthData) {
    logger.debug('🔍 [parseRawData] Attempting to parse stealth data...');
    const parsedStealthData = parseStructuredRawMetadata(rawData.stealthData);

    if (parsedStealthData) {
      logger.debug('✅ [parseRawData] Parsed stealth data successfully');
      return parsedStealthData;
    }

    logger.debug('❌ [parseRawData] Stealth data found but format not recognized');
    logger.debug('📄 [parseRawData] Raw stealth data sample:', typeof rawData.stealthData === 'string' ? rawData.stealthData.substring(0, 200) : rawData.stealthData);
  }

  logger.debug('⚠️ [MetadataExtractor] No recognized format found');
  return {};
}
