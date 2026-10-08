import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAdmin } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { SystemFolderError, SystemFolderService, parseNames, parseRelativePath, parseRootId } from '../services/systemFolderService';

/**
 * Server folders for administrators: browse uploads / save / temp / logs read-only, and manage the RecycleBin
 * (restore, permanent delete, empty). Paths travel as `?path=a/b/c` inside the chosen root.
 */
const router = Router();
router.use(requireAdmin);
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });

const target = (req: Request) => ({ root: parseRootId(req.params.root), segments: parseRelativePath(req.query.path) });

router.get('/', (_req, res) => res.json({ success: true, data: SystemFolderService.roots() }));

router.post('/recycle-bin/restore', asyncHandler(async (req, res) => {
  const conflict = req.body?.conflict === 'rename' ? 'rename' : 'fail';
  res.json({ success: true, data: await SystemFolderService.restore(parseNames(req.body?.names), conflict) });
}));
router.post('/recycle-bin/delete', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await SystemFolderService.deletePermanently(parseNames(req.body?.names)) });
}));
router.post('/recycle-bin/empty', asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await SystemFolderService.empty() });
}));

router.get('/:root', asyncHandler(async (req, res) => {
  const { root, segments } = target(req);
  const order = req.query.order === 'asc' ? 'asc' : 'desc';
  res.json({ success: true, data: await SystemFolderService.list(root, segments, Number(req.query.offset ?? 0), Number(req.query.limit ?? 100), order) });
}));
router.get('/:root/stat', (req, res) => {
  const { root, segments } = target(req);
  res.json({ success: true, data: SystemFolderService.stat(root, segments) });
});
/** Inert inline view; sendFile answers single byte ranges (206/416) and HEAD. */
router.get('/:root/view', asyncHandler(async (req, res, next) => {
  const { root, segments } = target(req);
  const view = await SystemFolderService.resolveView(root, segments);
  res.setHeader('Content-Type', view.mime);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(view.name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', 'sandbox');
  res.sendFile(view.absolute, { dotfiles: 'allow' }, (error) => {
    if (!error || res.headersSent) return;
    if ((error as { status?: number }).status === 416) {
      res.setHeader('Content-Range', `bytes */${view.size}`);
      res.status(416).end();
    } else next(error);
  });
}));
router.get('/:root/thumbnail', asyncHandler(async (req, res) => {
  const { root, segments } = target(req);
  const cached = await SystemFolderService.thumbnail(root, segments);
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-cache');
  res.sendFile(cached, { dotfiles: 'allow' });
}));
router.get('/:root/download', (req, res, next) => {
  const { root, segments } = target(req);
  const file = SystemFolderService.resolveDownload(root, segments);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.download(file.absolute, file.name, { dotfiles: 'allow' }, (error) => { if (error && !res.headersSent) next(error); });
});

router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof SystemFolderError) {
    res.status(error.status).json({ success: false, error: error.message });
    return;
  }
  next(error);
});

export default router;
