import { Router, Request, Response } from 'express';
import { routeParam } from './routeParam';
import { asyncHandler } from '../middleware/errorHandler';
import { WildcardModel, WildcardCreateData, WildcardUpdateData } from '../models/Wildcard';
import { WildcardService } from '../services/wildcardService';

const router = Router();

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  try {
    const data: WildcardCreateData = req.body;

    if (!data.name || typeof data.name !== 'string') {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }

    if (!data.items || typeof data.items !== 'object') {
      return res.status(400).json({ success: false, error: 'Items object is required' });
    }

    const hasComfyuiItems = Array.isArray(data.items.comfyui) && data.items.comfyui.length > 0;
    const hasNaiItems = Array.isArray(data.items.nai) && data.items.nai.length > 0;

    if (!hasComfyuiItems && !hasNaiItems) {
      return res.status(400).json({
        success: false,
        error: 'At least one item is required for either ComfyUI or NAI'
      });
    }

    const existing = WildcardModel.findByName(data.name);
    if (existing) {
      return res.status(409).json({ success: false, error: 'Wildcard with this name already exists' });
    }

    if (data.parent_id !== undefined && data.parent_id !== null) {
      const parentWildcard = WildcardModel.findById(data.parent_id);
      if (!parentWildcard) {
        return res.status(400).json({ success: false, error: 'Parent wildcard not found' });
      }
    }

    const wildcard = WildcardModel.create(data);
    const wildcardWithItems = WildcardModel.findByIdWithItems(wildcard.id);
    const circularPath = WildcardService.detectCircularReference(wildcard.id);

    if (circularPath) {
      return res.status(201).json({
        success: true,
        data: wildcardWithItems,
        warning: `Circular reference detected: ${circularPath.join(' -> ')}`
      });
    }

    return res.status(201).json({ success: true, data: wildcardWithItems });
  } catch (error) {
    console.error('Error creating wildcard:', error);
    return res.status(500).json({ success: false, error: 'Failed to create wildcard' });
  }
}));

router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(routeParam(req.params.id)));

  if (isNaN(id)) {
    return res.status(400).json({ success: false, error: 'Invalid wildcard ID' });
  }

  try {
    const data: WildcardUpdateData = req.body;
    const existing = WildcardModel.findById(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Wildcard not found' });
    }

    if (data.name && data.name !== existing.name) {
      const duplicate = WildcardModel.findByName(data.name);
      if (duplicate) {
        return res.status(409).json({ success: false, error: 'Wildcard with this name already exists' });
      }
    }

    if (data.parent_id !== undefined && data.parent_id !== null) {
      const parentWildcard = WildcardModel.findById(data.parent_id);
      if (!parentWildcard) {
        return res.status(400).json({ success: false, error: 'Parent wildcard not found' });
      }
      if (WildcardModel.checkCircularReference(id, data.parent_id)) {
        return res.status(400).json({ success: false, error: 'Circular parent reference detected' });
      }
    }

    const wildcard = WildcardModel.update(id, data);
    const wildcardWithItems = WildcardModel.findByIdWithItems(wildcard.id);
    const circularPath = WildcardService.detectCircularReference(wildcard.id);

    if (circularPath) {
      return res.json({
        success: true,
        data: wildcardWithItems,
        warning: `Circular reference detected: ${circularPath.join(' -> ')}`
      });
    }

    return res.json({ success: true, data: wildcardWithItems });
  } catch (error) {
    console.error('Error updating wildcard:', error);
    return res.status(500).json({ success: false, error: 'Failed to update wildcard' });
  }
}));

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(routeParam(req.params.id)));
  const cascade = req.query.cascade === 'true';

  if (isNaN(id)) {
    return res.status(400).json({ success: false, error: 'Invalid wildcard ID' });
  }

  try {
    const deleted = WildcardModel.delete(id, cascade);

    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Wildcard not found' });
    }

    return res.json({
      success: true,
      message: cascade ? 'Wildcard and all children deleted successfully' : 'Wildcard deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting wildcard:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete wildcard' });
  }
}));

export { router as wildcardMutationRoutes };
