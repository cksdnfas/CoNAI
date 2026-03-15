import { Router, Request, Response } from 'express';
import { routeParam } from './routeParam';
import { AutoFolderGroupService } from '../services/autoFolderGroupService';
import { GroupDownloadService, DownloadType, CaptionMode } from '../services/groupDownloadService';
import { AutoFolderGroupImageModel } from '../models/AutoFolderGroup';
import { validateId,
successResponse,
errorResponse,
PAGINATION } from '@conai/shared';
import { asyncHandler } from '../middleware/errorHandler';
import { enrichImageWithFileView } from './images/utils';
import path from 'path';
import fs from 'fs';
import { resolveUploadsPath, runtimePaths } from '../config/runtimePaths';

const router = Router();

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
    const parentId = routeParam(routeParam(req.params.parentId)) === 'root'
      ? null
      : validateId(routeParam(routeParam(req.params.parentId)), 'Parent ID');

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
    const id = validateId(routeParam(routeParam(req.params.id)), 'Group ID');

    const randomImage = await AutoFolderGroupService.getRandomThumbnail(id);

    if (!randomImage) {
      return res.status(404).json(errorResponse('No images found in group'));
    }

    // 썸네일 파일 경로 사용 (media_metadata에 저장됨)
    if (!randomImage.thumbnail_path) {
      return res.status(404).json(errorResponse('Thumbnail not found for image'));
    }

    // 썸네일은 temp 폴더에 저장됨
    const fullPath = path.join(runtimePaths.tempDir, randomImage.thumbnail_path);

    // 파일 존재 여부 확인
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json(errorResponse('Image file not found'));
    }

    // 이미지 파일 직접 전송
    const ext = path.extname(fullPath).toLowerCase();
    let contentType = 'image/jpeg'; // 기본값

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
    res.setHeader('Cache-Control', 'public, max-age=3600'); // 1시간 캐시

    return res.sendFile(fullPath);
  } catch (error) {
    console.error('Error getting group thumbnail:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get group thumbnail';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

/**
 * 특정 그룹의 미리보기 이미지들 조회 (회전 표시용)
 * GET /api/auto-folder-groups/:id/preview-images?count=8&includeChildren=true
 */
router.get('/:id/preview-images', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(routeParam(routeParam(req.params.id)), 'Group ID');
    const count = parseInt(req.query.count as string) || 8;
    const includeChildren = req.query.includeChildren !== 'false'; // 기본값 true

    // count 범위 제한 (1~20)
    const limitedCount = Math.min(Math.max(count, 1), 20);

    const images = await AutoFolderGroupImageModel.findPreviewImages(id, limitedCount, includeChildren);

    // 이미지 경로 보강 (enrichImageWithFileView 사용)
    const enrichedImages = images.map(img => enrichImageWithFileView(img));

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
    const id = validateId(routeParam(routeParam(req.params.id)), 'Group ID');

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
    const id = validateId(routeParam(routeParam(req.params.id)), 'Group ID');
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(
      Math.max(1, parseInt(req.query.pageSize as string) || PAGINATION.DEFAULT_LIMIT),
      PAGINATION.MAX_LIMIT
    );

    const result = await AutoFolderGroupService.getGroupImages(id, page, pageSize);

    // 이미지 메타데이터 보강 (URL 추가)
    const enrichedImages = result.images.map(img => enrichImageWithFileView(img));

    return res.json(successResponse({
      items: enrichedImages,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages
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
    const id = validateId(routeParam(routeParam(req.params.id)), 'Group ID');

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
    const result = await AutoFolderGroupService.rebuildAllFolderGroups();

    if (!result.success) {
      return res.status(500).json(errorResponse(result.error || 'Failed to rebuild groups'));
    }

    return res.json(successResponse(result));
  } catch (error) {
    console.error('Error rebuilding groups:', error);
    return res.status(500).json(errorResponse('Failed to rebuild groups'));
  }
}));

/**
 * 그룹 이미지 다운로드 (ZIP)
 * GET /api/auto-folder-groups/:id/download
 */
router.get('/:id/download', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(routeParam(routeParam(req.params.id)), 'Group ID');
    const type = (req.query.type as DownloadType) || 'original';
    const hashesParam = req.query.hashes as string | undefined;

    // 선택된 이미지만 다운로드 (옵션)
    const selectedHashes = hashesParam ? hashesParam.split(',') : undefined;

    // 캡션 모드 파싱 (LoRA 데이터셋용)
    const captionMode = req.query.captionMode as string | undefined;
    if (captionMode && !['auto_tags', 'merged'].includes(captionMode)) {
      return res.status(400).json(errorResponse('Invalid captionMode. Must be: auto_tags or merged'));
    }

    const group = await AutoFolderGroupService.getGroupById(id);
    if (!group) {
      return res.status(404).json(errorResponse('Group not found'));
    }

    // 다운로드할 해시 목록 가져오기
    const allHashes = await AutoFolderGroupService.getGroupHashes(id);
    const hashesToDownload = selectedHashes || allHashes;

    if (hashesToDownload.length === 0) {
      return res.status(400).json(errorResponse('No images to download'));
    }

    // ZIP 파일 생성
    const result = await GroupDownloadService.createGroupZip({
      groupId: id,
      downloadType: type,
      groupType: 'auto-folder',
      compositeHashes: selectedHashes,
      captionOptions: captionMode ? { captionMode: captionMode as CaptionMode } : undefined
    });

    // ZIP 파일 전송
    res.download(result.zipPath, result.fileName, (err) => {
      // 다운로드 완료 또는 실패 시 임시 파일 삭제
      if (fs.existsSync(result.zipPath)) {
        fs.unlinkSync(result.zipPath);
      }

      if (err) {
        console.error('Error sending zip file:', err);
      }
    });

    return;
  } catch (error) {
    console.error('Error downloading group:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to download group';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

/**
 * 그룹의 파일 타입별 개수 조회 (다운로드 전 정보)
 * GET /api/auto-folder-groups/:id/file-counts
 */
router.get('/:id/file-counts', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(routeParam(routeParam(req.params.id)), 'Group ID');

    const fileCounts = await GroupDownloadService.getFileCountByType(id, 'auto-folder');

    return res.json(successResponse(fileCounts));
  } catch (error) {
    console.error('Error getting file counts:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get file counts';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

export default router;
