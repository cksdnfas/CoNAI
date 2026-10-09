import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAdmin, requirePermission } from '../middleware/authMiddleware';
import { requireImagesView } from '../middleware/imageAccess';
import { asyncHandler } from '../middleware/asyncHandler';
import { FileStoreError, FileStoreService, parseFileId } from '../services/fileStoreService';
import { filePreviewMime, getFileThumbnail } from '../services/fileStorePreview';
import { PostError, actorFromRequest } from '../services/posts/postActor';
import { PostBotRuns } from '../services/posts/postBotRuns';
import { PostCategoryStore, PostCommentStore, PostStore, PostTagStore } from '../services/posts/postStore';
import { loadPostsSettings, updatePostsSettings } from '../services/posts/postsSettings';

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
const id = (req: Request, name = 'id') => {
  const value = Number(req.params[name]);
  if (!Number.isSafeInteger(value) || value < 1) throw new PostError('잘못된 ID야.');
  return value;
};

router.get('/settings', (_req, res) => res.json({ success: true, data: loadPostsSettings() }));
router.put('/settings', requireAdmin, (req, res) => res.json({ success: true, data: updatePostsSettings(req.body) }));

router.get('/categories', (_req, res) => res.json({ success: true, data: PostCategoryStore.list() }));
router.post('/categories', requireAdmin, (req, res) => res.status(201).json({ success: true, data: PostCategoryStore.create(actorFromRequest(req), req.body ?? {}) }));
router.patch('/categories/:id', requireAdmin, (req, res) => res.json({ success: true, data: PostCategoryStore.update(actorFromRequest(req), id(req), req.body ?? {}) }));
router.delete('/categories/:id', requireAdmin, (req, res) => {
  PostCategoryStore.remove(actorFromRequest(req), id(req));
  res.json({ success: true });
});

router.get('/tags', (req, res) => res.json({ success: true, data: PostTagStore.list(Number(req.query.limit ?? 200)) }));

/** Profiles the requester may call with @ (enabled, allowed for the account, summoning switched on). */
router.get('/mentionable', summon, (req, res) => res.json({ success: true, data: PostBotRuns.mentionable(actorFromRequest(req)) }));
router.post('/runs/:id/cancel', (req, res) => res.json({ success: true, data: PostBotRuns.cancel(actorFromRequest(req), id(req)) }));

router.patch('/comments/:id', comment, (req, res) => res.json({ success: true, data: PostCommentStore.update(actorFromRequest(req), id(req), req.body ?? {}) }));
router.delete('/comments/:id', comment, (req, res) => {
  PostCommentStore.remove(actorFromRequest(req), id(req));
  res.json({ success: true });
});
router.post('/comments/:id/hidden', requireAdmin, (req, res) => res.json({ success: true, data: PostCommentStore.setHidden(actorFromRequest(req), id(req), req.body?.hidden !== false) }));

router.get('/', asyncHandler(async (req, res) => res.json({ success: true, data: await PostStore.list(actorFromRequest(req), req.query) })));
router.post('/', write, (req, res) => res.status(201).json({ success: true, data: PostStore.create(actorFromRequest(req), req.body ?? {}) }));
router.get('/:id', (req, res) => res.json({ success: true, data: PostStore.get(actorFromRequest(req), id(req)) }));
router.patch('/:id', write, (req, res) => res.json({ success: true, data: PostStore.update(actorFromRequest(req), id(req), req.body ?? {}) }));
router.delete('/:id', write, (req, res) => {
  PostStore.remove(actorFromRequest(req), id(req));
  res.json({ success: true });
});
router.get('/:id/revisions', write, (req, res) => res.json({ success: true, data: PostStore.revisions(actorFromRequest(req), id(req)) }));

router.get('/:id/comments', (req, res) => {
  const actor = actorFromRequest(req);
  const postId = id(req);
  res.json({ success: true, data: { comments: PostCommentStore.list(actor, postId), runs: PostBotRuns.list(actor, postId) } });
});
router.post('/:id/comments', comment, (req, res) => res.status(201).json({ success: true, data: PostCommentStore.create(actorFromRequest(req), id(req), req.body ?? {}) }));

/**
 * A file store file a post embeds, readable by whoever can read the post: the post grants it, not the file store.
 * Images and videos still need `images.view`, as everywhere else.
 */
function embeddedFile(req: Request) {
  const fileId = parseFileId(req.params.fileId) as string;
  const owner = PostStore.embeddedFileOwner(actorFromRequest(req), id(req), fileId);
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
    res.status(error.status).json({ success: false, error: error.message });
    return;
  }
  next(error);
});

export default router;
