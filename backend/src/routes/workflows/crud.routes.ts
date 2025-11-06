import { Router, Request, Response } from 'express';
import { WorkflowModel } from '../../models/Workflow';
import { WorkflowResponse, WorkflowCreateData, WorkflowUpdateData } from '../../types/workflow';
import { asyncHandler } from '../../middleware/errorHandler';

const router = Router();

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

export default router;
