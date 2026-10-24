import multer from 'multer'
import express, { type NextFunction, type Request, type Response } from 'express'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireAdmin } from '../middleware/authMiddleware'
import { ChatProfileError, ChatProfileStore } from '../services/codex-chat/chatProfiles'
import { canUseChatProfile, resolveChatAccess } from '../services/codex-chat/codexChatAccess'
import { ChatLorebookStore } from '../services/codex-chat/chatLorebook'
import { LorebookError, OwnedLorebookStore } from '../services/codex-chat/chatLorebookFiles'
import { describeLinkedFiles, LinkedFileError, normalizeLinkedFiles, threadLinkedFiles } from '../services/codex-chat/chatLinkedFiles'
import { threadLorebooks } from '../services/codex-chat/chatLoreContext'
import { applyMerge, draftMerge, hasDuplicates, previewMerge, type MergeResult } from '../services/codex-chat/chatLorebookMerge'
import { fillLoreKeys } from '../services/codex-chat/chatLoreKeyFill'
import { bilingualLore } from '../services/codex-chat/loreTranslation'
import { CodexChatStore } from '../services/codex-chat/codexChatStore'
import { ChatGroupStore } from '../services/codex-chat/chatGroupStore'
import { CHAT_CARD_MAX_BYTES, readLorebookFile } from '../services/codex-chat/chatCardImport'
import { undoFileChange } from '../services/codex-chat/chatFileChanges'
import { parseFileId } from '../services/fileStoreService'
import { requireFileStoreAction, requireFileStoreOwner } from '../services/fileStoreAccess'
import { getRequesterAccountId } from './requester-session-helpers'
import { sendRouteBadRequest } from './routeValidation'
import { lorebookOwner, parseId, parseThreadId, requesterFrom, requireChatAccess, sendChatError, sendMergeError } from './codex-chat-route-helpers'

/** /api/codex-chat lorebooks (account, chat and shared books), merges, and the files a chat links. */
const router = express.Router()

/**
 * GET /api/codex-chat/lorebooks — the shared account books (with entries) and the global books (name and
 * entry count only; the admin edits those). `kind` tells them apart.
 */
router.get('/lorebooks', requireChatAccess, (req: Request, res: Response) => {
  try {
    const own = OwnedLorebookStore.list(lorebookOwner(req)).map((book) => ({ ...book, entryCount: book.entries.length }))
    const global = ChatLorebookStore.list().map(({ entries, ...book }) => ({ ...book, entries: [], entryCount: entries.length, threadId: null, folderId: null }))
    const books = [...own, ...global]
    res.json({ success: true, data: req.query.summary === '1' ? books.map(({ entries: _entries, ...book }) => book) : books })
  } catch (error) { sendChatError(res, error) }
})

/** POST /api/codex-chat/lorebooks — `{ name, entries? }`: a new account book, a folder under 로어북/ in the file store. */
router.post('/lorebooks', requireChatAccess, (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { name?: unknown; entries?: unknown }
  try {
    res.status(201).json({ success: true, data: OwnedLorebookStore.create(lorebookOwner(req), body) })
  } catch (error) { sendChatError(res, error) }
})

/** PATCH /api/codex-chat/lorebooks/:lorebookId — `{ name?, entries? }` of an own account or chat book (null: an emptied chat book went away). */
router.patch('/lorebooks/:lorebookId', requireChatAccess, (req: Request, res: Response) => {
  const lorebookId = parseId(req.params.lorebookId)
  if (lorebookId === null) { sendRouteBadRequest(res, 'Invalid lorebook id'); return }
  const body = (req.body ?? {}) as { name?: unknown; entries?: unknown }
  if (body.entries !== undefined && !Array.isArray(body.entries)) { sendRouteBadRequest(res, 'entries must be a list'); return }
  try {
    res.json({ success: true, data: OwnedLorebookStore.update(lorebookId, lorebookOwner(req), { name: body.name, entries: body.entries }) })
  } catch (error) { sendChatError(res, error) }
})

/** DELETE /api/codex-chat/lorebooks/:lorebookId — an own account or chat book with its folder and files. */
router.delete('/lorebooks/:lorebookId', requireChatAccess, (req: Request, res: Response) => {
  const lorebookId = parseId(req.params.lorebookId)
  if (lorebookId === null) { sendRouteBadRequest(res, 'Invalid lorebook id'); return }
  try {
    res.json({ success: true, data: { deleted: OwnedLorebookStore.delete(lorebookId, lorebookOwner(req)) } })
  } catch (error) { sendChatError(res, error) }
})

/** PUT / DELETE /api/codex-chat/lorebooks/:lorebookId/profiles/:profileId — link an own account book to a profile, or unlink it. */
router.put('/lorebooks/:lorebookId/profiles/:profileId', requireChatAccess, (req: Request, res: Response) => {
  const lorebookId = parseId(req.params.lorebookId)
  const profileId = parseId(req.params.profileId)
  if (lorebookId === null || profileId === null) { sendRouteBadRequest(res, 'Invalid lorebook or profile id'); return }
  try {
    res.json({ success: true, data: { lorebookIds: OwnedLorebookStore.linkProfile(profileId, lorebookId, lorebookOwner(req)) } })
  } catch (error) { sendChatError(res, error) }
})

router.delete('/lorebooks/:lorebookId/profiles/:profileId', requireChatAccess, (req: Request, res: Response) => {
  const lorebookId = parseId(req.params.lorebookId)
  const profileId = parseId(req.params.profileId)
  if (lorebookId === null || profileId === null) { sendRouteBadRequest(res, 'Invalid lorebook or profile id'); return }
  try {
    res.json({ success: true, data: { lorebookIds: OwnedLorebookStore.unlinkProfile(profileId, lorebookId, lorebookOwner(req)) } })
  } catch (error) { sendChatError(res, error) }
})

/**
 * POST /api/codex-chat/lorebooks/:targetId/merge — `{ sourceId, decisions?, deleteSource?, entryIds? }`: merge an own
 * chat or account book into an own account book. Without decisions: the preview (`status: 'preview'`) when there are
 * duplicates, else the merge right away. With decisions: the merge (409 with the preview when a duplicate has none).
 * `deleteSource` removes the source afterwards; `entryIds` merges only those source entries (승격).
 */
router.post('/lorebooks/:targetId/merge', requireChatAccess, (req: Request, res: Response) => {
  const targetId = parseId(req.params.targetId)
  const body = (req.body ?? {}) as { sourceId?: unknown; decisions?: unknown; deleteSource?: unknown; entryIds?: unknown }
  const sourceId = parseId(body.sourceId)
  if (targetId === null || sourceId === null) { sendRouteBadRequest(res, 'Invalid lorebook id'); return }
  const owner = lorebookOwner(req)
  try {
    if (body.decisions === undefined || body.decisions === null) {
      const preview = previewMerge(sourceId, targetId, owner, { entryIds: body.entryIds })
      if (hasDuplicates(preview)) {
        res.json({ success: true, data: { status: 'preview', preview } })
        return
      }
    }
    const result: MergeResult = applyMerge(sourceId, targetId, owner, body.decisions, { entryIds: body.entryIds })
    let sourceDeleted = false
    let sourceError: string | undefined
    if (body.deleteSource === true) {
      try { sourceDeleted = OwnedLorebookStore.delete(sourceId, owner) } catch (error) { sourceError = error instanceof Error ? error.message : String(error) }
    }
    res.json({ success: true, data: { status: 'merged', ...result, sourceDeleted, ...(sourceError ? { sourceError } : {}) } })
  } catch (error) { sendMergeError(res, error) }
})

/** POST /api/codex-chat/lorebooks/:targetId/merge/preview — `{ sourceId, entryIds? }`: what a merge would do; changes nothing. */
router.post('/lorebooks/:targetId/merge/preview', requireChatAccess, (req: Request, res: Response) => {
  const targetId = parseId(req.params.targetId)
  const body = (req.body ?? {}) as { sourceId?: unknown; entryIds?: unknown }
  const sourceId = parseId(body.sourceId)
  if (targetId === null || sourceId === null) { sendRouteBadRequest(res, 'Invalid lorebook id'); return }
  try {
    res.json({ success: true, data: previewMerge(sourceId, targetId, lorebookOwner(req), { entryIds: body.entryIds }) })
  } catch (error) { sendChatError(res, error) }
})

/**
 * POST /api/codex-chat/lorebooks/key-fill — `{ profileId, language, entries: [{ id, title, keys, content }] }`: the
 * profile's translation model (else its summary model) writes each entry's keywords in `language`. Saves nothing;
 * entries it found none for come back in `failed`.
 */
router.post('/lorebooks/translate', requireChatAccess, asyncHandler(async (req: Request, res: Response) => {
  const body = req.body ?? {}, id = parseId(body.profileId)
  const profile = id === null ? null : ChatProfileStore.find(id)
  if (!profile || !canUseChatProfile(resolveChatAccess(getRequesterAccountId(req)), profile)) { sendRouteBadRequest(res, '사용할 수 없는 프로필이야.'); return }
  const entry = body.entry
  if (!entry || typeof entry.title !== 'string' || entry.title.length > 80 || typeof entry.content !== 'string' || !entry.content.trim() || entry.content.length > 12000 || !Array.isArray(entry.keys) || entry.keys.length > 20 || entry.keys.some((k: unknown) => typeof k !== 'string' || k.length > 100)) { sendRouteBadRequest(res, '번역할 항목을 확인해줘.'); return }
  const controller = new AbortController()
  res.on('close', () => { if (!res.writableFinished) controller.abort() })
  const result = await bilingualLore(profile, { title: entry.title, keys: entry.keys, content: entry.content }, controller.signal)
  if (controller.signal.aborted) return
  const current = ChatProfileStore.find(profile.id)
  if (!current || current.updatedDate !== profile.updatedDate || !canUseChatProfile(resolveChatAccess(getRequesterAccountId(req)), current)) { sendRouteBadRequest(res, '프로필 설정이나 권한이 바뀌었어. 다시 시도해줘.'); return }
  res.json({ success: true, data: result }) // draft only; the normal book save owns revisions/approval
}))

router.post('/lorebooks/key-fill', requireChatAccess, asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { profileId?: unknown; language?: unknown; entries?: unknown }
  if (parseId(body.profileId) === null) { sendRouteBadRequest(res, 'Invalid profile id'); return }
  const controller = new AbortController()
  res.on('close', () => { if (!res.writableFinished) controller.abort() })
  try {
    res.json({ success: true, data: await fillLoreKeys(body, controller.signal) })
  } catch (error) {
    if (controller.signal.aborted) return
    sendChatError(res, error)
  }
}))

/**
 * POST /api/codex-chat/lorebooks/:targetId/merge/draft —`{ sourceId, profileId, entryIds?, instruction? }`: the
 * profile's summary model (else its chat model) writes a merged text for each duplicate (or the given ones). Saves
 * nothing; an entry that failed comes back as `{ entryId, error }`. `instruction` replaces the preview's
 * `defaultInstruction`.
 */
router.post('/lorebooks/:targetId/merge/draft', requireChatAccess, asyncHandler(async (req: Request, res: Response) => {
  const targetId = parseId(req.params.targetId)
  const body = (req.body ?? {}) as { sourceId?: unknown; profileId?: unknown; entryIds?: unknown; instruction?: unknown }
  const sourceId = parseId(body.sourceId)
  if (targetId === null || sourceId === null) { sendRouteBadRequest(res, 'Invalid lorebook id'); return }
  if (parseId(body.profileId) === null) { sendRouteBadRequest(res, 'Invalid profile id'); return }
  const controller = new AbortController()
  res.on('close', () => { if (!res.writableFinished) controller.abort() })
  try {
    res.json({ success: true, data: await draftMerge(sourceId, targetId, lorebookOwner(req), body, controller.signal) })
  } catch (error) {
    if (controller.signal.aborted) return
    sendChatError(res, error)
  }
}))

/**
 * POST /api/codex-chat/threads/:threadId/lorebook/keep — keep the chat's own book as an account book (its folder
 * moves to 로어북/), linked to this chat so its requests still carry it.
 */
router.post('/threads/:threadId/lorebook/keep', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  try {
    if (!CodexChatStore.findThread(threadId, getRequesterAccountId(req))) throw new LorebookError('채팅을 찾을 수 없어.', 404)
    res.json({ success: true, data: OwnedLorebookStore.keepChatBook(threadId, { link: true }) })
  } catch (error) { sendChatError(res, error) }
})

/**
 * GET /api/codex-chat/threads/:threadId/linked-files — the context tab's linked files: the chat's own links, then
 * those the profile (a room: every member) brings.
 */
router.get('/threads/:threadId/linked-files', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  try {
    const thread = CodexChatStore.findThread(threadId, getRequesterAccountId(req))
    if (!thread) throw new LinkedFileError('채팅을 찾을 수 없어.', 404)
    const profileIds = thread.kind === 'group' ? ChatGroupStore.members(threadId).map((member) => member.profile_id) : thread.profile_id ? [thread.profile_id] : []
    const profiles = profileIds.flatMap((id) => ChatProfileStore.find(id) ?? [])
    res.json({ success: true, data: threadLinkedFiles(thread, profiles) })
  } catch (error) { sendChatError(res, error) }
})

/**
 * POST /api/codex-chat/threads/:threadId/file-changes/undo — `{ replyId, fileId }`: undo what that reply's tools did to
 * the file (back to the version before it; a file it made is removed). Needs the file store's edit or delete right.
 */
router.post('/threads/:threadId/file-changes/undo', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  try {
    const accountId = getRequesterAccountId(req)
    if (!CodexChatStore.findThread(threadId, accountId)) throw new LinkedFileError('채팅을 찾을 수 없어.', 404)
    const replyId = typeof req.body?.replyId === 'string' ? req.body.replyId : ''
    const fileId = parseFileId(req.body?.fileId) as string
    if (!replyId) { sendRouteBadRequest(res, 'replyId is required'); return }
    requireFileStoreAction(requesterFrom(req), 'organize')
    res.json({ success: true, data: undoFileChange({ threadId, accountId, replyId, fileId, canDelete: () => requireFileStoreAction(requesterFrom(req), 'delete') }) })
  } catch (error) { sendChatError(res, error) }
})

/** POST /api/codex-chat/linked-files/describe — `{ links }`: names and places of links in the requester's own store (the profile editor). */
router.post('/linked-files/describe', requireChatAccess, (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: describeLinkedFiles(requireFileStoreOwner(requesterFrom(req)), normalizeLinkedFiles(req.body?.links), 'profile') })
  } catch (error) { sendChatError(res, error) }
})

/**
 * POST /api/codex-chat/threads/:threadId/lorebooks — `{ name }`: a new empty account book (`로어북/<name>/`), linked to
 * this chat and made the book save_lore writes to.
 */
router.post('/threads/:threadId/lorebooks', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  try {
    if (!CodexChatStore.findThread(threadId, getRequesterAccountId(req))) throw new LorebookError('채팅을 찾을 수 없어.', 404)
    res.status(201).json({ success: true, data: OwnedLorebookStore.createForThread(threadId, req.body?.name) })
  } catch (error) { sendChatError(res, error) }
})

/**
 * GET /api/codex-chat/threads/:threadId/lorebooks — the context tab's books: the chat's own book (null until its
 * first entry), the account books linked to this chat, and the books the profile (a room: every member) brings.
 */
router.get('/threads/:threadId/lorebooks', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  try {
    const thread = CodexChatStore.findThread(threadId, getRequesterAccountId(req))
    if (!thread) throw new LorebookError('채팅을 찾을 수 없어.', 404)
    const profileIds = thread.kind === 'group' ? ChatGroupStore.members(threadId).map((member) => member.profile_id) : thread.profile_id ? [thread.profile_id] : []
    const profiles = profileIds.flatMap((id) => ChatProfileStore.find(id) ?? [])
    res.json({ success: true, data: threadLorebooks(thread, profiles) })
  } catch (error) { sendChatError(res, error) }
})

/** PUT /api/codex-chat/threads/:threadId/lorebook — `{ entries }`: the chat's own book (made with its first entry; null once emptied). */
router.put('/threads/:threadId/lorebook', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  const entries = (req.body as { entries?: unknown } | undefined)?.entries
  if (!Array.isArray(entries)) { sendRouteBadRequest(res, 'entries must be a list'); return }
  try {
    if (!CodexChatStore.findThread(threadId, getRequesterAccountId(req))) throw new LorebookError('채팅을 찾을 수 없어.', 404)
    res.json({ success: true, data: OwnedLorebookStore.saveChatBook(threadId, entries) })
  } catch (error) { sendChatError(res, error) }
})

/** Shared lorebooks. Profiles link them by id, so an edit or a re-import reaches every linked profile at once. */
router.get('/admin/lorebooks', requireAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, data: ChatLorebookStore.list() })
})

router.post('/admin/lorebooks', requireAdmin, (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { name?: unknown; entries?: unknown }
  res.status(201).json({ success: true, data: ChatLorebookStore.create(body) })
})

const lorebookUpload = multer({ storage: multer.memoryStorage(), defParamCharset: 'utf8', limits: { fileSize: CHAT_CARD_MAX_BYTES, files: 1, fields: 0, parts: 2 } }).single('file')
function receiveLorebookFile(req: Request, res: Response, next: NextFunction) {
  lorebookUpload(req, res, (error) => {
    if (error) { res.status(400).json({ success: false, error: '로어북 JSON 또는 카드 PNG 한 개를 골라줘. 최대 8MB야.' }); return }
    next()
  })
}

/** POST /admin/lorebooks/import — a new shared lorebook from a world info / lorebook JSON or a card with a book. */
router.post('/admin/lorebooks/import', requireAdmin, receiveLorebookFile, (req: Request, res: Response) => {
  try {
    if (!req.file) throw new ChatProfileError('로어북 파일을 골라줘.')
    res.status(201).json({ success: true, data: ChatLorebookStore.create(readLorebookFile(req.file.buffer, req.file.originalname)) })
  } catch (error) { sendChatError(res, error) }
})

/** POST /admin/lorebooks/:lorebookId/import — replace the entries from a newer file; the name and links stay. */
router.post('/admin/lorebooks/:lorebookId/import', requireAdmin, receiveLorebookFile, (req: Request, res: Response) => {
  const lorebookId = parseId(req.params.lorebookId)
  if (lorebookId === null) { sendRouteBadRequest(res, 'Invalid lorebook id'); return }
  try {
    if (!req.file) throw new ChatProfileError('로어북 파일을 골라줘.')
    const updated = ChatLorebookStore.update(lorebookId, { entries: readLorebookFile(req.file.buffer, req.file.originalname).entries })
    if (!updated) { res.status(404).json({ success: false, error: '로어북을 찾을 수 없어.' }); return }
    res.json({ success: true, data: updated })
  } catch (error) { sendChatError(res, error) }
})

router.put('/admin/lorebooks/:lorebookId', requireAdmin, (req: Request, res: Response) => {
  const lorebookId = parseId(req.params.lorebookId)
  if (lorebookId === null) { sendRouteBadRequest(res, 'Invalid lorebook id'); return }
  const body = (req.body ?? {}) as { name?: unknown; entries?: unknown }
  const updated = ChatLorebookStore.update(lorebookId, { name: body.name, entries: body.entries })
  if (!updated) { res.status(404).json({ success: false, error: '로어북을 찾을 수 없어.' }); return }
  res.json({ success: true, data: updated })
})

router.delete('/admin/lorebooks/:lorebookId', requireAdmin, (req: Request, res: Response) => {
  const lorebookId = parseId(req.params.lorebookId)
  if (lorebookId === null) { sendRouteBadRequest(res, 'Invalid lorebook id'); return }
  res.json({ success: true, data: { deleted: ChatLorebookStore.delete(lorebookId) } })
})

export default router
