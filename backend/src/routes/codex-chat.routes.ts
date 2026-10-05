import fs from 'fs'
import { getUserSettingsDb } from '../database/userSettingsDb'
import multer from 'multer'
import express, { type NextFunction, type Request, type Response } from 'express'
import { getCodexModelSuggestions } from '../services/codexGenerationOptions'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireAdmin } from '../middleware/authMiddleware'
import type { McpRequester } from '../mcp/context'
import { AUTHOR_NOTE_MAX_LENGTH, CHAT_PROFILE_DEFAULTS, ChatProfileError, ChatProfileStore, DEFAULT_CHAT_SUMMARY_PROMPT, ensureCodexProfileMigrated, type ChatProfile, type ChatProfileInput } from '../services/codex-chat/chatProfiles'
import { CHAT_SCOPES, loadChatSettings, updateChatSettings } from '../services/codex-chat/chatSettings'
import { DEFAULT_CHAT_STYLE } from '../services/codex-chat/chatStyle'
import { listProfileEmoticons } from '../services/codex-chat/chatEmoticons'
import { EmoticonService } from '../services/emoticonService'
import { streamCacheableFile } from './images/query-file-helpers'
import { resolveChatAccess } from '../services/codex-chat/codexChatAccess'
import { getMcpToolScope } from '../mcp/context'
import { openChatMcpBridge } from '../services/codex-chat/chatMcpBridge'
import { buildCodexInstructions, CODEX_COMPACT_TOKENS, CodexChatError, CodexChatService, type CodexChatStreamEvent } from '../services/codex-chat/codexChatService'
import { buildChatPromptPreview, estimateTokens, fillCharacterPlaceholders } from '../services/codex-chat/llmChatContext'
import { buildLorebookText, ChatLorebookStore } from '../services/codex-chat/chatLorebook'
import { ChatSharedBlockStore, readBlockFile } from '../services/codex-chat/chatDisplayBlocks'
import { CodexChatStore } from '../services/codex-chat/codexChatStore'
import { listChatCompletionModels } from '../services/codex-chat/llmChatCompletion'
import { LlmChatError, LlmChatService } from '../services/codex-chat/llmChatService'
import { getRequesterAccountId, getRequesterAccountType } from './requester-session-helpers'
import { sendRouteBadRequest } from './routeValidation'
import { FileStoreError } from '../services/fileStoreService'
import { exportChatMarkdown } from '../services/codex-chat/chatExport'
import { ExternalApiProvider } from '../models/ExternalApiProvider'
import { readLlmConnectionConfig } from '../services/llmGenerationOptions'
import { CHAT_CARD_MAX_BYTES, importChatCard, readLorebookFile } from '../services/codex-chat/chatCardImport'
import { ChatGroupStore } from '../services/codex-chat/chatGroupStore'
import { chatAssetFile, localizeImages, rewriteImageLinks, rewriteStoredMessages } from '../services/codex-chat/chatCardAssets'
import { GroupChatService } from '../services/codex-chat/groupChatService'
import { ChatFlagError, ChatFlagStore, parseFlagIds } from '../services/codex-chat/chatFlags'
import { ChatUserProfileError, ChatUserProfileStore } from '../services/codex-chat/chatUserProfiles'
import { ChatAppearanceError, ChatAppearanceStore } from '../services/codex-chat/chatAppearance'
import { validateBlockData } from '../services/codex-chat/chatBlockState'

const MESSAGE_MAX_LENGTH = 20000

const router = express.Router()

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
  if (error instanceof CodexChatError || error instanceof LlmChatError || error instanceof FileStoreError) {
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
  return profile.background ? `${profile.id}-${Date.parse(profile.updatedDate) || 0}` : null
}

function toPublicProfile(profile: ChatProfile) {
  return {
    id: profile.id,
    name: profile.name,
    tagline: profile.tagline,
    model: profile.model || (profile.engine === 'llm' ? readLlmConnectionConfig(ExternalApiProvider.findByName(profile.providerName)?.additional_config).defaultModel ?? '' : ''),
    avatar: profile.avatar,
    engine: profile.engine,
    isEnabled: profile.isEnabled,
    contextTurns: profile.contextTurns,
    summaryEnabled: profile.summaryEnabled,
    maxTokens: profile.maxTokens,
    reasoningBudgetTokens: profile.reasoningBudgetTokens,
    loreDepth: profile.loreDepth,
    authorNote: profile.authorNote,
    style: profile.style,
    backgroundVersion: backgroundVersionOf(profile),
  }
}

/** Admin view of a profile: everything but the background image itself (served by its own route). */
function toAdminProfile(profile: ChatProfile | null) {
  if (!profile) return null
  const { background: _background, ...rest } = profile
  return { ...rest, backgroundVersion: backgroundVersionOf(profile) }
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
  res.json({
    success: true,
    data: ChatProfileStore.list().map((profile) => ({
      ...toPublicProfile(profile),
      usable: profile.isEnabled && (profile.engine === 'codex' ? access.codex : access.llm),
      canReadFileText: profile.mcpEnabled && profile.mcpScopes.includes('read') && access.scopes.includes('read') && (!profile.toolAllowlist || profile.toolAllowlist.includes('read_file_text')),
    })),
  })
})

/** GET /api/codex-chat/profiles/:profileId/background — the chat background image (`?v=` busts the cache). */
router.get('/profiles/:profileId/background', requireChatAccess, (req: Request, res: Response) => {
  const profileId = parseId(req.params.profileId)
  const match = profileId === null ? null : /^data:(image\/[a-z]+);base64,(.+)$/.exec(ChatProfileStore.find(profileId)?.background ?? '')
  if (!match) {
    res.status(404).json({ success: false, error: 'No background' })
    return
  }
  res.setHeader('Content-Type', match[1])
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
  res.send(Buffer.from(match[2], 'base64'))
})

/** GET /api/codex-chat/profiles/:profileId/emoticons — keyword → image of the profile's linked emoticon groups. */
router.get('/profiles/:profileId/emoticons', requireChatAccess, (req: Request, res: Response) => {
  const profileId = parseId(req.params.profileId)
  const profile = profileId === null ? null : ChatProfileStore.find(profileId)
  if (!profile) {
    res.status(404).json({ success: false, error: '프로필을 찾을 수 없어.' })
    return
  }
  res.json({ success: true, data: listProfileEmoticons(profile.style) })
})

/**
 * GET /api/codex-chat/profiles/:profileId/emoticons/:hash — the emoticon image. Served here (not /api/images) so chat
 * users without library access still see it; only images of the profile's linked emoticon groups are served.
 */
router.get('/profiles/:profileId/emoticons/:compositeHash', requireChatAccess, asyncHandler(async (req: Request, res: Response) => {
  const profileId = parseId(req.params.profileId)
  const profile = profileId === null ? null : ChatProfileStore.find(profileId)
  const compositeHash = String(req.params.compositeHash ?? '')
  const file = profile && EmoticonService.isInGroups(compositeHash, profile.style.emoticonGroupIds) ? EmoticonService.activeFile(compositeHash) : null
  if (!file || !fs.existsSync(file.path)) {
    res.status(404).json({ success: false, error: 'Not found' })
    return
  }
  await streamCacheableFile(req, res, file.path, file.mimeType ?? 'application/octet-stream')
}))

/** GET /api/codex-chat/assets/:name — an image copied in from a character card (content-addressed, so cached for good). */
router.get('/assets/:name', requireChatAccess, asyncHandler(async (req: Request, res: Response) => {
  const file = chatAssetFile(String(req.params.name ?? ''))
  if (!file) {
    res.status(404).json({ success: false, error: 'Not found' })
    return
  }
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
  await streamCacheableFile(req, res, file.path, file.mimeType)
}))

router.get('/threads', requireChatAccess, (req: Request, res: Response) => {
  const threads = CodexChatService.listThreads(requesterFrom(req))
  const members = ChatGroupStore.memberIdsByThread(threads.filter((thread) => thread.kind === 'group').map((thread) => thread.id))
  res.json({ success: true, data: threads.map((thread) => thread.kind === 'group' ? { ...thread, member_profile_ids: members.get(thread.id) ?? [] } : thread) })
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

/** POST /api/codex-chat/threads — `{ profileId }`: a new chat with that profile's engine and persona. */
/** POST /api/codex-chat/threads — `{ profileId, userProfileId? }` (userProfileId absent: the default user profile, null: none). */
router.post('/threads', requireChatAccess, (req: Request, res: Response) => {
  const profileId = parseId(req.body?.profileId)
  if (profileId === null) {
    sendRouteBadRequest(res, 'profileId is required')
    return
  }
  const userProfileId = parseUserProfileIdField(req.body?.userProfileId)
  if (userProfileId === 'invalid') { sendRouteBadRequest(res, 'userProfileId must be a number or null'); return }
  try {
    const created = CodexChatService.createThread(requesterFrom(req), profileId, userProfileId)
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
    if ((thread.engine !== 'llm' || thread.kind === 'group') && windowKeys.some((key) => body[key] !== undefined)) {
      sendRouteBadRequest(res, 'Only LLM chats have context settings')
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
    getUserSettingsDb().transaction(() => {
      if (userProfileId !== undefined) {
        if (thread.kind === 'group') GroupChatService.setUserProfile(requesterFrom(req), threadId, userProfileId)
        else ChatUserProfileStore.setThreadUserProfile(threadId, ChatUserProfileStore.requireOwn(getRequesterAccountId(req), userProfileId)?.id ?? null)
      }
      CodexChatStore.updateThreadContext(threadId, {
        contextTurns, maxTokens, summaryEnabled: body.summaryEnabled as boolean | null | undefined,
        authorNote: typeof body.authorNote === 'string' ? body.authorNote.slice(0, AUTHOR_NOTE_MAX_LENGTH) : (body.authorNote as null | undefined),
        authorNoteDepth,
      })
      if (body.summary !== undefined) {
        const summary = typeof body.summary === 'string' ? body.summary.trim().slice(0, 20000) : ''
        CodexChatStore.setSummary(threadId, summary || null, summary ? thread.summary_until_message_id : null)
      }
    }).immediate()
    res.json({ success: true, data: CodexChatService.getThread(requesterFrom(req), threadId).thread })
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

/** POST /api/codex-chat/threads/:threadId/summarize — fold everything not yet summarized into the summary now. */
router.post('/threads/:threadId/summarize', requireChatAccess, asyncHandler(async (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  try {
    const { thread } = CodexChatService.getThread(requesterFrom(req), threadId)
    if (thread.kind === 'group') throw new CodexChatError('그룹 방에서는 압축하지 않아. 이전 대화는 참가자가 직접 찾아봐.', 409)
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
  if (typeof req.body?.enabled !== 'boolean') {
    sendRouteBadRequest(res, 'enabled must be a boolean')
    return
  }
  res.json({ success: true, data: updateChatSettings({ enabled: req.body.enabled }) })
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
  const catalog = await getCodexModelSuggestions()
  const supported = catalog.models.find((entry) => (input.model ? entry.id === input.model : entry.isDefault))?.supportedReasoningEfforts
  if (supported && !supported.includes(input.reasoningEffort)) {
    throw new ChatProfileError('선택한 모델에서 지원하지 않는 추론 강도야.')
  }
}

const cardUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: CHAT_CARD_MAX_BYTES, files: 1, fields: 0, parts: 2 } }).single('file')
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
    await assertCodexEffortSupported(input)
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

/**
 * POST /admin/chat-assets/localize — `{ texts }`: copy the web images these texts show into CoNAI and return the texts
 * pointing at the copies (the profile editor applies them to its draft). Chat messages already showing those links
 * (greetings posted before) are updated too.
 */
router.post('/admin/chat-assets/localize', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const texts = (req.body as { texts?: unknown } | undefined)?.texts
  if (!Array.isArray(texts) || texts.length > 300 || !texts.every((value) => typeof value === 'string' && value.length <= 40_000)) {
    sendRouteBadRequest(res, 'texts must be up to 300 strings')
    return
  }
  try {
    const { saved, failed } = await localizeImages(texts as string[])
    res.json({ success: true, data: { texts: (texts as string[]).map((value) => rewriteImageLinks(value, saved)), saved: saved.size, failed, messages: rewriteStoredMessages(saved) } })
  } catch (error) {
    sendChatError(res, error)
  }
}))

/** Every chat-grantable MCP tool with its scope and description, for the profile editor's tool picker. */
router.get('/admin/tools', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const bridge = await openChatMcpBridge(requesterFrom(req), [...CHAT_SCOPES])
  try {
    res.json({
      success: true,
      data: bridge.tools.map((tool) => ({ name: tool.function.name, description: tool.function.description ?? '', scope: getMcpToolScope(tool.function.name) })),
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
      ? await openChatMcpBridge(requesterFrom(req), profile.mcpScopes, profile.toolAllowlist)
      : null
    try {
      const tools = (bridge?.tools ?? []).filter((tool) => profile.engine === 'codex' || profile.visionEnabled || tool.function.name !== 'view_images')
      const messages = profile.engine === 'codex'
        ? [{ role: 'developer', content: buildCodexInstructions(profile) }]
        : buildChatPromptPreview(profile, tools)
      if (profile.engine === 'codex') {
        const lore = buildLorebookText(profile, undefined, (text) => estimateTokens(profile.id, text), (text) => fillCharacterPlaceholders(text, profile))
        if (lore) messages.push({ role: 'user', content: `[참고 설정]\n${lore}\n[/참고 설정]` })
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

router.get('/threads/:threadId/export', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  const format = req.query.format ?? 'md'
  if (format !== 'md' && format !== 'json') { sendRouteBadRequest(res, '내보내기 형식은 md 또는 json이야.'); return }
  try {
    const requester = requesterFrom(req)
    const detail = CodexChatService.getThread(requester, threadId)
    const profile = detail.thread.profile_id ? ChatProfileStore.find(detail.thread.profile_id) : null
    res.setHeader('Content-Disposition', `attachment; filename="chat-${threadId}.${format}"`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'private, no-store')
    if (format === 'json') {
      res.type('application/json').send(JSON.stringify({ format: 'conai-chat', version: 1, exportedAt: new Date().toISOString(), profileName: profile?.name ?? null, thread: detail.thread, messages: detail.messages, media: detail.media }, null, 2))
    } else {
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

router.get('/threads/:threadId', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  try {
    const requester = requesterFrom(req)
    res.json({ success: true, data: isGroupThread(req, threadId) ? GroupChatService.getThread(requester, threadId) : CodexChatService.getThread(requester, threadId) })
  } catch (error) {
    sendChatError(res, error)
  }
})

/** GET /api/codex-chat/threads/:threadId/media — images the chat generated or looked up, newest first. */
router.get('/threads/:threadId/media', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  try {
    res.json({ success: true, data: CodexChatService.listThreadMedia(requesterFrom(req), threadId) })
  } catch (error) {
    sendChatError(res, error)
  }
})

router.delete('/threads/:threadId', requireChatAccess, asyncHandler(async (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  try {
    if (isGroupThread(req, threadId)) await GroupChatService.deleteThread(requesterFrom(req), threadId)
    else await CodexChatService.deleteThread(requesterFrom(req), threadId)
    ChatAppearanceStore.threadDeleted(getRequesterAccountId(req), threadId)
    res.json({ success: true })
  } catch (error) {
    sendChatError(res, error)
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
  await streamChatReply(res, (write) => isGroupThread(req, threadId)
    ? GroupChatService.rewriteMessage(requesterFrom(req), threadId, messageId, content, write)
    : CodexChatService.rewriteMessage(requesterFrom(req), threadId, messageId, content, write))
}

router.post('/threads/:threadId/messages/:messageId/regenerate', requireChatAccess, asyncHandler((req, res) => rewriteMessage(req, res, false)))
router.patch('/threads/:threadId/messages/:messageId', requireChatAccess, asyncHandler((req, res) => rewriteMessage(req, res, true)))

/** A rejected operation retains its HTTP status until the first NDJSON event is accepted. */
async function streamChatReply(res: Response, run: (write: (event: CodexChatStreamEvent) => void) => Promise<unknown>) {
  let streaming = false
  const write = (event: CodexChatStreamEvent) => {
    if (res.destroyed || res.writableEnded) return
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

  await streamChatReply(res, (write) => isGroupThread(req, threadId)
    ? GroupChatService.sendMessage(requesterFrom(req), threadId, text, write, req.body?.fileIds, req.body?.flagIds, req.body?.mediaHashes, req.body?.picks)
    : CodexChatService.sendMessage(requesterFrom(req), threadId, text, write, req.body?.fileIds, req.body?.flagIds, req.body?.picks, req.body?.mediaHashes))
}))

// ---- Chat user profiles: who the account is in a chat (name, persona, avatar), one per chat ----------------------

router.get('/user-profiles', requireChatAccess, (req: Request, res: Response) => {
  res.json({ success: true, data: ChatUserProfileStore.list(getRequesterAccountId(req)) })
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
  res.json({ success: true, data: ChatFlagStore.list(getRequesterAccountId(req)) })
})

router.post('/flags', requireChatAccess, (req: Request, res: Response) => {
  try {
    res.status(201).json({ success: true, data: ChatFlagStore.create(getRequesterAccountId(req), (req.body ?? {}) as Record<string, unknown>) })
  } catch (error) { sendChatError(res, error) }
})

/** PUT /api/codex-chat/flags/order — `{ ids }`: the account's flags in this order (the order of the chat's flag tray). */
router.put('/flags/order', requireChatAccess, (req: Request, res: Response) => {
  res.json({ success: true, data: ChatFlagStore.reorder(getRequesterAccountId(req), parseFlagIds(req.body?.ids)) })
})

router.put('/flags/:flagId', requireChatAccess, (req: Request, res: Response) => {
  const flagId = parseId(req.params.flagId)
  if (flagId === null) { sendRouteBadRequest(res, 'Invalid flag id'); return }
  try {
    res.json({ success: true, data: ChatFlagStore.update(getRequesterAccountId(req), flagId, (req.body ?? {}) as Record<string, unknown>) })
  } catch (error) { sendChatError(res, error) }
})

router.delete('/flags/:flagId', requireChatAccess, (req: Request, res: Response) => {
  const flagId = parseId(req.params.flagId)
  if (flagId === null) { sendRouteBadRequest(res, 'Invalid flag id'); return }
  try {
    ChatFlagStore.delete(getRequesterAccountId(req), flagId)
    res.json({ success: true })
  } catch (error) { sendChatError(res, error) }
})

/** PUT /api/codex-chat/threads/:threadId/flags — `{ flagIds }`: the flags switched on in this chat. */
router.put('/threads/:threadId/flags', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  if (!CodexChatStore.findThread(threadId, getRequesterAccountId(req))) { res.status(404).json({ success: false, error: '채팅을 찾을 수 없어.' }); return }
  const flags = ChatFlagStore.resolve(getRequesterAccountId(req), parseFlagIds(req.body?.flagIds))
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
