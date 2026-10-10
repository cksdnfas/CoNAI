import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAdmin } from '../middleware/authMiddleware';
import { settingsService } from '../services/settingsService';
import { buildGraphWorkflowBrowseContent } from '../services/graphWorkflowViewService';
import { GraphWorkflowFolderModel } from '../models/GraphWorkflowFolder';
import { ImageGroupModel } from '../models/Group';
import { WallpaperRuntimeToken, type WallpaperRuntimeTokenRecord } from '../models/WallpaperRuntimeToken';
import { RuntimeEventBroadcaster } from '../services/runtime-events/runtimeEventBroadcaster';
import {
  getWallpaperRuntimeAccess,
  requireWallpaperRuntimeAccess,
  requireWallpaperRuntimePermission,
  resolveWallpaperRuntimeAccess,
} from '../services/wallpaperRuntimeAccess';
import { RUNTIME_EVENT_TOPIC_PERMISSIONS, type RuntimeEventTopic } from '../types/runtimeEvents';
import { isRuntimeEventStreamEnabled } from './events/event-stream.routes';
import { enrichCompactImageWithFileView } from './images/utils';
import { routeParam } from './routeParam';
import { parseOptionalGraphFolderId } from './graph-workflows/route-helpers';
import { errorResponse, successResponse, validateId } from '@conai/shared';
import { registerWallpaperRuntimeDataRoutes } from './wallpaperRuntimeData.routes';

const router = Router();

/** Topics a wallpaper may follow live; each still needs its own feature permission. */
const WALLPAPER_EVENT_TOPICS: RuntimeEventTopic[] = ['generation-queue', 'generation-history', 'graph-execution', 'posts'];

function toTokenView(record: WallpaperRuntimeTokenRecord) {
  return {
    id: record.id,
    name: record.name,
    prefix: record.token_prefix,
    presetId: record.preset_id,
    createdAt: record.created_at,
    lastUsedAt: record.last_used_at,
  };
}

/** Trade a runtime key for this browser session (Lively and other kiosk browsers stay logged out). */
router.post('/session', asyncHandler(async (req: Request, res: Response) => {
  const token = WallpaperRuntimeToken.findActiveByToken(req.body?.token);
  if (!token) {
    return res.status(401).json(errorResponse('Invalid or revoked wallpaper key'));
  }
  req.session.wallpaperRuntimeTokenId = token.id;
  WallpaperRuntimeToken.touch(token.id);
  return res.json(successResponse({ presetId: token.preset_id }));
}));

router.delete('/session', (req: Request, res: Response) => {
  delete req.session.wallpaperRuntimeTokenId;
  res.json(successResponse({ cleared: true }));
});

router.get('/tokens', requireAdmin, (_req: Request, res: Response) => {
  res.json(successResponse(WallpaperRuntimeToken.list().map(toTokenView)));
});

/** Issue one key; the plaintext is in this response only. Keys read as the issuing account. */
router.post('/tokens', requireAdmin, (req: Request, res: Response) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 60) {
    res.status(400).json(errorResponse('name must be 1-60 characters'));
    return;
  }
  const presetId = typeof req.body?.presetId === 'string' && req.body.presetId.trim() ? req.body.presetId.trim() : null;
  const accountId = typeof req.session.accountId === 'number' ? req.session.accountId : null;
  const { record, token } = WallpaperRuntimeToken.create({ name, accountId, presetId });
  res.status(201).json(successResponse({ ...toTokenView(record), token }));
});

router.delete('/tokens/:id', requireAdmin, (req: Request, res: Response) => {
  const id = Number(routeParam(req.params.id));
  if (!Number.isInteger(id) || !WallpaperRuntimeToken.revoke(id)) {
    res.status(404).json(errorResponse('Wallpaper key not found'));
    return;
  }
  res.json(successResponse({ revoked: true }));
});

/** Live events for runtime widgets; resolves access without writing the session (long-lived response). */
router.get('/events', (req: Request, res: Response) => {
  if (!isRuntimeEventStreamEnabled()) {
    res.status(404).json(errorResponse('Not Found'));
    return;
  }

  const access = resolveWallpaperRuntimeAccess(req);
  if (!access) {
    res.status(401).json(errorResponse('Unauthorized'));
    return;
  }

  const topics = WALLPAPER_EVENT_TOPICS.filter((topic) => {
    const permission = RUNTIME_EVENT_TOPIC_PERMISSIONS[topic];
    // Logged-out readers never get account-scoped topics such as the queue.
    if (access.isAnonymous) return permission !== null && access.permissionKeys.includes(permission);
    return permission === null || access.permissionKeys.includes(permission);
  });
  if (topics.length === 0) {
    res.status(403).json(errorResponse('Forbidden'));
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.socket?.setTimeout(0);
  res.socket?.setNoDelay(true);
  res.socket?.setKeepAlive(true);
  res.flushHeaders();
  res.write('retry: 3000\n\n');

  const initialKeys = access.permissionKeys.join('\n');
  const subscription = RuntimeEventBroadcaster.register({
    res,
    accountId: access.accountId,
    isAdmin: access.isAdmin,
    topics,
    resumeCursor: null,
    revalidateAccess: () => {
      const current = resolveWallpaperRuntimeAccess(req);
      if (!current || current.tokenId !== access.tokenId || current.accountId !== access.accountId) {
        return { ok: false, reason: 'unauthenticated' };
      }
      if (current.isAdmin !== access.isAdmin || current.permissionKeys.join('\n') !== initialKeys) {
        return { ok: false, reason: 'permission-revoked' };
      }
      return { ok: true };
    },
  });

  req.on('close', () => {
    RuntimeEventBroadcaster.unregister(subscription.id);
  });
});

router.use(requireWallpaperRuntimeAccess);

/** Saved presets for the live page, plus the preset a runtime key is bound to. */
router.get('/settings', asyncHandler(async (_req: Request, res: Response) => {
  const access = getWallpaperRuntimeAccess(res);
  const settings = settingsService.loadSettings();
  return res.json(successResponse({
    wallpaperLayoutPresets: settings.appearance.wallpaperLayoutPresets,
    wallpaperActivePresetId: settings.appearance.wallpaperActivePresetId,
    tokenPresetId: access.presetId,
  }));
}));

/** Return one read-only workflow browse snapshot for wallpaper live widgets. */
router.get('/browse-content', requireWallpaperRuntimePermission('images.view'), asyncHandler(async (req: Request, res: Response) => {
  const folderIdResult = parseOptionalGraphFolderId(req.query.folder_id);
  if (!folderIdResult.ok) {
    return res.status(400).json(errorResponse('Invalid graph workflow folder ID'));
  }

  const folderId = folderIdResult.value;

  if (folderId !== null && !GraphWorkflowFolderModel.findById(folderId)) {
    return res.status(404).json(errorResponse('Graph workflow folder not found'));
  }

  return res.json(successResponse(buildGraphWorkflowBrowseContent(folderId)));
}));

/** Return one read-only group preview image list for wallpaper live widgets. */
router.get('/groups/:id/preview-images', requireWallpaperRuntimePermission('images.view'), asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(routeParam(routeParam(req.params.id)), 'Group ID');
    const count = parseInt(req.query.count as string) || 8;
    const includeChildren = req.query.includeChildren !== 'false';
    const limitedCount = Math.min(Math.max(count, 1), 40);

    const images = await ImageGroupModel.findPreviewImages(id, limitedCount, includeChildren);
    return res.json(successResponse(images.map(enrichCompactImageWithFileView)));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to get preview images';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

registerWallpaperRuntimeDataRoutes(router);

export { router as wallpaperRuntimeRoutes };
