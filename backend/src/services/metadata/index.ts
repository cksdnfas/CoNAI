/**
 * Metadata Extractor
 * Unified metadata extraction with primary and secondary extraction
 */

import fs from 'fs';
import path from 'path';
import { ImageMetadata, AIMetadata } from './types';
import { StealthPngExtractor } from './extractors/stealthPngExtractor';
import { readRawMetadata } from './readers/rawMetadataReaders';
import { parseRawMetadata } from './parsers/rawMetadataParsers';
import { normalizeExtractedMetadata } from './normalizeMetadata';
import { MetadataExtractionError } from '../../types/errors';
import { assertFileReadable } from '../../utils/fileAccess';
import { logger } from '../../utils/logger';

export class MetadataExtractor {
  /**
   * Extract raw parser input plus parsed metadata for metadata-preserving conversions.
   */
  static async extractPreservableData(filePath: string): Promise<{
    metadata: ImageMetadata;
    rawData: Record<string, any>;
  }> {
    await assertFileReadable(filePath);

    const fileExt = path.extname(filePath).toLowerCase();
    const buffer = await fs.promises.readFile(filePath);
    const rawData = await this.extractRawData(buffer, filePath, fileExt);
    const metadata = await this.extractMetadata(filePath);

    return {
      metadata,
      rawData,
    };
  }

  /**
   * Extract metadata from image file (primary + secondary extraction)
   * @param filePath - Image file path
   * @returns ImageMetadata
   */
  static async extractMetadata(filePath: string): Promise<ImageMetadata> {
    const startTime = Date.now();
    const fileName = path.basename(filePath);
    logger.debug(`⏱️ [MetadataExtractor] Starting extraction: ${fileName}`);

    try {
      // 파일 접근 권한 체크 (존재 여부 + 읽기 권한)
      try {
        await assertFileReadable(filePath);
      } catch (error) {
        // 파일 접근 오류 - 재시도 가능한 오류로 throw
        throw MetadataExtractionError.fromNodeError(filePath, error as NodeJS.ErrnoException);
      }

      const fileExt = path.extname(filePath).toLowerCase();

      const readStart = Date.now();
      let buffer: Buffer;
      try {
        buffer = await fs.promises.readFile(filePath);
      } catch (error) {
        // 파일 읽기 오류 - 권한 또는 접근 오류
        throw MetadataExtractionError.fromNodeError(filePath, error as NodeJS.ErrnoException);
      }
      logger.debug(`⏱️ [MetadataExtractor] File read (${(buffer.length / 1024).toFixed(1)}KB): ${Date.now() - readStart}ms`);

      // 1차 추출 (Primary extraction)
      const primaryStart = Date.now();
      let aiInfo = await this.primaryExtraction(buffer, filePath, fileExt);
      logger.debug(`⏱️ [MetadataExtractor] Primary extraction: ${Date.now() - primaryStart}ms`);

      // 프롬프트 추출 실패 여부 확인 (빈 문자열과 공백만 있는 경우도 실패로 처리)
      const hasPrompt = Boolean(
        (aiInfo.prompt && typeof aiInfo.prompt === 'string' && aiInfo.prompt.trim()) ||
        (aiInfo.positive_prompt && typeof aiInfo.positive_prompt === 'string' && aiInfo.positive_prompt.trim())
      );

      const promptPreviewRaw = aiInfo.prompt || aiInfo.positive_prompt;
      const promptPreview = typeof promptPreviewRaw === 'string'
        ? promptPreviewRaw.substring(0, 50)
        : (promptPreviewRaw ? String(promptPreviewRaw).substring(0, 50) : undefined);

      logger.debug(`🔍 [MetadataExtractor] Primary extraction result:`, {
        hasPrompt,
        promptLength: aiInfo.prompt?.length || 0,
        positivePromptLength: aiInfo.positive_prompt?.length || 0,
        promptPreview
      });

      if (!hasPrompt && fileExt === '.png') {
        // 설정 로드
        const { settingsService } = await import('../../services/settingsService');
        const settings = settingsService.loadSettings();
        const metadataSettings = settings.metadataExtraction;

        // Secondary extraction 비활성화 체크
        if (!metadataSettings.enableSecondaryExtraction) {
          console.log('⚡ [MetadataExtractor] Secondary extraction disabled in settings');
          // Skip secondary extraction - proceed with primary result
        } else if (aiInfo.ai_tool === 'ComfyUI' && metadataSettings.skipStealthForComfyUI) {
          // AI 도구 기반 스킵
          logger.debug('⚡ [MetadataExtractor] Skipping Stealth PNG for ComfyUI (setting enabled)');
        } else if ((aiInfo.ai_tool === 'Automatic1111' || aiInfo.ai_tool === 'Stable Diffusion') && metadataSettings.skipStealthForWebUI) {
          logger.debug('⚡ [MetadataExtractor] Skipping Stealth PNG for WebUI (setting enabled)');
        } else {
          // 파일 크기 체크
          const fileSizeMB = buffer.length / (1024 * 1024);
          if (fileSizeMB > metadataSettings.stealthMaxFileSizeMB) {
            console.log(`⚡ [MetadataExtractor] File too large for Stealth PNG scan (${fileSizeMB.toFixed(1)}MB > ${metadataSettings.stealthMaxFileSizeMB}MB)`);
          } else {
            // 해상도 체크를 위해 Sharp 메타데이터 가져오기
            const sharp = (await import('sharp')).default;
            const imageMetadata = await sharp(buffer).metadata();

            if (imageMetadata.width && imageMetadata.height) {
              const megaPixels = (imageMetadata.width * imageMetadata.height) / 1_000_000;
              if (megaPixels > metadataSettings.stealthMaxResolutionMP) {
                console.log(`⚡ [MetadataExtractor] Resolution too high for Stealth PNG scan (${megaPixels.toFixed(1)}MP > ${metadataSettings.stealthMaxResolutionMP}MP)`);
              } else {
                // 모든 조건 통과 - Secondary extraction 실행
                console.log(`⚠️ [MetadataExtractor] Primary extraction failed - attempting Stealth PNG Info (mode: ${metadataSettings.stealthScanMode})`);

                // 2차 추출 (Secondary extraction - Stealth PNG Info)
                const secondaryStart = Date.now();
                aiInfo = await this.secondaryExtraction(buffer, aiInfo, metadataSettings.stealthScanMode);

                // Fast Scan 실패 시 Full Scan 자동 재시도
                // 프론트엔드는 항상 Full Scan을 수행하므로, 백엔드도 동일한 정확도를 보장해야 함
                const hasStealthPrompt = Boolean(aiInfo.prompt || aiInfo.positive_prompt);

                if (!hasStealthPrompt && metadataSettings.stealthScanMode === 'fast') {
                  console.log('⚠️ [MetadataExtractor] Fast scan failed to find prompt - retrying with FULL scan');
                  aiInfo = await this.secondaryExtraction(buffer, aiInfo, 'full');
                }

                logger.debug(`⏱️ [MetadataExtractor] Secondary extraction: ${Date.now() - secondaryStart}ms`);

                // 최종 결과 확인
                if (aiInfo.prompt || aiInfo.positive_prompt) {
                  logger.info('✅ [MetadataExtractor] Prompt successfully extracted via Stealth PNG');
                }
              }
            } else {
              // width/height가 없으면 Secondary extraction 실행
              console.log(`⚠️ [MetadataExtractor] Primary extraction failed - attempting Stealth PNG Info (mode: ${metadataSettings.stealthScanMode})`);

              const secondaryStart = Date.now();
              aiInfo = await this.secondaryExtraction(buffer, aiInfo, metadataSettings.stealthScanMode);

              // Fast Scan 실패 시 Full Scan 자동 재시도
              const hasStealthPrompt = Boolean(aiInfo.prompt || aiInfo.positive_prompt);
              if (!hasStealthPrompt && metadataSettings.stealthScanMode === 'fast') {
                console.log('⚠️ [MetadataExtractor] Fast scan failed to find prompt - retrying with FULL scan');
                aiInfo = await this.secondaryExtraction(buffer, aiInfo, 'full');
              }

              logger.debug(`⏱️ [MetadataExtractor] Secondary extraction: ${Date.now() - secondaryStart}ms`);
            }
          }
        }
      }

      // Normalize parsed metadata (workflow guard, AI tool detection, LoRA extraction)
      const normalizeStart = Date.now();
      normalizeExtractedMetadata(aiInfo);
      logger.debug(`⏱️ [MetadataExtractor] Metadata normalization: ${Date.now() - normalizeStart}ms`);

      // AI 정보가 없어도 기본값 설정하지 않음
      // 프롬프트가 없으면 prompt 필드를 undefined로 유지
      if (!aiInfo || Object.keys(aiInfo).length === 0) {
        aiInfo = {
          ai_tool: 'Unknown'
          // prompt는 설정하지 않음 (undefined)
        };
      }

      const totalTime = Date.now() - startTime;
      logger.debug(`⏱️ [MetadataExtractor] ✅ Total extraction time: ${totalTime}ms`);

      return {
        extractedAt: new Date().toISOString(),
        ai_info: aiInfo
      };
    } catch (error) {
      logger.error(`⏱️ [MetadataExtractor] ❌ Failed after ${Date.now() - startTime}ms:`, error);

      // MetadataExtractionError인 경우 재throw (재시도 가능 오류)
      if (error instanceof MetadataExtractionError) {
        throw error;
      }

      // 기타 오류는 파싱 오류로 처리 (재시도 불필요)
      const parsingError = MetadataExtractionError.parsingError(
        filePath,
        error as Error
      );

      // 파싱 오류는 재시도 불필요하므로 기본값 반환
      return {
        extractedAt: new Date().toISOString(),
        ai_info: {
          ai_tool: 'Unknown'
          // prompt는 설정하지 않음 (undefined)
        },
        error: parsingError.message
      };
    }
  }

  /**
   * Primary extraction (PNG/JPEG standard metadata)
   */
  private static async primaryExtraction(
    buffer: Buffer,
    filePath: string,
    fileExt: string
  ): Promise<AIMetadata> {
    const rawData = await this.extractRawData(buffer, filePath, fileExt);

    // Parse raw data
    return parseRawMetadata(rawData);
  }

  /**
   * Extract raw parser input based on file type.
   */
  private static async extractRawData(
    buffer: Buffer,
    filePath: string,
    fileExt: string
  ): Promise<Record<string, any>> {
    return readRawMetadata({
      buffer,
      filePath,
      fileExt,
    });
  }

  /**
   * Secondary extraction (Stealth PNG Info)
   */
  private static async secondaryExtraction(
    buffer: Buffer,
    existingAiInfo: AIMetadata,
    scanMode: import('../../types/settings').StealthScanMode = 'fast'
  ): Promise<AIMetadata> {
    try {
      logger.debug(`🔍 [secondaryExtraction] Starting Stealth PNG Info extraction (mode: ${scanMode})...`);
      logger.debug(`📊 [secondaryExtraction] Buffer size: ${buffer.length} bytes`);

      const stealthData = await StealthPngExtractor.extractStealthPngInfo(buffer, scanMode);

      if (!stealthData) {
        logger.debug('❌ [secondaryExtraction] Stealth PNG Info not found - keeping original');
        logger.debug('📋 [secondaryExtraction] Original aiInfo:', {
          hasPrompt: !!existingAiInfo.prompt,
          hasPositivePrompt: !!existingAiInfo.positive_prompt,
          aiTool: existingAiInfo.ai_tool
        });
        return existingAiInfo;
      }

      logger.debug('✅ [secondaryExtraction] Stealth PNG Info extracted successfully!');
      logger.debug(`📊 [secondaryExtraction] Stealth data length: ${stealthData.length} characters`);
      logger.debug('📄 [secondaryExtraction] First 200 chars:', stealthData.substring(0, 200));
      logger.debug('📄 [secondaryExtraction] Last 100 chars:', stealthData.substring(Math.max(0, stealthData.length - 100)));

      // Check if stealth data looks like JSON or WebUI format
      const looksLikeJSON = stealthData.trim().startsWith('{') || stealthData.trim().startsWith('[');
      const looksLikeWebUI = stealthData.includes('Steps:') || stealthData.includes('parameters');
      logger.debug('🔍 [secondaryExtraction] Data format hints:', {
        looksLikeJSON,
        looksLikeWebUI,
        startsWithBrace: stealthData.trim()[0],
        includesSteps: stealthData.includes('Steps:'),
        includesParameters: stealthData.includes('parameters')
      });

      // Parse Stealth data
      logger.debug('🔄 [secondaryExtraction] Calling parseRawData...');
      const parsedData = parseRawMetadata({ stealthData });

      logger.debug('📦 [secondaryExtraction] Parse result:', {
        hasPrompt: !!parsedData.prompt,
        hasPositivePrompt: !!parsedData.positive_prompt,
        hasNegativePrompt: !!parsedData.negative_prompt,
        aiTool: parsedData.ai_tool,
        promptPreview: String(parsedData.prompt || parsedData.positive_prompt || '').substring(0, 50)
      });

      if (parsedData && (parsedData.prompt || parsedData.positive_prompt)) {
        const finalPrompt = parsedData.prompt || parsedData.positive_prompt;
        const trimmedPrompt = finalPrompt?.trim();

        if (trimmedPrompt && trimmedPrompt.length > 0) {
          logger.debug('✅ [secondaryExtraction] Successfully parsed Stealth PNG Info with valid prompts');
          logger.debug('📝 [secondaryExtraction] Extracted prompt length:', trimmedPrompt.length);
          return parsedData;
        } else {
          logger.debug('⚠️ [secondaryExtraction] Prompt exists but is empty or whitespace only');
        }
      }

      // Parsing failed - keep original
      logger.debug('❌ [secondaryExtraction] Stealth data parsing failed - no valid prompts found');
      logger.debug('📋 [secondaryExtraction] Reverting to original aiInfo');
      return existingAiInfo;
    } catch (error) {
      logger.error('❌ [secondaryExtraction] Exception occurred:', error);
      if (error instanceof Error) {
        logger.error('📋 [secondaryExtraction] Error stack:', error.stack);
      }
      return existingAiInfo;
    }
  }
}

// Re-export types for convenience
export * from './types';
export { NovelAIParser } from './parsers/novelaiParser';
export { WebUIParser } from './parsers/webuiParser';
export { ComfyUIParser } from './parsers/comfyuiParser';
export { WorkflowDetector } from './parsers/workflowDetector';
export { PngExtractor } from './extractors/pngExtractor';
export { JpegExtractor } from './extractors/jpegExtractor';
export { WebPExtractor } from './extractors/webpExtractor';
export { WebPStealthExtractor } from './extractors/webpStealthExtractor';
export { StealthPngExtractor } from './extractors/stealthPngExtractor';
