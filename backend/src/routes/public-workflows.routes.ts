import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { WorkflowModel } from '../models/Workflow';
import { WorkflowServerModel } from '../models/ComfyUIServer';
import { CustomDropdownListModel } from '../models/CustomDropdownList';
import { GenerationHistoryModel } from '../models/GenerationHistory';
import { GenerationHistoryService } from '../services/generationHistoryService';
import { GenerationQueueModel } from '../models/GenerationQueue';
import { GenerationQueueService } from '../services/generationQueueService';
import { settingsService } from '../services/settingsService';
import type { MarkedField, WorkflowRecord } from '../types/workflow';

const router = Router();

const DROPDOWN_RANDOM_OPTION_VALUE = '__random__';
const PUBLIC_QUEUE_MAX_COUNT_DEFAULT = 32;

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

function parseMarkedFields(markedFieldsJson?: string | null): MarkedField[] {
  if (!markedFieldsJson) {
    return [];
  }

  try {
    return JSON.parse(markedFieldsJson) as MarkedField[];
  } catch (error) {
    console.error('Failed to parse public workflow marked fields:', error);
    return [];
  }
}

function buildCustomDropdownListMap() {
  return new Map(
    CustomDropdownListModel.findAll().map((list) => [list.name, list.items]),
  );
}

function buildDropdownSelectOptions(items: string[]) {
  return [
    DROPDOWN_RANDOM_OPTION_VALUE,
    ...items.filter((item) => item.trim().length > 0 && item !== DROPDOWN_RANDOM_OPTION_VALUE),
  ];
}

function resolveCustomDropdownMarkedFields(
  markedFields: MarkedField[],
  dropdownListMap: Map<string, string[]>,
): MarkedField[] {
  return markedFields.map((field) => {
    if (field.type !== 'select' || !field.dropdown_list_name) {
      return field;
    }

    const dropdownItems = dropdownListMap.get(field.dropdown_list_name);
    if (!dropdownItems) {
      return field;
    }

    return {
      ...field,
      options: buildDropdownSelectOptions(dropdownItems),
    };
  });
}

function resolvePublicQueueMaxCount(workflow: WorkflowRecord) {
  return typeof workflow.public_queue_max_count === 'number' && Number.isFinite(workflow.public_queue_max_count)
    ? Math.min(PUBLIC_QUEUE_MAX_COUNT_DEFAULT, Math.max(1, Math.trunc(workflow.public_queue_max_count)))
    : PUBLIC_QUEUE_MAX_COUNT_DEFAULT;
}

function serializePublicWorkflow(workflow: WorkflowRecord, dropdownListMap: Map<string, string[]>) {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description ?? null,
    color: workflow.color,
    is_active: workflow.is_active,
    is_public_page: workflow.is_public_page,
    public_slug: workflow.public_slug ?? null,
    public_queue_max_count: resolvePublicQueueMaxCount(workflow),
    marked_fields: resolveCustomDropdownMarkedFields(parseMarkedFields(workflow.marked_fields), dropdownListMap),
  };
}

function parsePublicQueueEnqueueCount(value: unknown, workflow: WorkflowRecord) {
  const publicQueueMaxCount = resolvePublicQueueMaxCount(workflow);
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim().length > 0
      ? Number(value)
      : 1;

  if (!Number.isFinite(numericValue) || !Number.isInteger(numericValue) || numericValue < 1) {
    return { count: null, max: publicQueueMaxCount, error: 'enqueue_count must be a positive integer' } as const;
  }

  if (numericValue > publicQueueMaxCount) {
    return { count: null, max: publicQueueMaxCount, error: `enqueue_count exceeds this public workflow limit (${publicQueueMaxCount})` } as const;
  }

  return { count: numericValue, max: publicQueueMaxCount, error: null } as const;
}

/** GET /api/public-workflows */
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const dropdownListMap = buildCustomDropdownListMap();
  const workflows = WorkflowModel.findAllPublic().map((workflow) => serializePublicWorkflow(workflow, dropdownListMap));

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

  const dropdownListMap = buildCustomDropdownListMap();

  res.json({
    success: true,
    data: serializePublicWorkflow(workflow, dropdownListMap),
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

  const { request_payload, request_summary, enqueue_count } = req.body ?? {};
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

  const parsedEnqueueCount = parsePublicQueueEnqueueCount(enqueue_count ?? 1, workflow);
  if (parsedEnqueueCount.error || parsedEnqueueCount.count === null) {
    res.status(400).json({ success: false, error: parsedEnqueueCount.error, max: parsedEnqueueCount.max });
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
  const records = Array.from({ length: parsedEnqueueCount.count }, () => {
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

    return GenerationQueueModel.findById(jobId);
  });
  GenerationQueueService.requestDispatch();

  res.status(201).json({
    success: true,
    record: records[0] ?? null,
    records,
    enqueued_count: records.length,
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
