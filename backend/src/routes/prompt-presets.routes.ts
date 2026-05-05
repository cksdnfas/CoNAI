import { Router, Request, Response } from 'express';
import { routeParam } from './routeParam';
import { asyncHandler } from '../middleware/errorHandler';
import { requirePermission } from '../middleware/authMiddleware';
import { PromptPresetModel, type PromptPresetCreateData, type PromptPresetItemInput, type PromptPresetUpdateData } from '../models/PromptPreset';

const router = Router();

router.use(requirePermission('page.prompts.view'));

function normalizePresetItems(value: unknown): PromptPresetItemInput[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const source = item as Record<string, unknown>;
      const description = typeof source.description === 'string' ? source.description.trim() : '';
      const itemValue = typeof source.value === 'string' ? source.value.trim() : '';
      if (!description || !itemValue) {
        return null;
      }

      return { description, value: itemValue };
    })
    .filter((item): item is PromptPresetItemInput => item !== null);
}

function normalizePresetName(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const withItems = req.query.withItems !== 'false';
  const hierarchical = req.query.hierarchical === 'true';
  const rootsOnly = req.query.rootsOnly === 'true';

  const presets = hierarchical
    ? PromptPresetModel.findHierarchy(null)
    : rootsOnly
      ? PromptPresetModel.findRoots()
      : withItems
        ? PromptPresetModel.findAllWithItems()
        : PromptPresetModel.findAll();

  return res.json({ success: true, data: presets });
}));

router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(req.params.id), 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ success: false, error: 'Invalid prompt preset ID' });
  }

  const preset = PromptPresetModel.findByIdWithItems(id);
  if (!preset) {
    return res.status(404).json({ success: false, error: 'Prompt preset not found' });
  }

  return res.json({ success: true, data: preset });
}));

router.post('/', requirePermission('prompts.create'), asyncHandler(async (req: Request, res: Response) => {
  const name = normalizePresetName(req.body?.name);
  if (!name) {
    return res.status(400).json({ success: false, error: 'Name is required' });
  }

  const items = normalizePresetItems(req.body?.items);
  if (!items || items.length === 0) {
    return res.status(400).json({ success: false, error: 'At least one description/value item is required' });
  }

  if (PromptPresetModel.findByName(name)) {
    return res.status(409).json({ success: false, error: 'Prompt preset with this name already exists' });
  }

  const parentId = req.body?.parent_id ?? null;
  if (parentId !== null) {
    const numericParentId = Number(parentId);
    if (!Number.isInteger(numericParentId) || !PromptPresetModel.findById(numericParentId)) {
      return res.status(400).json({ success: false, error: 'Parent prompt preset not found' });
    }
  }

  const data: PromptPresetCreateData = {
    name,
    description: typeof req.body?.description === 'string' ? req.body.description.trim() : null,
    parent_id: parentId === null ? null : Number(parentId),
    items,
  };

  const preset = PromptPresetModel.create(data);
  return res.status(201).json({ success: true, data: PromptPresetModel.findByIdWithItems(preset.id) });
}));

router.put('/:id', requirePermission('prompts.update'), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(req.params.id), 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ success: false, error: 'Invalid prompt preset ID' });
  }

  const existing = PromptPresetModel.findById(id);
  if (!existing) {
    return res.status(404).json({ success: false, error: 'Prompt preset not found' });
  }

  const name = req.body?.name === undefined ? undefined : normalizePresetName(req.body.name);
  if (name !== undefined && !name) {
    return res.status(400).json({ success: false, error: 'Name is required' });
  }

  if (name && name !== existing.name && PromptPresetModel.findByName(name)) {
    return res.status(409).json({ success: false, error: 'Prompt preset with this name already exists' });
  }

  let parentId: number | null | undefined = undefined;
  if (req.body?.parent_id !== undefined) {
    parentId = req.body.parent_id === null ? null : Number(req.body.parent_id);
    if (parentId !== null && (!Number.isInteger(parentId) || !PromptPresetModel.findById(parentId))) {
      return res.status(400).json({ success: false, error: 'Parent prompt preset not found' });
    }
    if (parentId !== null && PromptPresetModel.checkCircularReference(id, parentId)) {
      return res.status(400).json({ success: false, error: 'Circular parent reference detected' });
    }
  }

  const normalizedItems = req.body?.items === undefined ? undefined : normalizePresetItems(req.body.items);
  if (req.body?.items !== undefined && (!normalizedItems || normalizedItems.length === 0)) {
    return res.status(400).json({ success: false, error: 'At least one description/value item is required' });
  }
  const items = normalizedItems ?? undefined;

  const data: PromptPresetUpdateData = {
    ...(name !== undefined ? { name } : {}),
    ...(req.body?.description !== undefined ? { description: typeof req.body.description === 'string' ? req.body.description.trim() : null } : {}),
    ...(parentId !== undefined ? { parent_id: parentId } : {}),
    ...(items !== undefined ? { items } : {}),
  };

  const preset = PromptPresetModel.update(id, data);
  return res.json({ success: true, data: PromptPresetModel.findByIdWithItems(preset.id) });
}));

router.delete('/:id', requirePermission('prompts.delete'), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(req.params.id), 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ success: false, error: 'Invalid prompt preset ID' });
  }

  const deleted = PromptPresetModel.delete(id, req.query.cascade === 'true');
  if (!deleted) {
    return res.status(404).json({ success: false, error: 'Prompt preset not found' });
  }

  return res.json({ success: true });
}));

export { router as promptPresetRoutes };
