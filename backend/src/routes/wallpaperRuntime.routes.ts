import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { settingsService } from '../services/settingsService';
import { buildGraphWorkflowBrowseContent } from '../services/graphWorkflowViewService';
import { GraphWorkflowFolderModel } from '../models/GraphWorkflowFolder';
import { ImageGroupModel } from '../models/Group';
import { enrichCompactImageWithFileView } from './images/utils';
import { routeParam } from './routeParam';
import { errorResponse, successResponse, validateId } from '@conai/shared';

const router = Router();

/** Return the saved wallpaper runtime preset payload needed by the public live page. */
router.get('/settings', asyncHandler(async (_req: Request, res: Response) => {
  const settings = settingsService.loadSettings();
  return res.json(successResponse({
    wallpaperLayoutPresets: settings.appearance.wallpaperLayoutPresets,
    wallpaperActivePresetId: settings.appearance.wallpaperActivePresetId,
  }));
}));

/** Return one read-only workflow browse snapshot for wallpaper live widgets. */
router.get('/browse-content', asyncHandler(async (req: Request, res: Response) => {
  const folderIdParam = typeof req.query.folder_id === 'string' ? Number(req.query.folder_id) : null;
  const folderId = folderIdParam !== null && Number.isFinite(folderIdParam) ? folderIdParam : null;

  if (folderId !== null && !GraphWorkflowFolderModel.findById(folderId)) {
    return res.status(404).json(errorResponse('Graph workflow folder not found'));
  }

  return res.json(successResponse(buildGraphWorkflowBrowseContent(folderId)));
}));

/** Return one read-only group preview image list for wallpaper live widgets. */
router.get('/groups/:id/preview-images', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(routeParam(routeParam(req.params.id)), 'Group ID');
    const count = parseInt(req.query.count as string) || 8;
    const includeChildren = req.query.includeChildren !== 'false';
    const limitedCount = Math.min(Math.max(count, 1), 20);

    const images = await ImageGroupModel.findPreviewImages(id, limitedCount, includeChildren);
    return res.json(successResponse(images.map(enrichCompactImageWithFileView)));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to get preview images';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

export { router as wallpaperRuntimeRoutes };
