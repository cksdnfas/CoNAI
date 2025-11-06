import { Router, Request, Response } from 'express';
import { WorkflowServerModel } from '../../models/ComfyUIServer';
import { WorkflowResponse } from '../../types/workflow';
import { asyncHandler } from '../../middleware/errorHandler';

const router = Router();

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

export default router;
