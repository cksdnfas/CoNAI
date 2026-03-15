import { Router, Request, Response } from 'express';
import { routeParam } from './routeParam';
import { ComfyUIServerModel, WorkflowServerModel } from '../models/ComfyUIServer';
import { ParallelGenerationService } from '../services/comfyuiService';
import { ComfyUIServerResponse, ComfyUIServerCreateData, ComfyUIServerUpdateData } from '../types/comfyuiServer';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

/**
 * 모든 서버 조회
 * GET /api/comfyui-servers
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  try {
    const activeOnly = req.query.active === 'true';
    const servers = await ComfyUIServerModel.findAll(activeOnly);

    const response: ComfyUIServerResponse = {
      success: true,
      data: servers
    };

    return res.json(response);
  } catch (error) {
    console.error('Error getting servers:', error);
    const response: ComfyUIServerResponse = {
      success: false,
      error: 'Failed to get servers'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 모든 활성 서버 연결 테스트
 * GET /api/comfyui-servers/test-all-connections
 * NOTE: Must be defined before /:id route
 */
router.get('/test-all-connections', asyncHandler(async (req: Request, res: Response) => {
  try {
    const servers = await ComfyUIServerModel.findActiveServers();

    if (servers.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No active servers found'
      } as ComfyUIServerResponse);
    }

    const serverList = servers.map(s => ({ id: s.id, name: s.name, endpoint: s.endpoint }));
    const results = await ParallelGenerationService.testMultipleConnections(serverList);

    const response: ComfyUIServerResponse = {
      success: true,
      data: {
        total_servers: servers.length,
        results
      }
    };

    return res.json(response);
  } catch (error) {
    console.error('Error testing all connections:', error);
    const response: ComfyUIServerResponse = {
      success: false,
      error: 'Failed to test connections'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 서버 연결 테스트
 * GET /api/comfyui-servers/:id/test-connection
 * NOTE: Must be defined before /:id route
 */
router.get('/:id/test-connection', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(routeParam(req.params.id)));

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid server ID'
    } as ComfyUIServerResponse);
  }

  try {
    const server = await ComfyUIServerModel.findById(id);
    if (!server) {
      return res.status(404).json({
        success: false,
        error: 'Server not found'
      } as ComfyUIServerResponse);
    }

    const results = await ParallelGenerationService.testMultipleConnections([
      { id: server.id, name: server.name, endpoint: server.endpoint }
    ]);

    const response: ComfyUIServerResponse = {
      success: true,
      data: results[0]
    };

    return res.json(response);
  } catch (error) {
    console.error('Error testing connection:', error);
    const response: ComfyUIServerResponse = {
      success: false,
      error: 'Failed to test connection'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 서버를 사용하는 워크플로우 목록 조회
 * GET /api/comfyui-servers/:id/workflows
 * NOTE: Must be defined before /:id route
 */
router.get('/:id/workflows', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(routeParam(req.params.id)));

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid server ID'
    } as ComfyUIServerResponse);
  }

  try {
    const workflows = await WorkflowServerModel.findWorkflowsByServer(id);

    const response: ComfyUIServerResponse = {
      success: true,
      data: workflows
    };

    return res.json(response);
  } catch (error) {
    console.error('Error getting server workflows:', error);
    const response: ComfyUIServerResponse = {
      success: false,
      error: 'Failed to get server workflows'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 특정 서버 조회
 * GET /api/comfyui-servers/:id
 * NOTE: Must be defined after specific routes
 */
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(routeParam(req.params.id)));

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid server ID'
    } as ComfyUIServerResponse);
  }

  try {
    const server = await ComfyUIServerModel.findById(id);

    if (!server) {
      return res.status(404).json({
        success: false,
        error: 'Server not found'
      } as ComfyUIServerResponse);
    }

    // 서버 통계 조회
    const stats = await ComfyUIServerModel.getStatsByServer(id);

    const response: ComfyUIServerResponse = {
      success: true,
      data: {
        ...server,
        stats
      }
    };

    return res.json(response);
  } catch (error) {
    console.error('Error getting server:', error);
    const response: ComfyUIServerResponse = {
      success: false,
      error: 'Failed to get server'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 새 서버 생성
 * POST /api/comfyui-servers
 */
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { name, endpoint, description, is_active } = req.body;

  if (!name || !endpoint) {
    return res.status(400).json({
      success: false,
      error: 'Name and endpoint are required'
    } as ComfyUIServerResponse);
  }

  try {
    // 이름 중복 확인
    const exists = await ComfyUIServerModel.existsByName(name);
    if (exists) {
      return res.status(409).json({
        success: false,
        error: 'Server name already exists'
      } as ComfyUIServerResponse);
    }

    const serverData: ComfyUIServerCreateData = {
      name,
      endpoint,
      description,
      is_active
    };

    const serverId = await ComfyUIServerModel.create(serverData);

    const response: ComfyUIServerResponse = {
      success: true,
      data: {
        id: serverId,
        message: 'Server created successfully'
      }
    };

    return res.status(201).json(response);
  } catch (error) {
    console.error('Error creating server:', error);
    const response: ComfyUIServerResponse = {
      success: false,
      error: 'Failed to create server'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 서버 업데이트
 * PUT /api/comfyui-servers/:id
 */
router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(routeParam(req.params.id)));
  const { name, endpoint, description, is_active } = req.body;

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid server ID'
    } as ComfyUIServerResponse);
  }

  try {
    // 이름 중복 확인 (변경하는 경우)
    if (name) {
      const exists = await ComfyUIServerModel.existsByName(name, id);
      if (exists) {
        return res.status(409).json({
          success: false,
          error: 'Server name already exists'
        } as ComfyUIServerResponse);
      }
    }

    const serverData: ComfyUIServerUpdateData = {
      name,
      endpoint,
      description,
      is_active
    };

    const updated = await ComfyUIServerModel.update(id, serverData);

    if (!updated) {
      return res.status(404).json({
        success: false,
        error: 'Server not found'
      } as ComfyUIServerResponse);
    }

    const response: ComfyUIServerResponse = {
      success: true,
      data: {
        message: 'Server updated successfully'
      }
    };

    return res.json(response);
  } catch (error) {
    console.error('Error updating server:', error);
    const response: ComfyUIServerResponse = {
      success: false,
      error: 'Failed to update server'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 서버 삭제
 * DELETE /api/comfyui-servers/:id
 */
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(routeParam(req.params.id)));

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid server ID'
    } as ComfyUIServerResponse);
  }

  try {
    const deleted = await ComfyUIServerModel.delete(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Server not found'
      } as ComfyUIServerResponse);
    }

    const response: ComfyUIServerResponse = {
      success: true,
      data: {
        message: 'Server deleted successfully'
      }
    };

    return res.json(response);
  } catch (error) {
    console.error('Error deleting server:', error);
    const response: ComfyUIServerResponse = {
      success: false,
      error: 'Failed to delete server'
    };
    return res.status(500).json(response);
  }
}));

export { router as comfyuiServerRoutes };
