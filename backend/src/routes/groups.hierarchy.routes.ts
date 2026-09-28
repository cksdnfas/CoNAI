import { Router, Request, Response } from 'express';
import { routeParam } from './routeParam';
import { GroupModel } from '../models/Group';
import { GroupMoveRequest, errorResponse, successResponse, validateId } from '@conai/shared';
import { asyncHandler } from '../middleware/asyncHandler';
import { getGroupHierarchyService } from '../services/groupHierarchyService';
import {
  GROUP_NAME_CONFLICT_MESSAGE,
  GroupPathError,
  GroupPathService,
  isGroupNameConflictError,
} from '../services/groupPathService';

const router = Router();

router.get('/hierarchy/roots', asyncHandler(async (req: Request, res: Response) => {
  try {
    const groups = await GroupModel.findChildrenWithHierarchy(null);
    return res.json(successResponse(groups));
  } catch (error) {
    console.error('Error getting root groups:', error);
    return res.status(500).json(errorResponse('Failed to get root groups'));
  }
}));

router.get('/:id/children', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(routeParam(routeParam(req.params.id)), 'Group ID');
    const groups = await GroupModel.findChildrenWithHierarchy(id);
    return res.json(successResponse(groups));
  } catch (error) {
    console.error('Error getting child groups:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get child groups';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

router.get('/:id/breadcrumb', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(routeParam(routeParam(req.params.id)), 'Group ID');
    const breadcrumb = await GroupModel.getBreadcrumbPath(id);
    return res.json(successResponse(breadcrumb));
  } catch (error) {
    console.error('Error getting breadcrumb path:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get breadcrumb path';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

router.post('/:id/move', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(routeParam(routeParam(req.params.id)), 'Group ID');
    const { parent_id } = req.body as GroupMoveRequest;

    const hierarchyService = getGroupHierarchyService();
    const validation = hierarchyService.validateHierarchy(id, parent_id);

    if (!validation.valid) {
      return res.status(400).json(errorResponse(validation.error || 'Invalid hierarchy'));
    }

    const updated = await GroupModel.update(id, { parent_id });

    if (!updated) {
      return res.status(404).json(errorResponse('Group not found'));
    }

    return res.json(successResponse({ message: 'Group moved successfully' }));
  } catch (error) {
    if (isGroupNameConflictError(error)) {
      return res.status(400).json(errorResponse(GROUP_NAME_CONFLICT_MESSAGE));
    }
    console.error('Error moving group:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to move group';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

router.post('/:id/validate-hierarchy', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(routeParam(routeParam(req.params.id)), 'Group ID');
    const { parent_id } = req.body;

    const hierarchyService = getGroupHierarchyService();
    const validation = hierarchyService.validateHierarchy(id, parent_id);

    return res.json(successResponse(validation));
  } catch (error) {
    console.error('Error validating hierarchy:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to validate hierarchy';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

/** `프로젝트/이펙트` 경로를 그룹으로 해석한다. `create: true` 면 없는 단계를 만든다. */
router.post('/resolve-path', asyncHandler(async (req: Request, res: Response) => {
  const { path, create } = (req.body ?? {}) as { path?: unknown; create?: unknown };
  try {
    const resolved = GroupPathService.resolve(path, { create: create === true });
    if (!resolved) {
      return res.status(404).json(errorResponse('Group path not found'));
    }
    return res.json(successResponse({
      group_id: resolved.groupId,
      path: resolved.path,
      segments: resolved.segments,
      created_group_ids: resolved.createdGroupIds,
    }));
  } catch (error) {
    if (error instanceof GroupPathError) {
      return res.status(400).json(errorResponse(error.message));
    }
    console.error('Error resolving group path:', error);
    return res.status(500).json(errorResponse('Failed to resolve group path'));
  }
}));

router.get('/hierarchy/all',asyncHandler(async (req: Request, res: Response) => {
  try {
    const groups = await GroupModel.findAllWithHierarchy();
    return res.json(successResponse(groups));
  } catch (error) {
    console.error('Error getting all groups with hierarchy:', error);
    return res.status(500).json(errorResponse('Failed to get groups with hierarchy'));
  }
}));

export { router as groupHierarchyRoutes };
