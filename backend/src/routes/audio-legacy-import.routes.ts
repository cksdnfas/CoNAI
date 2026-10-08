import fs from 'fs';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { requireAdmin } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { createUploadStorage, wrapUploadMiddleware } from '../middleware/upload';
import { AudioServiceError } from '../services/audio/audioService';
import {
  LEGACY_IMPORT_ZIP_MAX_BYTES,
  LEGACY_UPLOAD_DIR,
  listLegacyAudioWorkflows,
  registerLegacyAudioWorkflow,
  resolveLegacyPath,
  resolveLegacyUpload,
  stageLegacyUpload,
  type LegacyImportParams,
} from '../services/audio/audioLegacyImport';
import { getRequesterAccountId } from './requester-session-helpers';
import { respondWithStartedJob } from './runtimeJobRouteHelpers';

/**
 * /api/audio/legacy-import — admin only: bring the old standalone SFX manager's data (sfx.sqlite3 + audio/) into the
 * audio workspace. The source is a server folder or an uploaded zip of it; the import runs as the runtime job
 * 'audio-legacy-import' (progress and result via /api/jobs/:jobId).
 */
const router = Router();
router.use(requireAdmin);
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });

const upload = wrapUploadMiddleware(multer({
  defParamCharset: 'utf8',
  storage: createUploadStorage(LEGACY_IMPORT_ZIP_MAX_BYTES, LEGACY_UPLOAD_DIR(), true),
  limits: { fileSize: LEGACY_IMPORT_ZIP_MAX_BYTES, files: 1, fields: 2, parts: 3 },
  fileFilter: (_req, file, callback) => {
    if (/\.zip$/i.test(file.originalname)) callback(null, true);
    else callback(Object.assign(new Error('zip 파일만 올릴 수 있어.'), { status: 415 }));
  },
}).single('archive'));

/** POST /uploads — multipart `archive` (a zip of the old data folder) → { upload_id } to import from. */
router.post('/uploads', (_req, _res, next) => {
  fs.mkdirSync(LEGACY_UPLOAD_DIR(), { recursive: true });
  next();
}, upload, (req, res) => {
  if (!req.file) throw new AudioServiceError('zip 파일을 골라줘.');
  try {
    res.status(201).json({ success: true, data: stageLegacyUpload(req.file.path) });
  } catch (error) {
    fs.rmSync(req.file.path, { force: true });
    throw error;
  }
});

/** POST / — { path } or { upload_id }, dryRun (default true) → 202 + the runtime job. */
router.post('/', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const uploadId = body.upload_id ?? body.uploadId;
  const source: LegacyImportParams['source'] = uploadId !== undefined && uploadId !== null && uploadId !== ''
    ? { uploadId: resolveLegacyUpload(uploadId).id }
    : { path: resolveLegacyPath(body.path) };
  const params: LegacyImportParams = { source, dryRun: body.dryRun !== false && body.dry_run !== false, accountId: getRequesterAccountId(req) };
  return respondWithStartedJob(req, res, 'audio-legacy-import', params, '이전 오디오 앱 가져오기가 이미 진행 중이야.');
});

/** GET /workflows — workflows brought over by an import, with the generation-side workflow each was registered as. */
router.get('/workflows', (_req, res) => res.json({ success: true, data: listLegacyAudioWorkflows() }));

/** POST /workflows/register { legacy_workflow_id } — register one as an audio workflow (graph, marked fields, binding). */
router.post('/workflows/register', asyncHandler(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  res.status(201).json({ success: true, data: await registerLegacyAudioWorkflow(body.legacy_workflow_id ?? body.legacyWorkflowId) });
}));

router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof AudioServiceError) {
    res.status(error.status).json({ success: false, error: error.message });
    return;
  }
  next(error);
});

export default router;
