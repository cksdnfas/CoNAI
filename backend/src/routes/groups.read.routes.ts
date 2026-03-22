import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { routeParam } from './routeParam';
import { GroupModel, ImageGroupModel } from '../models/Group';
import { db } from '../database/init';
import { GroupDownloadService, DownloadType, CaptionMode } from '../services/groupDownloadService';
import { PAGINATION, errorResponse, successResponse, validateId } from '@conai/shared';
import { asyncHandler } from '../middleware/errorHandler';
import { enrichImageRecord, enrichImageWithFileView } from './images/utils';
import { runtimePaths } from '../config/runtimePaths';

const router = Router();

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  try {
    const groups = await GroupModel.findAllWithStats();
    return res.json(successResponse(groups));
  } catch (error) {
    console.error('Error getting groups:', error);
    return res.status(500).json(errorResponse('Failed to get groups'));
  }
}));

router.get('/:id/thumbnail', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(routeParam(routeParam(req.params.id)), 'Group ID');
    const randomImage = await ImageGroupModel.findRandomImageForGroup(id);

    if (!randomImage) {
      return res.status(404).json(errorResponse('No images found in group'));
    }

    if (!randomImage.thumbnail_path) {
      return res.status(404).json(errorResponse('Thumbnail not found for image'));
    }

    const fullPath = path.join(runtimePaths.tempDir, randomImage.thumbnail_path);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json(errorResponse('Image file not found'));
    }

    const ext = path.extname(fullPath).toLowerCase();
    let contentType = 'image/jpeg';

    switch (ext) {
      case '.png':
        contentType = 'image/png';
        break;
      case '.gif':
        contentType = 'image/gif';
        break;
      case '.webp':
        contentType = 'image/webp';
        break;
      case '.jpg':
      case '.jpeg':
      default:
        contentType = 'image/jpeg';
        break;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    return res.sendFile(fullPath);
  } catch (error) {
    console.error('Error getting group thumbnail:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get group thumbnail';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

router.get('/:id/preview-images', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(routeParam(routeParam(req.params.id)), 'Group ID');
    const count = parseInt(req.query.count as string) || 8;
    const includeChildren = req.query.includeChildren !== 'false';
    const limitedCount = Math.min(Math.max(count, 1), 20);

    const images = await ImageGroupModel.findPreviewImages(id, limitedCount, includeChildren);
    const enrichedImages = images.map(img => enrichImageWithFileView(img));

    return res.json(successResponse(enrichedImages));
  } catch (error) {
    console.error('Error getting preview images:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get preview images';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(routeParam(routeParam(req.params.id)), 'Group ID');

    const query = `
      SELECT
        g.*,
        COUNT(ig.id) as image_count,
        COUNT(CASE WHEN ig.collection_type = 'auto' THEN 1 END) as auto_collected_count,
        COUNT(CASE WHEN ig.collection_type = 'manual' THEN 1 END) as manual_added_count
      FROM groups g
      LEFT JOIN image_groups ig ON g.id = ig.group_id
      WHERE g.id = ?
      GROUP BY g.id
    `;

    const group = db.prepare(query).get(id);

    if (!group) {
      return res.status(404).json(errorResponse('Group not found'));
    }

    return res.json(successResponse(group));
  } catch (error) {
    console.error('Error getting group:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get group';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

router.get('/:id/images', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(routeParam(routeParam(req.params.id)), 'Group ID');
    const page = parseInt(req.query.page as string) || PAGINATION.DEFAULT_PAGE;
    const limit = parseInt(req.query.limit as string) || PAGINATION.GROUP_IMAGES_LIMIT;
    const collectionType = req.query.collection_type as 'manual' | 'auto';

    const result = await ImageGroupModel.findImagesByGroup(id, page, limit, collectionType);
    const group = await GroupModel.findById(id);

    const enrichedImages = result.images.map(image => {
      const enriched = enrichImageWithFileView(image);
      enriched.groups = [{
        id: group!.id,
        name: group!.name,
        color: group!.color,
        collection_type: (image as any).collection_type || 'manual'
      }];
      return enriched;
    });

    if (enrichedImages.length > 0) {
      console.log('[DEBUG] First enriched image:', {
        composite_hash: enrichedImages[0].composite_hash,
        id: enrichedImages[0].id,
        file_type: enrichedImages[0].file_type,
        mime_type: enrichedImages[0].mime_type,
        file_size: enrichedImages[0].file_size
      });
    }

    return res.json(
      successResponse({
        images: enrichedImages,
        pagination: {
          page,
          limit,
          total: result.total,
          totalPages: Math.ceil(result.total / limit)
        }
      })
    );
  } catch (error) {
    console.error('Error getting group images:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get group images';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

router.get('/:id/image-ids', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(routeParam(routeParam(req.params.id)), 'Group ID');
    const fileIds = await ImageGroupModel.getImageFileIdsForGroup(id);

    return res.json(successResponse({
      ids: fileIds,
      total: fileIds.length
    }));
  } catch (error) {
    console.error('Error getting image IDs from group:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get image IDs from group';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

router.get('/:id/random-image', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(routeParam(routeParam(req.params.id)), 'Group ID');
    const randomImage = await ImageGroupModel.findRandomImageForGroup(id);

    if (!randomImage) {
      return res.status(404).json(errorResponse('No images found in group'));
    }

    return res.json(successResponse(enrichImageRecord(randomImage)));
  } catch (error) {
    console.error('Error getting random image from group:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get random image from group';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

router.get('/:id/download', asyncHandler(async (req: Request, res: Response) => {
  try {
    const groupId = validateId(routeParam(routeParam(req.params.id)), 'Group ID');
    const downloadType = (req.query.type as DownloadType) || 'thumbnail';

    let compositeHashes: string[] | undefined;
    if (req.query.hashes) {
      try {
        compositeHashes = JSON.parse(req.query.hashes as string);
        if (!Array.isArray(compositeHashes)) {
          return res.status(400).json(errorResponse('Invalid hashes parameter: must be an array'));
        }
      } catch (parseError) {
        return res.status(400).json(errorResponse('Invalid hashes parameter: must be valid JSON'));
      }
    }

    if (!['thumbnail', 'original', 'video'].includes(downloadType)) {
      return res.status(400).json(errorResponse('Invalid download type. Must be: thumbnail, original, or video'));
    }

    const captionMode = req.query.captionMode as string | undefined;
    if (captionMode && !['auto_tags', 'merged'].includes(captionMode)) {
      return res.status(400).json(errorResponse('Invalid captionMode. Must be: auto_tags or merged'));
    }

    const result = await GroupDownloadService.createGroupZip({
      groupId,
      downloadType,
      groupType: 'custom',
      compositeHashes,
      captionOptions: captionMode ? { captionMode: captionMode as CaptionMode } : undefined
    });

    const encodedFilename = encodeURIComponent(result.fileName);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition',
      `attachment; filename="${result.fileName}"; filename*=UTF-8''${encodedFilename}`
    );
    res.setHeader('X-File-Count', result.fileCount.toString());

    const fileStream = fs.createReadStream(result.zipPath);

    fileStream.on('error', (error) => {
      console.error('Error streaming zip file:', error);
      if (!res.headersSent) {
        res.status(500).json(errorResponse('Failed to download zip file'));
      }
    });

    fileStream.on('end', async () => {
      await GroupDownloadService.cleanupTempFile(result.zipPath);
    });

    return fileStream.pipe(res);
  } catch (error) {
    console.error('Error downloading group images:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to download group images';

    let statusCode = 500;
    if (errorMessage.includes('not found') || errorMessage.includes('No images')) {
      statusCode = 404;
    } else if (errorMessage.includes('Invalid')) {
      statusCode = 400;
    }

    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

router.get('/:id/file-counts', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(routeParam(routeParam(req.params.id)), 'Group ID');
    const counts = await GroupDownloadService.getFileCountByType(id, 'custom');
    return res.json(successResponse(counts));
  } catch (error) {
    console.error('Error getting file counts:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get file counts';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

export { router as groupReadRoutes };
