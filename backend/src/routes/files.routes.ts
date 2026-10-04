import fs from 'fs';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { requirePermission } from '../middleware/authMiddleware';
import { createUploadStorage, wrapUploadMiddleware, MAX_UPLOAD_FILE_SIZE_BYTES, MAX_MULTIPLE_UPLOAD_FILES, MAX_MULTIPLE_UPLOAD_TOTAL_BYTES } from '../middleware/upload';
import { asyncHandler } from '../middleware/asyncHandler';
import { FileStoreError, FileStoreService, fileOwnerKey, parseFileId } from '../services/fileStoreService';
import { ensureFileStoreDirectories, fileStoreIncoming } from '../services/fileStorePaths';
import { filePreviewMime, getFileThumbnail } from '../services/fileStorePreview';
import { getRequesterAccountId } from './requester-session-helpers';

const router = Router();
router.use(requirePermission('page.files.view'));
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
const owner = (req: Request) => fileOwnerKey(getRequesterAccountId(req));
const id = (req: Request) => parseFileId(req.params.id) as string;

router.get('/', (req, res) => {
  res.json({ success: true, data: FileStoreService.list(owner(req), parseFileId(req.query.parentId, true), Number(req.query.offset ?? 0), Number(req.query.limit ?? 100)) });
});
router.get('/folders', (req, res) => res.json({ success: true, data: FileStoreService.folders(owner(req)) }));
router.post('/folders', requirePermission('files.manage'), (req, res) => {
  res.status(201).json({ success: true, data: FileStoreService.createFolder(owner(req), parseFileId(req.body?.parentId, true), req.body?.name) });
});

const upload = wrapUploadMiddleware(multer({
  storage: createUploadStorage(MAX_MULTIPLE_UPLOAD_TOTAL_BYTES, fileStoreIncoming, false),
  limits: { fileSize: MAX_UPLOAD_FILE_SIZE_BYTES, files: MAX_MULTIPLE_UPLOAD_FILES, fields: 0, parts: MAX_MULTIPLE_UPLOAD_FILES },
}).array('files', MAX_MULTIPLE_UPLOAD_FILES));

router.post('/upload', requirePermission('files.manage'), (req, _res, next) => {
  // Validate the destination before receiving bytes, then recheck it inside the commit transaction.
  FileStoreService.list(owner(req), parseFileId(req.query.parentId, true), 0, 1);
  ensureFileStoreDirectories();
  next();
}, upload, asyncHandler(async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  try {
    if (files.length === 0) throw new FileStoreError('파일을 선택해줘.');
    const data = FileStoreService.upload(owner(req), parseFileId(req.query.parentId, true), files);
    FileStoreService.purgeDeleted();
    res.status(201).json({ success: true, data });
  } finally {
    await Promise.all(files.map((file) => fs.promises.rm(file.path, { force: true }).catch(() => undefined)));
  }
}));

router.post('/move', requirePermission('files.manage'), (req, res) => {
  FileStoreService.move(owner(req), req.body?.ids, parseFileId(req.body?.parentId, true));
  res.json({ success: true });
});
router.post('/delete', requirePermission('files.manage'), (req, res) => {
  FileStoreService.delete(owner(req), req.body?.ids);
  res.json({ success: true });
});
router.patch('/:id', requirePermission('files.manage'), (req, res) => {
  res.json({ success: true, data: FileStoreService.rename(owner(req), id(req), req.body?.name) });
});
router.get('/:id', (req, res) => res.json({ success: true, data: FileStoreService.get(owner(req), id(req)) }));
router.get('/:id/neighbors', (req, res) => res.json({ success: true, data: FileStoreService.neighbors(owner(req), id(req)) }));
router.get('/:id/text', asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, data: await FileStoreService.readText(owner(req), id(req), Number(req.query.offset ?? 0), Number(req.query.limit ?? 16000)) });
}));
/** Safe inline media and inert text; sendFile handles single byte ranges (206/416) and HEAD. */
router.get('/:id/view', asyncHandler(async (req, res, next) => {
  const { entry, filePath } = FileStoreService.resolveFile(owner(req), id(req));
  const mime = await filePreviewMime(entry, filePath);
  if (!mime) throw new FileStoreError('미리 볼 수 없는 형식이야.', 415);
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(entry.name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', 'sandbox');
  res.sendFile(filePath, { dotfiles: 'allow' }, (error) => {
    if (!error || res.headersSent) return;
    if ((error as { status?: number }).status === 416) {
      res.setHeader('Content-Range', `bytes */${entry.size}`);
      res.status(416).end();
    } else next(error);
  });
}));
/** GET /api/files/:id/thumbnail — cached, bounded image/video WebP for the icon view and picker. */
router.get('/:id/thumbnail', asyncHandler(async (req, res) => {
  const { entry, filePath } = FileStoreService.resolveFile(owner(req), id(req));
  const cached = await getFileThumbnail(owner(req), entry, filePath);
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(cached, { dotfiles: 'allow' });
}));
router.get('/:id/download', (req, res, next) => {
  const { entry, filePath } = FileStoreService.resolveFile(owner(req), id(req));
  // Even HTML and SVG are inert downloads; never expose the private root with express.static.
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.download(filePath, entry.name, { dotfiles: 'allow' }, (error) => { if (error && !res.headersSent) next(error); });
});
router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof FileStoreError) {
    res.status(error.status).json({ success: false, error: error.message });
    return;
  }
  next(error);
});

export default router;
