import { Router, Request, Response } from 'express';
import { routeParam } from '../routeParam';
import { WorkflowModel } from '../../models/Workflow';
import { createComfyUIService } from '../../services/comfyuiService';
import { WorkflowResponse, GenerationStatusResponse } from '../../types/workflow';
import { asyncHandler } from '../../middleware/errorHandler';
import { runtimePaths, publicUrls } from '../../config/runtimePaths';
import path from 'path';
import fs from 'fs';
import { GenerationHistoryService } from '../../services/generationHistoryService';
import type { GeneratedImageSaveOptions } from '../../utils/fileSaver';
import { ComfyUIWorkflowParser } from '../../utils/comfyuiWorkflowParser';
import { GenerationHistoryModel } from '../../models/GenerationHistory';

const router = Router();

interface WorkflowImageFieldPayload {
  fileName?: string;
  dataUrl?: string;
}

/** Convert a data URL payload into a Buffer that can be uploaded to ComfyUI. */
function parseImageFieldDataUrl(dataUrl: string): Buffer {
  const sanitized = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  return Buffer.from(sanitized, 'base64');
}

/** Create a safe upload filename for ComfyUI input images. */
function buildWorkflowImageUploadName(fileName?: string): string {
  const sourceName = (fileName || 'workflow-image.png').trim();
  const ext = path.extname(sourceName) || '.png';
  const baseName = path.basename(sourceName, ext).replace(/[^a-zA-Z0-9_-]/g, '_') || 'workflow-image';
  return `${baseName}_${Date.now()}${ext}`;
}

/** Upload image marked-field payloads to ComfyUI and replace them with stored filenames. */
async function prepareWorkflowPromptData(
  comfyService: ReturnType<typeof createComfyUIService>,
  markedFields: Array<{ id: string; type: string }>,
  promptData: Record<string, any>,
): Promise<Record<string, any>> {
  const preparedPromptData = { ...promptData };

  for (const field of markedFields) {
    if (field.type !== 'image') {
      continue;
    }

    const value = preparedPromptData[field.id];
    if (!value || typeof value !== 'object') {
      continue;
    }

    const payload = value as WorkflowImageFieldPayload;
    if (typeof payload.dataUrl !== 'string' || payload.dataUrl.trim().length === 0) {
      continue;
    }

    const fileName = buildWorkflowImageUploadName(payload.fileName);
    const imageBuffer = parseImageFieldDataUrl(payload.dataUrl);
    const uploadedName = await comfyService.uploadInputImage(fileName, imageBuffer);
    preparedPromptData[field.id] = uploadedName;
  }

  return preparedPromptData;
}

/**
 * 이미지 생성 요청
 * POST /api/workflows/:id/generate
 */
router.post('/:id/generate', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(routeParam(req.params.id)));
  const { prompt_data, server_id, groupId, source_image, imageSaveOptions } = req.body as {
    prompt_data?: Record<string, any>;
    server_id?: number;
    groupId?: string | number;
    source_image?: string;
    imageSaveOptions?: GeneratedImageSaveOptions;
  };

  if (isNaN(id) || !prompt_data) {
    return res.status(400).json({
      success: false,
      error: 'Workflow ID and prompt_data are required'
    } as WorkflowResponse);
  }

  try {
    // 워크플로우 조회
    const workflow = await WorkflowModel.findById(id);
    if (!workflow) {
      return res.status(404).json({
        success: false,
        error: 'Workflow not found'
      } as WorkflowResponse);
    }

    if (!workflow.is_active) {
      return res.status(400).json({
        success: false,
        error: 'Workflow is not active'
      } as WorkflowResponse);
    }

    // 서버 선택 로직
    let apiEndpoint = workflow.api_endpoint; // 기본값
    let serverName = 'default';

    if (server_id) {
      const { ComfyUIServerModel } = await import('../../models/ComfyUIServer');
      const server = await ComfyUIServerModel.findById(server_id);
      if (server && server.is_active) {
        apiEndpoint = server.endpoint;
        serverName = server.name;
        console.log(`🎯 Using selected server: ${serverName} (${apiEndpoint})`);
      }
    }

    const comfyService = createComfyUIService(apiEndpoint);
    const markedFields = workflow.marked_fields ? JSON.parse(workflow.marked_fields) : [];
    const preparedPromptData = await prepareWorkflowPromptData(comfyService, markedFields, prompt_data);
    const substitutedWorkflow = comfyService.substitutePromptData(
      workflow.workflow_json,
      markedFields,
      preparedPromptData,
    );

    // 전송 데이터 로깅
    console.log('📨 Image generation request:', {
      workflow_id: id,
      workflow_name: workflow.name,
      server: serverName,
      endpoint: apiEndpoint,
      prompt_data_keys: Object.keys(preparedPromptData),
      prompt_data_size: JSON.stringify(preparedPromptData).length
    });

    // Parse workflow to extract generation parameters
    const workflowJson = JSON.parse(workflow.workflow_json);
    const extractedParams = ComfyUIWorkflowParser.extractWithSubstitution(workflowJson, preparedPromptData);

    console.log('📊 Extracted workflow parameters:', {
      positive: extractedParams.positivePrompt.substring(0, 50) + '...',
      negative: extractedParams.negativePrompt?.substring(0, 30) + '...',
      dimensions: `${extractedParams.width}x${extractedParams.height}`,
      steps: extractedParams.steps,
      sampler: extractedParams.sampler
    });

    // API Generation History 생성
    let historyId: number | undefined;
    try {
      historyId = await GenerationHistoryService.createComfyUIHistory({
        workflow: substitutedWorkflow,
        workflowId: id,
        workflowName: workflow.name,
        promptId: '', // Will be updated after ComfyUI submission
        positivePrompt: extractedParams.positivePrompt,
        negativePrompt: extractedParams.negativePrompt,
        width: extractedParams.width,
        height: extractedParams.height,
        groupId: groupId !== undefined && groupId !== null ? Number(groupId) : undefined, // User-selected group for automatic assignment
        metadata: {
          server_endpoint: apiEndpoint,
          server_name: serverName,
          sampler: extractedParams.sampler,
          steps: extractedParams.steps,
          cfg_scale: extractedParams.cfg_scale,
          model: extractedParams.model
        }
      });
      console.log(`✅ Generation history created: ${historyId}`);
    } catch (historyError) {
      console.error('⚠️ Failed to create generation history (non-critical):', historyError);
    }

    // 백그라운드에서 이미지 생성 프로세스 실행
    (async () => {
      const startTime = Date.now();

      try {
        console.log(`📤 Sending to ComfyUI: ${apiEndpoint}`);

        // 이미지 생성 (temp 폴더에 다운로드)
        const { promptId, imagePaths: tempFilePaths } = await comfyService.generateImages(workflow, substitutedWorkflow);

        // promptId 업데이트
        if (historyId) {
          try {
            const history = await GenerationHistoryService.getHistory(historyId);
            if (history) {
              // JOIN으로 계산된 필드 제거 (actual_* 필드는 테이블에 없음)
              const historyAny = history as any;
              const { actual_composite_hash, actual_thumbnail_path, actual_width, actual_height, ...baseHistory } = historyAny;

              const updatedRecord = {
                ...baseHistory,
                comfyui_prompt_id: promptId,
                generation_status: 'processing' as const
              };
              GenerationHistoryModel.update(historyId, updatedRecord);
              console.log(`✅ History ${historyId} updated with promptId: ${promptId}`);
            }
          } catch (e) {
            console.error('⚠️ Failed to update history with promptId:', e);
          }
        }

        for (const tempPath of tempFilePaths) {
          try {
            // Read temp file
            const imageBuffer = await fs.promises.readFile(tempPath);

            const { APIImageProcessor } = await import('../../services/APIImageProcessor');
            const processedPaths = await APIImageProcessor.processGeneratedImage(imageBuffer, 'comfyui', {
              ...imageSaveOptions,
              sourcePathForMetadata: tempPath,
              originalFileName: path.basename(tempPath),
            });

            fs.unlinkSync(tempPath);

            console.log(`✅ ComfyUI image saved: ${processedPaths.originalPath}`);

            if (historyId && tempFilePaths.indexOf(tempPath) === 0) {
              GenerationHistoryModel.updateImagePaths(historyId, {
                original: processedPaths.originalPath,
                fileSize: processedPaths.fileSize,
                compositeHash: processedPaths.compositeHash
              });

              console.log(`✅ ComfyUI history ${historyId} updated with composite_hash: ${processedPaths.compositeHash.substring(0, 16)}...`);
              // Note: Group assignment is handled by BackgroundProcessorService after file watcher detects the new file
              // (due to foreign key constraint on image_groups table requiring media_metadata entry first)
            }
          } catch (error) {
            console.error(`❌ Failed to save ComfyUI image ${tempPath}:`, error);
          }
        }

        // Mark as completed
        if (historyId) {
          GenerationHistoryModel.updateStatus(historyId, 'completed');
        }

        console.log(`✅ Image generation completed for history ID ${historyId}`);
      } catch (error) {
        console.error(`❌ Image generation failed for history ID ${historyId}:`, error);

        // 실패 처리
        if (historyId) {
          try {
            const history = await GenerationHistoryService.getHistory(historyId);
            if (history) {
              GenerationHistoryModel.recordError(historyId, (error as Error).message);
              console.log(`✅ History ${historyId} marked as failed`);
            }
          } catch (recordError) {
            console.error(`⚠️ Failed to update history error:`, recordError);
          }
        }
      } finally {
        // No extra cleanup needed here because uploaded ComfyUI input files live on the target server.
      }
    })();

    // 즉시 응답 반환 (비동기 처리)
    const response: WorkflowResponse = {
      success: true,
      data: {
        history_id: historyId,
        status: 'pending',
        message: 'Image generation started. Check status using /api/generation-history/:id'
      }
    };

    return res.status(202).json(response);
  } catch (error) {
    console.error('Error starting image generation:', error);
    const response: WorkflowResponse = {
      success: false,
      error: 'Failed to start image generation'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 워크플로우별 생성 히스토리 조회
 * GET /api/workflows/:id/history
 */
router.get('/:id/history', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(routeParam(req.params.id)));
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid workflow ID'
    } as WorkflowResponse);
  }

  try {
    // API Generation History에서 조회
    const offset = (page - 1) * limit;
    const histories = GenerationHistoryModel.findByWorkflow(id, { limit, offset });
    const total = GenerationHistoryModel.count({ workflow_id: id });
    const stats = GenerationHistoryModel.getWorkflowStatistics(id);

    const response: WorkflowResponse = {
      success: true,
      data: {
        histories,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        },
        stats
      }
    };

    return res.json(response);
  } catch (error) {
    console.error('Error getting workflow history:', error);
    const response: WorkflowResponse = {
      success: false,
      error: 'Failed to get workflow history'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 생성 히스토리 상태 조회
 * GET /api/workflows/history/:historyId
 */
router.get('/history/:historyId', asyncHandler(async (req: Request, res: Response) => {
  const historyId = parseInt(routeParam(routeParam(req.params.historyId)));

  if (isNaN(historyId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid history ID'
    } as WorkflowResponse);
  }

  try {
    const history = GenerationHistoryModel.findById(historyId);

    if (!history) {
      return res.status(404).json({
        success: false,
        error: 'History not found'
      } as WorkflowResponse);
    }

    // 생성된 이미지 정보 조회
    let generatedImage = null;

    const statusResponse: GenerationStatusResponse = {
      id: history.id!,
      status: history.generation_status,
      comfyui_prompt_id: history.comfyui_prompt_id,
      generated_image_id: history.composite_hash,
      generated_image: generatedImage,
      error_message: history.error_message,
      execution_time: undefined, // Not stored in api_generation_history
      created_date: history.created_at || ''
    };

    const response: WorkflowResponse = {
      success: true,
      data: statusResponse
    };

    return res.json(response);
  } catch (error) {
    console.error('Error getting generation status:', error);
    const response: WorkflowResponse = {
      success: false,
      error: 'Failed to get generation status'
    };
    return res.status(500).json(response);
  }
}));

/**
 * ComfyUI 서버 연결 테스트
 * GET /api/workflows/:id/test-connection
 */
router.get('/:id/test-connection', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(routeParam(req.params.id)));

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid workflow ID'
    } as WorkflowResponse);
  }

  try {
    const workflow = await WorkflowModel.findById(id);
    if (!workflow) {
      return res.status(404).json({
        success: false,
        error: 'Workflow not found'
      } as WorkflowResponse);
    }

    const comfyService = createComfyUIService(workflow.api_endpoint);
    const isConnected = await comfyService.testConnection();

    const response: WorkflowResponse = {
      success: true,
      data: {
        connected: isConnected,
        api_endpoint: workflow.api_endpoint
      }
    };

    return res.json(response);
  } catch (error) {
    console.error('Error testing connection:', error);
    const response: WorkflowResponse = {
      success: false,
      error: 'Failed to test connection'
    };
    return res.status(500).json(response);
  }
}));

/**
 * Get canvas folder images for image-to-image workflows
 * GET /api/workflows/canvas-images
 */
router.get('/canvas-images', asyncHandler(async (req: Request, res: Response) => {
  try {
    const canvasPath = runtimePaths.canvasDir;

    // Ensure canvas directory exists
    if (!fs.existsSync(canvasPath)) {
      fs.mkdirSync(canvasPath, { recursive: true });
      return res.json({
        success: true,
        data: [],
        canvasPath: canvasPath  // Provide actual path for user guidance
      });
    }

    // Read directory and filter image files
    const files = fs.readdirSync(canvasPath);
    const imageFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);
    });

    // Get file stats and create response data
    const images = imageFiles.map(file => {
      const filePath = path.join(canvasPath, file);
      const stats = fs.statSync(filePath);
      return {
        filename: file,
        path: `${publicUrls.canvasBaseUrl}/${file}`,
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime
      };
    }).sort((a, b) => b.modified.getTime() - a.modified.getTime()); // Sort by newest first

    return res.json({
      success: true,
      data: images,
      canvasPath: canvasPath  // Provide actual path for user guidance
    });
  } catch (error) {
    console.error('Error getting canvas images:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get canvas images'
    });
  }
}));

export default router;
