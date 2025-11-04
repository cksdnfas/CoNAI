import { Router, Request, Response } from 'express';
import { WorkflowModel } from '../models/Workflow';
import { createComfyUIService, ParallelGenerationService } from '../services/comfyuiService';
import { WorkflowResponse, WorkflowCreateData, WorkflowUpdateData, GenerationRequest, GenerationStatusResponse } from '../types/workflow';
import { asyncHandler } from '../middleware/errorHandler';
import { ImageModel } from '../models/Image';
import { enrichImageRecord } from './images/utils';
import { ComfyUIServerModel, WorkflowServerModel } from '../models/ComfyUIServer';
import { ImageProcessor } from '../services/imageProcessor';
import { PromptCollectionService } from '../services/promptCollectionService';
import { AutoCollectionService } from '../services/autoCollectionService';
import { imageTaggerService, ImageTaggerService } from '../services/imageTaggerService';
import { settingsService } from '../services/settingsService';
import { runtimePaths } from '../config/runtimePaths';
import path from 'path';
import fs from 'fs';
import { GenerationHistoryService } from '../services/generationHistoryService';
import { ComfyUIWorkflowParser } from '../utils/comfyuiWorkflowParser';
import { GenerationHistoryModel } from '../models/GenerationHistory';
import { refinePrimaryPrompt } from '@comfyui-image-manager/shared';
import { FileSaver } from '../utils/fileSaver';

const router = Router();
const UPLOAD_BASE_PATH = runtimePaths.uploadsDir;

/**
 * 모든 워크플로우 조회
 * GET /api/workflows
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  try {
    const activeOnly = req.query.active === 'true';
    const workflows = await WorkflowModel.findAll(activeOnly);

    // marked_fields를 JSON 객체로 파싱
    const parsedWorkflows = workflows.map(workflow => ({
      ...workflow,
      marked_fields: workflow.marked_fields ? JSON.parse(workflow.marked_fields) : []
    }));

    const response: WorkflowResponse = {
      success: true,
      data: parsedWorkflows
    };

    return res.json(response);
  } catch (error) {
    console.error('Error getting workflows:', error);
    const response: WorkflowResponse = {
      success: false,
      error: 'Failed to get workflows'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 특정 워크플로우 조회
 * GET /api/workflows/:id
 */
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
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

    // marked_fields를 JSON 객체로 파싱
    const workflowData = {
      ...workflow,
      marked_fields: workflow.marked_fields ? JSON.parse(workflow.marked_fields) : []
    };

    const response: WorkflowResponse = {
      success: true,
      data: workflowData
    };

    return res.json(response);
  } catch (error) {
    console.error('Error getting workflow:', error);
    const response: WorkflowResponse = {
      success: false,
      error: 'Failed to get workflow'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 새 워크플로우 생성
 * POST /api/workflows
 */
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { name, description, workflow_json, marked_fields, api_endpoint, is_active, color } = req.body;

  if (!name || !workflow_json) {
    return res.status(400).json({
      success: false,
      error: 'Name and workflow_json are required'
    } as WorkflowResponse);
  }

  try {
    // workflow_json 유효성 검사
    JSON.parse(workflow_json);
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: 'Invalid workflow_json: must be valid JSON'
    } as WorkflowResponse);
  }

  try {
    // 이름 중복 확인
    const exists = await WorkflowModel.existsByName(name);
    if (exists) {
      return res.status(409).json({
        success: false,
        error: 'Workflow name already exists'
      } as WorkflowResponse);
    }

    const workflowData: WorkflowCreateData = {
      name,
      description,
      workflow_json,
      marked_fields,
      api_endpoint,
      is_active,
      color
    };

    const workflowId = await WorkflowModel.create(workflowData);

    const response: WorkflowResponse = {
      success: true,
      data: {
        id: workflowId,
        message: 'Workflow created successfully'
      }
    };

    return res.status(201).json(response);
  } catch (error) {
    console.error('Error creating workflow:', error);
    const response: WorkflowResponse = {
      success: false,
      error: 'Failed to create workflow'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 워크플로우 업데이트
 * PUT /api/workflows/:id
 */
router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const { name, description, workflow_json, marked_fields, api_endpoint, is_active, color } = req.body;

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid workflow ID'
    } as WorkflowResponse);
  }

  // workflow_json 유효성 검사 (제공된 경우)
  if (workflow_json) {
    try {
      JSON.parse(workflow_json);
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: 'Invalid workflow_json: must be valid JSON'
      } as WorkflowResponse);
    }
  }

  try {
    // 이름 중복 확인 (변경하는 경우)
    if (name) {
      const exists = await WorkflowModel.existsByName(name, id);
      if (exists) {
        return res.status(409).json({
          success: false,
          error: 'Workflow name already exists'
        } as WorkflowResponse);
      }
    }

    const workflowData: WorkflowUpdateData = {
      name,
      description,
      workflow_json,
      marked_fields,
      api_endpoint,
      is_active,
      color
    };

    const updated = await WorkflowModel.update(id, workflowData);

    if (!updated) {
      return res.status(404).json({
        success: false,
        error: 'Workflow not found'
      } as WorkflowResponse);
    }

    const response: WorkflowResponse = {
      success: true,
      data: {
        message: 'Workflow updated successfully'
      }
    };

    return res.json(response);
  } catch (error) {
    console.error('Error updating workflow:', error);
    const response: WorkflowResponse = {
      success: false,
      error: 'Failed to update workflow'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 워크플로우 삭제
 * DELETE /api/workflows/:id
 */
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid workflow ID'
    } as WorkflowResponse);
  }

  try {
    const deleted = await WorkflowModel.delete(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Workflow not found'
      } as WorkflowResponse);
    }

    const response: WorkflowResponse = {
      success: true,
      data: {
        message: 'Workflow deleted successfully'
      }
    };

    return res.json(response);
  } catch (error) {
    console.error('Error deleting workflow:', error);
    const response: WorkflowResponse = {
      success: false,
      error: 'Failed to delete workflow'
    };
    return res.status(500).json(response);
  }
}));

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
              const { ImageSimilarityService } = await import('../services/imageSimilarity');
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
            const { TempImageService } = await import('../services/tempImageService');
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
    if (history.linked_image_id) {
      const image = await ImageModel.findById(history.linked_image_id);
      if (image) {
        generatedImage = enrichImageRecord(image);
      }
    }

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
 * 워크플로우에 연결된 서버 목록 조회
 * GET /api/workflows/:id/servers
 */
router.get('/:id/servers', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid workflow ID'
    } as WorkflowResponse);
  }

  try {
    const servers = await WorkflowServerModel.findServersByWorkflow(id);

    const response: WorkflowResponse = {
      success: true,
      data: servers
    };

    return res.json(response);
  } catch (error) {
    console.error('Error getting workflow servers:', error);
    const response: WorkflowResponse = {
      success: false,
      error: 'Failed to get workflow servers'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 워크플로우에 서버 연결
 * POST /api/workflows/:id/servers
 */
router.post('/:id/servers', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const { server_ids } = req.body;

  if (isNaN(id) || !server_ids || !Array.isArray(server_ids)) {
    return res.status(400).json({
      success: false,
      error: 'Workflow ID and server_ids array are required'
    } as WorkflowResponse);
  }

  try {
    const linkedCount = await WorkflowServerModel.linkMultipleServers(id, server_ids);

    const response: WorkflowResponse = {
      success: true,
      data: {
        message: `${linkedCount} server(s) linked successfully`,
        linked_count: linkedCount
      }
    };

    return res.status(201).json(response);
  } catch (error) {
    console.error('Error linking servers:', error);
    const response: WorkflowResponse = {
      success: false,
      error: 'Failed to link servers'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 워크플로우에서 서버 연결 해제
 * DELETE /api/workflows/:id/servers/:serverId
 */
router.delete('/:id/servers/:serverId', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const serverId = parseInt(req.params.serverId);

  if (isNaN(id) || isNaN(serverId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid workflow ID or server ID'
    } as WorkflowResponse);
  }

  try {
    const unlinked = await WorkflowServerModel.unlinkServer(id, serverId);

    if (!unlinked) {
      return res.status(404).json({
        success: false,
        error: 'Server link not found'
      } as WorkflowResponse);
    }

    const response: WorkflowResponse = {
      success: true,
      data: {
        message: 'Server unlinked successfully'
      }
    };

    return res.json(response);
  } catch (error) {
    console.error('Error unlinking server:', error);
    const response: WorkflowResponse = {
      success: false,
      error: 'Failed to unlink server'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 멀티 서버로 이미지 생성 (병렬)
 * POST /api/workflows/:id/generate-parallel
 * TODO: Refactor to use api_generation_history
 */
/* TEMPORARILY DISABLED - Needs refactoring for api_generation_history
router.post('/:id/generate-parallel', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const { prompt_data } = req.body;

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

    // 워크플로우에 연결된 활성 서버 조회
    const servers = await WorkflowServerModel.findServersByWorkflow(id, true);

    if (servers.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No active servers linked to this workflow'
      } as WorkflowResponse);
    }

    // 서버 목록 구성
    const serverList = servers.map(s => ({
      id: s.id,
      name: s.name,
      endpoint: s.endpoint
    }));

    // 각 서버에 대한 히스토리 레코드 생성
    const historyIds: number[] = [];
    for (const server of serverList) {
      const historyId = await GenerationHistoryModel.create({
        workflow_id: id,
        prompt_data,
        status: 'pending'
      });
      historyIds.push(historyId);
    }

    // 백그라운드에서 병렬 이미지 생성
    (async () => {
      const startTime = Date.now();

      // 병렬 프롬프트 제출
      const results = await ParallelGenerationService.submitToMultipleServers(
        serverList,
        workflow,
        prompt_data
      );

      // 각 서버 결과 처리
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const historyId = historyIds[i];

        if (result.success && result.promptId) {
          // 프롬프트 제출 성공
          await GenerationHistoryModel.updateStatus(historyId, 'processing', {
            comfyui_prompt_id: result.promptId
          });

          // 개별 서버에서 이미지 완성 대기 및 다운로드 (비동기)
          (async () => {
            try {
              const comfyService = createComfyUIService(result.serverName);

              // 완료 대기
              const history = await comfyService.waitForCompletion(result.promptId!);
              const imageInfos = comfyService.extractImageInfo(history, result.promptId!);

              // 이미지 다운로드 (temp 폴더로)
              const tempFilePaths: string[] = [];
              for (const imageInfo of imageInfos) {
                const tempPath = await comfyService.downloadImage(
                  imageInfo.filename,
                  imageInfo.subfolder,
                  imageInfo.type
                );
                tempFilePaths.push(tempPath);
              }

              // ImageProcessor로 처리하여 완전한 업로드 파이프라인 실행
              const imageIds: number[] = [];
              for (const tempPath of tempFilePaths) {
                try {
                  // Multer File 객체 생성
                  const fileStats = fs.statSync(tempPath);
                  const ext = path.extname(tempPath).substring(1);
                  const file: Express.Multer.File = {
                    path: tempPath,
                    originalname: path.basename(tempPath),
                    mimetype: `image/${ext}`,
                    size: fileStats.size,
                    fieldname: 'image',
                    encoding: '7bit',
                    destination: path.dirname(tempPath),
                    filename: path.basename(tempPath),
                    stream: null as any,
                    buffer: Buffer.alloc(0)
                  };

                  // ImageProcessor로 처리
                  const processed = await ImageProcessor.processImage(file, UPLOAD_BASE_PATH);
                  const aiInfo = processed.metadata.ai_info || {};

                  // STEP 1: 프롬프트 정제 (DB 저장 전)
                  let refinedPrompt = aiInfo.prompt || null;
                  let refinedNegativePrompt = aiInfo.negative_prompt || null;

                  if (refinedPrompt) {
                    refinedPrompt = refinePrimaryPrompt(refinedPrompt);
                  }

                  if (refinedNegativePrompt) {
                    refinedNegativePrompt = refinePrimaryPrompt(refinedNegativePrompt);
                  }

                  // DB 저장 (정제된 프롬프트 사용)
                  const imageId = await ImageModel.create({
                    filename: processed.filename,
                    original_name: path.basename(tempPath),
                    file_path: processed.originalPath,
                    thumbnail_path: processed.thumbnailPath,
                    file_size: processed.fileSize,
                    mime_type: `image/${ext}`,
                    width: processed.width,
                    height: processed.height,
                    metadata: JSON.stringify(processed.metadata),
                    ai_tool: 'ComfyUI',
                    model_name: aiInfo.model || null,
                    lora_models: aiInfo.lora_models ? JSON.stringify(aiInfo.lora_models) : null,
                    steps: aiInfo.steps || null,
                    cfg_scale: aiInfo.cfg_scale || null,
                    sampler: aiInfo.sampler || null,
                    seed: aiInfo.seed || null,
                    scheduler: aiInfo.scheduler || null,
                    prompt: refinedPrompt,
                    negative_prompt: refinedNegativePrompt,
                    denoise_strength: aiInfo.denoise_strength || null,
                    generation_time: aiInfo.generation_time || null,
                    batch_size: aiInfo.batch_size || null,
                    batch_index: aiInfo.batch_index || null,
                    auto_tags: null,
                    duration: null,
                    fps: null,
                    video_codec: null,
                    audio_codec: null,
                    bitrate: null,
                    perceptual_hash: processed.perceptualHash || null,
                    color_histogram: processed.colorHistogram || null
                  });

                  imageIds.push(imageId);

                  // STEP 3: 프롬프트 수집 (정제된 프롬프트 사용)
                  try {
                    await PromptCollectionService.collectFromImage(
                      refinedPrompt,
                      refinedNegativePrompt
                    );
                  } catch (promptError) {
                    console.warn('⚠️ Failed to collect prompts:', promptError);
                  }

                  // 자동 태깅은 AutoTagScheduler에서 백그라운드로 처리됨

                  // 자동수집 그룹 처리
                  try {
                    await AutoCollectionService.runAutoCollectionForNewImageById(imageId);
                  } catch (autoCollectError) {
                    console.warn('⚠️ Failed to run auto collection:', autoCollectError);
                  }

                } catch (error) {
                  console.error(`❌ Failed to process image ${tempPath}:`, error);
                }
              }

              const generatedImageId = imageIds.length > 0 ? imageIds[0] : undefined;

              // 완료 상태 업데이트
              const executionTime = Math.floor((Date.now() - startTime) / 1000);
              await GenerationHistoryModel.updateStatus(historyId, 'completed', {
                generated_image_id: generatedImageId,
                execution_time: executionTime
              });

              console.log(`✅ Parallel generation completed for history ID ${historyId} (Server: ${result.serverName})`);
            } catch (error) {
              console.error(`❌ Parallel generation failed for history ID ${historyId}:`, error);
              const executionTime = Math.floor((Date.now() - startTime) / 1000);
              await GenerationHistoryModel.updateStatus(historyId, 'failed', {
                error_message: (error as Error).message,
                execution_time: executionTime
              });
            }
          })();
        } else {
          // 프롬프트 제출 실패
          await GenerationHistoryModel.updateStatus(historyId, 'failed', {
            error_message: result.error || 'Failed to submit prompt'
          });
          console.error(`❌ Failed to submit prompt to server ${result.serverName}:`, result.error);
        }
      }
    })();

    // 즉시 응답 반환
    const response: WorkflowResponse = {
      success: true,
      data: {
        total_servers: servers.length,
        history_ids: historyIds,
        message: `Parallel image generation started on ${servers.length} server(s). Check status using history IDs`
      }
    };

    return res.status(202).json(response);
  } catch (error) {
    console.error('Error starting parallel generation:', error);
    const response: WorkflowResponse = {
      success: false,
      error: 'Failed to start parallel generation'
    };
    return res.status(500).json(response);
  }
}));
*/

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

export { router as workflowRoutes };
