import { Router, Request, Response } from 'express';
import { routeParam } from './routeParam';
import { ComfyUIServerModel, WorkflowServerModel } from '../models/ComfyUIServer';
import { createComfyUIService, getComfyUIServerRuntimeStatuses, ParallelGenerationService } from '../services/comfyuiService';
import { ComfyUIServerResponse, ComfyUIServerCreateData, ComfyUIServerUpdateData } from '../types/comfyuiServer';
import { asyncHandler } from '../middleware/errorHandler';
import { sendRouteBadRequest } from './routeValidation';

const router = Router();
const INVALID_SERVER_ID_ERROR = 'Invalid server ID';

/** Parse the server route id once and keep the legacy 400 response body on invalid input. */
function getServerIdOrSendBadRequest(req: Request, res: Response): number | null {
  const id = Number.parseInt(routeParam(req.params.id), 10);
  if (Number.isNaN(id)) {
    sendRouteBadRequest(res, INVALID_SERVER_ID_ERROR);
    return null;
  }

  return id;
}

/** Send the legacy not-found response for missing ComfyUI servers. */
function sendServerNotFound(res: Response) {
  return res.status(404).json({
    success: false,
    error: 'Server not found'
  } as ComfyUIServerResponse);
}

function normalizeRoutingTag(value: string) {
  return value.trim().toLowerCase();
}

function parseRoutingTagsInput(value: unknown) {
  if (value === undefined) {
    return { provided: false, tags: [] as string[] };
  }

  if (value === null) {
    return { provided: true, tags: [] as string[] };
  }

  if (!Array.isArray(value)) {
    throw new Error('routing_tags must be an array of strings');
  }

  const tags = Array.from(new Set(value.map((entry) => {
    if (typeof entry !== 'string') {
      throw new Error('routing_tags must contain only strings');
    }

    const normalized = normalizeRoutingTag(entry);
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(normalized)) {
      throw new Error(`Invalid routing tag: ${entry}`);
    }

    return normalized;
  }).filter((entry) => entry.length > 0)));

  return { provided: true, tags };
}

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
 * 서버 런타임 상태 조회
 * GET /api/comfyui-servers/status
 * NOTE: Must be defined before /:id route
 */
router.get('/status', asyncHandler(async (req: Request, res: Response) => {
  try {
    const activeOnly = req.query.active !== 'false';
    const servers = activeOnly
      ? await ComfyUIServerModel.findActiveServers()
      : await ComfyUIServerModel.findAll(false);

    const statuses = await getComfyUIServerRuntimeStatuses(servers);
    return res.json({
      success: true,
      data: statuses,
    } as ComfyUIServerResponse);
  } catch (error) {
    console.error('Error getting runtime statuses:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get runtime statuses'
    } as ComfyUIServerResponse);
  }
}));

/**
 * 단일 서버 런타임 상태 조회
 * GET /api/comfyui-servers/:id/status
 * NOTE: Must be defined before /:id route
 */
router.get('/:id/status', asyncHandler(async (req: Request, res: Response) => {
  const id = getServerIdOrSendBadRequest(req, res);
  if (id === null) {
    return;
  }

  try {
    const server = await ComfyUIServerModel.findById(id);
    if (!server) {
      return sendServerNotFound(res);
    }

    const status = await createComfyUIService(server.endpoint).getRuntimeStatus(server);
    return res.json({
      success: true,
      data: status,
    } as ComfyUIServerResponse);
  } catch (error) {
    console.error('Error getting runtime status:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get runtime status'
    } as ComfyUIServerResponse);
  }
}));

/**
 * 서버 연결 테스트
 * GET /api/comfyui-servers/:id/test-connection
 * NOTE: Must be defined before /:id route
 */
router.get('/:id/test-connection', asyncHandler(async (req: Request, res: Response) => {
  const id = getServerIdOrSendBadRequest(req, res);
  if (id === null) {
    return;
  }

  try {
    const server = await ComfyUIServerModel.findById(id);
    if (!server) {
      return sendServerNotFound(res);
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
  const id = getServerIdOrSendBadRequest(req, res);
  if (id === null) {
    return;
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
  const id = getServerIdOrSendBadRequest(req, res);
  if (id === null) {
    return;
  }

  try {
    const server = await ComfyUIServerModel.findById(id);

    if (!server) {
      return sendServerNotFound(res);
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

    const parsedRoutingTags = parseRoutingTagsInput(req.body?.routing_tags);
    const serverData: ComfyUIServerCreateData = {
      name,
      endpoint,
      description,
      routing_tags_json: parsedRoutingTags.provided ? JSON.stringify(parsedRoutingTags.tags) : null,
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
    if (error instanceof Error && (error.message.includes('routing_tags') || error.message.includes('routing tag'))) {
      return res.status(400).json({
        success: false,
        error: error.message
      } as ComfyUIServerResponse);
    }

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
  const id = getServerIdOrSendBadRequest(req, res);
  if (id === null) {
    return;
  }

  const { name, endpoint, description, is_active } = req.body;

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

    const parsedRoutingTags = parseRoutingTagsInput(req.body?.routing_tags);
    const serverData: ComfyUIServerUpdateData = {
      name,
      endpoint,
      description,
      routing_tags_json: parsedRoutingTags.provided ? JSON.stringify(parsedRoutingTags.tags) : undefined,
      is_active
    };

    const updated = await ComfyUIServerModel.update(id, serverData);

    if (!updated) {
      return sendServerNotFound(res);
    }

    const response: ComfyUIServerResponse = {
      success: true,
      data: {
        message: 'Server updated successfully'
      }
    };

    return res.json(response);
  } catch (error) {
    if (error instanceof Error && (error.message.includes('routing_tags') || error.message.includes('routing tag'))) {
      return res.status(400).json({
        success: false,
        error: error.message
      } as ComfyUIServerResponse);
    }

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
  const id = getServerIdOrSendBadRequest(req, res);
  if (id === null) {
    return;
  }

  try {
    const deleted = await ComfyUIServerModel.delete(id);

    if (!deleted) {
      return sendServerNotFound(res);
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
