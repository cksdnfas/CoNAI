import { Router, Request, Response } from 'express';
import { routeParam } from './routeParam';
import { GroupModel, ImageGroupModel } from '../models/Group';
import { GroupRematchJobService } from '../services/groupRematchJobService';
import { GroupCreateData, GroupUpdateData, errorResponse, successResponse, validateId } from '@conai/shared';
import { asyncHandler } from '../middleware/asyncHandler';
import { createCustomGroup, GroupMutationError, updateCustomGroup } from '../services/groupMutationService';

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

/** Read the session account id so started jobs carry an owner for `/api/jobs` access control. */
function resolveJobRequesterAccountId(req: Request): number | null {
  return typeof req.session?.accountId === 'number' ? req.session.accountId : null;
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
  const { name, description, color, parent_id, auto_collect_enabled, auto_collect_conditions, emoticon_enabled } = req.body;

  try {
    const groupData: GroupCreateData = {
      name,
      description,
      color,
      parent_id,
      auto_collect_enabled,
      auto_collect_conditions,
      emoticon_enabled: emoticon_enabled === true,
    };

    const { id: groupId } = createCustomGroup(groupData, resolveJobRequesterAccountId(req));

    return res.status(201).json(
      successResponse({
        id: groupId,
        message: 'Group created successfully'
      })
    );
  } catch (error) {
    if (error instanceof GroupMutationError) {
      return sendRouteBadRequest(res, error.message);
    }
    console.error('Error creating group:', error);
    return res.status(500).json(errorResponse('Failed to create group'));
  }
}));

router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = parseRouteId(req.params.id);
    const { name, description, color, parent_id, auto_collect_enabled, auto_collect_conditions, emoticon_enabled } = req.body;

    const groupData: GroupUpdateData = {
      name,
      description,
      color,
      parent_id,
      auto_collect_enabled,
      auto_collect_conditions,
      emoticon_enabled: typeof emoticon_enabled === 'boolean' ? emoticon_enabled : undefined,
    };

    const { updated } = updateCustomGroup(id, groupData, resolveJobRequesterAccountId(req));

    if (!updated) {
      return res.status(404).json(errorResponse('Group not found'));
    }

    return res.json(successResponse({ message: 'Group updated successfully' }));
  } catch (error) {
    if (error instanceof GroupMutationError) {
      return sendRouteBadRequest(res, error.message);
    }
    console.error('Error updating group:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to update group';
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

    const { addedCount, convertedCount, skippedCount, errors } = await ImageGroupModel.addImagesManuallyInPages(groupId, composite_hashes);

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

    const { removedCount, skippedCount, errors } = await ImageGroupModel.removeImagesInPages(groupId, composite_hashes);

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

router.get('/auto-collect-jobs/:jobId', asyncHandler(async (req: Request, res: Response) => {
  try {
    const jobId = parseRequiredRouteParam(req.params.jobId);
    const job = GroupRematchJobService.readJob(jobId);
    if (!job) {
      return res.status(404).json(errorResponse('Auto-collect job not found'));
    }

    return res.json(successResponse(job));
  } catch (error) {
    console.error('Error loading auto collection job:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to load auto collection job';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

router.post('/:id/auto-collect', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = parseRouteId(req.params.id);
    const job = GroupRematchJobService.startJobProcess('group-auto-collect', {
      groupId: id,
      requestedByAccountId: resolveJobRequesterAccountId(req),
    });
    return res.status(202).json(successResponse(job));
  } catch (error) {
    console.error('Error running auto collection:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to run auto collection';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

router.post('/auto-collect-all', asyncHandler(async (req: Request, res: Response) => {
  try {
    const job = GroupRematchJobService.startJobProcess('all-auto-collect', {
      requestedByAccountId: resolveJobRequesterAccountId(req),
    });
    return res.status(202).json(successResponse(job));
  } catch (error) {
    console.error('Error running auto collection for all groups:', error);
    return res.status(500).json(errorResponse('Failed to run auto collection for all groups'));
  }
}));

export { router as groupMutationRoutes };
