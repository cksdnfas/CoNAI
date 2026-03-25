import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { routeParam } from './routeParam';
import { errorResponse, successResponse } from '@conai/shared';
import { BackupSourceService } from '../services/backupSourceService';
import { BackupSourceWatcherService } from '../services/backupSourceWatcherService';

const router = Router();

/** List backup sources. */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const activeOnly = req.query.active_only === 'true';
  const sources = await BackupSourceService.listSources({ active_only: activeOnly });
  return res.json(successResponse(sources));
}));

/** Validate an external source path for backup ingestion. */
router.post('/validate-path', asyncHandler(async (req: Request, res: Response) => {
  const { source_path } = req.body;

  if (!source_path) {
    return res.status(400).json(errorResponse('source_path가 필요합니다'));
  }

  const validation = await BackupSourceService.validateSourcePath(source_path);
  if (!validation.exists || !validation.isDirectory) {
    return res.status(400).json(errorResponse(validation.error || '유효하지 않은 경로'));
  }

  return res.json(successResponse({ valid: true, message: '유효한 백업 source 경로입니다' }));
}));

/** Create a backup source. */
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const {
    source_path,
    display_name,
    target_folder_name,
    recursive,
    watcher_enabled,
    watcher_polling_interval,
    import_mode,
    webp_quality,
  } = req.body;

  if (!source_path || !target_folder_name) {
    return res.status(400).json(errorResponse('source_path와 target_folder_name이 필요합니다'));
  }

  try {
    const id = await BackupSourceService.addSource({
      source_path,
      display_name,
      target_folder_name,
      recursive,
      watcher_enabled,
      watcher_polling_interval,
      import_mode,
      webp_quality,
    });

    if (watcher_enabled !== false) {
      try {
        await BackupSourceWatcherService.startWatcher(id);
      } catch (error) {
        console.warn(`⚠️ Failed to start backup source watcher for ID ${id}:`, error);
      }
    }

    const source = await BackupSourceService.getSource(id);
    return res.json(successResponse({ id, source, message: '백업 소스를 등록했습니다' }));
  } catch (error) {
    const message = error instanceof Error ? error.message : '백업 소스 등록 실패';
    return res.status(400).json(errorResponse(message));
  }
}));

/** Update a backup source. */
router.patch('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(req.params.id));
  if (Number.isNaN(id)) {
    return res.status(400).json(errorResponse('유효하지 않은 source ID입니다'));
  }

  try {
    const success = await BackupSourceService.updateSource(id, req.body);
    if (!success) {
      return res.status(404).json(errorResponse('백업 소스를 찾을 수 없습니다'));
    }

    const watcherConfigChanged = (
      req.body.source_path !== undefined ||
      req.body.target_folder_name !== undefined ||
      req.body.recursive !== undefined ||
      req.body.watcher_enabled !== undefined ||
      req.body.watcher_polling_interval !== undefined ||
      req.body.import_mode !== undefined ||
      req.body.webp_quality !== undefined ||
      req.body.is_active !== undefined
    );

    const source = await BackupSourceService.getSource(id);

    if (watcherConfigChanged && source) {
      if (source.watcher_enabled === 1 && source.is_active === 1) {
        await BackupSourceWatcherService.restartWatcher(id);
      } else {
        await BackupSourceWatcherService.stopWatcher(id);
      }
    }
    return res.json(successResponse({ source, message: '백업 소스 설정을 저장했습니다' }));
  } catch (error) {
    const message = error instanceof Error ? error.message : '백업 소스 수정 실패';
    return res.status(400).json(errorResponse(message));
  }
}));

/** Delete a backup source. */
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(req.params.id));
  if (Number.isNaN(id)) {
    return res.status(400).json(errorResponse('유효하지 않은 source ID입니다'));
  }

  await BackupSourceWatcherService.stopWatcher(id);
  const success = await BackupSourceService.deleteSource(id);
  if (!success) {
    return res.status(404).json(errorResponse('백업 소스를 찾을 수 없습니다'));
  }

  return res.json(successResponse({ message: '백업 소스를 제거했습니다' }));
}));

/** Start a backup source watcher. */
router.post('/:id/watcher/start', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(req.params.id));
  if (Number.isNaN(id)) {
    return res.status(400).json(errorResponse('유효하지 않은 source ID입니다'));
  }

  await BackupSourceWatcherService.startWatcher(id);
  await BackupSourceService.updateSource(id, { watcher_enabled: true, is_active: true });
  const source = await BackupSourceService.getSource(id);
  return res.json(successResponse(source));
}));

/** Stop a backup source watcher. */
router.post('/:id/watcher/stop', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(req.params.id));
  if (Number.isNaN(id)) {
    return res.status(400).json(errorResponse('유효하지 않은 source ID입니다'));
  }

  await BackupSourceWatcherService.stopWatcher(id);
  await BackupSourceService.updateSource(id, { watcher_enabled: false });
  const source = await BackupSourceService.getSource(id);
  return res.json(successResponse(source));
}));

/** Restart a backup source watcher. */
router.post('/:id/watcher/restart', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(req.params.id));
  if (Number.isNaN(id)) {
    return res.status(400).json(errorResponse('유효하지 않은 source ID입니다'));
  }

  await BackupSourceWatcherService.restartWatcher(id);
  await BackupSourceService.updateSource(id, { watcher_enabled: true, is_active: true });
  const source = await BackupSourceService.getSource(id);
  return res.json(successResponse(source));
}));

export { router as backupSourcesRoutes };
