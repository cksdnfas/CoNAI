import fs from 'fs';
import path from 'path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { runtimePaths } from '../config/runtimePaths';
import { requirePermission } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { createUploadStorage, wrapUploadMiddleware, MAX_MULTIPLE_UPLOAD_FILES } from '../middleware/upload';
import { AudioLabelError } from '../services/audio/audioNaming';
import {
  AUDIO_MAX_FILE_BYTES,
  AUDIO_MIME_BY_EXTENSION,
  AudioStoreError,
  audioBlobPath,
  isAllowedAudioExtension,
  normalizeAudioExtension,
} from '../services/audio/audioStore';
import {
  AudioServiceError,
  audioCandidateFile,
  createAudioGroup,
  createAudioGroupComment,
  createAudioProject,
  deleteAudioCandidates,
  deleteAudioGroup,
  deleteAudioGroupComment,
  deleteAudioProject,
  getAudioCandidate,
  getAudioGroup,
  getAudioProject,
  importAudioFromFileStore,
  importAudioUpload,
  listAudioCandidates,
  listAudioGroupComments,
  listAudioGroups,
  listAudioProjects,
  moveAudioCandidates,
  restoreAudioCandidates,
  setAudioCandidateReview,
  setAudioGroupCommentStatus,
  updateAudioGroup,
  updateAudioGroupComment,
  updateAudioProject,
  type AudioCandidate,
  type AudioImportTarget,
} from '../services/audio/audioService';
import { FileStoreError, parseFileId } from '../services/fileStoreService';
import { requireFileStoreOwner } from '../services/fileStoreAccess';
import { getRequesterAccountId, getRequesterAccountType } from './requester-session-helpers';

/**
 * /api/audio — the sound-effect workspace. Reads need `audio.view`, every change `audio.edit`.
 *
 * Review (selected / rejected / pending) is set only here, by a signed-in person: MCP keys and chat bots never reach
 * `/api` routes and have no review tool.
 */
const router = Router();
router.use(requirePermission('audio.view'));
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });

const edit = requirePermission('audio.edit');
const AUDIO_INCOMING_DIR = path.join(runtimePaths.tempDir, 'audio-incoming');
const accountId = (req: Request) => getRequesterAccountId(req);
const param = (req: Request, name: string) => String(req.params[name] ?? '');

function importTarget(source: Record<string, unknown> | undefined): AudioImportTarget {
  const groupId = source?.groupId ?? source?.group_id;
  const projectId = source?.projectId ?? source?.project_id;
  if (typeof groupId === 'string' && groupId) return { groupId };
  if (typeof projectId === 'string' && projectId) return { projectId };
  throw new AudioServiceError('groupId 또는 projectId가 필요해.');
}

/* ------------------------------------------------------------------ projects */

router.get('/projects', (_req, res) => res.json({ success: true, data: listAudioProjects() }));
router.post('/projects', edit, (req, res) => res.status(201).json({ success: true, data: createAudioProject(req.body ?? {}, accountId(req)) }));
router.get('/projects/:projectId', (req, res) => res.json({ success: true, data: getAudioProject(param(req, 'projectId')) }));
router.patch('/projects/:projectId', edit, (req, res) => res.json({ success: true, data: updateAudioProject(param(req, 'projectId'), req.body ?? {}) }));
router.delete('/projects/:projectId', edit, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await deleteAudioProject(param(req, 'projectId')) });
}));

/* ------------------------------------------------------------------ groups */

router.get('/projects/:projectId/groups', (req, res) => {
  res.json({ success: true, data: listAudioGroups(param(req, 'projectId'), { search: req.query.search, filter: req.query.filter }) });
});
router.post('/projects/:projectId/groups', edit, (req, res) => {
  res.status(201).json({ success: true, data: createAudioGroup(param(req, 'projectId'), req.body ?? {}) });
});
router.get('/groups/:groupId', (req, res) => res.json({ success: true, data: getAudioGroup(param(req, 'groupId')) }));
router.patch('/groups/:groupId', edit, (req, res) => res.json({ success: true, data: updateAudioGroup(param(req, 'groupId'), req.body ?? {}) }));
router.delete('/groups/:groupId', edit, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await deleteAudioGroup(param(req, 'groupId')) });
}));
router.get('/groups/:groupId/candidates', (req, res) => {
  res.json({
    success: true,
    data: listAudioCandidates(param(req, 'groupId'), { review: req.query.review, deleted: req.query.deleted, limit: req.query.limit, offset: req.query.offset }),
  });
});

/* ------------------------------------------------------------------ comments */

router.get('/groups/:groupId/comments', (req, res) => {
  res.json({ success: true, data: listAudioGroupComments(param(req, 'groupId'), { status: req.query.status, limit: req.query.limit, offset: req.query.offset }) });
});
router.post('/groups/:groupId/comments', edit, (req, res) => {
  res.status(201).json({ success: true, data: createAudioGroupComment(param(req, 'groupId'), req.body ?? {}, accountId(req)) });
});
router.patch('/groups/:groupId/comments/:commentId', edit, (req, res) => {
  res.json({ success: true, data: updateAudioGroupComment(param(req, 'groupId'), param(req, 'commentId'), req.body ?? {}) });
});
router.delete('/groups/:groupId/comments/:commentId', edit, (req, res) => {
  res.json({ success: true, data: deleteAudioGroupComment(param(req, 'groupId'), param(req, 'commentId')) });
});
router.patch('/groups/:groupId/comments/:commentId/status', edit, (req, res) => {
  res.json({ success: true, data: setAudioGroupCommentStatus(param(req, 'groupId'), param(req, 'commentId'), req.body ?? {}) });
});

/* ------------------------------------------------------------------ imports */

const upload = wrapUploadMiddleware(multer({
  // Browsers send multipart file names as UTF-8; multer's latin1 default turns Korean names into mojibake.
  defParamCharset: 'utf8',
  storage: createUploadStorage(AUDIO_MAX_FILE_BYTES * 4, AUDIO_INCOMING_DIR, false),
  limits: { fileSize: AUDIO_MAX_FILE_BYTES, files: MAX_MULTIPLE_UPLOAD_FILES, fields: 4, parts: MAX_MULTIPLE_UPLOAD_FILES + 4 },
  fileFilter: (_req, file, callback) => {
    if (isAllowedAudioExtension(normalizeAudioExtension(file.originalname))) callback(null, true);
    else callback(Object.assign(new Error(`지원하지 않는 오디오 형식이야: ${file.originalname}`), { status: 415 }));
  },
}).array('files', MAX_MULTIPLE_UPLOAD_FILES));

/** POST /api/audio/upload?groupId=… | ?projectId=… (inbox) — multipart `files`. */
router.post('/upload', edit, (req, res, next) => {
  const target = importTarget(req.query as Record<string, unknown>);
  if ('groupId' in target) getAudioGroup(target.groupId);
  else getAudioProject(target.projectId);
  fs.mkdirSync(AUDIO_INCOMING_DIR, { recursive: true });
  res.locals.audioTarget = target;
  next();
}, upload, asyncHandler(async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  try {
    if (files.length === 0) throw new AudioServiceError('파일을 선택해줘.');
    const created: AudioCandidate[] = [];
    const failed: Array<{ name: string; error: string }> = [];
    for (const file of files) {
      try {
        created.push(await importAudioUpload(res.locals.audioTarget as AudioImportTarget, file.path, file.originalname, accountId(req)));
      } catch (error) {
        failed.push({ name: file.originalname, error: error instanceof Error ? error.message : String(error) });
      }
    }
    res.status(created.length > 0 ? 201 : 400).json({ success: created.length > 0, data: { created, failed } });
  } finally {
    await Promise.all(files.map((file) => fs.promises.rm(file.path, { force: true }).catch(() => undefined)));
  }
}));

/** POST /api/audio/import-file { fileId, groupId | projectId } — copy one audio file from your private file store. */
router.post('/import-file', edit, asyncHandler(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const fileId = parseFileId(body.fileId ?? body.file_id) as string;
  const owner = requireFileStoreOwner({ accountId: accountId(req), accountType: getRequesterAccountType(req) });
  res.status(201).json({ success: true, data: await importAudioFromFileStore(importTarget(body), owner, fileId, accountId(req)) });
}));

/* ------------------------------------------------------------------ candidates */

router.post('/candidates/move', edit, (req, res) => {
  res.json({ success: true, data: moveAudioCandidates(req.body?.ids, String(req.body?.groupId ?? req.body?.group_id ?? '')) });
});
router.post('/candidates/delete', edit, (req, res) => res.json({ success: true, data: deleteAudioCandidates(req.body?.ids) }));
router.post('/candidates/restore', edit, (req, res) => res.json({ success: true, data: restoreAudioCandidates(req.body?.ids) }));
router.get('/candidates/:candidateId', (req, res) => res.json({ success: true, data: getAudioCandidate(param(req, 'candidateId')) }));

/** Human-only review: selected / rejected / pending plus the review memo. */
router.patch('/candidates/:candidateId/review', edit, (req, res) => {
  res.json({ success: true, data: setAudioCandidateReview(param(req, 'candidateId'), { review: req.body?.review, notes: req.body?.notes }) });
});

/** The candidate's audio; sendFile answers single byte ranges (206/416) and HEAD for seeking players. */
router.get('/candidates/:candidateId/file', (req, res, next) => {
  const { candidate, file } = audioCandidateFile(param(req, 'candidateId'));
  const filePath = audioBlobPath(file.hash, file.ext);
  const safeName = `${candidate.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')}.${file.ext}`;
  res.setHeader('Content-Type', AUDIO_MIME_BY_EXTENSION[file.ext] ?? 'application/octet-stream');
  res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(safeName)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', 'sandbox');
  res.sendFile(filePath, { dotfiles: 'allow' }, (error) => {
    if (!error || res.headersSent) return;
    const status = (error as { status?: number }).status;
    if (status === 416) {
      res.setHeader('Content-Range', `bytes */${file.size}`);
      res.status(416).end();
    } else if (status === 404 || (error as NodeJS.ErrnoException).code === 'ENOENT') {
      res.status(404).json({ success: false, error: '파일이 없어.' });
    } else next(error);
  });
});

router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof AudioServiceError || error instanceof AudioStoreError || error instanceof AudioLabelError || error instanceof FileStoreError) {
    res.status(error.status).json({ success: false, error: error.message });
    return;
  }
  next(error);
});

export default router;
