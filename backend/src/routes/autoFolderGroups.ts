import { Router, Request, Response } from 'express';
import { AutoFolderGroupService } from '../services/autoFolderGroupService';
import { GroupDownloadService, DownloadType } from '../services/groupDownloadService';
import { AutoFolderGroupImageModel } from '../models/AutoFolderGroup';
import {
  validateId,
  successResponse,
  errorResponse,
  PAGINATION
} from '@comfyui-image-manager/shared';
import { asyncHandler } from '../middleware/errorHandler';
import { enrichImageRecord } from './images/utils';
import path from 'path';
import fs from 'fs';
import { resolveUploadsPath } from '../config/runtimePaths';

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
    const parentId = req.params.parentId === 'root'
      ? null
      : validateId(req.params.parentId, 'Parent ID');

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
    const id = validateId(req.params.id, 'Group ID');

    const randomImage = await AutoFolderGroupService.getRandomThumbnail(id);

    if (!randomImage) {
      return res.status(404).json(errorResponse('No images found in group'));
    }

    // 썸네일 파일 경로 사용 (media_metadata에 저장됨)
    if (!randomImage.thumbnail_path) {
      return res.status(404).json(errorResponse('Thumbnail not found for image'));
    }

    const fullPath = resolveUploadsPath(randomImage.thumbnail_path);

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
 * 특정 그룹 조회
 * GET /api/auto-folder-groups/:id
 */
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(req.params.id, 'Group ID');

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
    const id = validateId(req.params.id, 'Group ID');
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(
      Math.max(1, parseInt(req.query.pageSize as string) || PAGINATION.DEFAULT_PAGE_SIZE),
      PAGINATION.MAX_PAGE_SIZE
    );

    const result = await AutoFolderGroupService.getGroupImages(id, page, pageSize);

    // 이미지 메타데이터 보강 (URL 추가)
    const enrichedImages = result.images.map(img => enrichImageRecord(img));

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
    const id = validateId(req.params.id, 'Group ID');

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
    const id = validateId(req.params.id, 'Group ID');
    const type = (req.query.type as DownloadType) || 'original';
    const hashesParam = req.query.hashes as string | undefined;

    // 선택된 이미지만 다운로드 (옵션)
    const selectedHashes = hashesParam ? hashesParam.split(',') : undefined;

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
    const zipPath = await GroupDownloadService.createGroupZip(
      group.display_name,
      hashesToDownload,
      type
    );

    // ZIP 파일 전송
    res.download(zipPath, `${group.display_name}.zip`, (err) => {
      // 다운로드 완료 또는 실패 시 임시 파일 삭제
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
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
    const id = validateId(req.params.id, 'Group ID');
    const hashesParam = req.query.hashes as string | undefined;

    const selectedHashes = hashesParam ? hashesParam.split(',') : undefined;

    // 해시 목록 가져오기
    const allHashes = await AutoFolderGroupService.getGroupHashes(id);
    const hashesToCheck = selectedHashes || allHashes;

    const fileCounts = await GroupDownloadService.getFileTypeCounts(hashesToCheck);

    return res.json(successResponse(fileCounts));
  } catch (error) {
    console.error('Error getting file counts:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get file counts';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

export default router;
