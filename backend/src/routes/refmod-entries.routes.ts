import fs from 'fs';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { ZipArchive } from 'archiver';
import { REFMOD_BUNDLE_DOCUMENT } from '@conai/shared';
import { asyncHandler } from '../middleware/asyncHandler';
import { allowAnonymousAnyPermission, requirePermission } from '../middleware/authMiddleware';
import { canRequesterViewImages, requireImagesView } from '../middleware/imageAccess';
import { orPublicWorkflow } from '../middleware/publicWorkflowScope';
import { createUploadStorage, MAX_MULTIPLE_UPLOAD_TOTAL_BYTES } from '../middleware/upload';
import { fileOwnerKey, FileStoreError } from '../services/fileStoreService';
import { getFileThumbnail } from '../services/fileStorePreview';
import {
  adoptRefMods,
  buildRefModEntry,
  bulkRefModEntries,
  createRefModEntry,
  deleteRefModEntry,
  deleteUnregisteredRefModRecord,
  getRefModDraftTemplate,
  getRefModEntry,
  getRefModPresence,
  listRefModEntries,
  listRefModWorkflowCandidates,
  listUnregisteredRefModRecords,
  patchRefModEntry,
  refModEntryId,
  RefModEntryError,
} from '../services/comfyui/refmodEntries';
import { exportRefModEntries, importRefModEntries } from '../services/comfyui/refmodEntryBundle';
import { resolveRefModEntryFile } from '../services/comfyui/refmodEntryFiles';
import { streamCacheableFile, streamRangeFile } from './images/query-file-response-helpers';
import { getRequester } from './requester-session-helpers';
import { routeParam } from './routeParam';

/**
 * RefMod entries (/api/refmod-entries). The list follows GET /api/refmods: characters.view, or what the Director
 * picker needs (generation-only accounts and published-workflow pages). Every other read (one entry, unregistered
 * records, presence, workflow candidates, export) needs characters.view. Writes need characters.edit, a build also
 * generation.execute, media images.view (export too, for the sources it includes). Entry media is served here, never
 * through /api/files.
 */
const router = Router();
const listRead = orPublicWorkflow(allowAnonymousAnyPermission(['characters.view', 'generation.execute', 'workflows.view', 'images.view']));
const read = requirePermission('characters.view');
const edit = requirePermission('characters.edit');
const execute = requirePermission('generation.execute');
const actor = (req: Request) => {
  const requester = getRequester(req);
  return { owner: fileOwnerKey(requester.accountId), canViewImages: canRequesterViewImages(requester) };
};
const entryId = (req: Request) => refModEntryId(routeParam(req.params.id));

function sendError(res: Response, error: unknown): boolean {
  if (error instanceof RefModEntryError) {
    res.status(error.status).json({ success: false, error: error.message, ...error.extra });
    return true;
  }
  if (error instanceof FileStoreError) {
    res.status(error.status).json({ success: false, error: error.message });
    return true;
  }
  return false;
}

function handle(run: (req: Request, res: Response) => unknown | Promise<unknown>, status = 200) {
  return asyncHandler(async (req, res) => {
    try {
      const data = await run(req, res);
      res.status(status).json({ success: true, data });
    } catch (error) {
      if (!sendError(res, error)) throw error;
    }
  });
}

const query = (value: unknown) => typeof value === 'string' ? value : undefined;

router.get('/', listRead, handle((req) => {
  const rawRegistered = query(req.query.registered);
  const registered = rawRegistered === 'all' ? 'all' : rawRegistered === '0' || rawRegistered === 'false' ? false : true;
  return listRefModEntries({
    query: query(req.query.query),
    concept: query(req.query.concept),
    favorite: req.query.favorite === '1',
    registered,
    sort: query(req.query.sort),
    limit: req.query.limit === undefined ? undefined : Number(req.query.limit),
    offset: req.query.offset === undefined ? undefined : Number(req.query.offset),
  });
}));
router.get('/template', read, handle((req) => {
  const raw = query(req.query.workflowId);
  if (raw === undefined) return getRefModDraftTemplate();
  if (raw === '') return getRefModDraftTemplate(null);
  return getRefModDraftTemplate(refModEntryId(raw));
}));
router.get('/unregistered', read, handle(() => listUnregisteredRefModRecords()));
router.delete('/unregistered/:recordId', edit, handle(async (req) => {
  await deleteUnregisteredRefModRecord(refModEntryId(routeParam(req.params.recordId)));
  return { deleted: true };
}));
router.get('/presence', read, handle(() => getRefModPresence()));
router.get('/workflows', read, handle(() => listRefModWorkflowCandidates()));
router.post('/adopt', edit, handle((req) => adoptRefMods(req.body, actor(req))));
router.post('/bulk', edit, handle((req) => bulkRefModEntries(req.body, actor(req))));

/** A ZIP of refmods.json and the sources; media are already compressed, so entries are stored. Sources need images.view. */
router.post('/export', read, asyncHandler(async (req, res) => {
  let bundle: ReturnType<typeof exportRefModEntries>;
  try { bundle = exportRefModEntries(req.body, actor(req).canViewImages); }
  catch (error) { if (sendError(res, error)) return; throw error; }
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="refmods.zip"');
  res.setHeader('X-RefMod-Count', String(bundle.document.entries.length));
  res.setHeader('Cache-Control', 'private, no-store');
  await new Promise<void>((resolve, reject) => {
    const archive = new ZipArchive({ store: true });
    archive.once('error', reject);
    res.once('error', reject);
    res.once('close', () => { if (!res.writableFinished) { archive.abort(); resolve(); } });
    res.once('finish', resolve);
    archive.pipe(res);
    archive.append(Buffer.from(JSON.stringify(bundle.document, null, 2)), { name: REFMOD_BUNDLE_DOCUMENT });
    for (const file of bundle.files) archive.file(file.path, { name: file.name });
    void archive.finalize();
  });
}));

// The upload lands on disk; the import then reads it through the ZIP central directory, one entry at a time.
const bundleUpload = multer({ storage: createUploadStorage(MAX_MULTIPLE_UPLOAD_TOTAL_BYTES), limits: { files: 1, fields: 2, parts: 3 } }).single('file');
router.post('/import', edit, (req, res, next) => {
  bundleUpload(req, res, (error) => {
    if (error) { res.status(error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ success: false, error: 'RefMod 묶음 ZIP 하나를 골라줘.' }); return; }
    next();
  });
}, handle(async (req) => {
  try {
    if (!req.file) throw new RefModEntryError('RefMod 묶음 ZIP을 골라줘.');
    return await importRefModEntries({ bundlePath: req.file.path, conflict: req.body?.conflict ?? req.query.conflict }, actor(req));
  } finally {
    if (req.file?.path) await fs.promises.unlink(req.file.path).catch(() => {});
  }
}, 201));

router.post('/', edit, handle((req) => createRefModEntry(req.body, actor(req)), 201));
router.get('/:id', read, handle((req) => getRefModEntry(entryId(req))));
router.patch('/:id', edit, handle((req) => patchRefModEntry(entryId(req), req.body, actor(req))));
router.delete('/:id', edit, handle(async (req) => {
  const revision = req.query.revision === undefined ? undefined : Number(req.query.revision);
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) throw new RefModEntryError('잘못된 revision이야.');
  await deleteRefModEntry(entryId(req), actor(req), revision);
  return { deleted: true };
}));
router.post('/:id/build', edit, execute, handle((req) => buildRefModEntry(entryId(req), getRequester(req)), 201));

function entryFile(req: Request, res: Response) {
  const id = Number(routeParam(req.params.id));
  const fileId = routeParam(req.params.fileId);
  if (!Number.isSafeInteger(id) || id <= 0 || !/^[a-f0-9]{32}$/.test(fileId)) {
    res.status(400).json({ success: false, error: 'Invalid entry or file ID' });
    return null;
  }
  const file = resolveRefModEntryFile(id, fileId);
  if (!file) res.status(404).json({ success: false, error: 'RefMod source not found' });
  return file;
}

router.get('/:id/files/:fileId', requireImagesView, asyncHandler(async (req, res) => {
  const file = entryFile(req, res);
  if (!file) return;
  res.setHeader('Content-Security-Policy', 'sandbox');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (file.kind === 'video' || file.kind === 'audio') await streamRangeFile(req, res, file.filePath, file.mimeType);
    else await streamCacheableFile(req, res, file.filePath, file.mimeType);
  } catch (error) {
    console.error('[RefMod entry media] Failed to serve source', error);
    if (!res.headersSent) res.status((error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500).json({ success: false, error: 'RefMod source file is unavailable' });
  }
}));

router.get('/:id/files/:fileId/thumbnail', requireImagesView, asyncHandler(async (req, res) => {
  const file = entryFile(req, res);
  if (!file) return;
  let cached: string;
  try { cached = await getFileThumbnail('bootstrap', file.entry, file.filePath); }
  catch (error) { if (sendError(res, error)) return; throw error; }
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-cache');
  res.sendFile(cached, { dotfiles: 'allow' });
}));

export default router;
