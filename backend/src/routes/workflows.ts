import { Router, Request, Response } from 'express';
import { WorkflowModel, GenerationHistoryModel } from '../models/Workflow';
import { createComfyUIService, ParallelGenerationService } from '../services/comfyuiService';
import { WorkflowResponse, WorkflowCreateData, WorkflowUpdateData, GenerationRequest, GenerationStatusResponse } from '../types/workflow';
import { asyncHandler } from '../middleware/errorHandler';
import { UploadService } from '../services/uploadService';
import { ImageModel } from '../models/Image';
import { enrichImageRecord } from './images/utils';
import { ComfyUIServerModel, WorkflowServerModel } from '../models/ComfyUIServer';

const router = Router();

/**
 * 모든 워크플로우 조회
 * GET /api/workflows
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  try {
    const activeOnly = req.query.active === 'true';
    const workflows = await WorkflowModel.findAll(activeOnly);

    const response: WorkflowResponse = {
      success: true,
      data: workflows
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
  const { name, description, workflow_json, marked_fields, api_endpoint, is_active } = req.body;

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
      is_active
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
  const { name, description, workflow_json, marked_fields, api_endpoint, is_active } = req.body;

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
      is_active
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
  const { prompt_data, server_id } = req.body;

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

    // 생성 히스토리 레코드 생성 (pending 상태)
    const historyId = await GenerationHistoryModel.create({
      workflow_id: id,
      prompt_data,
      status: 'pending'
    });

    // 백그라운드에서 이미지 생성 프로세스 실행
    (async () => {
      const startTime = Date.now();
      try {
        // 상태를 processing으로 업데이트
        await GenerationHistoryModel.updateStatus(historyId, 'processing');

        // ComfyUI 서비스 생성 (선택된 endpoint 사용)
        const comfyService = createComfyUIService(apiEndpoint);
        console.log(`📤 Sending to ComfyUI: ${apiEndpoint}`);

        // 이미지 생성
        const { promptId, imagePaths } = await comfyService.generateImages(workflow, prompt_data);

        // ComfyUI prompt ID 업데이트
        await GenerationHistoryModel.updateStatus(historyId, 'processing', {
          comfyui_prompt_id: promptId
        });

        // 생성된 이미지를 UploadService로 처리하여 데이터베이스에 저장
        // 완전한 업로드 파이프라인 실행: 썸네일, 최적화, 메타데이터, 프롬프트 수집, 자동 태깅, 자동 그룹 분류
        // 이미지 메타데이터에서 프롬프트가 자동으로 추출됨
        const imageIds = await UploadService.processAndUploadMultipleImages(imagePaths, {
          ai_tool: 'ComfyUI'
        });

        // 첫 번째 이미지를 히스토리에 연결
        const generatedImageId = imageIds.length > 0 ? imageIds[0] : undefined;

        // 완료 상태로 업데이트
        const executionTime = Math.floor((Date.now() - startTime) / 1000);
        await GenerationHistoryModel.updateStatus(historyId, 'completed', {
          generated_image_id: generatedImageId,
          execution_time: executionTime
        });

        console.log(`✅ Image generation completed for history ID ${historyId}`);
      } catch (error) {
        console.error(`❌ Image generation failed for history ID ${historyId}:`, error);
        const executionTime = Math.floor((Date.now() - startTime) / 1000);
        await GenerationHistoryModel.updateStatus(historyId, 'failed', {
          error_message: (error as Error).message,
          execution_time: executionTime
        });
      }
    })();

    // 즉시 응답 반환 (비동기 처리)
    const response: WorkflowResponse = {
      success: true,
      data: {
        history_id: historyId,
        status: 'pending',
        message: 'Image generation started. Check status using /api/workflows/history/:id'
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
    const result = await GenerationHistoryModel.findByWorkflow(id, page, limit);
    const stats = await GenerationHistoryModel.getStatsByWorkflow(id);

    const response: WorkflowResponse = {
      success: true,
      data: {
        histories: result.histories,
        pagination: {
          page,
          limit,
          total: result.total,
          totalPages: Math.ceil(result.total / limit)
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
    const history = await GenerationHistoryModel.findById(historyId);

    if (!history) {
      return res.status(404).json({
        success: false,
        error: 'History not found'
      } as WorkflowResponse);
    }

    // 생성된 이미지 정보 조회
    let generatedImage = null;
    if (history.generated_image_id) {
      const image = await ImageModel.findById(history.generated_image_id);
      if (image) {
        generatedImage = enrichImageRecord(image);
      }
    }

    const statusResponse: GenerationStatusResponse = {
      id: history.id,
      status: history.status,
      comfyui_prompt_id: history.comfyui_prompt_id,
      generated_image_id: history.generated_image_id,
      generated_image: generatedImage,
      error_message: history.error_message,
      execution_time: history.execution_time,
      created_date: history.created_date
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
 */
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

              // 이미지 다운로드
              const imagePaths: string[] = [];
              for (const imageInfo of imageInfos) {
                const localPath = await comfyService.downloadImage(
                  imageInfo.filename,
                  imageInfo.subfolder,
                  imageInfo.type
                );
                imagePaths.push(localPath);
              }

              // UploadService로 처리하여 완전한 업로드 파이프라인 실행
              // 이미지 메타데이터에서 프롬프트가 자동으로 추출됨
              const imageIds = await UploadService.processAndUploadMultipleImages(imagePaths, {
                ai_tool: 'ComfyUI'
              });

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

export { router as workflowRoutes };
