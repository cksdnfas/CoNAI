import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { WatchedFolderService } from '../services/watchedFolderService';
import { FolderScanService } from '../services/folderScanService';
import { successResponse, errorResponse } from '@comfyui-image-manager/shared';

const router = Router();

/**
 * GET /api/folders
 * 감시 폴더 목록 조회
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const type = req.query.type as 'upload' | 'scan' | 'archive' | undefined;
  const activeOnly = req.query.active_only === 'true';

  const folders = await WatchedFolderService.listFolders({ type, active_only: activeOnly });
  return res.json(successResponse(folders));
}));

/**
 * GET /api/folders/default
 * 기본 업로드 폴더 조회
 */
router.get('/default', asyncHandler(async (_req: Request, res: Response) => {
  const folders = await WatchedFolderService.listFolders({ type: 'upload' });
  const defaultFolder = folders.find(f => f.folder_path.includes('uploads/images'));

  if (!defaultFolder) {
    return res.status(404).json(errorResponse('기본 업로드 폴더를 찾을 수 없습니다'));
  }

  return res.json(successResponse(defaultFolder));
}));

/**
 * GET /api/folders/:id
 * 특정 폴더 정보 조회
 */
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json(errorResponse('유효하지 않은 폴더 ID입니다'));
  }

  const folder = await WatchedFolderService.getFolder(id);

  if (!folder) {
    return res.status(404).json(errorResponse('폴더를 찾을 수 없습니다'));
  }

  return res.json(successResponse(folder));
}));

/**
 * POST /api/folders
 * 새 폴더 등록
 */
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const {
    folder_path,
    folder_name,
    folder_type,
    auto_scan,
    scan_interval,
    recursive,
    file_extensions,
    exclude_patterns
  } = req.body;

  if (!folder_path) {
    return res.status(400).json(errorResponse('folder_path가 필요합니다'));
  }

  try {
    const id = await WatchedFolderService.addFolder({
      folder_path,
      folder_name,
      folder_type,
      auto_scan,
      scan_interval,
      recursive,
      file_extensions,
      exclude_patterns
    });

    const folder = await WatchedFolderService.getFolder(id);

    return res.json(successResponse({
      id,
      folder,
      message: '폴더가 등록되었습니다'
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : '폴더 등록 실패';
    return res.status(400).json(errorResponse(message));
  }
}));

/**
 * POST /api/folders/scan-all
 * 모든 활성 폴더 스캔
 */
router.post('/scan-all', asyncHandler(async (req: Request, res: Response) => {
  try {
    const results = await FolderScanService.scanAllFolders();

    const summary = {
      totalFolders: results.length,
      totalScanned: results.reduce((sum, r) => sum + r.totalScanned, 0),
      totalNew: results.reduce((sum, r) => sum + r.newImages, 0),
      totalExisting: results.reduce((sum, r) => sum + r.existingImages, 0),
      totalErrors: results.reduce((sum, r) => sum + r.errors.length, 0),
      results
    };

    return res.json(successResponse(summary));
  } catch (error) {
    const message = error instanceof Error ? error.message : '전체 스캔 실패';
    return res.status(500).json(errorResponse(message));
  }
}));

/**
 * POST /api/folders/validate-path
 * 폴더 경로 유효성 검사
 */
router.post('/validate-path', asyncHandler(async (req: Request, res: Response) => {
  const { folder_path } = req.body;

  if (!folder_path) {
    return res.status(400).json(errorResponse('folder_path가 필요합니다'));
  }

  const validation = await WatchedFolderService.validateFolderPath(folder_path);

  if (!validation.exists || !validation.isDirectory) {
    return res.status(400).json(errorResponse(validation.error || '유효하지 않은 경로'));
  }

  return res.json(successResponse({
    valid: true,
    message: '유효한 폴더 경로입니다'
  }));
}));

/**
 * PATCH /api/folders/default
 * 기본 업로드 폴더 경로 변경
 */
router.patch('/default', asyncHandler(async (req: Request, res: Response) => {
  const { folder_path } = req.body;

  if (!folder_path) {
    return res.status(400).json(errorResponse('folder_path가 필요합니다'));
  }

  // 경로 유효성 검증
  const validation = await WatchedFolderService.validateFolderPath(folder_path);
  if (!validation.exists || !validation.isDirectory) {
    return res.status(400).json(errorResponse(validation.error || '유효하지 않은 경로'));
  }

  // 기존 기본 폴더 찾기
  const folders = await WatchedFolderService.listFolders({ type: 'upload' });
  const defaultFolder = folders.find(f => f.folder_path.includes('uploads/images'));

  if (!defaultFolder) {
    return res.status(404).json(errorResponse('기본 업로드 폴더를 찾을 수 없습니다'));
  }

  // 폴더 경로 업데이트
  const success = await WatchedFolderService.updateFolder(defaultFolder.id, {
    folder_name: '직접 업로드'
  });

  if (!success) {
    return res.status(500).json(errorResponse('폴더 업데이트 실패'));
  }

  // 업데이트된 폴더 정보 반환
  const updatedFolder = await WatchedFolderService.getFolder(defaultFolder.id);

  return res.json(successResponse({
    folder: updatedFolder,
    message: '기본 업로드 폴더가 업데이트되었습니다'
  }));
}));

/**
 * PATCH /api/folders/:id
 * 폴더 설정 업데이트
 */
router.patch('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json(errorResponse('유효하지 않은 폴더 ID입니다'));
  }

  const updates = req.body;

  const success = await WatchedFolderService.updateFolder(id, updates);

  if (!success) {
    return res.status(404).json(errorResponse('폴더를 찾을 수 없습니다'));
  }

  const folder = await WatchedFolderService.getFolder(id);

  return res.json(successResponse({
    folder,
    message: '폴더 설정이 업데이트되었습니다'
  }));
}));

/**
 * POST /api/folders/:id/scan
 * 폴더 스캔 실행
 */
router.post('/:id/scan', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const fullRescan = req.query.full === 'true';

  if (isNaN(id)) {
    return res.status(400).json(errorResponse('유효하지 않은 폴더 ID입니다'));
  }

  try {
    const result = await FolderScanService.scanFolder(id, fullRescan);
    return res.json(successResponse(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : '스캔 실패';
    return res.status(500).json(errorResponse(message));
  }
}));

/**
 * DELETE /api/folders/:id
 * 폴더 삭제
 */
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const deleteFiles = req.query.delete_files === 'true';

  if (isNaN(id)) {
    return res.status(400).json(errorResponse('유효하지 않은 폴더 ID입니다'));
  }

  const success = await WatchedFolderService.deleteFolder(id, deleteFiles);

  if (!success) {
    return res.status(404).json(errorResponse('폴더를 찾을 수 없습니다'));
  }

  return res.json(successResponse({
    message: deleteFiles
      ? '폴더와 관련 파일이 삭제되었습니다'
      : '폴더가 삭제되었습니다 (메타데이터는 유지됨)'
  }));
}));

/**
 * GET /api/folders/:id/scan-logs
 * 특정 폴더의 스캔 로그 조회
 */
router.get('/:id/scan-logs', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const limit = parseInt(req.query.limit as string) || 50;

  if (isNaN(id)) {
    return res.status(400).json(errorResponse('유효하지 않은 폴더 ID입니다'));
  }

  const logs = FolderScanService.getScanLogs(id, limit);
  return res.json(successResponse(logs));
}));

/**
 * GET /api/folders/scan-logs/recent
 * 최근 스캔 로그 조회 (모든 폴더)
 */
router.get('/scan-logs/recent', asyncHandler(async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const logs = FolderScanService.getRecentScanLogs(limit);
  return res.json(successResponse(logs));
}));

export { router as watchedFoldersRoutes };
