/**
 * Metadata Extractor
 * Unified metadata extraction with primary and secondary extraction
 */

import fs from 'fs';
import path from 'path';
import { ImageMetadata, AIMetadata, LoRAModel } from './types';
import { PngExtractor } from './extractors/pngExtractor';
import { JpegExtractor } from './extractors/jpegExtractor';
import { StealthPngExtractor } from './extractors/stealthPngExtractor';
import { NovelAIParser } from './parsers/novelaiParser';
import { WebUIParser } from './parsers/webuiParser';
import { ComfyUIParser } from './parsers/comfyuiParser';
import { WorkflowDetector } from './parsers/workflowDetector';

export class MetadataExtractor {
  /**
   * Extract metadata from image file (primary + secondary extraction)
   * @param filePath - Image file path
   * @returns ImageMetadata
   */
  static async extractMetadata(filePath: string): Promise<ImageMetadata> {
    const startTime = Date.now();
    const fileName = path.basename(filePath);
    console.log(`⏱️ [MetadataExtractor] Starting extraction: ${fileName}`);

    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File does not exist: ${filePath}`);
      }

      const fileExt = path.extname(filePath).toLowerCase();

      const readStart = Date.now();
      const buffer = await fs.promises.readFile(filePath);
      console.log(`⏱️ [MetadataExtractor] File read (${(buffer.length / 1024).toFixed(1)}KB): ${Date.now() - readStart}ms`);

      // 1차 추출 (Primary extraction)
      const primaryStart = Date.now();
      let aiInfo = await this.primaryExtraction(buffer, filePath, fileExt);
      console.log(`⏱️ [MetadataExtractor] Primary extraction: ${Date.now() - primaryStart}ms`);

      // 프롬프트 추출 실패 여부 확인 (빈 문자열과 공백만 있는 경우도 실패로 처리)
      const hasPrompt = Boolean(
        (aiInfo.prompt && typeof aiInfo.prompt === 'string' && aiInfo.prompt.trim()) ||
        (aiInfo.positive_prompt && typeof aiInfo.positive_prompt === 'string' && aiInfo.positive_prompt.trim())
      );

      console.log(`🔍 [MetadataExtractor] Primary extraction result:`, {
        hasPrompt,
        promptLength: aiInfo.prompt?.length || 0,
        positivePromptLength: aiInfo.positive_prompt?.length || 0,
        promptPreview: (aiInfo.prompt || aiInfo.positive_prompt)?.substring(0, 50)
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
          console.log('⚡ [MetadataExtractor] Skipping Stealth PNG for ComfyUI (setting enabled)');
        } else if ((aiInfo.ai_tool === 'Automatic1111' || aiInfo.ai_tool === 'Stable Diffusion') && metadataSettings.skipStealthForWebUI) {
          console.log('⚡ [MetadataExtractor] Skipping Stealth PNG for WebUI (setting enabled)');
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
                console.log(`⏱️ [MetadataExtractor] Secondary extraction: ${Date.now() - secondaryStart}ms`);
              }
            } else {
              // width/height가 없으면 Secondary extraction 실행
              console.log(`⚠️ [MetadataExtractor] Primary extraction failed - attempting Stealth PNG Info (mode: ${metadataSettings.stealthScanMode})`);

              const secondaryStart = Date.now();
              aiInfo = await this.secondaryExtraction(buffer, aiInfo, metadataSettings.stealthScanMode);
              console.log(`⏱️ [MetadataExtractor] Secondary extraction: ${Date.now() - secondaryStart}ms`);
            }
          }
        }
      }

      // 워크플로 JSON 검증 및 필터링
      if (aiInfo.prompt) {
        if (WorkflowDetector.isWorkflowJSON(aiInfo.prompt)) {
          const workflowInfo = WorkflowDetector.extractWorkflowInfo(aiInfo.prompt);
          console.warn(`⚠️ [MetadataExtractor] Workflow JSON detected - invalidating prompt`, workflowInfo);

          // 워크플로 JSON을 프롬프트로 저장하지 않음
          aiInfo.prompt = undefined;
          aiInfo.positive_prompt = undefined;
        }
      }

      // Negative prompt도 검증
      if (aiInfo.negative_prompt) {
        if (WorkflowDetector.isWorkflowJSON(aiInfo.negative_prompt)) {
          console.warn(`⚠️ [MetadataExtractor] Workflow JSON in negative prompt - invalidating`);
          aiInfo.negative_prompt = undefined;
        }
      }

      // AI 도구 자동 감지
      const detectStart = Date.now();
      this.detectAITool(aiInfo);
      console.log(`⏱️ [MetadataExtractor] AI tool detection: ${Date.now() - detectStart}ms`);

      // LoRA 모델 정보 처리
      const loraStart = Date.now();
      this.processLoRAModels(aiInfo);
      console.log(`⏱️ [MetadataExtractor] LoRA processing: ${Date.now() - loraStart}ms`);

      // AI 정보가 없어도 기본값 설정하지 않음
      // 프롬프트가 없으면 prompt 필드를 undefined로 유지
      if (!aiInfo || Object.keys(aiInfo).length === 0) {
        aiInfo = {
          ai_tool: 'Unknown'
          // prompt는 설정하지 않음 (undefined)
        };
      }

      const totalTime = Date.now() - startTime;
      console.log(`⏱️ [MetadataExtractor] ✅ Total extraction time: ${totalTime}ms`);

      return {
        extractedAt: new Date().toISOString(),
        ai_info: aiInfo
      };
    } catch (error) {
      console.error(`⏱️ [MetadataExtractor] ❌ Failed after ${Date.now() - startTime}ms:`, error);
      return {
        extractedAt: new Date().toISOString(),
        ai_info: {
          ai_tool: 'Unknown'
          // prompt는 설정하지 않음 (undefined)
        },
        error: 'Failed to extract metadata'
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
    let rawData: any = {};

    // Extract raw data based on file type
    if (fileExt === '.png') {
      rawData = PngExtractor.extract(buffer);
    } else if (['.jpg', '.jpeg'].includes(fileExt)) {
      rawData = await JpegExtractor.extract(filePath);
    }

    // Parse raw data
    return this.parseRawData(rawData);
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
      console.log(`🔍 [secondaryExtraction] Starting Stealth PNG Info extraction (mode: ${scanMode})...`);
      console.log('📊 [secondaryExtraction] Buffer size:', buffer.length, 'bytes');

      const stealthData = await StealthPngExtractor.extractStealthPngInfo(buffer, scanMode);

      if (!stealthData) {
        console.log('❌ [secondaryExtraction] Stealth PNG Info not found - keeping original');
        console.log('📋 [secondaryExtraction] Original aiInfo:', {
          hasPrompt: !!existingAiInfo.prompt,
          hasPositivePrompt: !!existingAiInfo.positive_prompt,
          aiTool: existingAiInfo.ai_tool
        });
        return existingAiInfo;
      }

      console.log('✅ [secondaryExtraction] Stealth PNG Info extracted successfully!');
      console.log(`📊 [secondaryExtraction] Stealth data length: ${stealthData.length} characters`);
      console.log('📄 [secondaryExtraction] First 200 chars:', stealthData.substring(0, 200));
      console.log('📄 [secondaryExtraction] Last 100 chars:', stealthData.substring(Math.max(0, stealthData.length - 100)));

      // Check if stealth data looks like JSON or WebUI format
      const looksLikeJSON = stealthData.trim().startsWith('{') || stealthData.trim().startsWith('[');
      const looksLikeWebUI = stealthData.includes('Steps:') || stealthData.includes('parameters');
      console.log('🔍 [secondaryExtraction] Data format hints:', {
        looksLikeJSON,
        looksLikeWebUI,
        startsWithBrace: stealthData.trim()[0],
        includesSteps: stealthData.includes('Steps:'),
        includesParameters: stealthData.includes('parameters')
      });

      // Parse Stealth data
      console.log('🔄 [secondaryExtraction] Calling parseRawData...');
      const parsedData = this.parseRawData({ stealthData });

      console.log('📦 [secondaryExtraction] Parse result:', {
        hasPrompt: !!parsedData.prompt,
        hasPositivePrompt: !!parsedData.positive_prompt,
        hasNegativePrompt: !!parsedData.negative_prompt,
        aiTool: parsedData.ai_tool,
        promptPreview: (parsedData.prompt || parsedData.positive_prompt)?.substring(0, 50)
      });

      if (parsedData && (parsedData.prompt || parsedData.positive_prompt)) {
        const finalPrompt = parsedData.prompt || parsedData.positive_prompt;
        const trimmedPrompt = finalPrompt?.trim();

        if (trimmedPrompt && trimmedPrompt.length > 0) {
          console.log('✅ [secondaryExtraction] Successfully parsed Stealth PNG Info with valid prompts');
          console.log('📝 [secondaryExtraction] Extracted prompt length:', trimmedPrompt.length);
          return parsedData;
        } else {
          console.log('⚠️ [secondaryExtraction] Prompt exists but is empty or whitespace only');
        }
      }

      // Parsing failed - keep original
      console.log('❌ [secondaryExtraction] Stealth data parsing failed - no valid prompts found');
      console.log('📋 [secondaryExtraction] Reverting to original aiInfo');
      return existingAiInfo;
    } catch (error) {
      console.error('❌ [secondaryExtraction] Exception occurred:', error);
      if (error instanceof Error) {
        console.error('📋 [secondaryExtraction] Error stack:', error.stack);
      }
      return existingAiInfo;
    }
  }

  /**
   * Parse raw data using appropriate parser
   */
  private static parseRawData(rawData: any): AIMetadata {
    console.log('🔍 [parseRawData] Input type:', typeof rawData, {
      hasStealthData: !!rawData.stealthData,
      stealthDataLength: rawData.stealthData?.length || 0,
      stealthDataPreview: rawData.stealthData?.substring(0, 100),
      hasComfyUIWorkflow: !!rawData.comfyui_workflow,
      hasParameters: !!rawData.parameters
    });

    // PRIORITY 1: Try NovelAI parser (most specific format)
    if (NovelAIParser.isNovelAIFormat(rawData)) {
      console.log('📦 [MetadataExtractor] Parsing as NovelAI format');
      return NovelAIParser.parse(rawData);
    }

    // PRIORITY 2: Try WebUI parser (reliable prompt extraction)
    if (WebUIParser.isWebUIFormat(rawData)) {
      console.log('📦 [MetadataExtractor] Parsing as WebUI format');
      const result = WebUIParser.parse(rawData);

      // If ComfyUI workflow exists, use it for AI tool detection
      if (rawData.comfyui_workflow && !result.ai_tool) {
        console.log('ℹ️ [MetadataExtractor] ComfyUI workflow detected - marking as ComfyUI');
        result.ai_tool = 'ComfyUI';
      }

      return result;
    }

    // PRIORITY 3: Try ComfyUI workflow parser (fallback, less reliable for prompts)
    if (rawData.comfyui_workflow) {
      console.log('📦 [MetadataExtractor] Parsing as ComfyUI workflow format (fallback)');
      return ComfyUIParser.parse(rawData);
    }

    // Try parsing stealth data if present
    if (rawData.stealthData) {
      console.log('🔍 [parseRawData] Attempting to parse stealth data...');

      // Try NovelAI
      const isNovelAI = NovelAIParser.isNovelAIFormat(rawData.stealthData);
      console.log('🔍 [parseRawData] Is NovelAI format?', isNovelAI);

      if (isNovelAI) {
        console.log('📦 [MetadataExtractor] Parsing stealth data as NovelAI format');
        const result = NovelAIParser.parse(rawData.stealthData);
        console.log('✅ [parseRawData] NovelAI parse result:', {
          hasPrompt: !!result.prompt,
          hasPositivePrompt: !!result.positive_prompt,
          hasNegativePrompt: !!result.negative_prompt
        });
        return result;
      }

      // Try WebUI
      const isWebUI = WebUIParser.isWebUIFormat(rawData.stealthData);
      console.log('🔍 [parseRawData] Is WebUI format?', isWebUI);

      if (isWebUI) {
        console.log('📦 [MetadataExtractor] Parsing stealth data as WebUI format');
        const result = WebUIParser.parse(rawData.stealthData);
        console.log('✅ [parseRawData] WebUI parse result:', {
          hasPrompt: !!result.prompt,
          hasPositivePrompt: !!result.positive_prompt,
          hasNegativePrompt: !!result.negative_prompt
        });
        return result;
      }

      console.log('❌ [parseRawData] Stealth data found but format not recognized');
      console.log('📄 [parseRawData] Raw stealth data sample:', rawData.stealthData.substring(0, 200));
    }

    // No recognized format - return empty
    console.log('⚠️ [MetadataExtractor] No recognized format found');
    return {};
  }

  /**
   * Detect AI tool from metadata
   */
  private static detectAITool(aiInfo: AIMetadata): void {
    if (!aiInfo) return;

    // Already detected
    if (aiInfo.ai_tool && aiInfo.ai_tool !== 'Unknown') return;

    // Detect from content
    const text = JSON.stringify(aiInfo).toLowerCase();

    if (text.includes('comfyui') || text.includes('comfy ui')) {
      aiInfo.ai_tool = 'ComfyUI';
    } else if (text.includes('novelai') || text.includes('novel ai')) {
      aiInfo.ai_tool = 'NovelAI';
    } else if (text.includes('automatic1111') || text.includes('webui')) {
      aiInfo.ai_tool = 'Automatic1111';
    } else if (text.includes('invokeai') || text.includes('invoke ai')) {
      aiInfo.ai_tool = 'InvokeAI';
    } else if (text.includes('midjourney')) {
      aiInfo.ai_tool = 'Midjourney';
    } else if (text.includes('dall-e') || text.includes('dalle')) {
      aiInfo.ai_tool = 'DALL-E';
    } else if (text.includes('stable diffusion') || text.includes('sd ')) {
      aiInfo.ai_tool = 'Stable Diffusion';
    } else {
      aiInfo.ai_tool = 'Unknown';
    }
  }

  /**
   * Process LoRA models information
   */
  private static processLoRAModels(aiInfo: AIMetadata): void {
    if (!aiInfo) return;

    // Already processed
    if (aiInfo.lora_models && Array.isArray(aiInfo.lora_models)) {
      return;
    }

    // Extract from prompt
    const promptText = aiInfo.positive_prompt || aiInfo.prompt;
    if (promptText) {
      const loras = this.extractLoRAInfo(promptText);
      if (loras.length > 0) {
        aiInfo.lora_models = loras;
      }
    }
  }

  /**
   * Extract LoRA information from prompt
   * Returns array of LoRA names (for compatibility with existing type)
   */
  private static extractLoRAInfo(prompt: string): string[] {
    const loraRegex = /<lora:([^:]+):([\d.]+)>/g;
    const loras: string[] = [];
    let match;

    while ((match = loraRegex.exec(prompt)) !== null) {
      loras.push(match[1]);  // Only store name for compatibility
    }

    return loras;
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
export { StealthPngExtractor } from './extractors/stealthPngExtractor';
