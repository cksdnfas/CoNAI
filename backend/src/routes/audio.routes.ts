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
  AudioStoreError,
  isAllowedAudioExtension,
  normalizeAudioExtension,
} from '../services/audio/audioStore';
import {
  AudioServiceError,
  audioCandidateFile,
  createAudioFolder,
  createAudioGroup,
  createAudioGroupComment,
  createAudioProject,
  deleteAudioCandidates,
  deleteAudioFolder,
  deleteAudioGroup,
  deleteAudioGroupComment,
  deleteAudioProject,
  getAudioCandidate,
  getAudioGroup,
  getAudioProject,
  importAudioFromFileStore,
  importAudioUpload,
  listAudioCandidates,
  listAudioFolders,
  listAudioGroupComments,
  listAudioGroups,
  listAudioProjects,
  moveAudioCandidates,
  restoreAudioCandidates,
  setAudioCandidateReview,
  setAudioGroupCommentStatus,
  updateAudioFolder,
  updateAudioGroup,
  updateAudioGroupComment,
  updateAudioProject,
  type AudioCandidate,
  type AudioImportTarget,
} from '../services/audio/audioService';
import { audioDeletionPlan, deleteAudioGroupCandidates } from '../services/audio/audioService';
import { renderAudioEditPreview, saveAudioEdit } from '../services/audio/audioEdit';
import {
  AUDIO_EXPORT_INLINE_MAX_FILES,
  audioCandidateExportName,
  audioExportMimeType,
  audioExportPlan,
  audioExportResultFile,
  buildAudioExport,
  canAccessAudioExport,
  createAudioExportWorkspace,
  exportAudioCandidateFile,
  getAudioExportWorkspace,
  getSavedAudioExportOptions,
  removeAudioExportWorkspace,
  resolveAudioExportOptions,
  saveAudioExportOptions,
  type AudioExportOwner,
} from '../services/audio/audioExport';
import { startAudioExportJob } from '../services/audio/audioExportJob';
import { FileStoreError, parseFileId } from '../services/fileStoreService';
import { requireFileStoreOwner } from '../services/fileStoreAccess';
import { getRequesterAccountId, getRequesterAccountType } from './requester-session-helpers';
import { sendAudioCandidateFile } from './audioCandidateFileResponse';
import {
  addDefaultStableAudioWorkflow,
  checkAudioWorkflowCompatibility,
  listAudioWorkflows,
  saveAudioWorkflowBinding,
} from '../services/audio/audioWorkflows';
import {
  cancelAudioOrder,
  createAudioOrder,
  getAudioOrder,
  listAudioOrders,
  retryAudioOrderJob,
} from '../services/audio/audioOrders';

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

/* ------------------------------------------------------------------ folders (그룹 in the UI) */

router.get('/projects/:projectId/folders', (req, res) => res.json({ success: true, data: listAudioFolders(param(req, 'projectId')) }));
router.post('/projects/:projectId/folders', edit, (req, res) => {
  res.status(201).json({ success: true, data: createAudioFolder(param(req, 'projectId'), req.body ?? {}) });
});
router.patch('/folders/:folderId', edit, (req, res) => res.json({ success: true, data: updateAudioFolder(param(req, 'folderId'), req.body ?? {}) }));
router.delete('/folders/:folderId', edit, (req, res) => res.json({ success: true, data: deleteAudioFolder(param(req, 'folderId')) }));

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
  sendAudioCandidateFile(req, res, next, candidate, file);
});

/* ------------------------------------------------------------------ generation */

const generate = requirePermission('generation.execute');
const workflowId = (req: Request) => {
  const id = Number(req.params.workflowId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AudioServiceError('잘못된 워크플로 ID야.');
  return id;
};

/** GET /api/audio/workflows — audio-kind workflows with their role binding, suggestion and last compatibility check. */
router.get('/workflows', (_req, res) => res.json({ success: true, data: listAudioWorkflows() }));
router.put('/workflows/:workflowId/binding', edit, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await saveAudioWorkflowBinding(workflowId(req), req.body ?? {}) });
}));
router.post('/workflows/:workflowId/check', edit, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await checkAudioWorkflowCompatibility(workflowId(req), { force: true }) });
}));
/** Registers the default Stable Audio 3 graph on the generation side, so it also needs workflows.edit. */
router.post('/workflows/default', edit, requirePermission('workflows.edit'), asyncHandler(async (_req, res) => {
  res.status(201).json({ success: true, data: await addDefaultStableAudioWorkflow() });
}));

/** POST /api/audio/orders { group_id, text, seconds, count, seed?, workflow_id?, request_key?, server_id?, server_tag? } */
router.post('/orders', edit, generate, asyncHandler(async (req, res) => {
  const order = await createAudioOrder(req.body ?? {}, {
    accountId: accountId(req),
    accountType: getRequesterAccountType(req) ?? null,
    scope: `account:${accountId(req) ?? 'bootstrap'}`,
  });
  res.status(201).json({ success: true, data: order });
}));
router.get('/orders', (req, res) => {
  res.json({ success: true, data: listAudioOrders({ groupId: req.query.group_id ?? req.query.groupId, limit: req.query.limit, offset: req.query.offset }) });
});
router.get('/orders/:orderId', (req, res) => res.json({ success: true, data: getAudioOrder(param(req, 'orderId')) }));
router.post('/orders/:orderId/cancel', edit, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await cancelAudioOrder(param(req, 'orderId')) });
}));
router.post('/orders/:orderId/jobs/:idx/retry', edit, generate, (req, res) => {
  const idx = Number(req.params.idx);
  if (!Number.isSafeInteger(idx) || idx < 0) throw new AudioServiceError('잘못된 순번이야.');
  res.json({ success: true, data: retryAudioOrderJob(param(req, 'orderId'), idx) });
});

/* ------------------------------------------------------------------ editing */

/** POST /api/audio/candidates/:id/preview — renders the edit to a temp WAV, streams it and removes it. */
router.post('/candidates/:candidateId/preview', edit, asyncHandler(async (req, res, next) => {
  const preview = await renderAudioEditPreview(param(req, 'candidateId'), req.body ?? {});
  const cleanup = () => { void fs.promises.rm(preview.path, { force: true }).catch(() => undefined); };
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Content-Disposition', 'inline; filename="preview.wav"');
  res.sendFile(preview.path, { dotfiles: 'allow' }, (error) => {
    cleanup();
    if (error && !res.headersSent) next(error);
  });
}));

/** POST /api/audio/candidates/:id/edit { start, end, gain_db, pitch_semitones, speed, fade_in, fade_out, request_key? } */
router.post('/candidates/:candidateId/edit', edit, asyncHandler(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const candidate = await saveAudioEdit(param(req, 'candidateId'), body, { accountId: accountId(req), requestKey: body.request_key ?? body.requestKey });
  res.status(201).json({ success: true, data: candidate });
}));

/* ------------------------------------------------------------------ deletion plan */

/** GET /api/audio/groups/:id/candidates/deletion?scope=all|unselected&candidate_id= — the frozen id list to confirm. */
router.get('/groups/:groupId/candidates/deletion', (req, res) => {
  res.json({ success: true, data: audioDeletionPlan(param(req, 'groupId'), req.query.scope, req.query.candidate_id ?? req.query.candidateId) });
});
/** POST /api/audio/groups/:id/candidates/delete { candidate_ids, include_selected } — soft delete of a frozen list. */
router.post('/groups/:groupId/candidates/delete', edit, (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  res.json({ success: true, data: deleteAudioGroupCandidates(param(req, 'groupId'), body.candidate_ids ?? body.candidateIds, body.include_selected === true || body.includeSelected === true) });
});

/* ------------------------------------------------------------------ export */

const exportOwner = (req: Request): AudioExportOwner => ({ accountId: accountId(req), accountType: getRequesterAccountType(req) ?? null });

function sendExportFile(res: Response, next: NextFunction, filePath: string, fileName: string, after?: () => void) {
  res.setHeader('Content-Type', audioExportMimeType(fileName));
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(filePath, { dotfiles: 'allow' }, (error) => {
    after?.();
    if (error && !res.headersSent) next(error);
  });
}

router.get('/settings/export', (_req, res) => res.json({ success: true, data: getSavedAudioExportOptions() }));
router.put('/settings/export', edit, (req, res) => res.json({ success: true, data: saveAudioExportOptions(req.body ?? {}) }));

/** GET /api/audio/candidates/:id/export?format&quality&normalize&… — one candidate, label name when it is a selected take. */
router.get('/candidates/:candidateId/export', asyncHandler(async (req, res, next) => {
  const options = resolveAudioExportOptions(req.query);
  const id = param(req, 'candidateId');
  const fileName = audioCandidateExportName(id, options);
  const workspace = createAudioExportWorkspace(exportOwner(req));
  try {
    const result = await exportAudioCandidateFile(id, options, workspace.dir, fileName);
    sendExportFile(res, next, result.path, fileName, () => removeAudioExportWorkspace(workspace.id));
  } catch (error) {
    removeAudioExportWorkspace(workspace.id);
    throw error;
  }
}));

/**
 * Selected takes of a group or a project: one file → that file; up to AUDIO_EXPORT_INLINE_MAX_FILES → a ZIP built in
 * the request; more → 202 with an 'audio-export' runtime job, downloaded later from /exports/:id/download.
 */
async function exportSelected(req: Request, res: Response, next: NextFunction, projectId: string, groupId: string | null) {
  const options = resolveAudioExportOptions(req.query);
  const plan = audioExportPlan(projectId, groupId, options);
  if (plan.count > AUDIO_EXPORT_INLINE_MAX_FILES) {
    const job = startAudioExportJob({ projectId, groupId, options, owner: exportOwner(req) }, plan.count);
    res.status(202).json({ success: true, data: { job, count: plan.count, files: plan.files } });
    return;
  }
  const result = await buildAudioExport(projectId, groupId, options, exportOwner(req));
  const workspace = getAudioExportWorkspace(result.export_id);
  const file = workspace ? audioExportResultFile(workspace) : null;
  if (!file) throw new AudioServiceError('내보낸 파일을 찾을 수 없어.', 500);
  sendExportFile(res, next, file.path, file.fileName, () => removeAudioExportWorkspace(result.export_id));
}

router.get('/groups/:groupId/export', asyncHandler(async (req, res, next) => {
  const group = getAudioGroup(param(req, 'groupId'));
  await exportSelected(req, res, next, group.project_id, group.id);
}));
router.get('/projects/:projectId/export', asyncHandler(async (req, res, next) => {
  const groupId = typeof req.query.group_id === 'string' && req.query.group_id ? req.query.group_id : null;
  await exportSelected(req, res, next, param(req, 'projectId'), groupId);
}));
/** GET /api/audio/projects/:id/export/manifest?group_id&… — the files, their names and a download_url with the options. */
router.get('/projects/:projectId/export/manifest', (req, res) => {
  const groupId = typeof req.query.group_id === 'string' && req.query.group_id ? req.query.group_id : null;
  res.json({ success: true, data: audioExportPlan(param(req, 'projectId'), groupId, resolveAudioExportOptions(req.query)) });
});
/** GET /api/audio/exports/:exportId/download — the result of a background export (starter or admin). */
router.get('/exports/:exportId/download', (req, res, next) => {
  const workspace = getAudioExportWorkspace(param(req, 'exportId'));
  if (!workspace || !canAccessAudioExport(workspace.owner, exportOwner(req))) throw new AudioServiceError('내보내기 결과를 찾을 수 없어.', 404);
  const file = audioExportResultFile(workspace);
  if (!file) throw new AudioServiceError('내보내기가 아직 끝나지 않았거나 만료됐어.', 404);
  sendExportFile(res, next, file.path, file.fileName);
});

router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof AudioServiceError || error instanceof AudioStoreError || error instanceof AudioLabelError || error instanceof FileStoreError) {
    res.status(error.status).json({ success: false, error: error.message });
    return;
  }
  next(error);
});

export default router;
