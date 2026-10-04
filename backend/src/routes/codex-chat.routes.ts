import express, { type NextFunction, type Request, type Response } from 'express'
import { getCodexModelSuggestions } from '../services/codexGenerationOptions'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireAdmin } from '../middleware/authMiddleware'
import type { McpRequester } from '../mcp/context'
import { CHAT_PROFILE_DEFAULTS, ChatProfileError, ChatProfileStore, DEFAULT_CHAT_SUMMARY_PROMPT, ensureCodexProfileMigrated, type ChatProfile, type ChatProfileInput } from '../services/codex-chat/chatProfiles'
import { CHAT_SCOPES, loadChatSettings, updateChatSettings } from '../services/codex-chat/chatSettings'
import { resolveChatAccess } from '../services/codex-chat/codexChatAccess'
import { CodexChatError, CodexChatService, type CodexChatStreamEvent } from '../services/codex-chat/codexChatService'
import { CodexChatStore } from '../services/codex-chat/codexChatStore'
import { listChatCompletionModels } from '../services/codex-chat/llmChatCompletion'
import { LlmChatError, LlmChatService } from '../services/codex-chat/llmChatService'
import { getRequesterAccountId, getRequesterAccountType } from './requester-session-helpers'
import { sendRouteBadRequest } from './routeValidation'

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

function sendChatError(res: Response, error: unknown) {
  if (error instanceof CodexChatError || error instanceof LlmChatError) {
    res.status(error.status).json({ success: false, error: error.message })
    return
  }
  if (error instanceof ChatProfileError) {
    res.status(400).json({ success: false, error: error.message })
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
function toPublicProfile(profile: ChatProfile) {
  return { id: profile.id, name: profile.name, avatar: profile.avatar, engine: profile.engine, isEnabled: profile.isEnabled }
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
    })),
  })
})

router.get('/threads', requireChatAccess, (req: Request, res: Response) => {
  res.json({ success: true, data: CodexChatService.listThreads(requesterFrom(req)) })
})

/** POST /api/codex-chat/threads — `{ profileId }`: a new chat with that profile's engine and persona. */
router.post('/threads', requireChatAccess, (req: Request, res: Response) => {
  const profileId = parseId(req.body?.profileId)
  if (profileId === null) {
    sendRouteBadRequest(res, 'profileId is required')
    return
  }
  try {
    res.status(201).json({ success: true, data: CodexChatService.createThread(requesterFrom(req), profileId) })
  } catch (error) {
    sendChatError(res, error)
  }
})

/** PATCH /api/codex-chat/threads/:threadId/context — LLM chats: turn window and summary on/off (null follows the profile), summary text. */
router.patch('/threads/:threadId/context', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  const body = (req.body ?? {}) as Record<string, unknown>
  try {
    const { thread } = CodexChatService.getThread(requesterFrom(req), threadId)
    if (thread.engine !== 'llm') {
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
    if (body.summaryEnabled !== undefined && body.summaryEnabled !== null && typeof body.summaryEnabled !== 'boolean') {
      sendRouteBadRequest(res, 'summaryEnabled must be a boolean or null')
      return
    }
    if (body.summary !== undefined && body.summary !== null && typeof body.summary !== 'string') {
      sendRouteBadRequest(res, 'summary must be a string or null')
      return
    }
    CodexChatStore.updateThreadContext(threadId, { contextTurns, summaryEnabled: body.summaryEnabled as boolean | null | undefined })
    if (body.summary !== undefined) {
      const summary = typeof body.summary === 'string' ? body.summary.trim().slice(0, 20000) : ''
      CodexChatStore.setSummary(threadId, summary || null, summary ? thread.summary_until_message_id : null)
    }
    res.json({ success: true, data: CodexChatService.getThread(requesterFrom(req), threadId).thread })
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
    if (thread.engine !== 'llm') {
      sendRouteBadRequest(res, 'Only LLM chats can be summarized')
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
  res.json({ success: true, data: { ...CHAT_PROFILE_DEFAULTS, summaryPrompt: DEFAULT_CHAT_SUMMARY_PROMPT, scopes: CHAT_SCOPES } })
})

router.get('/admin/profiles', requireAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, data: ChatProfileStore.list() })
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

router.post('/admin/profiles', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  try {
    const input = (req.body ?? {}) as ChatProfileInput
    await assertCodexEffortSupported(input)
    res.status(201).json({ success: true, data: ChatProfileStore.create(input) })
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
    res.json({ success: true, data: ChatProfileStore.update(profileId, patch) })
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

router.get('/threads/:threadId', requireChatAccess, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  try {
    res.json({ success: true, data: CodexChatService.getThread(requesterFrom(req), threadId) })
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
    await CodexChatService.deleteThread(requesterFrom(req), threadId)
    res.json({ success: true })
  } catch (error) {
    sendChatError(res, error)
  }
}))

router.post('/threads/:threadId/interrupt', requireChatAccess, asyncHandler(async (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  try {
    await CodexChatService.interrupt(requesterFrom(req), threadId)
    res.json({ success: true })
  } catch (error) {
    sendChatError(res, error)
  }
}))

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

  let streaming = false
  const write = (event: CodexChatStreamEvent) => {
    if (!streaming) {
      streaming = true
      res.status(200)
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('X-Accel-Buffering', 'no')
      res.flushHeaders()
    }
    if (!res.writableEnded) {
      res.write(`${JSON.stringify(event)}\n`)
    }
  }

  try {
    await CodexChatService.sendMessage(requesterFrom(req), threadId, text, write)
    if (!res.writableEnded) {
      res.end()
    }
  } catch (error) {
    if (!streaming) {
      sendChatError(res, error)
      return
    }
    write({ type: 'error', message: error instanceof Error ? error.message : 'Chat failed' })
    res.end()
  }
}))

export default router
