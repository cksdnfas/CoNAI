import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAdmin, requirePermission } from '../middleware/authMiddleware';
import { requireImagesView } from '../middleware/imageAccess';
import { asyncHandler, cancellableAsyncHandler } from '../middleware/asyncHandler';
import { FileStoreError, FileStoreService, parseFileId } from '../services/fileStoreService';
import { filePreviewMime, getFileThumbnail } from '../services/fileStorePreview';
import { PostError, actorFromRequest } from '../services/posts/postActor';
import { PostBotRuns } from '../services/posts/postBotRuns';
import { PostCategoryStore, PostCommentStore, PostStore, PostTagStore } from '../services/posts/postStore';
import { loadPostsSettings, updatePostsSettings } from '../services/posts/postsSettings';
import { readPageSettings, verifyNativePageSettingsRevision } from '../services/pageSettings';
import { KnowledgeStore } from '../services/posts/knowledgeStore';
import { KnowledgeAssessmentStore, getKnowledgeQuality } from '../services/posts/knowledgeAssessment';
import { postSemanticStatus } from '../services/embeddings/postSemantic';
import { KnowledgeProposalStore } from '../services/posts/knowledge/knowledgeProposals';
import { KnowledgeEvaluationStore } from '../services/posts/knowledge/knowledgeEvaluation';

/**
 * /api/posts — the posts board. Reading needs `posts.view`; writing posts `posts.write`, comments `posts.comment`,
 * calling bots `posts.summon`. Categories and settings are for administrators. Visibility (drafts, hidden) and
 * ownership are checked in the store.
 */
const router = Router();
router.use(requirePermission('posts.view'));
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });

const write = requirePermission('posts.write');
const comment = requirePermission('posts.comment');
const summon = requirePermission('posts.summon');
const evaluate = requirePermission('posts.evaluate');
const review = requirePermission('posts.knowledge.review');
const id = (req: Request, name = 'id') => {
  const value = Number(req.params[name]);
  if (!Number.isSafeInteger(value) || value < 1) throw new PostError('잘못된 ID야.');
  return value;
};

router.get('/settings', (_req, res) => res.json({ success: true, data: { ...loadPostsSettings(), pageSettingsRevisions: { posts: readPageSettings('posts').revision } } }));
router.put('/settings', requireAdmin, (req, res) => {
  if (!verifyNativePageSettingsRevision(req, res, 'posts')) return;
  const settings = updatePostsSettings(req.body);
  res.json({ success: true, data: { ...settings, pageSettingsRevisions: { posts: readPageSettings('posts').revision } } });
});

router.get('/categories', (_req, res) => res.json({ success: true, data: PostCategoryStore.list() }));
router.post('/categories', requireAdmin, (req, res) => res.status(201).json({ success: true, data: PostCategoryStore.create(actorFromRequest(req), req.body ?? {}) }));
router.patch('/categories/:id', requireAdmin, (req, res) => res.json({ success: true, data: PostCategoryStore.update(actorFromRequest(req), id(req), req.body ?? {}) }));
router.delete('/categories/:id', requireAdmin, (req, res) => {
  PostCategoryStore.remove(actorFromRequest(req), id(req));
  res.json({ success: true });
});

router.get('/tags', (req, res) => res.json({ success: true, data: PostTagStore.list(Number(req.query.limit ?? 200)) }));

router.get('/knowledge/search-status', (req,res) => res.json({ success: true,data: postSemanticStatus(actorFromRequest(req)) }));
router.get('/knowledge/review-queue', review, cancellableAsyncHandler(async (req, res, signal) => {
  try {
    const data = await KnowledgeStore.reviewQueue(actorFromRequest(req), req.query, { signal });
    if (!signal.aborted) res.json({ success: true, data });
  } catch (error) {
    if (!signal.aborted || error !== signal.reason) throw error;
  }
}));
router.get('/knowledge/evaluations/status', (req,res) => res.json({ success: true,data: KnowledgeEvaluationStore.status(actorFromRequest(req)) }));
router.get('/knowledge/proposals', (req,res) => res.json({ success: true,data: KnowledgeProposalStore.list(actorFromRequest(req),req.query) }));
router.post('/knowledge/proposals', write, (req,res) => res.status(201).json({ success: true,data: KnowledgeProposalStore.create(actorFromRequest(req),req.body ?? {}) }));
router.get('/knowledge/proposals/:proposalId', (req,res) => res.json({ success: true,data: KnowledgeProposalStore.get(actorFromRequest(req),String(req.params.proposalId)) }));
router.post('/knowledge/proposals/:proposalId/apply', write, (req,res) => res.json({ success: true,data: KnowledgeProposalStore.apply(actorFromRequest(req),String(req.params.proposalId),req.body ?? {}) }));
router.post('/knowledge/proposals/:proposalId/reject', write, (req,res) => res.json({ success: true,data: KnowledgeProposalStore.reject(actorFromRequest(req),String(req.params.proposalId),req.body ?? {}) }));

/** Profiles the requester may call with @ (enabled, allowed for the account, summoning switched on). */
router.get('/mentionable', summon, (req, res) => res.json({ success: true, data: PostBotRuns.mentionable(actorFromRequest(req)) }));
router.post('/runs/:id/cancel', (req, res) => res.json({ success: true, data: PostBotRuns.cancel(actorFromRequest(req), id(req)) }));

router.patch('/comments/:id', comment, (req, res) => res.json({ success: true, data: PostCommentStore.update(actorFromRequest(req), id(req), req.body ?? {}) }));
router.delete('/comments/:id', comment, (req, res) => {
  PostCommentStore.remove(actorFromRequest(req), id(req));
  res.json({ success: true });
});
router.post('/comments/:id/hidden', requireAdmin, (req, res) => res.json({ success: true, data: PostCommentStore.setHidden(actorFromRequest(req), id(req), req.body?.hidden !== false) }));

router.get('/', cancellableAsyncHandler(async (req, res, signal) => {
  try {
    const data = await PostStore.list(actorFromRequest(req), {...req.query,taskKey:undefined,taskConditionKey:undefined}, { signal });
    if (!signal.aborted) res.json({ success: true, data });
  } catch (error) {
    if (!signal.aborted || error !== signal.reason) throw error;
  }
}));
router.post('/', write, (req, res) => res.status(201).json({ success: true, data: PostStore.create(actorFromRequest(req), req.body ?? {}) }));
router.get('/:id', (req, res) => res.json({ success: true, data: PostStore.get(actorFromRequest(req), id(req)) }));
router.get('/:id/topic-evaluation', (req, res) => res.json({ success: true, data: PostStore.get(actorFromRequest(req),id(req)).topicEvaluation }));
router.post('/:id/topic-evaluation', write, (req, res) => res.status(202).json({ success: true, data: PostStore.requestTopicEvaluation(actorFromRequest(req),id(req),req.body ?? {}).topicEvaluation }));
router.patch('/:id', write, (req, res) => res.json({ success: true, data: PostStore.update(actorFromRequest(req), id(req), req.body ?? {}) }));
router.delete('/:id', write, (req, res) => {
  PostStore.remove(actorFromRequest(req), id(req), req.body ?? {});
  res.json({ success: true });
});
router.get('/:id/revisions', write, (req, res) => res.json({ success: true, data: req.query.detail === 'summary'
  ? PostStore.revisionSummaries(actorFromRequest(req), id(req)) : PostStore.revisions(actorFromRequest(req), id(req)) }));
router.get('/:id/revisions/:revision', write, (req, res) => {
  const [revision] = PostStore.revisions(actorFromRequest(req), id(req), id(req, 'revision'));
  if (!revision) throw new PostError('이전 판을 찾을 수 없어.', 404);
  res.json({ success: true, data: revision });
});
router.patch('/:id/knowledge', write, (req,res) => res.json({ success: true,data: KnowledgeStore.patch(actorFromRequest(req),id(req),req.body ?? {}) }));
router.get('/:id/links', (req,res) => res.json({ success: true,data: KnowledgeStore.links(actorFromRequest(req),id(req)) }));
router.get('/:id/knowledge/versions', write, (req,res) => res.json({ success: true,data: KnowledgeStore.versions(actorFromRequest(req),id(req)) }));
router.post('/:id/knowledge/versions/:contentVersion/restore', write, (req,res) => res.json({ success: true,data: KnowledgeStore.restoreVersion(actorFromRequest(req),id(req),id(req,'contentVersion'),req.body ?? {}) }));
router.get('/:id/knowledge/export', (req,res) => res.json({ success: true,data: KnowledgeStore.export(actorFromRequest(req),id(req)) }));
router.get('/:id/quality', (req,res) => res.json({ success: true,data: getKnowledgeQuality(actorFromRequest(req),id(req)) }));
router.put('/:id/vote', evaluate, (req,res) => res.json({ success: true,data: KnowledgeAssessmentStore.vote(actorFromRequest(req),id(req),req.body ?? {}) }));
router.delete('/:id/vote', evaluate, (req,res) => res.json({ success: true,data: KnowledgeAssessmentStore.withdraw(actorFromRequest(req),id(req),req.body ?? {}) }));
router.get('/:id/task-fit', (req,res) => res.json({success:true,data:KnowledgeAssessmentStore.ownTaskFit(actorFromRequest(req),id(req),req.query.searchReceiptToken)}));
router.put('/:id/task-fit', evaluate, (req,res) => res.json({success:true,data:KnowledgeAssessmentStore.taskFit(actorFromRequest(req),id(req),req.body??{})}));
router.get('/:id/assessments', (req,res) => res.json({success:true,data:KnowledgeAssessmentStore.history(actorFromRequest(req),id(req),req.query)}));
router.post('/:id/assessments/:eventId/moderate', review, (req,res) => res.json({success:true,data:KnowledgeAssessmentStore.moderate(actorFromRequest(req),id(req),id(req,'eventId'),req.body??{})}));
router.post('/:id/permanent-delete/preview', write, (req,res) => res.json({success:true,data:KnowledgeStore.permanentDeletePreview(actorFromRequest(req),id(req),req.body??{})}));
router.post('/:id/permanent-delete', write, (req,res) => res.json({success:true,data:KnowledgeStore.permanentDelete(actorFromRequest(req),id(req),req.body??{})}));
router.post('/:id/review', (req,res) => res.json({ success: true,data: KnowledgeStore.review(actorFromRequest(req),id(req),req.body ?? {}) }));
router.post('/:id/trash', write, (req,res) => {
  KnowledgeStore.trash(actorFromRequest(req),id(req),req.body ?? {});
  res.json({ success: true });
});
router.post('/:id/restore', write, (req,res) => res.json({ success: true,data: KnowledgeStore.restore(actorFromRequest(req),id(req),req.body ?? {}) }));
router.post('/:id/evaluations', review, (req,res) => res.status(202).json({ success: true,data: KnowledgeEvaluationStore.request(actorFromRequest(req),id(req),req.body ?? {}) }));
router.get('/:id/evaluations', (req,res) => res.json({ success: true,data: KnowledgeEvaluationStore.list(actorFromRequest(req),id(req)) }));
router.post('/:id/evaluations/:requestId/cancel', (req,res) => res.json({ success: true,data: KnowledgeEvaluationStore.cancel(actorFromRequest(req),id(req),String(req.params.requestId)) }));

router.get('/:id/runs', (req, res) => res.json({ success: true, data: PostBotRuns.list(actorFromRequest(req), id(req)) }));
router.get('/:id/comments', (req, res) => {
  const actor = actorFromRequest(req);
  const postId = id(req);
  const parseJson = (value: unknown) => {
    if (value === undefined) return undefined;
    if (typeof value !== 'string') throw new PostError('잘못된 댓글 조회 조건이야.');
    try { return JSON.parse(value) as unknown; } catch { throw new PostError('잘못된 댓글 조회 조건이야.'); }
  };
  const page = PostCommentStore.page(actor, postId, { parentId: req.query.parentId === undefined ? undefined : Number(req.query.parentId),
    before: parseJson(req.query.before), focusIds: parseJson(req.query.focusIds) });
  res.json({ success: true, data: { ...page, runs: PostBotRuns.list(actor, postId) } });
});
router.post('/:id/comments', comment, (req, res) => res.status(201).json({ success: true, data: PostCommentStore.create(actorFromRequest(req), id(req), req.body ?? {}) }));

/**
 * A file store file a post embeds, readable by whoever can read the post: the post grants it, not the file store.
 * Images and videos still need `images.view`, as everywhere else.
 */
function embeddedFile(req: Request) {
  const fileId = parseFileId(req.params.fileId) as string;
  const versionInput = req.query.contentVersion;
  const contentVersion = versionInput === undefined ? undefined : typeof versionInput === 'string' ? Number(versionInput) : NaN;
  if (contentVersion !== undefined && (!Number.isSafeInteger(contentVersion) || contentVersion < 1)) throw new PostError('첨부파일의 내용 판이 잘못됐어.');
  const actor = actorFromRequest(req);
  const owner = contentVersion === undefined ? PostStore.embeddedFileOwner(actor, id(req), fileId) : PostStore.embeddedKnowledgeVersionFileOwner(actor, id(req), contentVersion, fileId);
  if (!owner) throw new PostError('이 글에 들어 있는 파일이 아니야.', 404);
  return { owner, ...FileStoreService.resolveFile(owner, fileId) };
}

async function mediaGate(req: Request, res: Response, mime: string | null) {
  if (!mime || !/^(image|video)\//.test(mime)) return true;
  let allowed = false;
  requireImagesView(req, res, () => { allowed = true; });
  return allowed;
}

router.get('/:id/files/:fileId', (req, res) => {
  const { entry } = embeddedFile(req);
  res.json({ success: true, data: entry });
});
router.get('/:id/files/:fileId/view', asyncHandler(async (req, res, next) => {
  const { entry, filePath } = embeddedFile(req);
  const mime = await filePreviewMime(entry, filePath);
  if (!mime) throw new PostError('미리 볼 수 없는 형식이야.', 415);
  if (!await mediaGate(req, res, mime)) return;
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
router.get('/:id/files/:fileId/thumbnail', requireImagesView, asyncHandler(async (req, res) => {
  const { owner, entry, filePath } = embeddedFile(req);
  const cached = await getFileThumbnail(owner, entry, filePath);
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(cached, { dotfiles: 'allow' });
}));
router.get('/:id/files/:fileId/download', asyncHandler(async (req, res, next) => {
  const { entry, filePath } = embeddedFile(req);
  if (!await mediaGate(req, res, await filePreviewMime(entry, filePath))) return;
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.download(filePath, entry.name, { dotfiles: 'allow' }, (error) => { if (error && !res.headersSent) next(error); });
}));

router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof PostError || error instanceof FileStoreError) {
    res.status(error.status).json({ success: false, error: error.message, ...('code' in error && error.code ? { code: error.code } : {}) });
    return;
  }
  next(error);
});

export default router;
