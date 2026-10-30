import { requireImagesView, canRequesterViewImages } from '../middleware/imageAccess'
import fs from 'fs'
import { getUserSettingsDb } from '../database/userSettingsDb'
import multer from 'multer'
import express, { type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { claimChatPageCommand, resolveChatPageCommand } from '../services/codex-chat/chatPageBridge'
import { ChatTaskRunner, ChatTaskStore } from '../services/codex-chat/chatTasks'
import { automationRoomKinds, chatNotifyDefault, chatUnreadCount } from '../services/codex-chat/chatRoomWake'
import { getCodexModelSuggestions } from '../services/codexGenerationOptions'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireAdmin } from '../middleware/authMiddleware'
import { AUTHOR_NOTE_MAX_LENGTH, CHAT_PROFILE_DEFAULTS, ChatProfileError, ChatProfileStore, DEFAULT_CHAT_SUMMARY_PROMPT, ensureCodexProfileMigrated, isVisionTool, type ChatProfile, type ChatProfileInput } from '../services/codex-chat/chatProfiles'
import { ChatRevisionConflict } from '../services/codex-chat/chatProfileError'
import { checkedProfileFolder, createChatProfileFolder, deleteChatProfileFolder, listChatProfileFolders, profileFolderPaths, updateChatProfileFolder } from '../services/codex-chat/chatProfileFolders'
import { CHAT_SCOPES, LORE_SELECTION_LIMITS, MAX_CHAT_CAPTURE_LIMIT, TOOL_ROUND_LIMITS, WEB_RESEARCH_ENGINES, WEB_RESEARCH_MAX_DAILY_LIMIT, loadChatSettings, updateChatSettings } from '../services/codex-chat/chatSettings'
import { exportChatDiagnostics, getChatDiagnostics, visibleContextMessages } from '../services/codex-chat/chatDiagnostics'
import { DEFAULT_CHAT_STYLE } from '../services/codex-chat/chatStyle'
import { chatExpressionGroupId, listProfileEmoticons } from '../services/codex-chat/chatEmoticons'
import { copyProfileExpressions, expressionGroupId as ownExpressionGroupId } from '../services/codex-chat/chatProfileExpressions'
import { EmoticonService } from '../services/emoticonService'
import { serveThumbnailOrOriginal, streamCacheableFile, streamRangeFile } from './images/query-file-helpers'
import { ImageFileModel } from '../models/Image/ImageFileModel'
import { MediaMetadataModel } from '../models/Image/MediaMetadataModel'
import { canUseChatProfile, resolveChatAccess, resolveChatProfileToolGrant } from '../services/codex-chat/codexChatAccess'
import { CHAT_VISION_BUILTIN_TOOLS, getMcpToolScope } from '../mcp/context'
import { openChatMcpBridge } from '../services/codex-chat/chatMcpBridge'
import { buildCodexInstructions, CodexChatError, CodexChatService, type CodexChatStreamEvent } from '../services/codex-chat/codexChatService'
import { buildChatPromptPreview, estimateTokens, isSummarizing, referenceBlock, selectChatLore } from '../services/codex-chat/llmChatContext'
import { OwnedLorebookStore } from '../services/codex-chat/chatLorebookFiles'
import { assertLinkedFiles, LinkedFileStore, normalizeLinkedFiles } from '../services/codex-chat/chatLinkedFiles'
import { ChatMinutesStore } from '../services/codex-chat/chatMinutes'
import { loreIndexText } from '../services/codex-chat/chatLoreContext'
import { deleteChatThread, type ThreadLorebookOption } from '../services/codex-chat/chatThreadDeletion'
import { ModelSlotStore } from '../services/codex-chat/modelSlots'
import { downChatProfiles } from '../services/codex-chat/chatConnectionHealth'
import { effectiveModelOf, modelLabelOf } from '../services/codex-chat/chatModelRoles'
import { CodexChatStore, type ChatThreadSummary } from '../services/codex-chat/codexChatStore'
import { attachJobResults, collectCodexChatMedia } from '../services/codex-chat/codexChatMedia'
import { CHAT_IMPORT_MAX_BYTES, ChatImportError, importChatThread } from '../services/codex-chat/chatImport'
import { ChatSummaryStore } from '../services/codex-chat/chatMemory'
import { isChatTargetReady, listChatCompletionModels } from '../services/codex-chat/llmChatCompletion'
import { LlmChatService } from '../services/codex-chat/llmChatService'
import { getRequesterAccountId } from './requester-session-helpers'
import { sendRouteBadRequest } from './routeValidation'
import { FileStoreService, fileOwnerKey, parseFileId } from '../services/fileStoreService'
import { requireFileStoreOwner } from '../services/fileStoreAccess'
import { exportChatMarkdown } from '../services/codex-chat/chatExport'
import { ExternalApiProvider } from '../models/ExternalApiProvider'
import { readLlmConnectionConfig } from '../services/llmGenerationOptions'
import { CHAT_CARD_MAX_BYTES, importChatCard } from '../services/codex-chat/chatCardImport'
import { ChatGroupStore } from '../services/codex-chat/chatGroupStore'
import { backupChatToFiles, backupDateOf, exportChatJson } from '../services/codex-chat/chatBackup'
import { activeMediaFile, chatAssetFile, chatMediaInfo, chatMediaUsage, localizeImages, rewriteStoredMessages } from '../services/codex-chat/chatCardAssets'
import { MEDIA_HASH_PATTERN, rewriteMediaLinks } from '../services/codex-chat/chatMediaLinks'
import { GroupChatService } from '../services/codex-chat/groupChatService'
import { ChatFlagStore, parseFlagIds } from '../services/codex-chat/chatFlags'
import { chatOrdersOf } from '../services/codex-chat/chatOrders'
import { runChatOrder } from '../services/codex-chat/chatOrderRunner'
import { ChatUserProfileStore, type ChatUserProfile } from '../services/codex-chat/chatUserProfiles'
import { ChatAppearanceStore } from '../services/codex-chat/chatAppearance'
import { validateBlockData } from '../services/codex-chat/chatBlockState'
import { canSuggest, ChatSuggestError, profileWriterReady, suggestReplies, userWriterReady } from '../services/codex-chat/chatSuggestions'
import { createUploadStorage, MAX_UPLOAD_FILE_SIZE_BYTES } from '../middleware/upload'
import { downloadProfileAsset, hiddenProfileAssets, importFileStoreProfileAsset, ingestProfileAsset, isProfileAssetHidden, profileAssetFields, resolveProfileAsset } from '../services/codex-chat/chatProfileAssets'
import chatAssetBatchesRouter, { chatProfileExpressionsRouter } from './chat-asset-batches.routes'
import externalMcpRouter from './external-mcp.routes'
import { draftChatAppearance } from '../services/codex-chat/chatAppearanceDraft'
import { ChatAssetError } from '../services/codex-chat/chatAssetAccess'
import { chatAccessOf, isGroupThread, parseId, parseThreadId, requesterFrom, requireChatAccess, sendChatError, sendMergeError } from './codex-chat-route-helpers'
import { CharacterLibraryError, characterId, characterSettingRow } from '../services/characterLibrary'
import { requesterPermissionKeys } from '../middleware/featureAccess'
import chatLorebooksRouter from './codex-chat-lorebooks.routes'
import chatAdminPresetsRouter from './codex-chat-admin-presets.routes'

const MESSAGE_MAX_LENGTH = 20000

const router = express.Router()

/** Mutations keep their legacy full response unless the caller opts into the normal tail contract. */
function mutationTail(req: Request, res: Response): number | undefined | null {
  if (req.query.tail === undefined) return undefined
  const tail = Number(req.query.tail)
  if (!Number.isSafeInteger(tail) || tail < 1 || tail > 500) {
    sendRouteBadRequest(res, 'tail must be 1-500')
    return null
  }
  return tail
}

function mutationDetail(req: Request, detail: ReturnType<typeof CodexChatService.getThread> | ReturnType<typeof GroupChatService.getThread>, tail: number | undefined, changed?: { messageId: number; previousContextRevision: number }) {
  if (tail === undefined) return detail
  if (!changed) return { ...detail, hasMoreBefore: detail.messagesFrom !== undefined }
  const requester = requesterFrom(req)
  const message = detail.messages.find((entry) => entry.id === changed.messageId) ?? CodexChatStore.findMessage(detail.thread.id, changed.messageId)
  if (!message) throw new CodexChatError('답변을 찾을 수 없어.', 404)
  const visible = detail.messages.some((entry) => entry.id === changed.messageId)
    ? message
    : visibleContextMessages(detail.thread, attachJobResults([message]).messages, requester.accountId)[0]
  const extraMedia = canRequesterViewImages(requester) ? Object.fromEntries(collectCodexChatMedia([visible]).map((item) => [item.compositeHash, { mimeType: item.mimeType, width: item.width, height: item.height, historyId: item.historyId, postprocessStatus: item.postprocessStatus }])) : {}
  return { ...detail, media: { ...detail.media, ...extraMedia }, hasMoreBefore: detail.messagesFrom !== undefined, changedMessage: visible, previousContextRevision: changed.previousContextRevision }
}

router.use('/admin/profiles/:profileId/asset-batches', chatAssetBatchesRouter)
router.use('/admin/external-mcp', externalMcpRouter)
router.use('/admin/profiles/:profileId/expressions', chatProfileExpressionsRouter)

// The old server-wide Codex chat settings become a "Codex" profile the first time chat is used after the upgrade.
router.use((_req: Request, _res: Response, next: NextFunction) => {
  ensureCodexProfileMigrated()
  next()
})

/** What a chat user sees of a profile: enough to pick it and show who is talking. */
/** Changes whenever the background does, so the image URL can be cached for good. Null: no background. */
function backgroundVersionOf(profile: ChatProfile) {
  return profile.background || profile.backgroundHash ? `${profile.id}-${profile.backgroundHash?.slice(0, 8) ?? ''}-${Date.parse(profile.updatedDate) || 0}` : null
}

/**
 * `canViewLibrary`: the reader may see the character library, so the library setting the profile looks like is named
 * (its folders and name); others only see the profile.
 */
function toPublicProfile(profile: ChatProfile, accountId: number | null, canViewLibrary: boolean, hidden?: ReadonlySet<string>) {
  const canViewImages = canRequesterViewImages({ accountId, accountType: null })
  const link = canViewLibrary ? profile.characterLink : null
  return {
    id: profile.id,
    name: profile.name,
    tagline: profile.tagline,
    agentEnabled: profile.agentEnabled,
    agentDescription: profile.agentDescription,
    model: effectiveModelOf(profile),
    modelLabel: modelLabelOf(profile),
    ...profileAssetFields(profile, canViewImages, hidden),
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
    suggestEnabled: canSuggest(profile, accountId),
    pageAssist: profile.pageAssist,
    characterLink: link ? { settingId: link.settingId, synced: link.synced, settingName: link.settingName, path: link.path } : null,
  }
}

/** Admin view of a profile: everything but the background image itself (served by its own route). */
function toAdminProfile(profile: ChatProfile | null, hidden?: ReadonlySet<string>, includeOwnExpression = false) {
  if (!profile) return null
  const { background: _background, characterExpressionGroupId: _characterExpressionGroupId, ...rest } = profile
  // Whether it can write reply suggestions for a profile that links it (its model is set and its connection works).
  return { ...rest, ...profileAssetFields(profile, true, hidden), backgroundVersion: backgroundVersionOf(profile), suggestWriterReady: profileWriterReady(profile),
    ...(profile.characterLink?.synced ? { expressionGroupId: profile.characterExpressionGroupId } : includeOwnExpression ? { expressionGroupId: ownExpressionGroupId(profile) } : {}) }
}

/** GET /api/codex-chat/status — whether the chat (header key, panel, /chat) should appear, and which engines. */
router.get('/status', (req: Request, res: Response) => {
  const access = chatAccessOf(req)
  res.json({
    success: true,
    data: {
      enabled: loadChatSettings().enabled,
      // The default each chat's lore auto-save follows (shown beside the chat's own switch).
      loreAutoSave: loadChatSettings().loreAutoSave,
      // The language besides English every lorebook's keywords are kept in (null: English only).
      loreKeyLanguage: loadChatSettings().loreKeyLanguage,
      canUse: access.codex || access.llm || access.claude,
      codex: { canUse: access.codex },
      llm: { canUse: access.llm },
      claude: { canUse: access.claude },
      scopes: access.scopes,
    },
  })
})

/**
 * GET /api/codex-chat/health — the usable profiles whose chat connection is down (`{ [profileId]: { reason,
 * connection, checkedAt } }`), from free checks and real requests; `?recheck=1` checks every connection again now.
 */
router.get('/health', requireChatAccess, asyncHandler(async (req: Request, res: Response) => {
  const access = chatAccessOf(req)
  const profiles = ChatProfileStore.list({ enabledOnly: true }).filter((profile) => canUseChatProfile(access, profile))
  res.json({ success: true, data: { profiles: await downChatProfiles(profiles, { force: req.query.recheck === '1' }) } })
}))

/**
 * GET /api/codex-chat/profiles — every profile (threads show their profile even when it is off or not usable here),
 * with `usable` telling which ones this session can start a chat with.
 */
router.get('/profiles', requireChatAccess, (req: Request, res: Response) => {
  const access = chatAccessOf(req)
  const accountId = getRequesterAccountId(req)
  const profiles = ChatProfileStore.list({ directory: true })
  const usable = (profile: ChatProfile) => profile.isEnabled && canUseChatProfile(access, profile)
  const paths = profileFolderPaths(profiles, usable)
  const hidden = hiddenProfileAssets(profiles)
  const canViewLibrary = requesterPermissionKeys({ accountId, accountType: null }).includes('characters.view')
  res.json({
    success: true,
    data: ChatProfileStore.mapDirectory((profile) => ({
      ...toPublicProfile(profile, accountId, canViewLibrary, hidden),
      folderId: usable(profile) ? profile.folderId : null,
      folderPath: paths.get(profile.id) ?? [],
      sortOrder: profile.sortOrder,
      usable: usable(profile),
      canReadFileText: profile.mcpEnabled && profile.mcpScopes.includes('read') && access.scopes.includes('read') && (!profile.toolAllowlist || profile.toolAllowlist.includes('read_file_text')),
      // What a reply's bar can order this character to do (`choices` only in a direct chat).
      orders: chatOrdersOf(profile, access, 'direct'),
    }), profiles),
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
  if (file.mimeType.startsWith('video/')) await streamRangeFile(req, res, file.path, file.mimeType)
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

/** Targeted list metadata, with the same projection and account predicate as the SQL directory pages. */
function threadDirectoryByIds(ids: number[], accountId: number | null): ChatThreadSummary[] {
  if (!ids.length) return []
  return getUserSettingsDb().prepare(`
    SELECT id, title, engine, profile_id, kind, pinned, archived, notify, branched_from_thread_id,
      branched_at_message_id, branch_purpose, created_date, updated_date
    FROM codex_chat_threads WHERE account_id IS ? AND id IN (${ids.map(() => '?').join(',')})
  `).all(accountId, ...ids) as ChatThreadSummary[]
}

const threadDirectoryQuery = z.object({
  ids: z.string().max(2200).regex(/^\d+(,\d+)*$/).transform((value) => value.split(',').map(Number))
    .pipe(z.array(z.number().int().positive().safe()).max(100)).optional(),
  archive: z.enum(['all', 'active', 'archived']).optional(),
  pinned: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  kind: z.enum(['direct', 'group']).optional(),
  query: z.string().max(120).optional(),
  pinned_first: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(512).optional(),
  bootstrap: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
})

/** limit/cursor select SQL pages; ids resolve only explicitly requested rooms outside those pages. */
router.get('/threads', requireChatAccess, (req: Request, res: Response) => {
  const parsed = threadDirectoryQuery.safeParse(req.query)
  if (!parsed.success) { sendRouteBadRequest(res, 'Invalid thread directory query'); return }
  const { ids, bootstrap, pinned_first: pinnedFirst, ...filters } = parsed.data
  if (ids && (filters.limit !== undefined || filters.cursor !== undefined)) { sendRouteBadRequest(res, 'Use either ids or a thread page'); return }
  const options = { ...filters, pinnedFirst }
  let page: ReturnType<typeof CodexChatStore.listThreadPage> | undefined
  let threads: ReturnType<typeof CodexChatStore.listThreads>
  try {
    if (ids) {
      threads = threadDirectoryByIds([...new Set(ids)], getRequesterAccountId(req))
    } else {
      if (options.limit !== undefined || options.cursor !== undefined) page = CodexChatStore.listThreadPage(getRequesterAccountId(req), options)
      threads = page?.threads ?? CodexChatStore.listThreads(getRequesterAccountId(req), options)
    }
  } catch (error) {
    if (error instanceof TypeError) { sendRouteBadRequest(res, error.message); return }
    throw error
  }
  const automation = automationRoomKinds(getRequesterAccountId(req))
  const automatedIds = JSON.stringify([...automation.keys()])
  const directory = page ? getUserSettingsDb().prepare(`
    SELECT EXISTS(SELECT 1 FROM codex_chat_threads WHERE account_id IS ? AND id IN (SELECT value FROM json_each(?))) AS hasAutomation,
      EXISTS(SELECT 1 FROM codex_chat_threads WHERE account_id IS ? AND archived = 1 AND id NOT IN (SELECT value FROM json_each(?))) AS hasArchivedChats,
      EXISTS(SELECT 1 FROM codex_chat_threads WHERE account_id IS ? AND archived = 1 AND id IN (SELECT value FROM json_each(?))) AS hasArchivedAutomation
  `).get(getRequesterAccountId(req), automatedIds, getRequesterAccountId(req), automatedIds, getRequesterAccountId(req), automatedIds) as { hasAutomation: number; hasArchivedChats: number; hasArchivedAutomation: number } : undefined
  // Selecting a default room must not depend on how many newer automation rooms fit on the first page.
  const defaultId = bootstrap ? (getUserSettingsDb().prepare(`
    SELECT id FROM codex_chat_threads WHERE account_id IS ? AND archived = 0 AND id NOT IN (SELECT value FROM json_each(?))
    ORDER BY updated_date DESC, id DESC LIMIT 1
  `).get(getRequesterAccountId(req), automatedIds) as { id: number } | undefined)?.id : undefined
  const defaultThread = defaultId === undefined ? undefined : threads.find((thread) => thread.id === defaultId) ?? threadDirectoryByIds([defaultId], getRequesterAccountId(req))[0]
  const enrichedThreads = defaultThread && !threads.some((thread) => thread.id === defaultId) ? [...threads, defaultThread] : threads
  const members = ChatGroupStore.memberIdsByThread(enrichedThreads.filter((thread) => thread.kind === 'group').map((thread) => thread.id))
  const previews = CodexChatStore.listPreviews(enrichedThreads.map((thread) => thread.id))
  const unread = CodexChatStore.countUnread(enrichedThreads.map((thread) => thread.id))
  const tasks = ChatTaskStore.summaries(enrichedThreads.map((thread) => thread.id))
  const summaries = enrichedThreads.map((thread) => ({
    ...thread,
    ...(thread.kind === 'group' ? { member_profile_ids: members.get(thread.id) ?? [] } : {}),
    preview: previews.get(thread.id) ?? null,
    unread_count: unread.get(thread.id) ?? 0,
    // A reply on its way (this or another tab, or one started before a reload).
    running: CodexChatService.isRunning(thread.id) || GroupChatService.isRunning(thread.id),
    task: tasks.get(thread.id) ?? null,
    // Rooms a board call, routine or workflow made for itself: the list keeps them under 자동화.
    automation: automation.get(thread.id) ?? null,
    // Whether its unread replies count on the shell badge (the room kind's default until the owner switches it).
    notify_enabled: thread.notify === null || thread.notify === undefined ? chatNotifyDefault(automation.get(thread.id)) : thread.notify === 1,
  }))
  res.json({ success: true, data: summaries.slice(0, threads.length),
    ...(page ? {
      pagination: { total: page.total, has_more: page.has_more, next_cursor: page.next_cursor },
      has_automation: directory?.hasAutomation === 1,
      has_archived_chats: directory?.hasArchivedChats === 1,
      has_archived_automation: directory?.hasArchivedAutomation === 1,
    } : {}),
    ...(bootstrap ? { default_thread: summaries.find((thread) => thread.id === defaultId) ?? null } : {}),
  })
})

/** The shell badge is an account-scoped aggregate, not the sum of whichever directory pages are loaded. */
router.get('/threads/unread-count', requireChatAccess, (req: Request, res: Response) => {
  res.json({ success: true, data: chatUnreadCount(getRequesterAccountId(req)) })
})

/** POST /api/codex-chat/threads/:threadId/read — `{ messageId }`: the owner has seen the chat up to this message. */
router.post('/threads/:threadId/read', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  const messageId = (req.body ?? {}).messageId
  if (!Number.isSafeInteger(messageId) || messageId < 1) { sendRouteBadRequest(res, 'messageId must be a positive integer'); return }
  if (!CodexChatStore.findThread(threadId, getRequesterAccountId(req))) { res.status(404).json({ success: false, error: '채팅을 찾을 수 없어.' }); return }
  CodexChatStore.markRead(threadId, messageId)
  res.json({ success: true })
})

/** GET /api/codex-chat/threads/:threadId/task — the chat's newest task (for the progress card and strip), or null. */
router.get('/threads/:threadId/task', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  if (!CodexChatStore.findThread(threadId, getRequesterAccountId(req))) { res.status(404).json({ success: false, error: '채팅을 찾을 수 없어.' }); return }
  res.json({ success: true, data: ChatTaskStore.latest(threadId) })
})

/** POST /api/codex-chat/threads/:threadId/task/:action — pause, resume or cancel the chat's running task. */
router.post('/threads/:threadId/task/:action', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  if (!CodexChatStore.findThread(threadId, getRequesterAccountId(req))) { res.status(404).json({ success: false, error: '채팅을 찾을 수 없어.' }); return }
  try {
    const action = String(req.params.action)
    const task = action === 'pause' ? ChatTaskRunner.pause(threadId) : action === 'resume' ? ChatTaskRunner.resume(threadId, req.body?.extension) : action === 'cancel' ? ChatTaskRunner.cancel(threadId) : null
    if (!task) { sendRouteBadRequest(res, 'action must be pause, resume or cancel'); return }
    res.json({ success: true, data: task })
  } catch (error) {
    res.status(409).json({ success: false, error: error instanceof Error ? error.message : '작업을 바꾸지 못했어.' })
  }
})

/** A cancelled or already-started command cannot be claimed by a delayed/reconnecting tab. */
router.post('/page-commands/:commandId/claim', requireChatAccess, (req: Request, res: Response) => {
  try {
    claimChatPageCommand(requesterFrom(req), String(req.params.commandId), req.body?.connectionId)
    res.json({ success: true })
  } catch (error) { sendChatError(res, error) }
})

/** POST /api/codex-chat/page-commands/:commandId — the connected browser tab's answer to a page operation the chat ran. */
router.post('/page-commands/:commandId', requireChatAccess, (req: Request, res: Response) => {
  try {
    resolveChatPageCommand(requesterFrom(req), String(req.params.commandId), req.body)
    res.json({ success: true })
  } catch (error) { sendChatError(res, error) }
})

/** PATCH /api/codex-chat/threads/:threadId/list — `{ title?, pinned?, archived?, notify? }`: the chat's place in the chat list. */
router.patch('/threads/:threadId/list', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  const body = (req.body ?? {}) as Record<string, unknown>
  const patch: { title?: string; pinned?: boolean; archived?: boolean; notify?: boolean } = {}
  if (body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.replace(/\s+/g, ' ').trim() : ''
    if (!title) { sendRouteBadRequest(res, 'title must be a non-empty string'); return }
    patch.title = title
  }
  for (const key of ['pinned', 'archived', 'notify'] as const) {
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
  const tail = mutationTail(req, res)
  if (tail === null) return
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    const detail = GroupChatService.updateRoom(requesterFrom(req), threadId, { representativeId: body.representativeId, title: body.title, chainLimit: body.chainLimit, windowLimit: body.windowLimit, maxTokens: body.maxTokens, judgePresetId: body.judgePresetId }, tail)
    res.json({ success: true, data: mutationDetail(req, detail, tail) })
  } catch (error) {
    sendChatError(res, error)
  }
})

router.post('/threads/:threadId/members', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  const tail = mutationTail(req, res)
  if (tail === null) return
  try {
    res.json({ success: true, data: mutationDetail(req, GroupChatService.addMembers(requesterFrom(req), threadId, req.body?.profileIds, tail), tail) })
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
  const tail = mutationTail(req, res)
  if (tail === null) return
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    res.json({ success: true, data: mutationDetail(req, GroupChatService.updateMember(requesterFrom(req), threadId, profileId, { maxTokens: body.maxTokens }, tail), tail) })
  } catch (error) {
    sendChatError(res, error)
  }
})

router.delete('/threads/:threadId/members/:profileId', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  const profileId = parseId(req.params.profileId)
  if (threadId === null) return
  if (profileId === null) { sendRouteBadRequest(res, 'Invalid profile id'); return }
  const tail = mutationTail(req, res)
  if (tail === null) return
  try {
    res.json({ success: true, data: mutationDetail(req, GroupChatService.removeMember(requesterFrom(req), threadId, profileId, tail), tail) })
  } catch (error) {
    sendChatError(res, error)
  }
})

/**
 * GET /api/codex-chat/profiles/:profileId/greeting?userProfileId= — a new chat's opening before it is saved:
 * `{ index, text, greetings, userProfileId, before, after }` (index null: no greeting).
 * `before` / `after`: filled `{ role: 'user' | 'assistant', content: string }[]` surrounding the greeting.
 * POST /threads with that index keeps the same greeting and saves the whole opening as real messages.
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
 * POST /api/codex-chat/threads — `{ profileId, userProfileId?, greetingIndex?, flagIds? }`: a new chat with that profile's engine
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
    const created = CodexChatService.createThread(requesterFrom(req), profileId, userProfileId, greetingIndex as number | null | undefined, req.body?.flagIds)
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
    const thread = CodexChatService.getThreadRecord(requesterFrom(req), threadId)
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
    const windowKeys = ['contextTurns', 'summaryEnabled', 'summary', 'maxTokens', 'minutesFolderId'] as const
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
    if (body.loreAutoSave !== undefined && body.loreAutoSave !== null && typeof body.loreAutoSave !== 'boolean') {
      sendRouteBadRequest(res, 'loreAutoSave must be a boolean or null')
      return
    }
    // Account lorebooks linked to this chat only (the chat owner's own books).
    if (body.lorebookIds !== undefined && body.lorebookIds !== null && !Array.isArray(body.lorebookIds)) {
      sendRouteBadRequest(res, 'lorebookIds must be a list of lorebook ids or null')
      return
    }
    // File store folders and text files linked to this chat ([{ id, write }]).
    if (body.linkedFiles !== undefined && body.linkedFiles !== null && !Array.isArray(body.linkedFiles)) {
      sendRouteBadRequest(res, 'linkedFiles must be a list of { id, write } or null')
      return
    }
    // The linked account book save_lore writes to (null: the chat's own book).
    if (body.loreRecordBookId !== undefined && body.loreRecordBookId !== null && !Number.isSafeInteger(body.loreRecordBookId)) {
      sendRouteBadRequest(res, 'loreRecordBookId must be a lorebook id or null')
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
        authorNoteDepth, loreAutoSave: body.loreAutoSave as boolean | null | undefined,
      })
      if (body.lorebookIds !== undefined) OwnedLorebookStore.setThreadLinks(threadId, body.lorebookIds ?? [])
      if (body.loreRecordBookId !== undefined) OwnedLorebookStore.setRecordBook(threadId, body.loreRecordBookId)
      if (body.linkedFiles !== undefined) {
        // Linking reaches the chat owner's file store: the same right the file page needs.
        requireFileStoreOwner(requesterFrom(req))
        LinkedFileStore.setThreadLinks(threadId, body.linkedFiles ?? [])
      }
      // Minutes write into the owner's file store too; set after the links, so a folder linked in the same patch counts.
      if (body.minutesFolderId !== undefined) {
        requireFileStoreOwner(requesterFrom(req))
        ChatMinutesStore.set(threadId, body.minutesFolderId)
      }
      // The whole summary at once: empty clears it, text replaces it as one plot up to where it reached.
      if (body.summary !== undefined) {
        const summary = typeof body.summary === 'string' ? body.summary.trim().slice(0, 20000) : ''
        ChatSummaryStore.replaceAll(threadId, summary || null, summary ? thread.summary_until_message_id : null)
      }
    }).immediate()
    res.json({ success: true, data: CodexChatService.getThreadRecord(requesterFrom(req), threadId) })
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
  const tail = mutationTail(req, res)
  if (tail === null) return
  try {
    const thread = CodexChatService.getThreadRecord(requesterFrom(req), threadId)
    if (CodexChatService.isRunning(threadId) || GroupChatService.isRunning(threadId)) throw new CodexChatError('이전 답변이 아직 진행 중이야.', 409)
    if (isSummarizing(threadId)) throw new CodexChatError('요약이 아직 진행 중이야.', 409)
    if (!ChatSummaryStore.editSegment(threadId, segmentId, content)) throw new CodexChatError('그 요약 구간을 찾을 수 없어.', 404)
    const detail = thread.kind === 'group' ? GroupChatService.getThread(requesterFrom(req), threadId, tail) : CodexChatService.getThread(requesterFrom(req), threadId, tail)
    res.json({ success: true, data: mutationDetail(req, detail, tail) })
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
  const tail = mutationTail(req, res)
  if (tail === null) return
  try {
    const group = isGroupThread(req, threadId)
    if (group ? GroupChatService.isRunning(threadId) : CodexChatService.isRunning(threadId)) throw new CodexChatError('이전 답변이 아직 진행 중이야.', 409)
    CodexChatService.editBlock(requesterFrom(req), threadId, key, reset ? null : body.data as Record<string, unknown>, profileId)
    const detail = group ? GroupChatService.getThread(requesterFrom(req), threadId, tail) : CodexChatService.getThread(requesterFrom(req), threadId, tail)
    res.json({ success: true, data: mutationDetail(req, detail, tail) })
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
  const onClose = () => { if (!res.writableFinished) controller.abort() }
  res.on('close', onClose)
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
  } finally {
    res.off('close', onClose)
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
  const { enabled, diagnostics, loreAutoSave, loreKeyLanguage, webResearch, piCodemode, toolRoundLimit, loreSelectionLimit } = req.body ?? {}
  if ((enabled === undefined && diagnostics === undefined && loreAutoSave === undefined && loreKeyLanguage === undefined && webResearch === undefined && piCodemode === undefined && toolRoundLimit === undefined && loreSelectionLimit === undefined) || (enabled !== undefined && typeof enabled !== 'boolean')
    || (piCodemode !== undefined && typeof piCodemode !== 'boolean')
    || (toolRoundLimit !== undefined && !(Number.isInteger(toolRoundLimit) && toolRoundLimit >= TOOL_ROUND_LIMITS.min && toolRoundLimit <= TOOL_ROUND_LIMITS.max))
    || (loreSelectionLimit !== undefined && !(Number.isInteger(loreSelectionLimit) && loreSelectionLimit >= LORE_SELECTION_LIMITS.min && loreSelectionLimit <= LORE_SELECTION_LIMITS.max))
    || (webResearch !== undefined && (!webResearch || typeof webResearch !== 'object' || Array.isArray(webResearch)
      || (webResearch.engine !== undefined && !WEB_RESEARCH_ENGINES.includes(webResearch.engine))
      || (webResearch.model !== undefined && webResearch.model !== null && typeof webResearch.model !== 'string')
      || (webResearch.dailyLimit !== undefined && webResearch.dailyLimit !== null && !(Number.isInteger(webResearch.dailyLimit) && webResearch.dailyLimit >= 1 && webResearch.dailyLimit <= WEB_RESEARCH_MAX_DAILY_LIMIT))))
    || (loreAutoSave !== undefined && typeof loreAutoSave !== 'boolean')
    || (loreKeyLanguage !== undefined && loreKeyLanguage !== null && typeof loreKeyLanguage !== 'string')
    || (diagnostics !== undefined && (!diagnostics || typeof diagnostics !== 'object' || Array.isArray(diagnostics)
      || (diagnostics.enabled !== undefined && typeof diagnostics.enabled !== 'boolean')
      || (diagnostics.captureRaw !== undefined && typeof diagnostics.captureRaw !== 'boolean')
      || (diagnostics.captureLimit !== undefined && (!Number.isSafeInteger(diagnostics.captureLimit) || diagnostics.captureLimit < 1 || diagnostics.captureLimit > MAX_CHAT_CAPTURE_LIMIT))))) {
    sendRouteBadRequest(res, '채팅 설정 값이 올바르지 않아.')
    return
  }
  res.json({ success: true, data: updateChatSettings({ enabled, diagnostics, loreAutoSave, loreKeyLanguage, webResearch, piCodemode, toolRoundLimit, loreSelectionLimit }) })
})

/**
 * Values the profile editor fills in for a new profile, and the scopes it may offer. `systemPrompt` is the chat
 * representative model's default prompt (a new profile starts with it); `summaryPrompt` is what an empty summary
 * prompt uses.
 */
router.get('/admin/profile-defaults', requireAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, data: { ...CHAT_PROFILE_DEFAULTS, systemPrompt: ModelSlotStore.routePrompt('chat'), summaryPrompt: ModelSlotStore.routePrompt('summary') || DEFAULT_CHAT_SUMMARY_PROMPT, scopes: CHAT_SCOPES, style: DEFAULT_CHAT_STYLE } })
})

function adminProfileList(options: Parameters<typeof ChatProfileStore.list>[0] = {}) {
  const profiles = ChatProfileStore.list({ ...options, admin: true })
  const hidden = hiddenProfileAssets(profiles)
  const paths = profileFolderPaths(profiles, () => true)
  const references = new Map((getUserSettingsDb().prepare('SELECT id, reference_hash FROM character_settings WHERE id IN (SELECT value FROM json_each(?))')
    .all(JSON.stringify([...new Set(profiles.flatMap((profile) => profile.characterLink ? [profile.characterLink.settingId] : []))])) as Array<{ id: number; reference_hash: string | null }>).map((row) => [row.id, row.reference_hash]))
  return ModelSlotStore.withReadSnapshot(() => profiles.map((profile) => ({
    ...toAdminProfile(profile, hidden),
    folderPath: paths.get(profile.id) ?? [],
    libraryReferenceHash: profile.characterLink ? references.get(profile.characterLink.settingId) ?? null : null,
  })))
}

router.get('/admin/profile-names', requireAdmin, (_req, res) => {
  res.json({ success: true, data: ChatProfileStore.listNames() })
})

router.get('/admin/profiles', requireAdmin, (req: Request, res: Response) => {
  try {
    if (req.query.limit === undefined) { res.json({ success: true, data: adminProfileList() }); return }
    const parsed = z.object({ limit: z.coerce.number().int().positive().safe(), offset: z.coerce.number().int().nonnegative().safe().default(0), q: z.string().default(''), folder: z.union([z.literal('root'), z.coerce.number().int().positive().safe()]).optional() }).safeParse(req.query)
    if (!parsed.success) throw new ChatProfileError('프로필 목록 범위가 올바르지 않아.')
    const { limit, offset, q, folder } = parsed.data
    const query = q.trim()
    const folderId = query ? undefined : folder === 'root' || folder === undefined ? null : checkedProfileFolder(folder)
    const total = (getUserSettingsDb().prepare(`SELECT COUNT(*) AS n FROM llm_chat_profiles WHERE ${query ? 'instr(lower(name), lower(?)) > 0' : 'folder_id IS ?'}`).get(query || folderId) as { n: number }).n
    res.json({ success: true, data: { items: adminProfileList({ folderId, query, limit, offset }), total, hasMore: offset + limit < total } })
  } catch (error) { sendChatError(res, error) }
})

router.get('/admin/profile-folders', requireAdmin, (_req, res) => {
  res.json({ success: true, data: listChatProfileFolders() })
})
router.post('/admin/profile-folders', requireAdmin, (req, res) => {
  try { res.status(201).json({ success: true, data: createChatProfileFolder(req.body) }) }
  catch (error) { sendChatError(res, error) }
})
router.put('/admin/profile-folders/:folderId', requireAdmin, (req, res) => {
  try { res.json({ success: true, data: updateChatProfileFolder(characterId(req.params.folderId), req.body) }) }
  catch (error) { sendChatError(res, error) }
})
router.delete('/admin/profile-folders/:folderId', requireAdmin, (req, res) => {
  try { res.json({ success: true, data: deleteChatProfileFolder(characterId(req.params.folderId)) }) }
  catch (error) { sendChatError(res, error) }
})

/** Read one profile without fetching the whole admin list. */
router.get('/admin/profiles/:profileId', requireAdmin, (req: Request, res: Response) => {
  const profileId = parseId(req.params.profileId)
  if (profileId === null) { sendRouteBadRequest(res, 'Invalid profile id'); return }
  const profile = ChatProfileStore.find(profileId)
  if (!profile) { res.status(404).json({ success: false, error: '프로필을 찾을 수 없어.' }); return }
  res.json({ success: true, data: toAdminProfile(profile, undefined, true) })
})

/** PUT /admin/profiles/order — `{ ids, folderId }` replaces listed positions in one folder. Legacy unscoped calls retain the folder-tree grouping. */
router.put('/admin/profiles/order', requireAdmin, (req: Request, res: Response) => {
  try {
    ChatProfileStore.reorder(parseFlagIds(req.body?.ids), req.body?.folderId === undefined ? undefined : checkedProfileFolder(req.body.folderId))
    res.json({ success: true, data: req.body?.folderId === undefined ? adminProfileList() : null })
  } catch (error) { sendChatError(res, error) }
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
const assetUpload = multer({ storage: createUploadStorage(MAX_UPLOAD_FILE_SIZE_BYTES), limits: { fileSize: MAX_UPLOAD_FILE_SIZE_BYTES, files: 1, fields: 2, parts: 4 } }).single('file')
function uploadSettingId(req: Request) {
  if (req.body?.settingId === undefined) return undefined
  if (!requesterPermissionKeys(requesterFrom(req)).includes('characters.edit')) throw new CharacterLibraryError('Permission required: characters.edit', 403)
  const id = characterId(req.body.settingId)
  characterSettingRow(id)
  return id
}

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
    const settingId = uploadSettingId(req)
    if (!req.file) throw new ChatProfileError('이미지를 골라줘.')
    res.json({ success: true, data: await ingestProfileAsset(await fs.promises.readFile(req.file.path), String(req.body?.characterName ?? ''), settingId) })
  } catch (error) { sendChatError(res, error) }
  finally { if (req.file?.path) await fs.promises.unlink(req.file.path).catch(() => {}) }
}))

router.post('/admin/chat-assets/url', requireAdmin, requireImagesView, asyncHandler(async (req, res) => {
  try { res.json({ success: true, data: await downloadProfileAsset(req.body?.url, String(req.body?.characterName ?? ''), uploadSettingId(req)) }) }
  catch (error) { sendChatError(res, error) }
}))

router.post('/admin/chat-assets/from-file-store', requireAdmin, requireImagesView, asyncHandler(async (req, res) => {
  try { res.json({ success: true, data: await importFileStoreProfileAsset(requesterFrom(req), req.body?.fileId, String(req.body?.characterName ?? ''), uploadSettingId(req)) }) }
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
    // The card starts on the chat representative model; the editor lets the admin pick another before saving.
    res.json({ success: true, data: await importChatCard(req.file.buffer, ModelSlotStore.defaultTarget() ? ModelSlotStore.routeId('chat') : null) })
  } catch (error) { sendChatError(res, error) }
}))

router.post('/admin/profiles', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  try {
    const input = (req.body ?? {}) as ChatProfileInput
    // An API LLM profile with no model of its own starts on the chat representative model, when it reaches one.
    if (input.engine !== 'codex' && input.engine !== 'claude' && !input.providerName && (input.modelSlotId === null || input.modelSlotId === undefined)) {
      if (ModelSlotStore.defaultTarget()) input.modelSlotId = ModelSlotStore.routeId('chat')
    }
    await assertCodexEffortSupported(input)
    // A copy keeps the links its source already has; anything added on top is checked as usual.
    const source = typeof req.body?.copyOf === 'number' ? ChatProfileStore.find(req.body.copyOf) : null
    if (req.body?.copyOf !== undefined && !source) {
      res.status(404).json({ success: false, error: '복사할 프로필을 찾을 수 없어.' })
      return
    }
    assertLinkedFiles(fileOwnerKey(getRequesterAccountId(req)), normalizeLinkedFiles(input.linkedFiles), source?.linkedFiles)
    // A new profile/cross-folder copy appends to its folder; a same-folder copy stays by its source.
    input.sortOrder = source && source.folderId === (input.folderId ?? null) ? source.sortOrder : ChatProfileStore.nextSortOrder(checkedProfileFolder(input.folderId))
    // A copy follows its source's link unless the draft chose its own (linked or unlinked before the first save).
    if (source && input.characterLink === undefined) input.characterLink = source.characterLink ? { settingId: source.characterLink.settingId, synced: source.characterLink.synced } : null
    const created = ChatProfileStore.create(input, source ?? undefined)
    // A synced copy shows its setting's expressions; only an own-look copy takes the source's own ones.
    res.status(201).json({ success: true, data: toAdminProfile(source && !source.characterLink?.synced && !created.characterLink?.synced ? copyProfileExpressions(source, created) : created) })
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
    const { revision, ...patch } = (req.body ?? {}) as ChatProfileInput & { revision?: unknown }
    if (revision !== undefined && typeof revision !== 'string') { sendRouteBadRequest(res, 'revision must be a string'); return }
    if (revision !== undefined && revision !== current.revision) throw new ChatRevisionConflict(current)
    await assertCodexEffortSupported({ ...current, ...patch })
    if (patch.linkedFiles !== undefined) assertLinkedFiles(fileOwnerKey(getRequesterAccountId(req)), normalizeLinkedFiles(patch.linkedFiles), current.linkedFiles)
    res.json({ success: true, data: toAdminProfile(ChatProfileStore.update(profileId, patch, undefined, { revision })) })
  } catch (error) {
    if (error instanceof ChatRevisionConflict) {
      res.status(409).json({ success: false, code: 'revision_conflict', error: error.message, data: toAdminProfile(error.current as ChatProfile) })
      return
    }
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

// Mounted here so their routes keep their original place in the match order.
router.use(chatLorebooksRouter)
router.use(chatAdminPresetsRouter)

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

/** Every chat-grantable MCP tool with its scope and description, for the profile editor's tool picker (not the ones every seeing chat has). */
router.get('/admin/tools', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  // Every tool by name: the catalog would hide all but open_tools / run_tool from the picker.
  const bridge = await openChatMcpBridge(requesterFrom(req), [...CHAT_SCOPES], null, { toolCatalog: false })
  try {
    res.json({
      success: true,
      data: [
        ...bridge.tools.filter((tool) => !CHAT_VISION_BUILTIN_TOOLS.has(tool.function.name)).map((tool) => ({ name: tool.function.name, description: tool.function.description ?? '', scope: getMcpToolScope(tool.function.name) })),
        // Picker grouping only: delegation still follows its own nonempty-grant/allowlist checks at execution.
        { name: 'call_agent', description: 'Delegate work to another usable profile agent. Results arrive in this chat; notify posts only, react also requests a reaction. Requires enabled tools and is unavailable in agent rooms, board calls and public pages.', scope: 'read' },
      ],
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
    // A draft that leaves its link alone previews with the stored one (a synced profile shows its setting's look).
    const stored = body.characterLink === undefined && profileId > 0 ? ChatProfileStore.find(profileId)?.characterLink : null
    const profile = ChatProfileStore.draft(stored ? { ...body, characterLink: { settingId: stored.settingId, synced: stored.synced } } : body, profileId)
    const { scopes, toolAllowlist } = resolveChatProfileToolGrant(profile, resolveChatAccess(requesterFrom(req).accountId))
    const bridge = scopes.length > 0
      ? await openChatMcpBridge(requesterFrom(req), scopes, toolAllowlist, { generationPresetIds: profile.generationPresetIds })
      : null
    try {
      const tools = (bridge?.tools ?? []).filter((tool) => profile.engine === 'codex' || profile.visionEnabled || !isVisionTool(tool.function.name))
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
          contextTokens: profile.engine !== 'codex' ? profile.contextTokens : null,
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

/** `tail=N` (1-500), optionally `before=messageId`: bounded messages, with current global thread state. */
router.get('/threads/:threadId', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  const tail = req.query.tail === undefined ? null : Number(req.query.tail)
  if (tail !== null && (!Number.isSafeInteger(tail) || tail < 1 || tail > 500)) { sendRouteBadRequest(res, 'tail must be 1-500'); return }
  const before = req.query.before === undefined ? null : Number(req.query.before)
  if (before !== null && (!Number.isSafeInteger(before) || before < 1 || tail === null)) { sendRouteBadRequest(res, 'before requires a positive message id and tail'); return }
  try {
    const requester = requesterFrom(req)
    // These services retain ownership/profile access checks and global block/job/group state. An older page
    // needs just one latest row for that state, not a second whole page of message bodies.
    const limit = before === null ? tail ?? undefined : 1
    const detail = isGroupThread(req, threadId) ? GroupChatService.getThread(requester, threadId, limit) : CodexChatService.getThread(requester, threadId, limit)
    if (before === null) {
      res.json({ success: true, data: { ...detail, ...(tail === null ? {} : { hasMoreBefore: detail.messages.length > 0 && CodexChatStore.hasMessagesBefore(threadId, detail.messages[0].id) }) } })
      return
    }
    const selected = CodexChatStore.listMessages(threadId, { tail: tail!, before })
    const messages = visibleContextMessages(detail.thread, attachJobResults(selected).messages, requester.accountId)
    const media = canRequesterViewImages(requester) ? Object.fromEntries(collectCodexChatMedia(messages).map((item) => [item.compositeHash, { mimeType: item.mimeType, width: item.width, height: item.height, historyId: item.historyId, postprocessStatus: item.postprocessStatus }])) : {}
    res.json({ success: true, data: { ...detail, messages, media, messagesFrom: messages[0]?.id, messageCount: CodexChatStore.messageCount(threadId), hasMoreBefore: messages.length > 0 && CodexChatStore.hasMessagesBefore(threadId, messages[0].id) } })
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
  try {
    res.json({ success: true, data: await deleteChatThread(requesterFrom(req), threadId, { lorebook: option, backup: body.backup === true, backupDate: body.backupDate }) })
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
  const tail = mutationTail(req, res)
  if (tail === null) return
  try {
    const detail = isGroupThread(req, threadId) ? GroupChatService.clearThread(requesterFrom(req), threadId, tail) : CodexChatService.clearThread(requesterFrom(req), threadId, tail)
    res.json({ success: true, data: mutationDetail(req, detail, tail) })
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
  const tail = mutationTail(req, res)
  if (tail === null) return
  try {
    if (GroupChatService.isRunning(threadId)) throw new CodexChatError('이전 답변이 아직 진행 중이야.', 409)
    const requester = requesterFrom(req)
    const previousContextRevision = CodexChatService.getThreadRecord(requester, threadId).context_revision
    if (isGroupThread(req, threadId)) {
      CodexChatService.applyAlternative(requester, threadId, messageId, req.body.index)
      const detail = GroupChatService.getThread(requester, threadId, tail)
      res.json({ success: true, data: mutationDetail(req, detail, tail, { messageId, previousContextRevision }) })
      return
    }
    const detail = CodexChatService.selectAlternative(requester, threadId, messageId, req.body.index, tail)
    res.json({ success: true, data: mutationDetail(req, detail, tail, { messageId, previousContextRevision }) })
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

/**
 * POST /api/codex-chat/threads/:threadId/messages/:messageId/order — `{ kind }`: an order from a character's reply
 * (draw this scene, draw again, voice, lore, choices), carried out on that reply without a new message. NDJSON: the
 * calls it makes (`tool`), then `done` with the reply as it is now.
 */
router.post('/threads/:threadId/messages/:messageId/order', requireChatAccess, asyncHandler(async (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  const messageId = parseId(req.params.messageId)
  if (threadId === null) return
  if (messageId === null) { sendRouteBadRequest(res, '메시지를 확인해줘.'); return }
  await streamChatReply(req, res, (write) => runChatOrder(requesterFrom(req), threadId, messageId, req.body?.kind, write))
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
  const tail = mutationTail(req, res)
  if (tail === null) return
  try {
    const requester = requesterFrom(req)
    const previousContextRevision = CodexChatService.getThreadRecord(requester, threadId).context_revision
    const detail = isGroupThread(req, threadId) ? GroupChatService.editReplyText(requester, threadId, messageId, req.body.content, tail) : CodexChatService.editReplyText(requester, threadId, messageId, req.body.content, tail)
    res.json({ success: true, data: mutationDetail(req, detail, tail, { messageId, previousContextRevision }) })
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
    : CodexChatService.sendMessage(requesterFrom(req), threadId, text, write, req.body?.fileIds, req.body?.flagIds, req.body?.picks, req.body?.mediaHashes, req.body?.replyToMessageId, req.body?.pageContext, { choice: req.body?.choice }))
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
  res.json({ success: true, data: ModelSlotStore.list({ usage: false }).filter((slot) => slot.providerType !== 'decision_typesafe').map((slot) => ({ id: slot.id, kind: slot.kind, routeKey: slot.routeKey, providerName: slot.providerName, providerLabel: slot.providerLabel, label: slot.label, model: slot.model, ready: slot.model !== '' && isChatTargetReady(slot.providerName, slot.model) })) })
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
