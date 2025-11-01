import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { WatchedFolderService } from '../services/watchedFolderService';
import { FolderScanService } from '../services/folderScanService';
import { FileWatcherService } from '../services/fileWatcherService';
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
 *
 * 중요: 이 라우트는 /:id 보다 먼저 정의되어야 합니다.
 * Express는 라우트를 순서대로 매칭하므로, 특정 문자열 경로가
 * 파라미터 경로보다 먼저 와야 합니다.
 */
router.get('/default', asyncHandler(async (_req: Request, res: Response) => {
  const folders = await WatchedFolderService.listFolders({ type: 'upload' });
  // Windows와 Unix 경로 구분자를 모두 처리하기 위해 정규화
  const defaultFolder = folders.find(f => {
    const normalizedPath = f.folder_path.replace(/\\/g, '/');
    return normalizedPath.includes('uploads/images');
  });

  if (!defaultFolder) {
    return res.status(404).json(errorResponse('기본 업로드 폴더를 찾을 수 없습니다'));
  }

  return res.json(successResponse(defaultFolder));
}));

/**
 * GET /api/folders/scan-logs/recent
 * 최근 스캔 로그 조회 (모든 폴더)
 *
 * 중요: 이 라우트는 /:id 보다 먼저 정의되어야 합니다.
 */
router.get('/scan-logs/recent', asyncHandler(async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const logs = FolderScanService.getRecentScanLogs(limit);
  return res.json(successResponse(logs));
}));

/**
 * GET /api/folders/:id
 * 특정 폴더 정보 조회
 *
 * 중요: 파라미터 라우트는 특정 문자열 경로 뒤에 정의되어야 합니다.
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
    exclude_extensions,
    exclude_patterns,
    watcher_enabled
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
      exclude_extensions,
      exclude_patterns,
      watcher_enabled
    });

    // watcher_enabled가 true면 FileWatcherService 시작
    if (watcher_enabled) {
      try {
        await FileWatcherService.startWatcher(id);
        console.log(`✅ Watcher started for folder ID: ${id}`);
      } catch (error) {
        console.warn(`⚠️ Failed to start watcher for folder ID ${id}:`, error);
        // Watcher 시작 실패해도 폴더 등록은 성공으로 처리
      }
    }

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
  // Windows와 Unix 경로 구분자를 모두 처리하기 위해 정규화
  const defaultFolder = folders.find(f => {
    const normalizedPath = f.folder_path.replace(/\\/g, '/');
    return normalizedPath.includes('uploads/images');
  });

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

  // 워처 관련 설정이 변경되었는지 확인
  const watcherConfigChanged = !!(
    updates.recursive !== undefined ||
    updates.exclude_extensions !== undefined ||
    updates.exclude_patterns !== undefined ||
    updates.watcher_enabled !== undefined
  );

  const success = await WatchedFolderService.updateFolder(id, updates);

  if (!success) {
    return res.status(404).json(errorResponse('폴더를 찾을 수 없습니다'));
  }

  // 워처 설정이 변경되었고 워처가 실행 중이면 재시작
  if (watcherConfigChanged) {
    const watcherStatus = FileWatcherService.getWatcherStatus(id);

    if (updates.watcher_enabled === 1) {
      // 워처 활성화 요청
      try {
        if (watcherStatus && watcherStatus.state === 'watching') {
          // 이미 실행 중이면 재시작
          await FileWatcherService.restartWatcher(id);
          console.log(`  🔄 워처 재시작: folderId=${id} (설정 변경)`);
        } else {
          // 실행 중이 아니면 시작
          await FileWatcherService.startWatcher(id);
          console.log(`  ✅ 워처 시작: folderId=${id} (설정 활성화)`);
        }
      } catch (error) {
        console.error(`  ❌ 워처 시작/재시작 실패: folderId=${id}`, error);
      }
    } else if (updates.watcher_enabled === 0) {
      // 워처 비활성화 요청
      try {
        if (watcherStatus) {
          await FileWatcherService.stopWatcher(id);
          console.log(`  🛑 워처 중지: folderId=${id} (설정 비활성화)`);
        }
      } catch (error) {
        console.error(`  ❌ 워처 중지 실패: folderId=${id}`, error);
      }
    } else if (watcherStatus && watcherStatus.state === 'watching') {
      // 워처 활성화 상태 변경 없이 다른 설정만 변경된 경우 재시작
      try {
        await FileWatcherService.restartWatcher(id);
        console.log(`  🔄 워처 재시작: folderId=${id} (설정 변경)`);
      } catch (error) {
        console.error(`  ❌ 워처 재시작 실패: folderId=${id}`, error);
      }
    }
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

// ==================== 파일 워처 제어 API ====================

/**
 * GET /api/folders/:id/watcher/status
 * 워처 상태 조회
 */
router.get('/:id/watcher/status', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json(errorResponse('유효하지 않은 폴더 ID입니다'));
  }

  const status = FileWatcherService.getWatcherStatus(id);

  if (!status) {
    return res.json(successResponse({
      folderId: id,
      running: false,
      state: 'stopped',
      message: '워처가 실행되고 있지 않습니다'
    }));
  }

  return res.json(successResponse({
    folderId: id,
    running: status.state === 'watching',
    state: status.state,
    folderName: status.folderName,
    folderPath: status.folderPath,
    lastEvent: status.lastEvent,
    eventCount: status.eventCount,
    error: status.error,
    retryAttempts: status.retryAttempts
  }));
}));

/**
 * POST /api/folders/:id/watcher/start
 * 워처 시작
 */
router.post('/:id/watcher/start', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json(errorResponse('유효하지 않은 폴더 ID입니다'));
  }

  // 폴더 확인
  const folder = await WatchedFolderService.getFolder(id);
  if (!folder) {
    return res.status(404).json(errorResponse('폴더를 찾을 수 없습니다'));
  }

  if (!folder.is_active) {
    return res.status(400).json(errorResponse('비활성화된 폴더입니다'));
  }

  // 워처 시작
  try {
    await FileWatcherService.startWatcher(id);

    // watcher_enabled 플래그 업데이트
    await WatchedFolderService.updateFolder(id, { watcher_enabled: 1 });

    return res.json(successResponse({
      message: '워처가 시작되었습니다',
      folderId: id,
      folderName: folder.folder_name
    }));
  } catch (error) {
    return res.status(500).json(errorResponse(
      `워처 시작 실패: ${error instanceof Error ? error.message : 'Unknown error'}`
    ));
  }
}));

/**
 * POST /api/folders/:id/watcher/stop
 * 워처 중지
 */
router.post('/:id/watcher/stop', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json(errorResponse('유효하지 않은 폴더 ID입니다'));
  }

  try {
    await FileWatcherService.stopWatcher(id);

    // watcher_enabled 플래그 업데이트
    await WatchedFolderService.updateFolder(id, { watcher_enabled: 0 });

    return res.json(successResponse({
      message: '워처가 중지되었습니다',
      folderId: id
    }));
  } catch (error) {
    return res.status(500).json(errorResponse(
      `워처 중지 실패: ${error instanceof Error ? error.message : 'Unknown error'}`
    ));
  }
}));

/**
 * POST /api/folders/:id/watcher/restart
 * 워처 재시작
 */
router.post('/:id/watcher/restart', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json(errorResponse('유효하지 않은 폴더 ID입니다'));
  }

  const folder = await WatchedFolderService.getFolder(id);
  if (!folder) {
    return res.status(404).json(errorResponse('폴더를 찾을 수 없습니다'));
  }

  try {
    await FileWatcherService.restartWatcher(id);

    return res.json(successResponse({
      message: '워처가 재시작되었습니다',
      folderId: id,
      folderName: folder.folder_name
    }));
  } catch (error) {
    return res.status(500).json(errorResponse(
      `워처 재시작 실패: ${error instanceof Error ? error.message : 'Unknown error'}`
    ));
  }
}));

/**
 * GET /api/folders/watchers/health
 * 모든 워처 헬스체크
 */
router.get('/watchers/health', asyncHandler(async (_req: Request, res: Response) => {
  const allStatuses = FileWatcherService.getAllWatcherStatuses();

  const summary = {
    totalWatchers: allStatuses.length,
    watching: allStatuses.filter(w => w.state === 'watching').length,
    error: allStatuses.filter(w => w.state === 'error').length,
    stopped: allStatuses.filter(w => w.state === 'stopped').length,
    initializing: allStatuses.filter(w => w.state === 'initializing').length,
    totalEvents24h: allStatuses.reduce((sum, w) => sum + w.eventCount, 0),
    watchers: allStatuses.map(w => ({
      folderId: w.folderId,
      folderName: w.folderName,
      folderPath: w.folderPath,
      state: w.state,
      lastEvent: w.lastEvent,
      eventCount: w.eventCount,
      error: w.error,
      retryAttempts: w.retryAttempts
    }))
  };

  return res.json(successResponse(summary));
}));

export { router as watchedFoldersRoutes };
