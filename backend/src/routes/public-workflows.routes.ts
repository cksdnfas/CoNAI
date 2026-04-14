import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { WorkflowModel } from '../models/Workflow';
import { WorkflowServerModel } from '../models/ComfyUIServer';
import { GenerationHistoryModel } from '../models/GenerationHistory';
import { GenerationHistoryService } from '../services/generationHistoryService';
import { GenerationQueueModel } from '../models/GenerationQueue';
import { GenerationQueueService } from '../services/generationQueueService';
import { settingsService } from '../services/settingsService';

const router = Router();

function getPublicWorkflowOrNull(slug: string) {
  return WorkflowModel.findPublicBySlug(slug.trim().toLowerCase());
}

function getRequesterAccountId(req: Request) {
  return typeof req.session?.accountId === 'number' ? req.session.accountId : null;
}

function getRequesterAccountType(req: Request) {
  return req.session?.accountType === 'admin' || req.session?.accountType === 'guest'
    ? req.session.accountType
    : null;
}

/** GET /api/public-workflows */
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const workflows = WorkflowModel.findAllPublic().map((workflow) => ({
    id: workflow.id,
    name: workflow.name,
    description: workflow.description ?? null,
    color: workflow.color,
    is_active: workflow.is_active,
    is_public_page: workflow.is_public_page,
    public_slug: workflow.public_slug ?? null,
    marked_fields: workflow.marked_fields ? JSON.parse(workflow.marked_fields) : [],
  }));

  res.json({
    success: true,
    data: workflows,
  });
}));

/** GET /api/public-workflows/:slug */
router.get('/:slug', asyncHandler(async (req: Request, res: Response) => {
  const workflow = getPublicWorkflowOrNull(String(req.params.slug || ''));
  if (!workflow) {
    res.status(404).json({ success: false, error: 'Public workflow not found' });
    return;
  }

  res.json({
    success: true,
    data: {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description ?? null,
      color: workflow.color,
      is_active: workflow.is_active,
      is_public_page: workflow.is_public_page,
      public_slug: workflow.public_slug ?? null,
      marked_fields: workflow.marked_fields ? JSON.parse(workflow.marked_fields) : [],
    },
  });
}));

/** GET /api/public-workflows/:slug/history */
router.get('/:slug/history', asyncHandler(async (req: Request, res: Response) => {
  const workflow = getPublicWorkflowOrNull(String(req.params.slug || ''));
  if (!workflow) {
    res.status(404).json({ success: false, error: 'Public workflow not found' });
    return;
  }

  const limit = Number(req.query.limit ?? 40);
  const offset = Number(req.query.offset ?? 0);

  if (!Number.isInteger(limit) || limit <= 0 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
    res.status(400).json({ success: false, error: 'limit and offset must be valid integers' });
    return;
  }

  const requesterAccountId = getRequesterAccountId(req);
  const requesterAccountType = getRequesterAccountType(req);

  if (requesterAccountId === null || requesterAccountType === null) {
    res.json({
      success: true,
      records: [],
      total: 0,
    });
    return;
  }

  const result = await GenerationHistoryService.getHistoryByWorkflow(workflow.id, {
    limit,
    offset,
    requested_by_account_id: requesterAccountId,
    requested_by_account_type: requesterAccountType,
  });

  res.json({
    success: true,
    records: result.records,
    total: result.total,
  });
}));

/** POST /api/public-workflows/:slug/queue */
router.post('/:slug/queue', asyncHandler(async (req: Request, res: Response) => {
  const workflow = getPublicWorkflowOrNull(String(req.params.slug || ''));
  if (!workflow) {
    res.status(404).json({ success: false, error: 'Public workflow not found' });
    return;
  }

  const { request_payload, request_summary } = req.body ?? {};
  if (!request_payload || typeof request_payload !== 'object' || Array.isArray(request_payload)) {
    res.status(400).json({ success: false, error: 'request_payload must be an object' });
    return;
  }

  const promptData = (request_payload as Record<string, unknown>).prompt_data;
  if (!promptData || typeof promptData !== 'object' || Array.isArray(promptData)) {
    res.status(400).json({ success: false, error: 'request_payload.prompt_data must be an object' });
    return;
  }

  const workflowHasServerLinks = WorkflowServerModel.findServersByWorkflow(workflow.id, false).length > 0;
  const activeLinkedServers = WorkflowServerModel.findServersByWorkflow(workflow.id, true);
  if (workflowHasServerLinks && activeLinkedServers.length === 0) {
    res.status(400).json({ success: false, error: 'This public workflow has no active linked ComfyUI servers' });
    return;
  }

  const imageSaveSettings = settingsService.loadSettings().imageSave;
  const normalizedRequestPayload = { ...request_payload } as Record<string, unknown>;

  if (normalizedRequestPayload.imageSaveOptions === undefined && imageSaveSettings.applyToWorkflowOutputs) {
    normalizedRequestPayload.imageSaveOptions = {
      format: imageSaveSettings.defaultFormat,
      quality: imageSaveSettings.quality,
      resizeEnabled: imageSaveSettings.resizeEnabled,
      maxWidth: imageSaveSettings.maxWidth,
      maxHeight: imageSaveSettings.maxHeight,
    };
  }

  const requesterAccountId = getRequesterAccountId(req);
  const jobId = GenerationQueueModel.create({
    service_type: 'comfyui',
    workflow_id: workflow.id,
    workflow_name: workflow.name,
    request_payload: normalizedRequestPayload,
    request_summary: typeof request_summary === 'string' && request_summary.trim().length > 0
      ? request_summary.trim()
      : `${workflow.name} public queue job`,
    requested_by_account_id: requesterAccountId,
    requested_by_account_type: req.session?.accountType,
  });

  const record = GenerationQueueModel.findById(jobId);
  GenerationQueueService.requestDispatch();

  res.status(201).json({
    success: true,
    record,
    message: 'Public workflow queue job created',
  });
}));

/** POST /api/public-workflows/:slug/cleanup-failed */
router.post('/:slug/cleanup-failed', asyncHandler(async (req: Request, res: Response) => {
  const workflow = getPublicWorkflowOrNull(String(req.params.slug || ''));
  if (!workflow) {
    res.status(404).json({ success: false, error: 'Public workflow not found' });
    return;
  }

  const requesterAccountId = getRequesterAccountId(req);
  const requesterAccountType = getRequesterAccountType(req);

  if (requesterAccountId === null || requesterAccountType === null) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }

  const failedRecords = GenerationHistoryModel.findAll({
    workflow_id: workflow.id,
    generation_status: 'failed',
    requested_by_account_id: requesterAccountId,
    requested_by_account_type: requesterAccountType,
  });

  const deleted = GenerationHistoryModel.deleteMany(
    failedRecords
      .map((record) => record.id)
      .filter((id): id is number => typeof id === 'number'),
  );

  res.json({
    success: true,
    deleted,
    message: deleted > 0
      ? `Removed ${deleted} failed public workflow history records`
      : 'No failed public workflow history records to remove',
  });
}));

export default router;
