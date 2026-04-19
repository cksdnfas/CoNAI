import { Router, Request, Response } from 'express';
import { routeParam } from './routeParam';
import { GroupModel, ImageGroupModel } from '../models/Group';
import { AutoCollectionService } from '../services/autoCollectionService';
import { ComplexFilterService } from '../services/complexFilterService';
import { GroupCreateData, GroupUpdateData, ComplexFilter, AutoCollectCondition, errorResponse, successResponse, validateId } from '@conai/shared';
import { asyncHandler } from '../middleware/errorHandler';
import { getGroupHierarchyService } from '../services/groupHierarchyService';

const router = Router();

/** Send the standard 400 route validation payload without changing response shape. */
function sendRouteBadRequest(res: Response, message: string) {
  return res.status(400).json(errorResponse(message));
}

/** Read and validate one numeric route id without repeating routeParam/validateId plumbing. */
function parseRouteId(value: string | string[] | undefined, label = 'Group ID') {
  return validateId(routeParam(value), label);
}

/** Read one required route parameter while preserving the legacy missing-param error flow. */
function parseRequiredRouteParam(value: string | string[] | undefined) {
  return routeParam(value);
}

function validateAutoCollectConditions(conditions: AutoCollectCondition[] | ComplexFilter): { valid: boolean; errors: string[] } {
  const isComplexFilter = conditions && typeof conditions === 'object' && !Array.isArray(conditions);

  if (isComplexFilter) {
    return ComplexFilterService.validateFilter(conditions as ComplexFilter);
  }

  return AutoCollectionService.validateConditions(conditions as AutoCollectCondition[]);
}

/** Validate auto-collect conditions only when the route enables them and supplied input exists. */
function validateAutoCollectInput(
  res: Response,
  autoCollectEnabled: boolean | undefined,
  autoCollectConditions: AutoCollectCondition[] | ComplexFilter | undefined
) {
  if (!autoCollectEnabled || !autoCollectConditions) {
    return true;
  }

  const validation = validateAutoCollectConditions(autoCollectConditions);
  if (!validation.valid) {
    sendRouteBadRequest(
      res,
      `Invalid auto collection conditions: ${validation.errors.join(', ')}`
    );
    return false;
  }

  return true;
}

/** Validate the bulk composite hash array without changing the route error payload. */
function requireCompositeHashes(res: Response, compositeHashes: unknown): compositeHashes is string[] {
  if (!Array.isArray(compositeHashes) || compositeHashes.length === 0) {
    sendRouteBadRequest(res, 'Composite hashes array is required');
    return false;
  }

  return true;
}

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { name, description, color, parent_id, auto_collect_enabled, auto_collect_conditions } = req.body;

  if (!name) {
    return sendRouteBadRequest(res, 'Group name is required');
  }

  if (parent_id !== undefined && parent_id !== null) {
    const hierarchyService = getGroupHierarchyService();
    const parentDepth = hierarchyService.calculateDepth(parent_id);

    if (parentDepth >= 4) {
      return sendRouteBadRequest(res, 'Maximum hierarchy depth (5 levels) would be exceeded');
    }
  }

  if (!validateAutoCollectInput(res, auto_collect_enabled, auto_collect_conditions)) {
    return;
  }

  try {
    const groupData: GroupCreateData = {
      name,
      description,
      color,
      parent_id,
      auto_collect_enabled,
      auto_collect_conditions
    };

    const groupId = await GroupModel.create(groupData);

    if (auto_collect_enabled && auto_collect_conditions) {
      try {
        await AutoCollectionService.runAutoCollectionForGroup(groupId);
      } catch (autoCollectError) {
        console.warn('Auto collection failed for new group:', autoCollectError);
      }
    }

    return res.status(201).json(
      successResponse({
        id: groupId,
        message: 'Group created successfully'
      })
    );
  } catch (error) {
    console.error('Error creating group:', error);
    const errorMessage = (error as Error).message.includes('UNIQUE')
      ? 'Group name already exists'
      : 'Failed to create group';
    return res.status(500).json(errorResponse(errorMessage));
  }
}));

router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = parseRouteId(req.params.id);
    const { name, description, color, parent_id, auto_collect_enabled, auto_collect_conditions } = req.body;

    if (parent_id !== undefined) {
      const hierarchyService = getGroupHierarchyService();
      const validation = hierarchyService.validateHierarchy(id, parent_id);

      if (!validation.valid) {
        return sendRouteBadRequest(res, validation.error || 'Invalid hierarchy');
      }
    }

    if (!validateAutoCollectInput(res, auto_collect_enabled, auto_collect_conditions)) {
      return;
    }

    const groupData: GroupUpdateData = {
      name,
      description,
      color,
      parent_id,
      auto_collect_enabled,
      auto_collect_conditions
    };

    const updated = await GroupModel.update(id, groupData);

    if (!updated) {
      return res.status(404).json(errorResponse('Group not found'));
    }

    if (auto_collect_enabled && auto_collect_conditions) {
      try {
        await AutoCollectionService.runAutoCollectionForGroup(id);
      } catch (autoCollectError) {
        console.warn('Auto collection failed after group update:', autoCollectError);
      }
    }

    return res.json(successResponse({ message: 'Group updated successfully' }));
  } catch (error) {
    console.error('Error updating group:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to update group';
    if ((errorMessage as string).includes('UNIQUE')) {
      return sendRouteBadRequest(res, 'Group name already exists');
    }
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = parseRouteId(req.params.id);
    const cascade = req.query.cascade === 'true';

    const deleted = await GroupModel.delete(id, cascade);

    if (!deleted) {
      return res.status(404).json(errorResponse('Group not found'));
    }

    return res.json(successResponse({ message: 'Group deleted successfully' }));
  } catch (error) {
    console.error('Error deleting group:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to delete group';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

router.post('/:id/images', asyncHandler(async (req: Request, res: Response) => {
  try {
    const groupId = parseRouteId(req.params.id);
    const { composite_hash, order_index = 0 } = req.body;

    if (!composite_hash) {
      return sendRouteBadRequest(res, 'Composite hash is required');
    }

    const collectionType = await ImageGroupModel.getCollectionType(groupId, composite_hash);

    if (collectionType === 'manual') {
      return res.status(409).json(errorResponse('Image is already manually added to the group'));
    } else if (collectionType === 'auto') {
      const converted = await ImageGroupModel.convertToManual(groupId, composite_hash);
      if (converted) {
        return res.status(200).json(
          successResponse({
            message: 'Image converted from auto-collection to manual',
            converted: true
          })
        );
      }
    }

    await ImageGroupModel.addImageToGroup(groupId, composite_hash, 'manual', order_index);

    return res.status(201).json(
      successResponse({
        message: 'Image added to group successfully',
        converted: false
      })
    );
  } catch (error) {
    console.error('Error adding image to group:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to add image to group';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

router.post('/:id/images/bulk', asyncHandler(async (req: Request, res: Response) => {
  try {
    const groupId = parseRouteId(req.params.id);
    const { composite_hashes } = req.body;

    if (!requireCompositeHashes(res, composite_hashes)) {
      return;
    }

    let addedCount = 0;
    let convertedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    for (const compositeHash of composite_hashes) {
      try {
        const collectionType = await ImageGroupModel.getCollectionType(groupId, compositeHash);

        if (collectionType === 'manual') {
          skippedCount++;
          continue;
        } else if (collectionType === 'auto') {
          const converted = await ImageGroupModel.convertToManual(groupId, compositeHash);
          if (converted) {
            convertedCount++;
          }
          continue;
        }

        await ImageGroupModel.addImageToGroup(groupId, compositeHash, 'manual', 0);
        addedCount++;
      } catch (error) {
        errors.push(`Image ${compositeHash}: ${(error as Error).message}`);
      }
    }

    return res.status(201).json(
      successResponse({
        message: `Bulk add completed: ${addedCount} added, ${convertedCount} converted, ${skippedCount} skipped`,
        added_count: addedCount,
        converted_count: convertedCount,
        skipped_count: skippedCount,
        errors: errors.length > 0 ? errors : undefined
      })
    );
  } catch (error) {
    console.error('Error bulk adding images to group:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to bulk add images to group';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

router.post('/:id/images/bulk-remove', asyncHandler(async (req: Request, res: Response) => {
  try {
    const groupId = parseRouteId(req.params.id);
    const { composite_hashes } = req.body;

    if (!requireCompositeHashes(res, composite_hashes)) {
      return;
    }

    let removedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    for (const compositeHash of composite_hashes) {
      try {
        const removed = await ImageGroupModel.removeImageFromGroup(groupId, compositeHash);
        if (removed) {
          removedCount++;
        } else {
          skippedCount++;
        }
      } catch (error) {
        errors.push(`Image ${compositeHash}: ${(error as Error).message}`);
      }
    }

    return res.json(
      successResponse({
        message: `Bulk remove completed: ${removedCount} removed, ${skippedCount} skipped`,
        removed_count: removedCount,
        skipped_count: skippedCount,
        errors: errors.length > 0 ? errors : undefined
      })
    );
  } catch (error) {
    console.error('Error bulk removing images from group:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to bulk remove images from group';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

router.delete('/:id/images/:imageId', asyncHandler(async (req: Request, res: Response) => {
  try {
    const groupId = parseRouteId(req.params.id);
    const compositeHash = parseRequiredRouteParam(req.params.imageId);

    const removed = await ImageGroupModel.removeImageFromGroup(groupId, compositeHash);

    if (!removed) {
      return res.status(404).json(errorResponse('Image not found in group'));
    }

    return res.json(successResponse({ message: 'Image removed from group successfully' }));
  } catch (error) {
    console.error('Error removing image from group:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to remove image from group';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

router.post('/:id/auto-collect', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = parseRouteId(req.params.id);
    const result = await AutoCollectionService.runAutoCollectionForGroup(id);
    return res.json(successResponse(result));
  } catch (error) {
    console.error('Error running auto collection:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to run auto collection';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

router.post('/auto-collect-all', asyncHandler(async (req: Request, res: Response) => {
  try {
    const results = await AutoCollectionService.runAutoCollectionForAllGroups();

    return res.json(
      successResponse({
        results,
        total_groups: results.length,
        total_images_added: results.reduce((sum, r) => sum + r.images_added, 0),
        total_images_removed: results.reduce((sum, r) => sum + r.images_removed, 0)
      })
    );
  } catch (error) {
    console.error('Error running auto collection for all groups:', error);
    return res.status(500).json(errorResponse('Failed to run auto collection for all groups'));
  }
}));

export { router as groupMutationRoutes };
