import { Router, Request, Response } from 'express';
import { WorkflowModel } from '../../models/Workflow';
import { createComfyUIService } from '../../services/comfyuiService';
import { WorkflowResponse, GenerationStatusResponse } from '../../types/workflow';
import { asyncHandler } from '../../middleware/errorHandler';
import { runtimePaths } from '../../config/runtimePaths';
import path from 'path';
import fs from 'fs';
import { GenerationHistoryService } from '../../services/generationHistoryService';
import { ComfyUIWorkflowParser } from '../../utils/comfyuiWorkflowParser';
import { GenerationHistoryModel } from '../../models/GenerationHistory';

const router = Router();

/**
 * 이미지 생성 요청
 * POST /api/workflows/:id/generate
 */
router.post('/:id/generate', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const { prompt_data, server_id, groupId, source_image } = req.body;

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

    // 전송 데이터 로깅
    console.log('📨 Image generation request:', {
      workflow_id: id,
      workflow_name: workflow.name,
      server: serverName,
      endpoint: apiEndpoint,
      prompt_data_keys: Object.keys(prompt_data),
      prompt_data_size: JSON.stringify(prompt_data).length
    });

    // Parse workflow to extract generation parameters
    const workflowJson = JSON.parse(workflow.workflow_json);
    const extractedParams = ComfyUIWorkflowParser.extractWithSubstitution(workflowJson, prompt_data);

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
        workflow: workflowJson,
        workflowId: id,
        workflowName: workflow.name,
        promptId: '', // Will be updated after ComfyUI submission
        positivePrompt: extractedParams.positivePrompt,
        negativePrompt: extractedParams.negativePrompt,
        width: extractedParams.width,
        height: extractedParams.height,
        groupId: groupId ? parseInt(groupId) : undefined, // User-selected group for automatic assignment
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
      let tempImageId: string | undefined;

      try {
        // Handle source_image if provided (from image editor)
        if (source_image?.tempId) {
          tempImageId = source_image.tempId;
          console.log(`🖼️  Using edited image from temp: ${tempImageId}`);

          // TODO: Inject temp image into workflow JSON
          // This will be done when ComfyUI service supports img2img
        }

        // ComfyUI 서비스 생성 (선택된 endpoint 사용)
        const comfyService = createComfyUIService(apiEndpoint);
        console.log(`📤 Sending to ComfyUI: ${apiEndpoint}`);

        // 이미지 생성 (temp 폴더에 다운로드)
        const { promptId, imagePaths: tempFilePaths } = await comfyService.generateImages(workflow, prompt_data);

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

        // Simple file move: temp → uploads/API/images/YYYY-MM-DD/
        // Main system will auto-detect and process (thumbnails, metadata, etc.)
        console.log(`📁 Moving ${tempFilePaths.length} images to uploads/API/images/...`);

        for (const tempPath of tempFilePaths) {
          try {
            // Read temp file
            const imageBuffer = await fs.promises.readFile(tempPath);

            // Create date-based directory (YYYY-MM-DD)
            const dateDir = new Date().toISOString().split('T')[0];
            const targetDir = path.join(runtimePaths.uploadsDir, 'API', 'images', dateDir);

            // Ensure directory exists
            if (!fs.existsSync(targetDir)) {
              fs.mkdirSync(targetDir, { recursive: true });
            }

            // Generate unique filename
            const ext = path.extname(tempPath);
            const filename = `comfyui_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${ext}`;
            const targetPath = path.join(targetDir, filename);

            // Write file to target
            fs.writeFileSync(targetPath, imageBuffer);

            // Delete temp file
            fs.unlinkSync(tempPath);

            console.log(`✅ ComfyUI image saved: API/images/${dateDir}/${filename}`);

            // Update history (first image only)
            if (historyId && tempFilePaths.indexOf(tempPath) === 0) {
              const relativePath = `API/images/${dateDir}/${filename}`;

              // Generate composite hash
              const { ImageSimilarityService } = await import('../../services/imageSimilarity');
              const { hashes } = await ImageSimilarityService.generateHashAndHistogram(targetPath);

              GenerationHistoryModel.updateImagePaths(historyId, {
                original: relativePath,
                thumbnail: '',
                fileSize: imageBuffer.length,
                compositeHash: hashes.compositeHash
              });

              console.log(`✅ ComfyUI history ${historyId} updated with composite_hash: ${hashes.compositeHash.substring(0, 16)}...`);
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
        // Cleanup temp image if used
        if (tempImageId) {
          try {
            const { TempImageService } = await import('../../services/tempImageService');
            await TempImageService.deleteTempFile(tempImageId);
            console.log(`🧹 Cleaned up temp image: ${tempImageId}`);
          } catch (cleanupError) {
            console.error(`⚠️ Failed to cleanup temp image ${tempImageId}:`, cleanupError);
          }
        }
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
  const id = parseInt(req.params.id);
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
  const historyId = parseInt(req.params.historyId);

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
    // TODO: Migrate api_generation_history.linked_image_id from INT to TEXT (composite_hash)
    // Currently broken: ImageModel.findById() throws error
    // See: docs/development/IMAGE_MODEL_MIGRATION_STATUS.md
    // DISABLED: Cannot query by linked_image_id until database migration completed

    const statusResponse: GenerationStatusResponse = {
      id: history.id!,
      status: history.generation_status,
      comfyui_prompt_id: history.comfyui_prompt_id,
      generated_image_id: history.linked_image_id,
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
  const id = parseInt(req.params.id);

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
    const canvasPath = path.join(runtimePaths.uploadsDir, 'temp', 'canvas');

    // Ensure canvas directory exists
    if (!fs.existsSync(canvasPath)) {
      fs.mkdirSync(canvasPath, { recursive: true });
      return res.json({
        success: true,
        data: []
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
        path: `/uploads/temp/canvas/${file}`,
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime
      };
    }).sort((a, b) => b.modified.getTime() - a.modified.getTime()); // Sort by newest first

    return res.json({
      success: true,
      data: images
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
