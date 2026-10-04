import express, { type NextFunction, type Request, type Response } from 'express'
import { isCodexReasoningEffort } from '@conai/shared'
import { getCodexModelSuggestions } from '../services/codexGenerationOptions'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireAdmin } from '../middleware/authMiddleware'
import type { McpRequester } from '../mcp/context'
import { resolveChatAccess } from '../services/codex-chat/codexChatAccess'
import { CodexChatError, CodexChatService, type CodexChatStreamEvent } from '../services/codex-chat/codexChatService'
import { CodexChatStore } from '../services/codex-chat/codexChatStore'
import { listChatCompletionModels } from '../services/codex-chat/llmChatCompletion'
import { LlmChatProfileError, LlmChatProfileStore, type LlmChatProfile } from '../services/codex-chat/llmChatProfiles'
import { LlmChatError, LlmChatService } from '../services/codex-chat/llmChatService'
import { DEFAULT_LLM_CHAT_SUMMARY_PROMPT, loadLlmChatSettings, updateLlmChatSettings } from '../services/codex-chat/llmChatSettings'
import { CODEX_CHAT_SCOPES, loadCodexChatSettings, updateCodexChatSettings } from '../services/codex-chat/codexChatSettings'
import { getRequesterAccountId, getRequesterAccountType } from './requester-session-helpers'
import { sendRouteBadRequest } from './routeValidation'

const MESSAGE_MAX_LENGTH = 20000

const router = express.Router()

function requesterFrom(req: Request): McpRequester {
  return { accountId: getRequesterAccountId(req), accountType: getRequesterAccountType(req) ?? 'admin' }
}

function parseThreadId(req: Request, res: Response) {
  const threadId = Number(req.params.threadId)
  if (!Number.isSafeInteger(threadId) || threadId <= 0) {
    sendRouteBadRequest(res, 'Invalid thread id')
    return null
  }
  return threadId
}

function sendChatError(res: Response, error: unknown) {
  if (error instanceof CodexChatError || error instanceof LlmChatError) {
    res.status(error.status).json({ success: false, error: error.message })
    return
  }
  if (error instanceof LlmChatProfileError) {
    res.status(400).json({ success: false, error: error.message })
    return
  }
  res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Codex chat failed' })
}

/** Codex or LLM chat, whichever this session may use (each send re-checks its own engine). */
function canUseAnyChat(req: Request) {
  const access = resolveChatAccess(getRequesterAccountId(req))
  return {
    codex: loadCodexChatSettings().enabled && access.codex,
    llm: loadLlmChatSettings().enabled && access.llm,
    scopes: access.scopes,
  }
}

function requireChatAccess(req: Request, res: Response, next: NextFunction) {
  const access = canUseAnyChat(req)
  if (!access.codex && !access.llm) {
    res.status(403).json({ success: false, error: '채팅 권한이 없어.' })
    return
  }
  next()
}

/** What a chat user sees of a profile: enough to pick it and show who is talking. */
function toPublicProfile(profile: LlmChatProfile) {
  return { id: profile.id, name: profile.name, avatar: profile.avatar, isEnabled: profile.isEnabled }
}

/** GET /api/codex-chat/status — whether the chat (header key, panel, /chat) should appear, and which engines. */
router.get('/status', (req: Request, res: Response) => {
  const access = canUseAnyChat(req)
  res.json({
    success: true,
    data: {
      enabled: loadCodexChatSettings().enabled || loadLlmChatSettings().enabled,
      canUse: access.codex || access.llm,
      codex: { canUse: access.codex },
      llm: { canUse: access.llm },
      scopes: access.scopes,
    },
  })
})

router.get('/settings', requireAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, data: { ...loadCodexChatSettings(), availableScopes: CODEX_CHAT_SCOPES } })
})

router.put('/settings', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
    sendRouteBadRequest(res, 'enabled must be a boolean')
    return
  }
  if (body.scopes !== undefined && !Array.isArray(body.scopes)) {
    sendRouteBadRequest(res, 'scopes must be an array')
    return
  }
  if (body.model !== undefined && typeof body.model !== 'string') {
    sendRouteBadRequest(res, 'model must be a string')
    return
  }
  if (body.reasoningEffort !== undefined && body.reasoningEffort !== '' && !isCodexReasoningEffort(body.reasoningEffort)) {
    sendRouteBadRequest(res, 'Invalid reasoningEffort')
    return
  }
  const catalog = body.model !== undefined || body.reasoningEffort !== undefined ? await getCodexModelSuggestions() : null
  // Read after the catalog lookup so concurrent setting updates are not overwritten with an old effort.
  const current = loadCodexChatSettings()
  const model = typeof body.model === 'string' ? body.model.trim() : current.model
  let reasoningEffort = body.reasoningEffort ?? current.reasoningEffort
  if (reasoningEffort && catalog) {
    const supported = catalog.models.find((entry) => model ? entry.id === model : entry.isDefault)?.supportedReasoningEfforts
    if (supported && !supported.some((effort) => effort === reasoningEffort)) {
      if (body.reasoningEffort !== undefined) {
        sendRouteBadRequest(res, '선택한 모델에서 지원하지 않는 추론 강도야.')
        return
      }
      reasoningEffort = ''
    }
  }
  const settings = updateCodexChatSettings({ enabled: body.enabled, scopes: body.scopes, model: body.model, reasoningEffort })
  res.json({ success: true, data: { ...settings, availableScopes: CODEX_CHAT_SCOPES } })
}))

/** GET /api/codex-chat/profiles — enabled LLM chat profiles to start a chat with (plus any a thread still uses). */
router.get('/profiles', requireChatAccess, (req: Request, res: Response) => {
  if (!canUseAnyChat(req).llm) {
    res.json({ success: true, data: [] })
    return
  }
  res.json({ success: true, data: LlmChatProfileStore.list().map(toPublicProfile) })
})

router.get('/threads', requireChatAccess, (req: Request, res: Response) => {
  res.json({ success: true, data: CodexChatService.listThreads(requesterFrom(req)) })
})

/** POST /api/codex-chat/threads — `{ profileId }` starts an LLM chat with that profile; no body starts a Codex chat. */
router.post('/threads', requireChatAccess, (req: Request, res: Response) => {
  const rawProfileId = req.body?.profileId
  const profileId = rawProfileId === undefined || rawProfileId === null ? null : Number(rawProfileId)
  if (profileId !== null && (!Number.isSafeInteger(profileId) || profileId <= 0)) {
    sendRouteBadRequest(res, 'Invalid profile id')
    return
  }
  try {
    res.status(201).json({ success: true, data: CodexChatService.createThread(requesterFrom(req), profileId) })
  } catch (error) {
    sendChatError(res, error)
  }
})

/** PATCH /api/codex-chat/threads/:threadId/context — LLM chats: turn window, summary on/off (null inherits), summary text. */
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

/** Admin: LLM chat defaults (context window, summary, tool rounds). */
router.get('/llm/settings', requireAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, data: { ...loadLlmChatSettings(), defaultSummaryPrompt: DEFAULT_LLM_CHAT_SUMMARY_PROMPT } })
})

router.put('/llm/settings', requireAdmin, (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
    sendRouteBadRequest(res, 'enabled must be a boolean')
    return
  }
  const settings = updateLlmChatSettings({
    enabled: body.enabled,
    contextTurns: body.contextTurns,
    summaryEnabled: typeof body.summaryEnabled === 'boolean' ? body.summaryEnabled : undefined,
    summaryTriggerTurns: body.summaryTriggerTurns,
    summaryPrompt: body.summaryPrompt,
    maxToolRounds: body.maxToolRounds,
  })
  res.json({ success: true, data: { ...settings, defaultSummaryPrompt: DEFAULT_LLM_CHAT_SUMMARY_PROMPT } })
})

/** Admin: full LLM chat profiles. */
router.get('/llm/profiles', requireAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, data: LlmChatProfileStore.list() })
})

router.post('/llm/profiles', requireAdmin, (req: Request, res: Response) => {
  try {
    res.status(201).json({ success: true, data: LlmChatProfileStore.create(req.body ?? {}) })
  } catch (error) {
    sendChatError(res, error)
  }
})

function parseProfileId(req: Request, res: Response) {
  const profileId = Number(req.params.profileId)
  if (!Number.isSafeInteger(profileId) || profileId <= 0) {
    sendRouteBadRequest(res, 'Invalid profile id')
    return null
  }
  return profileId
}

router.put('/llm/profiles/:profileId', requireAdmin, (req: Request, res: Response) => {
  const profileId = parseProfileId(req, res)
  if (profileId === null) return
  try {
    const profile = LlmChatProfileStore.update(profileId, req.body ?? {})
    if (!profile) {
      res.status(404).json({ success: false, error: '프로필을 찾을 수 없어.' })
      return
    }
    res.json({ success: true, data: profile })
  } catch (error) {
    sendChatError(res, error)
  }
})

router.delete('/llm/profiles/:profileId', requireAdmin, (req: Request, res: Response) => {
  const profileId = parseProfileId(req, res)
  if (profileId === null) return
  res.json({ success: true, data: { deleted: LlmChatProfileStore.delete(profileId) } })
})

/** Admin: model ids an LLM connection offers (`GET {base}/models`), for the profile editor. */
router.get('/llm/models', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
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
 * Streams the turn as NDJSON (`user`, `delta`, `tool`, then `done` or `error`). Closing the response does not stop
 * the turn; the reply is stored and shows up on the next thread load.
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
    write({ type: 'error', message: error instanceof Error ? error.message : 'Codex chat failed' })
    res.end()
  }
}))

export default router
