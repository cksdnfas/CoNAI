import { requireImagesView, canRequesterViewImages } from '../middleware/imageAccess'
import fs from 'fs'
import { getUserSettingsDb } from '../database/userSettingsDb'
import multer from 'multer'
import express, { type NextFunction, type Request, type Response } from 'express'
import { ChatPageContextError } from '../services/codex-chat/chatPageContext'
import { CHAT_PAGE_TOOL_INFO } from '../mcp/tools/chatPageTools'
import { getCodexModelSuggestions } from '../services/codexGenerationOptions'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireAdmin } from '../middleware/authMiddleware'
import type { McpRequester } from '../mcp/context'
import { AUTHOR_NOTE_MAX_LENGTH, CHAT_PROFILE_DEFAULTS, ChatProfileError, ChatProfileStore, DEFAULT_CHAT_SUMMARY_PROMPT, ensureCodexProfileMigrated, type ChatProfile, type ChatProfileInput } from '../services/codex-chat/chatProfiles'
import { CHAT_SCOPES, MAX_CHAT_CAPTURE_LIMIT, loadChatSettings, updateChatSettings } from '../services/codex-chat/chatSettings'
import { ChatDiagnosticsError, exportChatDiagnostics, getChatDiagnostics, visibleContextMessages } from '../services/codex-chat/chatDiagnostics'
import { DEFAULT_CHAT_STYLE } from '../services/codex-chat/chatStyle'
import { chatExpressionGroupId, listProfileEmoticons } from '../services/codex-chat/chatEmoticons'
import { EmoticonService } from '../services/emoticonService'
import { serveThumbnailOrOriginal, streamCacheableFile, streamRangeFile } from './images/query-file-helpers'
import { ImageFileModel } from '../models/Image/ImageFileModel'
import { MediaMetadataModel } from '../models/Image/MediaMetadataModel'
import { resolveChatAccess } from '../services/codex-chat/codexChatAccess'
import { getMcpToolScope } from '../mcp/context'
import { openChatMcpBridge } from '../services/codex-chat/chatMcpBridge'
import { buildCodexInstructions, CODEX_COMPACT_TOKENS, CodexChatError, CodexChatService, type CodexChatStreamEvent } from '../services/codex-chat/codexChatService'
import { buildChatPromptPreview, estimateTokens, isSummarizing, referenceBlock, selectChatLore } from '../services/codex-chat/llmChatContext'
import { ChatLorebookStore, normalizeLorebookIds } from '../services/codex-chat/chatLorebook'
import { LorebookError, OwnedLorebookStore } from '../services/codex-chat/chatLorebookFiles'
import { loreIndexText, threadLorebooks } from '../services/codex-chat/chatLoreContext'
import { applyMerge, assertMergeDecisions, draftMerge, hasDuplicates, MergeDecisionsMissingError, previewMerge, type MergeResult } from '../services/codex-chat/chatLorebookMerge'
import { ChatSharedBlockStore, readBlockFile } from '../services/codex-chat/chatDisplayBlocks'
import { ChatToolPresetStore, readToolPresetFile } from '../services/codex-chat/chatToolPresets'
import { ModelSlotStore } from '../services/codex-chat/modelSlots'
import { buildModelUsage } from '../services/codex-chat/modelUsage'
import { effectiveModelOf, modelLabelOf } from '../services/codex-chat/chatModelRoles'
import { ChatGenerationPresetStore, readGenerationPresetFile, type ChatGenerationPresetInput } from '../services/codex-chat/chatGenerationPresets'
import { CodexChatStore, type CodexChatMessageRecord } from '../services/codex-chat/codexChatStore'
import { collectCodexChatMedia } from '../services/codex-chat/codexChatMedia'
import { CHAT_IMPORT_MAX_BYTES, ChatImportError, importChatThread } from '../services/codex-chat/chatImport'
import { ChatSummaryStore } from '../services/codex-chat/chatMemory'
import { isChatTargetReady, listChatCompletionModels } from '../services/codex-chat/llmChatCompletion'
import { LlmChatError, LlmChatService } from '../services/codex-chat/llmChatService'
import { getRequesterAccountId, getRequesterAccountType } from './requester-session-helpers'
import { sendRouteBadRequest } from './routeValidation'
import { FileStoreError, FileStoreService, fileOwnerKey, parseFileId } from '../services/fileStoreService'
import { exportChatMarkdown } from '../services/codex-chat/chatExport'
import { ExternalApiProvider } from '../models/ExternalApiProvider'
import { readLlmConnectionConfig } from '../services/llmGenerationOptions'
import { CHAT_CARD_MAX_BYTES, importChatCard, readLorebookFile } from '../services/codex-chat/chatCardImport'
import { ChatGroupStore } from '../services/codex-chat/chatGroupStore'
import { backupChatToFiles, backupDateOf, exportChatJson } from '../services/codex-chat/chatBackup'
import { activeMediaFile, chatAssetFile, chatMediaInfo, chatMediaUsage, localizeImages, rewriteStoredMessages } from '../services/codex-chat/chatCardAssets'
import { MEDIA_HASH_PATTERN, rewriteMediaLinks } from '../services/codex-chat/chatMediaLinks'
import { GroupChatService } from '../services/codex-chat/groupChatService'
import { ChatReplyError } from '../services/codex-chat/chatReplies'
import { ChatFlagError, ChatFlagStore, parseFlagIds } from '../services/codex-chat/chatFlags'
import { ChatUserProfileError, ChatUserProfileStore, type ChatUserProfile } from '../services/codex-chat/chatUserProfiles'
import { ChatAppearanceError, ChatAppearanceStore } from '../services/codex-chat/chatAppearance'
import { validateBlockData } from '../services/codex-chat/chatBlockState'
import { canSuggest, ChatSuggestError, profileWriterReady, suggestReplies, userWriterReady } from '../services/codex-chat/chatSuggestions'
import { createUploadStorage, MAX_UPLOAD_FILE_SIZE_BYTES } from '../middleware/upload'
import { downloadProfileAsset, importFileStoreProfileAsset, ingestProfileAsset, isProfileAssetHidden, profileAssetFields, resolveProfileAsset } from '../services/codex-chat/chatProfileAssets'
import chatAssetBatchesRouter from './chat-asset-batches.routes'
import { draftChatAppearance } from '../services/codex-chat/chatAppearanceDraft'
import { ChatAssetError } from '../services/codex-chat/chatAssetAccess'

const MESSAGE_MAX_LENGTH = 20000

const router = express.Router()
router.use('/admin/profiles/:profileId/asset-batches', chatAssetBatchesRouter)

// The old server-wide Codex chat settings become a "Codex" profile the first time chat is used after the upgrade.
router.use((_req: Request, _res: Response, next: NextFunction) => {
  ensureCodexProfileMigrated()
  next()
})

function requesterFrom(req: Request): McpRequester {
  return { accountId: getRequesterAccountId(req), accountType: getRequesterAccountType(req) ?? 'admin' }
}

function parseId(value: unknown) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function parseThreadId(req: Request, res: Response) {
  const threadId = parseId(req.params.threadId)
  if (threadId === null) {
    sendRouteBadRequest(res, 'Invalid thread id')
  }
  return threadId
}

/** Group rooms take their own path for sending, rewriting and stopping (false when the thread is not the caller's). */
function isGroupThread(req: Request, threadId: number) {
  return CodexChatStore.findThread(threadId, getRequesterAccountId(req))?.kind === 'group'
}

function sendChatError(res: Response, error: unknown) {
  if (error instanceof ChatDiagnosticsError || error instanceof ChatPageContextError || error instanceof CodexChatError || error instanceof LlmChatError || error instanceof FileStoreError || error instanceof ChatReplyError || error instanceof ChatSuggestError || error instanceof LorebookError) {
    res.status(error.status).json({ success: false, error: error.message })
    return
  }
  if (error instanceof ChatProfileError) {
    res.status(400).json({ success: false, error: error.message })
    return
  }
  if (error instanceof ChatFlagError || error instanceof ChatAppearanceError || error instanceof ChatUserProfileError) {
    res.status(error.status).json({ success: false, error: error.message })
    return
  }
  res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Chat failed' })
}

/** Which engines this session may chat with (chat on, plus the engine's permission key). */
function chatAccessOf(req: Request) {
  const access = resolveChatAccess(getRequesterAccountId(req))
  const enabled = loadChatSettings().enabled
  return { codex: enabled && access.codex, llm: enabled && access.llm, scopes: access.scopes }
}

function requireChatAccess(req: Request, res: Response, next: NextFunction) {
  const access = chatAccessOf(req)
  if (!access.codex && !access.llm) {
    res.status(403).json({ success: false, error: '채팅 권한이 없어.' })
    return
  }
  next()
}

/** What a chat user sees of a profile: enough to pick it and show who is talking. */
/** Changes whenever the background does, so the image URL can be cached for good. Null: no background. */
function backgroundVersionOf(profile: ChatProfile) {
  return profile.background || profile.backgroundHash ? `${profile.id}-${profile.backgroundHash?.slice(0, 8) ?? ''}-${Date.parse(profile.updatedDate) || 0}` : null
}

function toPublicProfile(profile: ChatProfile, accountId: number | null) {
  const canViewImages = canRequesterViewImages({ accountId, accountType: null })
  return {
    id: profile.id,
    name: profile.name,
    tagline: profile.tagline,
    model: effectiveModelOf(profile),
    modelLabel: modelLabelOf(profile),
    ...profileAssetFields(profile, canViewImages),
    engine: profile.engine,
    isEnabled: profile.isEnabled,
    contextTurns: profile.contextTurns,
    summaryEnabled: profile.summaryEnabled,
    maxTokens: profile.maxTokens,
    reasoningEffort: profile.reasoningEffort,
    reasoningBudgetTokens: profile.reasoningBudgetTokens,
    loreDepth: profile.loreDepth,
    authorNote: profile.authorNote,
    style: profile.style,
    expressionGroupId: canViewImages ? chatExpressionGroupId(profile) : null,
    backgroundVersion: canViewImages ? backgroundVersionOf(profile) : null,
    // The composer shows the suggestion button only when someone can answer it.
    canUsePageContext: profile.mcpEnabled && profile.mcpScopes.includes('read') && resolveChatAccess(accountId).scopes.includes('read') && (!profile.toolAllowlist || profile.toolAllowlist.includes('get_current_page')),
    suggestEnabled: canSuggest(profile, accountId),
  }
}

/** Admin view of a profile: everything but the background image itself (served by its own route). */
function toAdminProfile(profile: ChatProfile | null) {
  if (!profile) return null
  const { background: _background, ...rest } = profile
  // Whether it can write reply suggestions for a profile that links it (its model is set and its connection works).
  return { ...rest, ...profileAssetFields(profile, true), backgroundVersion: backgroundVersionOf(profile), suggestWriterReady: profileWriterReady(profile) }
}

/** GET /api/codex-chat/status — whether the chat (header key, panel, /chat) should appear, and which engines. */
router.get('/status', (req: Request, res: Response) => {
  const access = chatAccessOf(req)
  res.json({
    success: true,
    data: {
      enabled: loadChatSettings().enabled,
      canUse: access.codex || access.llm,
      codex: { canUse: access.codex },
      llm: { canUse: access.llm },
      scopes: access.scopes,
    },
  })
})

/**
 * GET /api/codex-chat/profiles — every profile (threads show their profile even when it is off or not usable here),
 * with `usable` telling which ones this session can start a chat with.
 */
router.get('/profiles', requireChatAccess, (req: Request, res: Response) => {
  const access = chatAccessOf(req)
  const accountId = getRequesterAccountId(req)
  res.json({
    success: true,
    data: ChatProfileStore.list().map((profile) => ({
      ...toPublicProfile(profile, accountId),
      usable: profile.isEnabled && (profile.engine === 'codex' ? access.codex : access.llm),
      canReadFileText: profile.mcpEnabled && profile.mcpScopes.includes('read') && access.scopes.includes('read') && (!profile.toolAllowlist || profile.toolAllowlist.includes('read_file_text')),
    })),
  })
})

/** GET /api/codex-chat/profiles/:profileId/background — the chat background image (`?v=` busts the cache). */
async function serveProfileAsset(req: Request, res: Response, kind: string) {
  const profileId = parseId(req.params.profileId)
  const profile = profileId === null ? null : ChatProfileStore.find(profileId)
  if (!profile || (kind !== 'avatar' && kind !== 'background' && kind !== 'reference')) {
    res.status(404).json({ success: false, error: '프로필 자산을 찾을 수 없어.' })
    return
  }
  const asset = resolveProfileAsset(profile, kind)
  res.setHeader('Cache-Control', 'private, no-cache')
  if (asset.state === 'hidden') {
    res.status(403).json({ success: false, code: 'hidden_by_safety_policy', error: 'This image is hidden by the current safety policy' })
  } else if (asset.state === 'missing') {
    res.status(404).json({ success: false, error: '프로필 자산을 찾을 수 없어.' })
  } else if (asset.state === 'legacy') {
    res.setHeader('Content-Type', asset.mimeType)
    res.send(asset.buffer)
  } else {
    await streamCacheableFile(req, res, asset.file.path, asset.file.mimeType)
  }
}

router.get('/profiles/:profileId/background', requireChatAccess, requireImagesView, asyncHandler(async (req, res) => serveProfileAsset(req, res, 'background')))

/** Only the selected profile's asset is served; the caller cannot supply an arbitrary hash. */
router.get('/profiles/:profileId/assets/:kind', requireChatAccess, requireImagesView, asyncHandler(async (req, res) => serveProfileAsset(req, res, String(req.params.kind))))

/** GET /api/codex-chat/profiles/:profileId/emoticons — keyword → image of the profile's linked emoticon groups. */
router.get('/profiles/:profileId/emoticons', requireChatAccess, requireImagesView, (req: Request, res: Response) => {
  const profileId = parseId(req.params.profileId)
  const profile = profileId === null ? null : ChatProfileStore.find(profileId)
  if (!profile) {
    res.status(404).json({ success: false, error: '프로필을 찾을 수 없어.' })
    return
  }
  res.json({ success: true, data: listProfileEmoticons(profile.style) })
})

/**
 * GET /api/codex-chat/profiles/:profileId/emoticons/:hash — the emoticon image. The shared image-view capability is required; only images of the profile's linked emoticon groups are served.
 */
router.get('/profiles/:profileId/emoticons/:compositeHash', requireChatAccess, requireImagesView, asyncHandler(async (req: Request, res: Response) => {
  const profileId = parseId(req.params.profileId)
  const profile = profileId === null ? null : ChatProfileStore.find(profileId)
  const compositeHash = String(req.params.compositeHash ?? '')
  const file = profile && !isProfileAssetHidden(compositeHash) && EmoticonService.isInGroups(compositeHash, profile.style.emoticonGroupIds) ? EmoticonService.activeFile(compositeHash) : null
  if (!file || !fs.existsSync(file.path)) {
    res.status(404).json({ success: false, error: 'Not found' })
    return
  }
  await streamCacheableFile(req, res, file.path, file.mimeType ?? 'application/octet-stream')
}))

/**
 * GET /api/codex-chat/media/:file — library media linked from chat text (`media:<hash>.<ext>`; the extension is
 * ignored). Requires images.view while retaining the existing chat safety
 * policy and without waiting for postprocessing. The id is the pixel identity, so the response is cached for good.
 */
router.get('/media/:file', requireChatAccess, requireImagesView, asyncHandler(async (req: Request, res: Response) => {
  const file = activeMediaFile(String(req.params.file ?? '').replace(/\.[a-z0-9]{2,5}$/, ''))
  if (!file) {
    res.status(404).json({ success: false, error: 'Not found' })
    return
  }
  res.setHeader('Cache-Control', 'private, no-cache')
  if (file.mimeType.startsWith('video/')) streamRangeFile(req, res, file.path, file.mimeType)
  else await streamCacheableFile(req, res, file.path, file.mimeType)
}))

/** GET /api/codex-chat/media/:hash/thumbnail — the library thumbnail (a poster frame for video and animations). */
router.get('/media/:compositeHash/thumbnail', requireChatAccess, requireImagesView, asyncHandler(async (req: Request, res: Response) => {
  const compositeHash = String(req.params.compositeHash ?? '')
  const metadata = MEDIA_HASH_PATTERN.test(compositeHash) ? MediaMetadataModel.findByHash(compositeHash) : null
  const file = metadata ? ImageFileModel.findActiveByHash(compositeHash)[0] : undefined
  if (!metadata || !file) {
    res.status(404).json({ success: false, error: 'Not found' })
    return
  }
  await serveThumbnailOrOriginal(req, res, compositeHash, metadata, file)
}))

/** GET /api/codex-chat/assets/:name — an image copied in from a character card before card media went to the library. */
router.get('/assets/:name', requireChatAccess, requireImagesView, asyncHandler(async (req: Request, res: Response) => {
  const file = chatAssetFile(String(req.params.name ?? ''))
  if (!file) {
    res.status(404).json({ success: false, error: 'Not found' })
    return
  }
  res.setHeader('Cache-Control', 'private, no-cache')
  await streamCacheableFile(req, res, file.path, file.mimeType)
}))

router.get('/threads', requireChatAccess, (req: Request, res: Response) => {
  const threads = CodexChatService.listThreads(requesterFrom(req))
  const members = ChatGroupStore.memberIdsByThread(threads.filter((thread) => thread.kind === 'group').map((thread) => thread.id))
  const previews = CodexChatStore.listPreviews(threads.map((thread) => thread.id))
  res.json({ success: true, data: threads.map((thread) => ({
    ...thread,
    ...(thread.kind === 'group' ? { member_profile_ids: members.get(thread.id) ?? [] } : {}),
    preview: previews.get(thread.id) ?? null,
    // A reply on its way (this or another tab, or one started before a reload).
    running: CodexChatService.isRunning(thread.id) || GroupChatService.isRunning(thread.id),
  })) })
})

/** PATCH /api/codex-chat/threads/:threadId/list — `{ title?, pinned?, archived? }`: the chat's place in the chat list. */
router.patch('/threads/:threadId/list', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  const body = (req.body ?? {}) as Record<string, unknown>
  const patch: { title?: string; pinned?: boolean; archived?: boolean } = {}
  if (body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.replace(/\s+/g, ' ').trim() : ''
    if (!title) { sendRouteBadRequest(res, 'title must be a non-empty string'); return }
    patch.title = title
  }
  for (const key of ['pinned', 'archived'] as const) {
    if (body[key] === undefined) continue
    if (typeof body[key] !== 'boolean') { sendRouteBadRequest(res, `${key} must be a boolean`); return }
    patch[key] = body[key] as boolean
  }
  try {
    res.json({ success: true, data: CodexChatService.updateListState(requesterFrom(req), threadId, patch) })
  } catch (error) {
    sendChatError(res, error)
  }
})

/**
 * `userProfileId` in a request body: a number, null (the plain user), or undefined when absent (new chats then take
 * the default profile). Anything else is 'invalid'.
 */
function parseUserProfileIdField(value: unknown): number | null | undefined | 'invalid' {
  if (value === undefined) return undefined
  if (value === null) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : 'invalid'
}

/** POST /api/codex-chat/threads/group — `{ profileIds, representativeId, title?, userProfileId? }`: a group room (empty, no greeting). */
router.post('/threads/group', requireChatAccess, (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    const userProfileId = parseUserProfileIdField(body.userProfileId)
    if (userProfileId === 'invalid') { sendRouteBadRequest(res, 'userProfileId must be a number or null'); return }
    const created = GroupChatService.create(requesterFrom(req), { profileIds: body.profileIds, representativeId: body.representativeId, title: body.title, userProfileId })
    ChatAppearanceStore.threadCreated(getRequesterAccountId(req), created.id)
    res.status(201).json({ success: true, data: created })
  } catch (error) {
    sendChatError(res, error)
  }
})

/** PATCH /api/codex-chat/threads/:threadId/group — representative, title, bot-to-bot chain and handed-over window. */
router.patch('/threads/:threadId/group', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    res.json({ success: true, data: GroupChatService.updateRoom(requesterFrom(req), threadId, { representativeId: body.representativeId, title: body.title, chainLimit: body.chainLimit, windowLimit: body.windowLimit, maxTokens: body.maxTokens }) })
  } catch (error) {
    sendChatError(res, error)
  }
})

router.post('/threads/:threadId/members', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  try {
    res.json({ success: true, data: GroupChatService.addMembers(requesterFrom(req), threadId, req.body?.profileIds) })
  } catch (error) {
    sendChatError(res, error)
  }
})

/** PATCH /api/codex-chat/threads/:threadId/members/:profileId — `{ maxTokens }`: this member's reply cap in the room (null follows the room, then the profile). */
router.patch('/threads/:threadId/members/:profileId', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  const profileId = parseId(req.params.profileId)
  if (threadId === null) return
  if (profileId === null) { sendRouteBadRequest(res, 'Invalid profile id'); return }
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    res.json({ success: true, data: GroupChatService.updateMember(requesterFrom(req), threadId, profileId, { maxTokens: body.maxTokens }) })
  } catch (error) {
    sendChatError(res, error)
  }
})

router.delete('/threads/:threadId/members/:profileId', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  const profileId = parseId(req.params.profileId)
  if (threadId === null) return
  if (profileId === null) { sendRouteBadRequest(res, 'Invalid profile id'); return }
  try {
    res.json({ success: true, data: GroupChatService.removeMember(requesterFrom(req), threadId, profileId) })
  } catch (error) {
    sendChatError(res, error)
  }
})

/**
 * GET /api/codex-chat/profiles/:profileId/greeting?userProfileId= — a new chat's opening before it is saved:
 * `{ index, text, userProfileId }` (index null: no greeting). POST /threads with that index keeps the same greeting.
 */
router.get('/profiles/:profileId/greeting', requireChatAccess, (req: Request, res: Response) => {
  const profileId = parseId(req.params.profileId)
  if (profileId === null) { sendRouteBadRequest(res, 'Invalid profile id'); return }
  const raw = req.query.userProfileId
  const userProfileId = parseUserProfileIdField(raw === undefined ? undefined : raw === 'null' ? null : raw)
  if (userProfileId === 'invalid') { sendRouteBadRequest(res, 'userProfileId must be a number or null'); return }
  try {
    res.json({ success: true, data: CodexChatService.previewGreeting(requesterFrom(req), profileId, userProfileId) })
  } catch (error) {
    sendChatError(res, error)
  }
})

/**
 * POST /api/codex-chat/threads — `{ profileId, userProfileId?, greetingIndex? }`: a new chat with that profile's engine
 * and persona (userProfileId absent: the default user profile, null: none; greetingIndex: the previewed greeting).
 */
router.post('/threads', requireChatAccess, (req: Request, res: Response) => {
  const profileId = parseId(req.body?.profileId)
  if (profileId === null) {
    sendRouteBadRequest(res, 'profileId is required')
    return
  }
  const userProfileId = parseUserProfileIdField(req.body?.userProfileId)
  if (userProfileId === 'invalid') { sendRouteBadRequest(res, 'userProfileId must be a number or null'); return }
  const greetingIndex = req.body?.greetingIndex
  if (greetingIndex !== undefined && greetingIndex !== null && !(Number.isSafeInteger(greetingIndex) && greetingIndex >= 0)) {
    sendRouteBadRequest(res, 'greetingIndex must be a non-negative integer or null')
    return
  }
  try {
    const created = CodexChatService.createThread(requesterFrom(req), profileId, userProfileId, greetingIndex as number | null | undefined)
    ChatAppearanceStore.threadCreated(getRequesterAccountId(req), created.id)
    res.status(201).json({ success: true, data: created })
  } catch (error) {
    sendChatError(res, error)
  }
})

/** PATCH /api/codex-chat/threads/:threadId/context — LLM chats: turn window, reply token cap and summary on/off (null follows the profile), summary text. */
router.patch('/threads/:threadId/context', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  const body = (req.body ?? {}) as Record<string, unknown>
  try {
    const { thread } = CodexChatService.getThread(requesterFrom(req), threadId)
    if (CodexChatService.isRunning(threadId)) throw new CodexChatError('이전 답변이 아직 진행 중이야.', 409)
    if (GroupChatService.isRunning(threadId)) throw new CodexChatError('이전 답변이 아직 진행 중이야.', 409)
    // The author's note applies to every kind of chat; the window and summary settings only to direct LLM chats.
    if (body.authorNote !== undefined && body.authorNote !== null && typeof body.authorNote !== 'string') {
      sendRouteBadRequest(res, 'authorNote must be a string or null')
      return
    }
    let authorNoteDepth: number | null | undefined
    if (body.authorNoteDepth !== undefined) {
      authorNoteDepth = body.authorNoteDepth === null ? null : Number(body.authorNoteDepth)
      if (authorNoteDepth !== null && (!Number.isSafeInteger(authorNoteDepth) || authorNoteDepth < 0 || authorNoteDepth > 20)) {
        sendRouteBadRequest(res, 'authorNoteDepth must be 0-20 or null')
        return
      }
    }
    // The user profile (who the user is) applies to every kind of chat; in a room its name must not read as a member's.
    const userProfileId = parseUserProfileIdField(body.userProfileId)
    if (userProfileId === 'invalid') { sendRouteBadRequest(res, 'userProfileId must be a number or null'); return }
    const windowKeys = ['contextTurns', 'summaryEnabled', 'summary', 'maxTokens'] as const
    if (body.reactionEnabled !== undefined && typeof body.reactionEnabled !== 'boolean') {
      sendRouteBadRequest(res, 'reactionEnabled must be a boolean')
      return
    }
    let reactionModelSlotId: number | null | undefined
    if (body.reactionModelSlotId !== undefined) {
      reactionModelSlotId = body.reactionModelSlotId as number | null
      if (reactionModelSlotId !== null && (typeof reactionModelSlotId !== 'number' || !Number.isSafeInteger(reactionModelSlotId) || reactionModelSlotId <= 0 || !ModelSlotStore.target(reactionModelSlotId))) {
        sendRouteBadRequest(res, '반응 모델 슬롯을 다시 골라줘.')
        return
      }
    }
    if (thread.kind === 'direct' && thread.engine === 'codex' && (body.reactionEnabled !== undefined || body.reactionModelSlotId !== undefined)) {
      sendRouteBadRequest(res, 'Codex 채팅은 완료 반응을 사용할 수 없어.')
      return
    }
    if (thread.engine !== 'llm' && windowKeys.some((key) => body[key] !== undefined)) {
      sendRouteBadRequest(res, 'Only LLM chats have context settings')
      return
    }
    // A room has its own summary switch and summary; its window and reply cap are room settings (see updateRoom).
    if (thread.kind === 'group' && (['contextTurns', 'maxTokens'] as const).some((key) => body[key] !== undefined)) {
      sendRouteBadRequest(res, 'A group room sets its window and reply cap as room settings')
      return
    }
    // Replacing or clearing the summary under a reply or a background fold would be lost or half-applied.
    if (body.summary !== undefined && (CodexChatService.isRunning(threadId) || GroupChatService.isRunning(threadId) || isSummarizing(threadId))) {
      sendChatError(res, new CodexChatError(isSummarizing(threadId) ? '요약이 아직 진행 중이야.' : '이전 답변이 아직 진행 중이야.', 409))
      return
    }
    let contextTurns: number | null | undefined
    if (body.contextTurns !== undefined) {
      contextTurns = body.contextTurns === null ? null : Number(body.contextTurns)
      if (contextTurns !== null && (!Number.isSafeInteger(contextTurns) || contextTurns < 1 || contextTurns > 200)) {
        sendRouteBadRequest(res, 'contextTurns must be 1-200 or null')
        return
      }
    }
    let maxTokens: number | null | undefined
    if (body.maxTokens !== undefined) {
      maxTokens = body.maxTokens === null ? null : Number(body.maxTokens)
      if (maxTokens !== null && (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 1_000_000)) {
        sendRouteBadRequest(res, 'maxTokens must be 1-1000000 or null')
        return
      }
    }
    if (body.summaryEnabled !== undefined && body.summaryEnabled !== null && typeof body.summaryEnabled !== 'boolean') {
      sendRouteBadRequest(res, 'summaryEnabled must be a boolean or null')
      return
    }
    if (body.summary !== undefined && body.summary !== null && typeof body.summary !== 'string') {
      sendRouteBadRequest(res, 'summary must be a string or null')
      return
    }
    // Account lorebooks linked to this chat only (the chat owner's own books).
    if (body.lorebookIds !== undefined && body.lorebookIds !== null && !Array.isArray(body.lorebookIds)) {
      sendRouteBadRequest(res, 'lorebookIds must be a list of lorebook ids or null')
      return
    }
    getUserSettingsDb().transaction(() => {
      if (userProfileId !== undefined) {
        if (thread.kind === 'group') GroupChatService.setUserProfile(requesterFrom(req), threadId, userProfileId)
        else ChatUserProfileStore.setThreadUserProfile(threadId, ChatUserProfileStore.requireOwn(getRequesterAccountId(req), userProfileId)?.id ?? null)
      }
      CodexChatStore.updateThreadContext(threadId, {
        contextTurns, maxTokens, summaryEnabled: body.summaryEnabled as boolean | null | undefined,
        reactionEnabled: body.reactionEnabled as boolean | undefined, reactionModelSlotId,
        authorNote: typeof body.authorNote === 'string' ? body.authorNote.slice(0, AUTHOR_NOTE_MAX_LENGTH) : (body.authorNote as null | undefined),
        authorNoteDepth,
      })
      if (body.lorebookIds !== undefined) OwnedLorebookStore.setThreadLinks(threadId, body.lorebookIds ?? [])
      // The whole summary at once: empty clears it, text replaces it as one plot up to where it reached.
      if (body.summary !== undefined) {
        const summary = typeof body.summary === 'string' ? body.summary.trim().slice(0, 20000) : ''
        ChatSummaryStore.replaceAll(threadId, summary || null, summary ? thread.summary_until_message_id : null)
      }
    }).immediate()
    res.json({ success: true, data: CodexChatService.getThread(requesterFrom(req), threadId).thread })
  } catch (error) {
    sendChatError(res, error)
  }
})

/** PATCH /api/codex-chat/threads/:threadId/summary-segments/:segmentId — `{ content }`: rewrite one summary segment by hand. */
router.patch('/threads/:threadId/summary-segments/:segmentId', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  const segmentId = parseId(req.params.segmentId)
  if (segmentId === null) { sendRouteBadRequest(res, 'Invalid segment id'); return }
  const content = typeof req.body?.content === 'string' ? req.body.content.trim().slice(0, 20000) : ''
  if (!content) { sendRouteBadRequest(res, 'content must be a non-empty string'); return }
  try {
    const { thread } = CodexChatService.getThread(requesterFrom(req), threadId)
    if (CodexChatService.isRunning(threadId) || GroupChatService.isRunning(threadId)) throw new CodexChatError('이전 답변이 아직 진행 중이야.', 409)
    if (isSummarizing(threadId)) throw new CodexChatError('요약이 아직 진행 중이야.', 409)
    if (!ChatSummaryStore.editSegment(threadId, segmentId, content)) throw new CodexChatError('그 요약 구간을 찾을 수 없어.', 404)
    res.json({ success: true, data: thread.kind === 'group' ? GroupChatService.getThread(requesterFrom(req), threadId) : CodexChatService.getThread(requesterFrom(req), threadId) })
  } catch (error) {
    sendChatError(res, error)
  }
})

/**
 * PATCH /api/codex-chat/threads/:threadId/blocks/:key — set a display block's values by hand (`data`: the whole
 * object) or put them back to the block's starting values (`reset: true`). Returns the thread detail.
 */
router.patch('/threads/:threadId/blocks/:key', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  const key = String(req.params.key ?? '').toLowerCase()
  const body = (req.body ?? {}) as { data?: unknown; reset?: unknown; profileId?: unknown }
  const reset = body.reset === true
  const reason = reset ? null : validateBlockData(body.data)
  if (reason) {
    sendRouteBadRequest(res, reason)
    return
  }
  const profileId = body.profileId === undefined || body.profileId === null ? undefined : Number(body.profileId)
  if (profileId !== undefined && !Number.isSafeInteger(profileId)) {
    sendRouteBadRequest(res, 'profileId must be an integer')
    return
  }
  try {
    const group = isGroupThread(req, threadId)
    if (group ? GroupChatService.isRunning(threadId) : CodexChatService.isRunning(threadId)) throw new CodexChatError('이전 답변이 아직 진행 중이야.', 409)
    CodexChatService.editBlock(requesterFrom(req), threadId, key, reset ? null : body.data as Record<string, unknown>, profileId)
    res.json({ success: true, data: group ? GroupChatService.getThread(requesterFrom(req), threadId) : CodexChatService.getThread(requesterFrom(req), threadId) })
  } catch (error) {
    sendChatError(res, error)
  }
})

/**
 * POST /api/codex-chat/threads/:threadId/suggest — a few things the user might say next, from the profile's
 * suggestion model. Generated on request only; `messageId` is the last message it was made after, so the client can
 * keep it until the chat moves on.
 */
router.post('/threads/:threadId/suggest', requireChatAccess, asyncHandler(async (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  const controller = new AbortController()
  req.on('close', () => controller.abort())
  try {
    const { thread, messages } = CodexChatService.getThread(requesterFrom(req), threadId)
    const profile = thread.profile_id ? ChatProfileStore.find(thread.profile_id) : null
    if (!profile) throw new ChatSuggestError('이 대화에는 프로필이 없어서 추천할 수 없어.', 409)
    const nameOf = (message: { speaker_profile_id: number | null }) => (message.speaker_profile_id ? ChatProfileStore.find(message.speaker_profile_id)?.name : null) ?? profile.name
    const suggestions = await suggestReplies(profile, thread, messages, nameOf, controller.signal)
    res.json({ success: true, data: { suggestions, messageId: messages.at(-1)?.id ?? null } })
  } catch (error) {
    if (controller.signal.aborted) return
    sendChatError(res, error)
  }
}))

/** POST /api/codex-chat/threads/:threadId/summarize — fold everything not yet summarized into the summary now. */
router.post('/threads/:threadId/summarize', requireChatAccess, asyncHandler(async (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  try {
    const { thread } = CodexChatService.getThread(requesterFrom(req), threadId)
    if (thread.kind === 'group') {
      await GroupChatService.summarize(requesterFrom(req), threadId)
      res.json({ success: true, data: GroupChatService.getThread(requesterFrom(req), threadId).thread })
      return
    }
    if (thread.engine !== 'llm') {
      // Codex chats: Codex folds its own memory of the chat.
      res.json({ success: true, data: await CodexChatService.compact(requesterFrom(req), threadId) })
      return
    }
    await LlmChatService.summarize(requesterFrom(req), thread)
    res.json({ success: true, data: CodexChatService.getThread(requesterFrom(req), threadId).thread })
  } catch (error) {
    sendChatError(res, error)
  }
}))

// ---- Admin: chat switch and profiles ---------------------------------------------------------------------------

router.get('/admin/settings', requireAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, data: loadChatSettings() })
})

router.put('/admin/settings', requireAdmin, (req: Request, res: Response) => {
  const { enabled, diagnostics } = req.body ?? {}
  if ((enabled === undefined && diagnostics === undefined) || (enabled !== undefined && typeof enabled !== 'boolean')
    || (diagnostics !== undefined && (!diagnostics || typeof diagnostics !== 'object' || Array.isArray(diagnostics)
      || (diagnostics.enabled !== undefined && typeof diagnostics.enabled !== 'boolean')
      || (diagnostics.captureRaw !== undefined && typeof diagnostics.captureRaw !== 'boolean')
      || (diagnostics.captureLimit !== undefined && (!Number.isSafeInteger(diagnostics.captureLimit) || diagnostics.captureLimit < 1 || diagnostics.captureLimit > MAX_CHAT_CAPTURE_LIMIT))))) {
    sendRouteBadRequest(res, '채팅 설정 값이 올바르지 않아.')
    return
  }
  res.json({ success: true, data: updateChatSettings({ enabled, diagnostics }) })
})

/** Values the profile editor fills in for a new profile, and the scopes it may offer. */
router.get('/admin/profile-defaults', requireAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, data: { ...CHAT_PROFILE_DEFAULTS, codexCompactTokens: CODEX_COMPACT_TOKENS, summaryPrompt: DEFAULT_CHAT_SUMMARY_PROMPT, scopes: CHAT_SCOPES, style: DEFAULT_CHAT_STYLE } })
})

router.get('/admin/profiles', requireAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, data: ChatProfileStore.list().map(toAdminProfile) })
})

/** A Codex profile's effort must be one its model supports (when the CLI catalog lists the model). */
async function assertCodexEffortSupported(input: ChatProfileInput) {
  if (input.engine !== 'codex' || !input.reasoningEffort) {
    return
  }
  const catalog = await getCodexModelSuggestions({ cacheOnly: true })
  const supported = catalog.models.find((entry) => (input.model ? entry.id === input.model : entry.isDefault))?.supportedReasoningEfforts
  if (supported && !supported.includes(input.reasoningEffort)) {
    throw new ChatProfileError('선택한 모델에서 지원하지 않는 추론 강도야.')
  }
}

const cardUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: CHAT_CARD_MAX_BYTES, files: 1, fields: 0, parts: 2 } }).single('file')
const assetUpload = multer({ storage: createUploadStorage(MAX_UPLOAD_FILE_SIZE_BYTES), limits: { fileSize: MAX_UPLOAD_FILE_SIZE_BYTES, files: 1, fields: 1, parts: 3 } }).single('file')

router.post('/admin/profiles/appearance-draft', requireAdmin, requireImagesView, asyncHandler(async (req, res) => {
  const controller = new AbortController()
  res.on('close', () => { if (!res.writableFinished) controller.abort() })
  try {
    if (!req.body?.profile || typeof req.body.profile !== 'object' || Array.isArray(req.body.profile)) throw new ChatProfileError('프로필 초안을 넣어줘.')
    res.json({ success: true, data: await draftChatAppearance(requesterFrom(req), req.body.profile, controller.signal) })
  } catch (error) {
    if (controller.signal.aborted) return
    if (error instanceof ChatAssetError) { res.status(error.status).json({ success: false, error: error.message }); return }
    sendChatError(res, error)
  }
}))

router.post('/admin/chat-assets/upload', requireAdmin, requireImagesView, (req, res, next) => {
  assetUpload(req, res, (error) => {
    if (error) { res.status(error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ success: false, error: '이미지 한 장을 골라줘. 최대 500MB야.' }); return }
    next()
  })
}, asyncHandler(async (req, res) => {
  try {
    if (!req.file) throw new ChatProfileError('이미지를 골라줘.')
    res.json({ success: true, data: await ingestProfileAsset(await fs.promises.readFile(req.file.path), String(req.body?.characterName ?? '')) })
  } catch (error) { sendChatError(res, error) }
  finally { if (req.file?.path) await fs.promises.unlink(req.file.path).catch(() => {}) }
}))

router.post('/admin/chat-assets/url', requireAdmin, requireImagesView, asyncHandler(async (req, res) => {
  try { res.json({ success: true, data: await downloadProfileAsset(req.body?.url, String(req.body?.characterName ?? '')) }) }
  catch (error) { sendChatError(res, error) }
}))

router.post('/admin/chat-assets/from-file-store', requireAdmin, requireImagesView, asyncHandler(async (req, res) => {
  try { res.json({ success: true, data: await importFileStoreProfileAsset(requesterFrom(req), req.body?.fileId, String(req.body?.characterName ?? '')) }) }
  catch (error) { sendChatError(res, error) }
}))
router.post('/admin/profiles/import-card', requireAdmin, (req, res, next) => {
  cardUpload(req, res, (error) => {
    if (error) { res.status(400).json({ success: false, error: 'PNG 또는 JSON 카드 한 장을 골라줘. 최대 8MB야.' }); return }
    next()
  })
}, asyncHandler(async (req, res) => {
  try {
    if (!req.file) throw new ChatProfileError('카드를 골라줘.')
    const providerName = ExternalApiProvider.findEnabledLlmOptions()[0]?.provider_name ?? ''
    res.json({ success: true, data: await importChatCard(req.file.buffer, providerName) })
  } catch (error) { sendChatError(res, error) }
}))

router.post('/admin/profiles', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  try {
    const input = (req.body ?? {}) as ChatProfileInput
    // An API LLM profile with no model of its own starts on the default slot, when there is one.
    if (input.engine !== 'codex' && !input.providerName && (input.modelSlotId === null || input.modelSlotId === undefined)) {
      const defaultSlot = ModelSlotStore.findDefault()
      if (defaultSlot) input.modelSlotId = defaultSlot.id
    }
    await assertCodexEffortSupported(input)
    ChatLorebookStore.assertProfileLinks(normalizeLorebookIds(input.lorebookIds), fileOwnerKey(getRequesterAccountId(req)))
    res.status(201).json({ success: true, data: toAdminProfile(ChatProfileStore.create(input)) })
  } catch (error) {
    sendChatError(res, error)
  }
}))

router.put('/admin/profiles/:profileId', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const profileId = parseId(req.params.profileId)
  if (profileId === null) {
    sendRouteBadRequest(res, 'Invalid profile id')
    return
  }
  try {
    const current = ChatProfileStore.find(profileId)
    if (!current) {
      res.status(404).json({ success: false, error: '프로필을 찾을 수 없어.' })
      return
    }
    const patch = (req.body ?? {}) as ChatProfileInput
    await assertCodexEffortSupported({ ...current, ...patch })
    if (patch.lorebookIds !== undefined) ChatLorebookStore.assertProfileLinks(normalizeLorebookIds(patch.lorebookIds), fileOwnerKey(getRequesterAccountId(req)), current.lorebookIds)
    res.json({ success: true, data: toAdminProfile(ChatProfileStore.update(profileId, patch)) })
  } catch (error) {
    sendChatError(res, error)
  }
}))

router.delete('/admin/profiles/:profileId', requireAdmin, (req: Request, res: Response) => {
  const profileId = parseId(req.params.profileId)
  if (profileId === null) {
    sendRouteBadRequest(res, 'Invalid profile id')
    return
  }
  res.json({ success: true, data: { deleted: ChatProfileStore.delete(profileId) } })
})

/** The requester's file store key: account and chat lorebooks live there. */
function lorebookOwner(req: Request) {
  return fileOwnerKey(getRequesterAccountId(req))
}

/**
 * GET /api/codex-chat/lorebooks — the requester's account books (with entries) and the global books (name and
 * entry count only; the admin edits those). `kind` tells them apart.
 */
router.get('/lorebooks', requireChatAccess, (req: Request, res: Response) => {
  try {
    const own = OwnedLorebookStore.list(lorebookOwner(req)).map((book) => ({ ...book, entryCount: book.entries.length }))
    const global = ChatLorebookStore.list().map(({ entries, ...book }) => ({ ...book, entries: [], entryCount: entries.length, threadId: null, folderId: null }))
    res.json({ success: true, data: [...own, ...global] })
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

/** A merge stopped for decisions: 409 with the preview, so the client can ask about each duplicate. */
function sendMergeError(res: Response, error: unknown) {
  if (error instanceof MergeDecisionsMissingError) {
    res.status(409).json({ success: false, error: error.message, data: { status: 'decisions', missing: error.missing, preview: error.preview } })
    return
  }
  sendChatError(res, error)
}

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

/** Shared display blocks (status cards). Profiles link them by id, so an edit reaches every linked profile at once. */
router.get('/admin/blocks', requireAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, data: ChatSharedBlockStore.list() })
})

router.post('/admin/blocks', requireAdmin, (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { name?: unknown; block?: unknown }
    res.status(201).json({ success: true, data: ChatSharedBlockStore.create(body) })
  } catch (error) { sendChatError(res, error) }
})

/** POST /admin/blocks/import — the parsed contents of a block JSON file (one block, an export, or an array); each becomes a shared block. */
router.post('/admin/blocks/import', requireAdmin, (req: Request, res: Response) => {
  try {
    const created = readBlockFile(req.body).map((item) => ChatSharedBlockStore.create(item))
    res.status(201).json({ success: true, data: created })
  } catch (error) { sendChatError(res, error) }
})

router.put('/admin/blocks/:blockId', requireAdmin, (req: Request, res: Response) => {
  const blockId = parseId(req.params.blockId)
  if (blockId === null) { sendRouteBadRequest(res, 'Invalid block id'); return }
  try {
    const body = (req.body ?? {}) as { name?: unknown; block?: unknown }
    const updated = ChatSharedBlockStore.update(blockId, { name: body.name, block: body.block })
    if (!updated) { res.status(404).json({ success: false, error: '표시 블록을 찾을 수 없어.' }); return }
    res.json({ success: true, data: updated })
  } catch (error) { sendChatError(res, error) }
})

router.delete('/admin/blocks/:blockId', requireAdmin, (req: Request, res: Response) => {
  const blockId = parseId(req.params.blockId)
  if (blockId === null) { sendRouteBadRequest(res, 'Invalid block id'); return }
  res.json({ success: true, data: { deleted: ChatSharedBlockStore.delete(blockId) } })
})

/** Model slots (a named connection + model). Profiles and workflow nodes reference them per role, so an edit reaches all of them. */
router.get('/admin/model-slots', requireAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, data: ModelSlotStore.list().map((slot) => ({ ...slot, ready: isChatTargetReady(slot.providerName, slot.model) })) })
})

router.post('/admin/model-slots', requireAdmin, (req: Request, res: Response) => {
  try {
    res.status(201).json({ success: true, data: ModelSlotStore.create((req.body ?? {}) as Record<string, unknown>) })
  } catch (error) { sendChatError(res, error) }
})

router.put('/admin/model-slots/:slotId', requireAdmin, (req: Request, res: Response) => {
  const slotId = parseId(req.params.slotId)
  if (slotId === null) { sendRouteBadRequest(res, 'Invalid model slot id'); return }
  try {
    const updated = ModelSlotStore.update(slotId, (req.body ?? {}) as Record<string, unknown>)
    if (!updated) { res.status(404).json({ success: false, error: '모델을 찾을 수 없어.' }); return }
    res.json({ success: true, data: updated })
  } catch (error) { sendChatError(res, error) }
})

router.post('/admin/model-slots/:slotId/default', requireAdmin, (req: Request, res: Response) => {
  const slotId = parseId(req.params.slotId)
  if (slotId === null) { sendRouteBadRequest(res, 'Invalid model slot id'); return }
  const slot = ModelSlotStore.setDefault(slotId)
  if (!slot) { res.status(404).json({ success: false, error: '모델을 찾을 수 없어.' }); return }
  res.json({ success: true, data: slot })
})

router.delete('/admin/model-slots/:slotId', requireAdmin, (req: Request, res: Response) => {
  const slotId = parseId(req.params.slotId)
  if (slotId === null) { sendRouteBadRequest(res, 'Invalid model slot id'); return }
  res.json({ success: true, data: { deleted: ModelSlotStore.delete(slotId) } })
})

/** Which profiles, slots and saved workflow nodes use each LLM connection and slot. */
router.get('/admin/model-usage', requireAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, data: buildModelUsage() })
})

/** Tool presets (MCP scopes + tool allowlist). Profiles link one by id, so an edit reaches every linked profile at once. */
router.get('/admin/tool-presets', requireAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, data: ChatToolPresetStore.list() })
})

router.post('/admin/tool-presets', requireAdmin, (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { name?: unknown; scopes?: unknown; toolAllowlist?: unknown }
    res.status(201).json({ success: true, data: ChatToolPresetStore.create(body) })
  } catch (error) { sendChatError(res, error) }
})

/** POST /admin/tool-presets/import — the parsed contents of a preset JSON file (one preset, an export, or an array); each becomes a preset. */
router.post('/admin/tool-presets/import', requireAdmin, (req: Request, res: Response) => {
  try {
    const created = readToolPresetFile(req.body).map((item) => ChatToolPresetStore.create(item))
    res.status(201).json({ success: true, data: created })
  } catch (error) { sendChatError(res, error) }
})

router.put('/admin/tool-presets/:presetId', requireAdmin, (req: Request, res: Response) => {
  const presetId = parseId(req.params.presetId)
  if (presetId === null) { sendRouteBadRequest(res, 'Invalid preset id'); return }
  try {
    const body = (req.body ?? {}) as { name?: unknown; scopes?: unknown; toolAllowlist?: unknown }
    const updated = ChatToolPresetStore.update(presetId, { name: body.name, scopes: body.scopes, toolAllowlist: body.toolAllowlist })
    if (!updated) { res.status(404).json({ success: false, error: '도구 프리셋을 찾을 수 없어.' }); return }
    res.json({ success: true, data: updated })
  } catch (error) { sendChatError(res, error) }
})

router.delete('/admin/tool-presets/:presetId', requireAdmin, (req: Request, res: Response) => {
  const presetId = parseId(req.params.presetId)
  if (presetId === null) { sendRouteBadRequest(res, 'Invalid preset id'); return }
  try {
    res.json({ success: true, data: { deleted: ChatToolPresetStore.delete(presetId) } })
  } catch (error) { sendChatError(res, error) }
})

/** Generation presets (a fixed NAI setup or ComfyUI workflow the model fills in). Profiles link them by id. */
router.get('/admin/generation-presets', requireAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, data: ChatGenerationPresetStore.list() })
})

router.post('/admin/generation-presets', requireAdmin, (req: Request, res: Response) => {
  try {
    res.status(201).json({ success: true, data: ChatGenerationPresetStore.create((req.body ?? {}) as ChatGenerationPresetInput) })
  } catch (error) { sendChatError(res, error) }
})

/** POST /admin/generation-presets/import — the parsed contents of a preset JSON file (one preset, an export, or an array). */
router.post('/admin/generation-presets/import', requireAdmin, (req: Request, res: Response) => {
  try {
    const created = readGenerationPresetFile(req.body).map((item) => ChatGenerationPresetStore.create(item))
    res.status(201).json({ success: true, data: created })
  } catch (error) { sendChatError(res, error) }
})

router.put('/admin/generation-presets/:presetId', requireAdmin, (req: Request, res: Response) => {
  const presetId = parseId(req.params.presetId)
  if (presetId === null) { sendRouteBadRequest(res, 'Invalid preset id'); return }
  try {
    const updated = ChatGenerationPresetStore.update(presetId, (req.body ?? {}) as ChatGenerationPresetInput)
    if (!updated) { res.status(404).json({ success: false, error: '생성 프리셋을 찾을 수 없어.' }); return }
    res.json({ success: true, data: updated })
  } catch (error) { sendChatError(res, error) }
})

router.delete('/admin/generation-presets/:presetId', requireAdmin, (req: Request, res: Response) => {
  const presetId = parseId(req.params.presetId)
  if (presetId === null) { sendRouteBadRequest(res, 'Invalid preset id'); return }
  try {
    res.json({ success: true, data: { deleted: ChatGenerationPresetStore.delete(presetId) } })
  } catch (error) { sendChatError(res, error) }
})

/**
 * POST /admin/chat-assets/localize — `{ texts, name?, only? }`: copy the web images and videos these texts show into the
 * image library (filed under `채팅 카드/<name>`) and return the texts pointing at the copies (the profile editor
 * applies them to its draft). `only` limits the run to those links and fetches them again even if copied before.
 * Chat messages already showing those links (greetings posted before) are updated too.
 */
router.post('/admin/chat-assets/localize', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { texts?: unknown; name?: unknown; only?: unknown }
  const texts = body.texts
  if (!Array.isArray(texts) || texts.length > 300 || !texts.every((value) => typeof value === 'string' && value.length <= 40_000)) {
    sendRouteBadRequest(res, 'texts must be up to 300 strings')
    return
  }
  const only = Array.isArray(body.only) ? body.only.filter((value): value is string => typeof value === 'string').slice(0, 100) : undefined
  try {
    const { saved, items, failed, remaining } = await localizeImages(texts as string[], { characterName: typeof body.name === 'string' ? body.name : '', only })
    res.json({
      success: true,
      data: { texts: (texts as string[]).map((value) => rewriteMediaLinks(value, saved)), saved: saved.size, items, failed, remaining, messages: rewriteStoredMessages(saved) },
    })
  } catch (error) {
    sendChatError(res, error)
  }
}))

function parseMediaHashes(req: Request, res: Response) {
  const hashes = (req.body as { hashes?: unknown } | undefined)?.hashes
  if (!Array.isArray(hashes) || hashes.length > 500 || !hashes.every((value) => typeof value === 'string')) {
    sendRouteBadRequest(res, 'hashes must be up to 500 strings')
    return null
  }
  return hashes as string[]
}

/** POST /admin/chat-media/info — `{ hashes }`: size, kind and original link of the library media a profile links. */
router.post('/admin/chat-media/info', requireAdmin, (req: Request, res: Response) => {
  const hashes = parseMediaHashes(req, res)
  if (hashes) res.json({ success: true, data: chatMediaInfo(hashes) })
})

/** POST /admin/chat-media/usage — `{ hashes }`: chat profiles and messages that show these library media. */
router.post('/admin/chat-media/usage', requireAdmin, (req: Request, res: Response) => {
  const hashes = parseMediaHashes(req, res)
  if (hashes) res.json({ success: true, data: chatMediaUsage(hashes) })
})

/** Every chat-grantable MCP tool with its scope and description, for the profile editor's tool picker. */
router.get('/admin/tools', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const bridge = await openChatMcpBridge(requesterFrom(req), [...CHAT_SCOPES])
  try {
    res.json({
      success: true,
      data: [...bridge.tools.map((tool) => ({ name: tool.function.name, description: tool.function.description ?? '', scope: getMcpToolScope(tool.function.name) })), ...CHAT_PAGE_TOOL_INFO],
    })
  } finally {
    await bridge.close()
  }
}))

/**
 * POST /admin/profiles/preview — what a (possibly unsaved) profile sends before the conversation: the leading
 * messages (or Codex developer instructions) and the tool schemas, with token estimates (calibrated per saved
 * profile once a server has reported real usage).
 */
router.post('/admin/profiles/preview', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as ChatProfileInput & { id?: unknown }
    const profileId = parseId(body.id) ?? 0
    const profile = ChatProfileStore.draft(body, profileId)
    const bridge = profile.mcpEnabled && profile.mcpScopes.length > 0
      ? await openChatMcpBridge(requesterFrom(req), profile.mcpScopes, profile.toolAllowlist, { generationPresetIds: profile.generationPresetIds })
      : null
    try {
      const tools = (bridge?.tools ?? []).filter((tool) => profile.engine === 'codex' || profile.visionEnabled || tool.function.name !== 'view_images')
      const messages = profile.engine === 'codex'
        ? [{ role: 'developer', content: buildCodexInstructions(profile) }]
        : buildChatPromptPreview(profile, tools)
      // Codex gets the lore index and the always-on entries in its first turn's reference block (no chat here: the
      // profile's global books only, as in an LLM preview).
      if (profile.engine === 'codex') {
        const lore = referenceBlock([loreIndexText(selectChatLore(profile))])
        if (lore) messages.push({ role: 'user', content: lore })
      }
      const promptTokens = estimateTokens(profileId, JSON.stringify(messages))
      const toolTokens = tools.length > 0 ? estimateTokens(profileId, JSON.stringify(tools)) : 0
      res.json({
        success: true,
        data: {
          engine: profile.engine,
          messages,
          tools: tools.map((tool) => tool.function.name),
          tokens: { prompt: promptTokens, tools: toolTokens, total: promptTokens + toolTokens },
          contextTokens: profile.engine === 'llm' ? profile.contextTokens : null,
        },
      })
    } finally {
      await bridge?.close()
    }
  } catch (error) {
    sendChatError(res, error)
  }
}))

/** Model ids an LLM connection offers (`GET {base}/models`), for the profile editor. */
router.get('/admin/models', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const providerName = typeof req.query.providerName === 'string' ? req.query.providerName : ''
  if (!providerName) {
    sendRouteBadRequest(res, 'providerName is required')
    return
  }
  try {
    res.json({ success: true, data: await listChatCompletionModels(providerName) })
  } catch (error) {
    res.status(502).json({ success: false, error: error instanceof Error ? error.message : 'Could not list models' })
  }
}))

// ---- Threads ---------------------------------------------------------------------------------------------------

router.get('/search', requireChatAccess, (req: Request, res: Response) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (!query || query.length > 200) { sendRouteBadRequest(res, '검색어는 1~200자로 입력해줘.'); return }
  res.json({ success: true, data: CodexChatStore.searchMessages(getRequesterAccountId(req), query) })
})

const chatImportUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: CHAT_IMPORT_MAX_BYTES, files: 1, fields: 0, parts: 2 } }).single('file')

/** POST /api/codex-chat/threads/import — a CoNAI chat JSON (multipart `file`) as a new chat. Returns `{ thread, notes }`. */
router.post('/threads/import', requireChatAccess, (req, res, next) => {
  chatImportUpload(req, res, (error) => {
    if (error) { res.status(400).json({ success: false, error: '대화 JSON 파일 하나를 골라줘. 최대 32MB야.' }); return }
    next()
  })
}, (req: Request, res: Response) => {
  try {
    if (!req.file) throw new ChatImportError('대화 JSON 파일을 골라줘.')
    const requester = requesterFrom(req)
    const result = importChatThread(requester, req.file.buffer, {
      direct: (profileId) => CodexChatService.createThread(requester, profileId),
      group: (profileIds, representativeId) => GroupChatService.create(requester, { profileIds, representativeId }),
    })
    ChatAppearanceStore.threadCreated(getRequesterAccountId(req), result.threadId)
    res.status(201).json({ success: true, data: { thread: CodexChatService.getThread(requester, result.threadId).thread, notes: result.notes } })
  } catch (error) {
    if (error instanceof ChatImportError) { res.status(error.status).json({ success: false, error: error.message }); return }
    sendChatError(res, error)
  }
})

/**
 * POST /api/codex-chat/threads/import-files — `{ fileIds }`: CoNAI chat JSON files from the requester's own file store
 * (a chat backup, say) as new chats, without downloading them first. Each file is reported on its own:
 * `{ fileId, name, threadId?, notes?, error? }`.
 */
router.post('/threads/import-files', requireChatAccess, (req: Request, res: Response) => {
  const raw = (req.body as { fileIds?: unknown } | undefined)?.fileIds
  let fileIds: string[]
  try {
    fileIds = Array.isArray(raw) ? [...new Set(raw.map((value) => parseFileId(value) as string))] : []
  } catch {
    sendRouteBadRequest(res, 'fileIds must be file ids')
    return
  }
  if (fileIds.length === 0 || fileIds.length > 20) { sendRouteBadRequest(res, 'fileIds must hold 1–20 files'); return }
  const requester = requesterFrom(req)
  const owner = fileOwnerKey(requester.accountId)
  const target = {
    direct: (profileId: number) => CodexChatService.createThread(requester, profileId),
    group: (profileIds: number[], representativeId: number) => GroupChatService.create(requester, { profileIds, representativeId }),
  }
  const results = fileIds.map((fileId) => {
    let name = ''
    try {
      const { entry, filePath } = FileStoreService.resolveFile(owner, fileId)
      name = entry.name
      if (entry.size > CHAT_IMPORT_MAX_BYTES) throw new ChatImportError('대화 JSON은 최대 32MB야.')
      const imported = importChatThread(requester, fs.readFileSync(filePath), target)
      ChatAppearanceStore.threadCreated(getRequesterAccountId(req), imported.threadId)
      return { fileId, name, threadId: imported.threadId, notes: imported.notes }
    } catch (error) {
      return { fileId, name, error: error instanceof Error ? error.message : String(error) }
    }
  })
  res.json({ success: true, data: { results } })
})

router.get('/threads/:threadId/export', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  const format = req.query.format ?? 'md'
  if (format !== 'md' && format !== 'json') { sendRouteBadRequest(res, '내보내기 형식은 md 또는 json이야.'); return }
  try {
    const requester = requesterFrom(req)
    if (format === 'json') {
      const file = exportChatJson(requester, threadId)
      res.setHeader('Content-Disposition', `attachment; filename="chat-${threadId}.json"`)
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Cache-Control', 'private, no-store')
      res.type('application/json').send(JSON.stringify(file, null, 2))
    } else {
      const detail = CodexChatService.getThread(requester, threadId)
      const profile = detail.thread.profile_id ? ChatProfileStore.find(detail.thread.profile_id) : null
      res.setHeader('Content-Disposition', `attachment; filename="chat-${threadId}.md"`)
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Cache-Control', 'private, no-store')
      const speakers = new Map(detail.thread.kind === 'group'
        ? [...new Set(detail.messages.map((message) => message.speaker_profile_id).filter((id): id is number => id !== null))].map((id) => [id, ChatProfileStore.find(id)?.name ?? '(나간 참가자)'] as const)
        : [])
      res.type('text/markdown').send(exportChatMarkdown(detail.thread, detail.messages, CodexChatService.listThreadMedia(requester, threadId), profile?.name ?? '어시스턴트', `${req.protocol}://${req.get('host')}`, speakers))
    }
  } catch (error) { sendChatError(res, error) }
})

router.get('/threads/:threadId/running', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  try {
    const requester = requesterFrom(req)
    const running = isGroupThread(req, threadId) ? GroupChatService.getRunning(requester, threadId) : CodexChatService.getRunning(requester, threadId)
    res.json({ success: true, data: { running, latestMessageId: CodexChatStore.latestMessageId(threadId) } })
  } catch (error) { sendChatError(res, error) }
})

/**
 * Only the last `tail` messages of a thread detail (and the media they show), with where they start and how many
 * there are in all, so a poll does not resend a long transcript; the client keeps the rest from its copy.
 */
function threadTail<T extends { messages: CodexChatMessageRecord[]; media: Record<string, unknown> }>(detail: T, tail: number) {
  if (detail.messages.length <= tail) return detail
  const messages = detail.messages.slice(-tail)
  const shown = new Set(collectCodexChatMedia(messages).map((item) => item.compositeHash))
  return { ...detail, messages, media: Object.fromEntries(Object.entries(detail.media).filter(([hash]) => shown.has(hash))), messagesFrom: messages[0].id, messageCount: detail.messages.length }
}

/** GET /api/codex-chat/threads/:threadId — the thread detail; `?tail=N` (1-500): see threadTail. */
router.get('/threads/:threadId', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  const tail = req.query.tail === undefined ? null : Number(req.query.tail)
  if (tail !== null && (!Number.isSafeInteger(tail) || tail < 1 || tail > 500)) { sendRouteBadRequest(res, 'tail must be 1-500'); return }
  try {
    const requester = requesterFrom(req)
    const detail = isGroupThread(req, threadId) ? GroupChatService.getThread(requester, threadId) : CodexChatService.getThread(requester, threadId)
    res.json({ success: true, data: tail === null ? detail : threadTail(detail, tail) })
  } catch (error) {
    sendChatError(res, error)
  }
})

/** GET /api/codex-chat/threads/:threadId/media — images the chat generated or looked up, newest first. */
router.get('/threads/:threadId/media', requireChatAccess, requireImagesView, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  try {
    res.json({ success: true, data: CodexChatService.listThreadMedia(requesterFrom(req), threadId) })
  } catch (error) {
    sendChatError(res, error)
  }
})

type ThreadLorebookOption = { action: 'delete' | 'keep' | 'merge'; targetId: number | null; decisions: unknown }

/** The `lorebook` option of a chat deletion; null when it is malformed. No option: the book goes with the chat. */
function threadLorebookOption(value: unknown): ThreadLorebookOption | null {
  if (value === undefined || value === null) return { action: 'delete', targetId: null, decisions: undefined }
  if (typeof value !== 'object' || Array.isArray(value)) return null
  const { action = 'delete', targetId, decisions } = value as Record<string, unknown>
  if (action !== 'delete' && action !== 'keep' && action !== 'merge') return null
  const target = targetId === undefined || targetId === null ? null : parseId(targetId)
  if (action === 'merge' && target === null) return null
  return { action, targetId: target, decisions }
}

/**
 * DELETE /api/codex-chat/threads/:threadId — body `{ lorebook?: { action: 'delete' | 'keep' | 'merge', targetId?,
 * decisions? } }` decides the chat's own book: `delete` (default) removes it with the chat, `keep` makes it an
 * account book first, `merge` merges it into account book `targetId` first (409 with the preview, and nothing
 * changed, while a duplicate has no decision). The book itself goes in CodexChatStore.deleteThread, after the
 * messages whose attachments would block its folder.
 */
router.delete('/threads/:threadId', requireChatAccess, asyncHandler(async (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  const body = (req.body ?? {}) as { lorebook?: unknown; backup?: unknown; backupDate?: unknown }
  const option = threadLorebookOption(body.lorebook)
  if (!option) { sendRouteBadRequest(res, 'lorebook must be { action: delete | keep | merge, targetId?, decisions? } (merge needs targetId)'); return }
  const owner = lorebookOwner(req)
  try {
    const chatBook = CodexChatStore.findThread(threadId, getRequesterAccountId(req)) ? OwnedLorebookStore.chatBookOf(threadId) : null
    if (chatBook && option.action === 'merge') assertMergeDecisions(previewMerge(chatBook.id, option.targetId as number, owner), option.decisions)
    // A backup is written before anything is removed (the book still in it); when it fails nothing is deleted.
    if (body.backup === true) backupChatToFiles(requesterFrom(req), threadId, backupDateOf(body.backupDate))
    let lorebook: { action: ThreadLorebookOption['action']; bookId: number | null; merge?: Omit<MergeResult, 'book'> } = { action: chatBook ? option.action : 'delete', bookId: null }
    if (chatBook && option.action === 'keep') {
      lorebook = { action: 'keep', bookId: OwnedLorebookStore.keepChatBook(threadId).id }
    } else if (chatBook && option.action === 'merge') {
      const { book, ...counts } = applyMerge(chatBook.id, option.targetId as number, owner, option.decisions)
      lorebook = { action: 'merge', bookId: book.id, merge: counts }
    }
    try {
      if (isGroupThread(req, threadId)) await GroupChatService.deleteThread(requesterFrom(req), threadId)
      else await CodexChatService.deleteThread(requesterFrom(req), threadId)
    } catch (error) {
      // Merged already: the chat book goes anyway, so deleting the chat again does not merge it twice.
      if (chatBook && lorebook.action === 'merge') {
        try { OwnedLorebookStore.delete(chatBook.id, owner) } catch { /* a file a message attaches keeps it; the next delete asks again */ }
      }
      throw error
    }
    ChatAppearanceStore.threadDeleted(getRequesterAccountId(req), threadId)
    res.json({ success: true, data: { lorebook } })
  } catch (error) {
    sendMergeError(res, error)
  }
}))

router.post('/threads/:threadId/interrupt', requireChatAccess, asyncHandler(async (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  try {
    if (isGroupThread(req, threadId)) await GroupChatService.stop(threadId)
    else await CodexChatService.interrupt(requesterFrom(req), threadId)
    res.json({ success: true })
  } catch (error) {
    sendChatError(res, error)
  }
}))

router.post('/threads/:threadId/clear', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  try {
    res.json({ success: true, data: isGroupThread(req, threadId) ? GroupChatService.clearThread(requesterFrom(req), threadId) : CodexChatService.clearThread(requesterFrom(req), threadId) })
  } catch (error) { sendChatError(res, error) }
})

router.get('/threads/:threadId/messages/:messageId/diagnostics', requireChatAccess, asyncHandler(async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store')
  const threadId = parseThreadId(req, res)
  const messageId = parseId(req.params.messageId)
  if (threadId === null) return
  if (messageId === null) { sendRouteBadRequest(res, '메시지를 확인해줘.'); return }
  try { res.json({ success: true, data: await getChatDiagnostics(requesterFrom(req), threadId, messageId, req.query.alternative) }) }
  catch (error) { sendChatError(res, error) }
}))

router.post('/threads/:threadId/messages/:messageId/diagnostics/export', requireChatAccess, asyncHandler(async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store')
  const threadId = parseThreadId(req, res)
  const messageId = parseId(req.params.messageId)
  if (threadId === null) return
  if (messageId === null) { sendRouteBadRequest(res, '메시지를 확인해줘.'); return }
  try { res.json({ success: true, data: await exportChatDiagnostics(requesterFrom(req), threadId, messageId, req.query.alternative ?? req.body?.alternative) }) }
  catch (error) { sendChatError(res, error) }
}))

router.post('/threads/:threadId/messages/:messageId/alternative', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  const messageId = parseId(req.params.messageId)
  if (threadId === null) return
  if (messageId === null || !Number.isSafeInteger(req.body?.index) || req.body.index < 0) {
    sendRouteBadRequest(res, '메시지와 답변 번호를 확인해줘.')
    return
  }
  try {
    if (GroupChatService.isRunning(threadId)) throw new CodexChatError('이전 답변이 아직 진행 중이야.', 409)
    if (isGroupThread(req, threadId)) {
      CodexChatService.selectAlternative(requesterFrom(req), threadId, messageId, req.body.index)
      res.json({ success: true, data: GroupChatService.getThread(requesterFrom(req), threadId) })
      return
    }
    res.json({ success: true, data: CodexChatService.selectAlternative(requesterFrom(req), threadId, messageId, req.body.index) })
  } catch (error) { sendChatError(res, error) }
})

async function rewriteMessage(req: Request, res: Response, edit: boolean) {
  const threadId = parseThreadId(req, res)
  const messageId = parseId(req.params.messageId)
  if (threadId === null) return
  if (messageId === null || (edit && (typeof req.body?.content !== 'string' || req.body.content.length > MESSAGE_MAX_LENGTH))) {
    sendRouteBadRequest(res, '메시지 내용을 확인해줘.')
    return
  }
  const content = edit ? req.body.content : undefined
  await streamChatReply(req, res, (write) => isGroupThread(req, threadId)
    ? GroupChatService.rewriteMessage(requesterFrom(req), threadId, messageId, content, write)
    : CodexChatService.rewriteMessage(requesterFrom(req), threadId, messageId, content, write))
}

/** POST /api/codex-chat/threads/:threadId/messages/:messageId/continue — carry on a cut last reply (NDJSON stream, like regenerate). */
router.post('/threads/:threadId/messages/:messageId/continue', requireChatAccess, asyncHandler(async (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  const messageId = parseId(req.params.messageId)
  if (threadId === null) return
  if (messageId === null) { sendRouteBadRequest(res, '메시지를 확인해줘.'); return }
  await streamChatReply(req, res, (write) => CodexChatService.continueReply(requesterFrom(req), threadId, messageId, write))
}))

/** PATCH /api/codex-chat/threads/:threadId/messages/:messageId/text — `{ content }`: rewrite a reply by hand. Returns the thread detail. */
router.patch('/threads/:threadId/messages/:messageId/text', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  const messageId = parseId(req.params.messageId)
  if (threadId === null) return
  if (messageId === null || typeof req.body?.content !== 'string' || req.body.content.length > MESSAGE_MAX_LENGTH) {
    sendRouteBadRequest(res, '메시지 내용을 확인해줘.')
    return
  }
  try {
    const requester = requesterFrom(req)
    res.json({ success: true, data: isGroupThread(req, threadId) ? GroupChatService.editReplyText(requester, threadId, messageId, req.body.content) : CodexChatService.editReplyText(requester, threadId, messageId, req.body.content) })
  } catch (error) { sendChatError(res, error) }
})

/**
 * POST /api/codex-chat/threads/bulk — `{ threadIds, action: archive | unarchive | delete, backup?, backupDate? }`: the
 * chat list's selection. Each chat is handled on its own and reported (`done`, `skipped` while a reply runs, or
 * `failed` with the reason); a delete with `backup` saves the chat file first and keeps the chat when that fails.
 * Deleting here takes the chat's own lorebook with it (a backup carries its entries).
 */
router.post('/threads/bulk', requireChatAccess, asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { threadIds?: unknown; action?: unknown; backup?: unknown; backupDate?: unknown }
  const threadIds = Array.isArray(body.threadIds) ? [...new Set(body.threadIds.map(Number))].filter((id) => Number.isSafeInteger(id) && id > 0) : []
  if (threadIds.length === 0 || threadIds.length > 200) { sendRouteBadRequest(res, 'threadIds must hold 1–200 chat ids'); return }
  const action = body.action
  if (action !== 'archive' && action !== 'unarchive' && action !== 'delete') { sendRouteBadRequest(res, 'action must be archive, unarchive or delete'); return }
  const requester = requesterFrom(req)
  const backupDate = backupDateOf(body.backupDate)
  const results: Array<{ threadId: number; status: 'done' | 'skipped' | 'failed'; reason?: string }> = []
  for (const threadId of threadIds) {
    try {
      if (action !== 'delete') {
        CodexChatService.updateListState(requester, threadId, { archived: action === 'archive' })
      } else {
        if (!CodexChatStore.findThread(threadId, requester.accountId)) throw new CodexChatError('채팅을 찾을 수 없어.', 404)
        if (CodexChatService.isRunning(threadId) || GroupChatService.isRunning(threadId)) {
          results.push({ threadId, status: 'skipped', reason: '답변 중' })
          continue
        }
        if (body.backup === true) backupChatToFiles(requester, threadId, backupDate)
        if (isGroupThread(req, threadId)) await GroupChatService.deleteThread(requester, threadId)
        else await CodexChatService.deleteThread(requester, threadId)
        ChatAppearanceStore.threadDeleted(getRequesterAccountId(req), threadId)
      }
      results.push({ threadId, status: 'done' })
    } catch (error) {
      results.push({ threadId, status: 'failed', reason: error instanceof Error ? error.message : String(error) })
    }
  }
  res.json({ success: true, data: { results } })
}))

/** POST /api/codex-chat/threads/:threadId/messages/:messageId/branch — a new chat with this one up to the message. Returns the new thread. */
router.post('/threads/:threadId/messages/:messageId/branch', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  const messageId = parseId(req.params.messageId)
  if (threadId === null) return
  if (messageId === null) { sendRouteBadRequest(res, '메시지를 확인해줘.'); return }
  try {
    const purpose = req.body?.purpose === 'preserve' ? 'preserve' : 'continue'
    const branch = isGroupThread(req, threadId) ? GroupChatService.branchThread(requesterFrom(req), threadId, messageId, purpose) : CodexChatService.branchThread(requesterFrom(req), threadId, messageId, purpose)
    ChatAppearanceStore.threadCreated(getRequesterAccountId(req), branch.id)
    res.status(201).json({ success: true, data: branch })
  } catch (error) { sendChatError(res, error) }
})

router.post('/threads/:threadId/messages/:messageId/regenerate', requireChatAccess, asyncHandler((req, res) => rewriteMessage(req, res, false)))
router.patch('/threads/:threadId/messages/:messageId', requireChatAccess, asyncHandler((req, res) => rewriteMessage(req, res, true)))

/**
 * A rejected operation retains its HTTP status until the first NDJSON event is accepted. Every streamed chat route
 * (send, regenerate, edit, continue; direct and room) goes through here: the server's 60 s socket timeout is lifted
 * like on the SSE routes, since a reply can stay silent for minutes (thinking, a summary it waits for).
 */
async function streamChatReply(req: Request, res: Response, run: (write: (event: CodexChatStreamEvent) => void) => Promise<unknown>) {
  res.socket?.setTimeout(0)
  res.socket?.setKeepAlive(true)
  let streaming = false
  const write = (event: CodexChatStreamEvent) => {
    if (res.destroyed || res.writableEnded) return
    if (event.type === 'done' || event.type === 'user' || event.type === 'rewind') {
      const thread = CodexChatStore.findThread(event.message.thread_id, getRequesterAccountId(req))
      if (!thread) return
      event = { ...event, message: visibleContextMessages(thread, [event.message], getRequesterAccountId(req))[0] }
    }
    if (!streaming) {
      streaming = true
      res.status(200)
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('X-Accel-Buffering', 'no')
      res.flushHeaders()
    }
    res.write(`${JSON.stringify(event)}\n`)
  }
  try {
    await run(write)
    if (!res.destroyed && !res.writableEnded) res.end()
  } catch (error) {
    if (res.destroyed || res.writableEnded) return
    if (!streaming) { sendChatError(res, error); return }
    write({ type: 'error', message: error instanceof Error ? error.message : 'Chat failed' })
    res.end()
  }
}

/**
 * POST /api/codex-chat/threads/:threadId/messages
 * Streams the turn as NDJSON (`user`, `delta`, `reasoning`, `tool`, then `done` or `error`). Closing the response
 * does not stop the turn; the reply is stored and shows up on the next thread load.
 */
router.post('/threads/:threadId/messages', requireChatAccess, asyncHandler(async (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  const text = typeof req.body?.text === 'string' ? req.body.text : ''
  if (text.length > MESSAGE_MAX_LENGTH) {
    sendRouteBadRequest(res, `Message is longer than ${MESSAGE_MAX_LENGTH} characters`)
    return
  }

  if (req.body?.pageContext != null && isGroupThread(req, threadId)) {
    sendRouteBadRequest(res, '페이지 연결은 1:1 채팅에서 사용할 수 있어.')
    return
  }
  await streamChatReply(req, res, (write) => isGroupThread(req, threadId)
    ? GroupChatService.sendMessage(requesterFrom(req), threadId, text, write, req.body?.fileIds, req.body?.flagIds, req.body?.mediaHashes, req.body?.picks, req.body?.replyToMessageId)
    : CodexChatService.sendMessage(requesterFrom(req), threadId, text, write, req.body?.fileIds, req.body?.flagIds, req.body?.picks, req.body?.mediaHashes, req.body?.replyToMessageId, req.body?.pageContext))
}))

// ---- Chat user profiles: who the account is in a chat (name, persona, avatar), one per chat ----------------------

/** A user profile with whether it can write reply suggestions (its model is set and its connection works). */
const withModelReady = (profile: ChatUserProfile) => ({ ...profile, modelReady: userWriterReady(profile) })

router.get('/user-profiles', requireChatAccess, (req: Request, res: Response) => {
  const canViewImages = canRequesterViewImages(requesterFrom(req))
  res.json({ success: true, data: ChatUserProfileStore.list(getRequesterAccountId(req)).map((profile) => withModelReady(canViewImages ? profile : { ...profile, avatar: null })) })
})

/** GET /api/codex-chat/model-options — the models a user profile can write reply suggestions with (any chat user). */
router.get('/model-options', requireChatAccess, (_req: Request, res: Response) => {
  res.json({ success: true, data: ModelSlotStore.list().map((slot) => ({ id: slot.id, name: slot.name, model: slot.model, ready: isChatTargetReady(slot.providerName, slot.model) })) })
})

router.post('/user-profiles', requireChatAccess, (req: Request, res: Response) => {
  try {
    res.status(201).json({ success: true, data: ChatUserProfileStore.create(getRequesterAccountId(req), (req.body ?? {}) as Record<string, unknown>) })
  } catch (error) { sendChatError(res, error) }
})

/** PUT /api/codex-chat/user-profiles/order — `{ ids }`: the account's user profiles in this order. */
router.put('/user-profiles/order', requireChatAccess, (req: Request, res: Response) => {
  res.json({ success: true, data: ChatUserProfileStore.reorder(getRequesterAccountId(req), parseFlagIds(req.body?.ids)) })
})

router.put('/user-profiles/:userProfileId', requireChatAccess, (req: Request, res: Response) => {
  const userProfileId = parseId(req.params.userProfileId)
  if (userProfileId === null) { sendRouteBadRequest(res, 'Invalid user profile id'); return }
  try {
    res.json({ success: true, data: ChatUserProfileStore.update(getRequesterAccountId(req), userProfileId, (req.body ?? {}) as Record<string, unknown>) })
  } catch (error) { sendChatError(res, error) }
})

router.delete('/user-profiles/:userProfileId', requireChatAccess, (req: Request, res: Response) => {
  const userProfileId = parseId(req.params.userProfileId)
  if (userProfileId === null) { sendRouteBadRequest(res, 'Invalid user profile id'); return }
  try {
    ChatUserProfileStore.delete(getRequesterAccountId(req), userProfileId)
    res.json({ success: true })
  } catch (error) { sendChatError(res, error) }
})

// ---- Chat flags: each account's own instructions, switched on per chat ----------------------------------------

router.get('/flags', requireChatAccess, (req: Request, res: Response) => {
  res.json({ success: true, data: ChatFlagStore.list(requesterFrom(req), { includeHidden: req.query.all === '1' }) })
})

router.post('/flags', requireChatAccess, (req: Request, res: Response) => {
  try {
    res.status(201).json({ success: true, data: ChatFlagStore.create(requesterFrom(req), (req.body ?? {}) as Record<string, unknown>) })
  } catch (error) { sendChatError(res, error) }
})

/** PUT /api/codex-chat/flags/order — `{ ids }`: the account's flags in this order (the order of the chat's flag tray). */
router.put('/flags/order', requireChatAccess, (req: Request, res: Response) => {
  res.json({ success: true, data: ChatFlagStore.reorder(requesterFrom(req), parseFlagIds(req.body?.ids)) })
})

router.put('/flags/:flagId', requireChatAccess, (req: Request, res: Response) => {
  const flagId = parseId(req.params.flagId)
  if (flagId === null) { sendRouteBadRequest(res, 'Invalid flag id'); return }
  try {
    res.json({ success: true, data: ChatFlagStore.update(requesterFrom(req), flagId, (req.body ?? {}) as Record<string, unknown>) })
  } catch (error) { sendChatError(res, error) }
})

router.delete('/flags/:flagId', requireChatAccess, (req: Request, res: Response) => {
  const flagId = parseId(req.params.flagId)
  if (flagId === null) { sendRouteBadRequest(res, 'Invalid flag id'); return }
  try {
    ChatFlagStore.delete(requesterFrom(req), flagId)
    res.json({ success: true })
  } catch (error) { sendChatError(res, error) }
})

/** POST /api/codex-chat/flags/:flagId/restore — a shared flag the account hid, back in its tray. */
router.post('/flags/:flagId/restore', requireChatAccess, (req: Request, res: Response) => {
  const flagId = parseId(req.params.flagId)
  if (flagId === null) { sendRouteBadRequest(res, 'Invalid flag id'); return }
  try {
    res.json({ success: true, data: ChatFlagStore.restore(requesterFrom(req), flagId) })
  } catch (error) { sendChatError(res, error) }
})

/** POST /api/codex-chat/flags/:flagId/reset — a shared flag back to the admin's text for this account. */
router.post('/flags/:flagId/reset', requireChatAccess, (req: Request, res: Response) => {
  const flagId = parseId(req.params.flagId)
  if (flagId === null) { sendRouteBadRequest(res, 'Invalid flag id'); return }
  try {
    res.json({ success: true, data: ChatFlagStore.reset(requesterFrom(req), flagId) })
  } catch (error) { sendChatError(res, error) }
})

/** PUT /api/codex-chat/threads/:threadId/flags — `{ flagIds }`: the flags switched on in this chat. */
router.put('/threads/:threadId/flags', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  if (!CodexChatStore.findThread(threadId, getRequesterAccountId(req))) { res.status(404).json({ success: false, error: '채팅을 찾을 수 없어.' }); return }
  const flags = ChatFlagStore.resolve(requesterFrom(req), parseFlagIds(req.body?.flagIds))
  ChatFlagStore.setThreadFlags(threadId, flags.map((flag) => flag.id))
  res.json({ success: true, data: { flagIds: flags.map((flag) => flag.id) } })
})

/** GET /api/codex-chat/appearance — the reader's chat appearance: slots, the default slot, and each chat's values. */
router.get('/appearance', requireChatAccess, (req: Request, res: Response) => {
  const accountId = getRequesterAccountId(req)
  res.json({ success: true, data: ChatAppearanceStore.read(accountId, CodexChatStore.listThreads(accountId).map((thread) => thread.id)) })
})

/** PUT /api/codex-chat/appearance/slots — `{ defaultSlotId, slots }`: the whole slot list; a slot without an id is new. */
router.put('/appearance/slots', requireChatAccess, (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    res.json({ success: true, data: ChatAppearanceStore.saveSlots(getRequesterAccountId(req), { defaultSlotId: body.defaultSlotId, slots: body.slots }) })
  } catch (error) { sendChatError(res, error) }
})

/** PUT /api/codex-chat/threads/:threadId/appearance — `{ appearance }`: this chat's values, or null for the defaults. */
router.put('/threads/:threadId/appearance', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  if (!CodexChatStore.findThread(threadId, getRequesterAccountId(req))) { res.status(404).json({ success: false, error: '채팅을 찾을 수 없어.' }); return }
  try {
    res.json({ success: true, data: { appearance: ChatAppearanceStore.setThread(getRequesterAccountId(req), threadId, req.body?.appearance) } })
  } catch (error) { sendChatError(res, error) }
})

export default router
