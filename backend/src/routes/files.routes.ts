import fs from 'fs';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { requireAdmin, requirePermission } from '../middleware/authMiddleware';
import { requireImagesView } from '../middleware/imageAccess';
import { createUploadStorage, wrapUploadMiddleware, MAX_UPLOAD_FILE_SIZE_BYTES, MAX_MULTIPLE_UPLOAD_FILES, MAX_MULTIPLE_UPLOAD_TOTAL_BYTES } from '../middleware/upload';
import { asyncHandler } from '../middleware/asyncHandler';
import { FileStoreError, FileStoreService, assertFileTypeAllowed, fileOwnerKey, parseFileId, parseOwnerKey } from '../services/fileStoreService';
import { ensureFileStoreDirectories, fileStoreIncoming } from '../services/fileStorePaths';
import { filePreviewMime, getFileThumbnail } from '../services/fileStorePreview';
import { searchStoredFiles } from '../services/fileStoreSearch';
import { getRequesterAccountId, isAdminRequest } from './requester-session-helpers';

const router = Router();
router.use(requirePermission('files.view'));
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });

/** `requirePermission` refreshed the session's keys just before this, so they are current for the whole request. */
const has = (req: Request, permissionKey: string) => req.session?.permissionKeys?.includes(permissionKey) === true;
const selfOwner = (req: Request) => fileOwnerKey(getRequesterAccountId(req));
/**
 * The store being browsed. Every route defaults to the requester's own store; `?owner=` switches to
 * another account's store and is honored only for administrators, who may then act on it.
 */
const owner = (req: Request) => {
  const self = selfOwner(req);
  const requested = req.query.owner;
  if (requested === undefined || requested === '' || requested === self) return self;
  const key = parseOwnerKey(requested);
  if (!isAdminRequest(req)) throw new FileStoreError('다른 계정의 파일을 볼 권한이 없어.', 403);
  return key;
};
const id = (req: Request) => parseFileId(req.params.id) as string;
/** Restricted types (executables and the like) are for administrators; bootstrap is the local administrator. */
const allowAnyType = (req: Request) => isAdminRequest(req);

router.get('/', (req, res) => {
  res.json({ success: true, data: FileStoreService.list(owner(req), parseFileId(req.query.parentId, true), Number(req.query.offset ?? 0), Number(req.query.limit ?? 100)) });
});
router.get('/owners', requireAdmin, (req, res) => res.json({ success: true, data: FileStoreService.owners(selfOwner(req)) }));
router.get('/folders', (req, res) => res.json({ success: true, data: FileStoreService.folders(owner(req)) }));
/** GET /api/files/search?q= — files and folders whose name or text contains every word ("quoted phrase" = one term). */
router.get('/search', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await searchStoredFiles(owner(req), req.query.q, Number(req.query.limit ?? 50)) });
}));
router.post('/folders', requirePermission('files.edit'), (req, res) => {
  res.status(201).json({ success: true, data: FileStoreService.createFolder(owner(req), parseFileId(req.body?.parentId, true), req.body?.name) });
});

const upload = wrapUploadMiddleware(multer({
  storage: createUploadStorage(MAX_MULTIPLE_UPLOAD_TOTAL_BYTES, fileStoreIncoming, false),
  limits: { fileSize: MAX_UPLOAD_FILE_SIZE_BYTES, files: MAX_MULTIPLE_UPLOAD_FILES, fields: 0, parts: MAX_MULTIPLE_UPLOAD_FILES },
  // Reject restricted extensions before their bytes are received; the service rechecks the decoded name on commit.
  fileFilter: (req, file, callback) => {
    try {
      assertFileTypeAllowed(file.originalname, req.res?.locals.allowAnyType === true);
      callback(null, true);
    } catch (error) {
      callback(error as Error);
    }
  },
}).array('files', MAX_MULTIPLE_UPLOAD_FILES));

router.post('/upload', requirePermission('files.edit'), (req, res, next) => {
  // Validate the destination before receiving bytes, then recheck it inside the commit transaction.
  FileStoreService.list(owner(req), parseFileId(req.query.parentId, true), 0, 1);
  ensureFileStoreDirectories();
  res.locals.allowAnyType = allowAnyType(req);
  next();
}, upload, asyncHandler(async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  try {
    if (files.length === 0) throw new FileStoreError('파일을 선택해줘.');
    const data = FileStoreService.upload(owner(req), parseFileId(req.query.parentId, true), files, res.locals.allowAnyType === true);
    FileStoreService.purgeDeleted();
    res.status(201).json({ success: true, data });
  } finally {
    await Promise.all(files.map((file) => fs.promises.rm(file.path, { force: true }).catch(() => undefined)));
  }
}));

router.post('/move', requirePermission('files.edit'), (req, res) => {
  FileStoreService.move(owner(req), req.body?.ids, parseFileId(req.body?.parentId, true));
  res.json({ success: true });
});
router.post('/delete', requirePermission('files.delete'), (req, res) => {
  FileStoreService.delete(owner(req), req.body?.ids);
  res.json({ success: true });
});
router.patch('/:id', requirePermission('files.edit'), (req, res) => {
  res.json({ success: true, data: FileStoreService.rename(owner(req), id(req), req.body?.name, allowAnyType(req)) });
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
  if (/^(image|video)\//.test(mime)) {
    let allowed = false;
    requireImagesView(req, res, () => { allowed = true; });
    if (!allowed) return;
  }
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
router.get('/:id/thumbnail', requireImagesView, asyncHandler(async (req, res) => {
  const store = owner(req);
  const { entry, filePath } = FileStoreService.resolveFile(store, id(req));
  const cached = await getFileThumbnail(store, entry, filePath);
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-cache');
  res.sendFile(cached, { dotfiles: 'allow' });
}));
router.get('/:id/download', asyncHandler(async (req, res, next) => {
  const { entry, filePath } = FileStoreService.resolveFile(owner(req), id(req));
  const mime = await filePreviewMime(entry, filePath);
  if (mime && /^(image|video)\//.test(mime)) {
    let allowed = false;
    requireImagesView(req, res, () => { allowed = true; });
    if (!allowed) return;
  }
  // Even HTML and SVG are inert downloads; never expose the private root with express.static.
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.download(filePath, entry.name, { dotfiles: 'allow' }, (error) => { if (error && !res.headersSent) next(error); });
}));
router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof FileStoreError) {
    res.status(error.status).json({ success: false, error: error.message });
    return;
  }
  next(error);
});

export default router;
