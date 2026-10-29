import { Router, Request, Response } from 'express';
import { routeParam } from './routeParam';
import { AutoFolderGroupService } from '../services/autoFolderGroupService';
import { GroupRematchJobService } from '../services/groupRematchJobService';
import { GroupDownloadService, DownloadType, CaptionMode } from '../services/groupDownloadService';
import { AutoFolderGroupImageModel } from '../models/AutoFolderGroup';
import { validateId,
successResponse,
errorResponse,
PAGINATION } from '@conai/shared';
import { asyncHandler, cancellableAsyncHandler } from '../middleware/asyncHandler';
import { pipeFileToResponse } from './images/query-file-response-helpers';
import { enrichCompactImageWithFileView } from './images/utils';
import fs from 'fs';
import { allowImagesView } from '../middleware/imageAccess';
import { requirePermission } from '../middleware/authMiddleware';
import { getRequesterAccountId } from './requester-session-helpers';
import { parseGroupPreviewBatchIds, sendGroupReadBadRequest } from './groups.read.routes';
import { parsePositiveIntegerQuery } from './routeValidation';

const router = Router();
router.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    allowImagesView(req, res, next);
  } else requirePermission('images.edit')(req, res, next);
});

/**
 * 모든 자동 폴더 그룹 조회 (통계 포함)
 * GET /api/auto-folder-groups
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  try {
    const groups = await AutoFolderGroupService.getAllGroups();
    return res.json(successResponse(groups));
  } catch (error) {
    console.error('Error getting auto folder groups:', error);
    return res.status(500).json(errorResponse('Failed to get auto folder groups'));
  }
}));

/**
 * 특정 부모의 자식 그룹들 조회
 * GET /api/auto-folder-groups/children/:parentId
 * parentId = 'root' for root level groups
 */
router.get('/children/:parentId', asyncHandler(async (req: Request, res: Response) => {
  try {
    const parentId = routeParam(req.params.parentId) === 'root'
      ? null
      : validateId(routeParam(req.params.parentId), 'Parent ID');

    const groups = await AutoFolderGroupService.getChildGroups(parentId);
    return res.json(successResponse(groups));
  } catch (error) {
    console.error('Error getting child groups:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get child groups';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

/**
 * 특정 그룹의 썸네일 이미지 조회 (랜덤)
 * GET /api/auto-folder-groups/:id/thumbnail
 */
router.get('/:id/thumbnail', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(routeParam(req.params.id), 'Group ID');

    const randomImage = await AutoFolderGroupService.getRandomThumbnail(id);

    if (!randomImage) {
      return res.status(404).json(errorResponse('No images found in group'));
    }

    if (!randomImage.composite_hash) {
      return res.status(404).json(errorResponse('Thumbnail not found for image'));
    }

    return res.redirect(`/api/images/${encodeURIComponent(randomImage.composite_hash)}/thumbnail`);
  } catch (error) {
    console.error('Error getting group thumbnail:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get group thumbnail';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

/**
 * 여러 그룹의 미리보기 이미지를 한 번에 조회 (그룹 커버 모자이크)
 * GET /api/auto-folder-groups/preview-images?ids=1,2,3&count=4&includeChildren=true
 * GET 이므로 위의 이미지 보기 권한 검사를 그대로 거친다.
 */
router.get('/preview-images', asyncHandler(async (req: Request, res: Response) => {
  const ids = parseGroupPreviewBatchIds(req.query.ids);
  if (ids.ok === false) {
    return sendGroupReadBadRequest(res, ids.error);
  }
  const countResult = parsePositiveIntegerQuery(req.query.count, 8, { max: 20, error: 'count must be an integer between 1 and 20' });
  if (countResult.ok === false) {
    return sendGroupReadBadRequest(res, countResult.error);
  }

  const includeChildren = req.query.includeChildren !== 'false';
  const previews: Record<string, unknown[]> = {};
  for (const id of ids.value) {
    previews[id] = AutoFolderGroupImageModel.findPreviewImages(id, countResult.value, includeChildren).map((image) => enrichCompactImageWithFileView(image));
  }
  return res.json(successResponse(previews));
}));

/**
 * 특정 그룹의 미리보기 이미지들 조회 (회전 표시용)
 * GET /api/auto-folder-groups/:id/preview-images?count=8&includeChildren=true
 */
router.get('/:id/preview-images', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(routeParam(req.params.id), 'Group ID');
    const count = parseInt(req.query.count as string) || 8;
    const includeChildren = req.query.includeChildren !== 'false'; // 기본값 true

    // count 범위 제한 (1~20)
    const limitedCount = Math.min(Math.max(count, 1), 20);

    const images = await AutoFolderGroupImageModel.findPreviewImages(id, limitedCount, includeChildren);

    // 이미지 경로 보강 (enrichImageWithFileView 사용)
    const enrichedImages = images.map(img => enrichCompactImageWithFileView(img));

    return res.json(successResponse(enrichedImages));
  } catch (error) {
    console.error('Error getting preview images:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get preview images';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

/**
 * 특정 그룹 조회
 * GET /api/auto-folder-groups/:id
 */
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(routeParam(req.params.id), 'Group ID');

    const group = await AutoFolderGroupService.getGroupById(id);

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

/**
 * 그룹의 이미지 조회 (페이징)
 * GET /api/auto-folder-groups/:id/images
 */
router.get('/:id/images', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(routeParam(req.params.id), 'Group ID');
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(
      Math.max(1, parseInt(req.query.pageSize as string) || PAGINATION.DEFAULT_LIMIT),
      PAGINATION.MAX_LIMIT
    );
    const useCursor = req.query.pagination === 'cursor';
    const cursorDate = typeof req.query.cursor_date === 'string' ? req.query.cursor_date : undefined;
    const cursorHash = typeof req.query.cursor_hash === 'string' ? req.query.cursor_hash : undefined;
    const includeChildren = req.query.include_children === 'true';

    const result = await AutoFolderGroupService.getGroupImages(id, page, pageSize, {
      useCursor,
      cursorDate,
      cursorHash,
      includeTotal: req.query.include_total !== 'false',
      includeChildren,
    });

    // 이미지 메타데이터 보강 (URL 추가)
    const enrichedImages = result.images.map(img => enrichCompactImageWithFileView(img));

    return res.json(successResponse({
      items: enrichedImages,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages,
        hasMore: result.hasMore,
        totalKnown: result.totalKnown,
        nextCursorDate: result.nextCursorDate,
        nextCursorHash: result.nextCursorHash,
      }
    }));
  } catch (error) {
    console.error('Error getting group images:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get group images';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

/**
 * 그룹의 브레드크럼 경로 조회
 * GET /api/auto-folder-groups/:id/breadcrumb
 */
router.get('/:id/breadcrumb', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(routeParam(req.params.id), 'Group ID');

    const breadcrumb = await AutoFolderGroupService.getBreadcrumbPath(id);

    return res.json(successResponse(breadcrumb));
  } catch (error) {
    console.error('Error getting breadcrumb:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get breadcrumb';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

/**
 * 자동 폴더 그룹 재구축
 * POST /api/auto-folder-groups/rebuild
 */
router.post('/rebuild', asyncHandler(async (req: Request, res: Response) => {
  try {
    const job = GroupRematchJobService.startJobProcess('auto-folder-rebuild', {
      requestedByAccountId: getRequesterAccountId(req),
    });
    return res.status(202).json(successResponse(job));
  } catch (error) {
    console.error('Error rebuilding groups:', error);
    return res.status(500).json(errorResponse('Failed to rebuild groups'));
  }
}));

/**
 * 그룹 이미지 다운로드 (ZIP)
 * GET /api/auto-folder-groups/:id/download
 */
router.get('/:id/download', cancellableAsyncHandler(async (req, res, signal) => {
  try {
    const id = validateId(routeParam(req.params.id), 'Group ID');
    const type = (req.query.type as DownloadType) || 'original';
    const hashesParam = req.query.hashes as string | undefined;
    const includeChildren = req.query.include_children === 'true';
    if (!['thumbnail', 'original', 'video'].includes(type)) {
      return res.status(400).json(errorResponse('Invalid download type. Must be: thumbnail, original, or video'));
    }

    // 선택된 이미지만 다운로드 (옵션)
    const selectedHashes = hashesParam ? hashesParam.split(',') : undefined;

    // 캡션 모드 파싱 (LoRA 데이터셋용)
    const captionMode = req.query.captionMode as string | undefined;
    if (captionMode && !['auto_tags', 'merged'].includes(captionMode)) {
      return res.status(400).json(errorResponse('Invalid captionMode. Must be: auto_tags or merged'));
    }

    // ZIP 파일 생성
    const result = await GroupDownloadService.createGroupZip({
      groupId: id,
      downloadType: type,
      groupType: 'auto-folder',
      compositeHashes: selectedHashes,
      includeChildren,
      signal,
      captionOptions: captionMode ? { captionMode: captionMode as CaptionMode } : undefined
    });

    if (signal.aborted) { await GroupDownloadService.cleanupTempFile(result.zipPath); return; }
    res.attachment(result.fileName);
    res.setHeader('X-File-Count', result.fileCount.toString());
    return pipeFileToResponse(res, fs.createReadStream(result.zipPath), () => {
      void GroupDownloadService.cleanupTempFile(result.zipPath);
    });
  } catch (error) {
    if (signal.aborted) return;
    console.error('Error downloading group:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to download group';
    const statusCode = errorMessage.includes('Invalid') ? 400
      : errorMessage.includes('not found') || errorMessage.includes('No images') ? 404
        : (error as { status?: number }).status === 503 ? 503 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

/**
 * 그룹의 파일 타입별 개수 조회 (다운로드 전 정보)
 * GET /api/auto-folder-groups/:id/file-counts
 */
router.get('/:id/file-counts', cancellableAsyncHandler(async (req, res, signal) => {
  try {
    const id = validateId(routeParam(req.params.id), 'Group ID');
    const includeChildren = req.query.include_children === 'true';

    const fileCounts = await GroupDownloadService.getFileCountByType(id, 'auto-folder', includeChildren, signal);

    return res.json(successResponse(fileCounts));
  } catch (error) {
    if (signal.aborted) return;
    console.error('Error getting file counts:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get file counts';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

export default router;
