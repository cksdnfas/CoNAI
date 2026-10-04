import express, { type Request, type Response } from 'express'
import { isCodexReasoningEffort } from '@conai/shared'
import { getCodexModelSuggestions } from '../services/codexGenerationOptions'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireAdmin } from '../middleware/authMiddleware'
import type { McpRequester } from '../mcp/context'
import { isCodexChatAdmin } from '../services/codex-chat/codexChatAccess'
import { CodexChatError, CodexChatService, type CodexChatStreamEvent } from '../services/codex-chat/codexChatService'
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
  if (error instanceof CodexChatError) {
    res.status(error.status).json({ success: false, error: error.message })
    return
  }
  res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Codex chat failed' })
}

/** GET /api/codex-chat/status — whether the chat (header key, panel, /chat) should appear for this session. */
router.get('/status', (req: Request, res: Response) => {
  const settings = loadCodexChatSettings()
  res.json({ success: true, data: { enabled: settings.enabled, canUse: settings.enabled && isCodexChatAdmin(getRequesterAccountId(req)) } })
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

router.get('/threads', requireAdmin, (req: Request, res: Response) => {
  res.json({ success: true, data: CodexChatService.listThreads(requesterFrom(req)) })
})

router.post('/threads', requireAdmin, (req: Request, res: Response) => {
  try {
    res.status(201).json({ success: true, data: CodexChatService.createThread(requesterFrom(req)) })
  } catch (error) {
    sendChatError(res, error)
  }
})

router.get('/threads/:threadId', requireAdmin, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  try {
    res.json({ success: true, data: CodexChatService.getThread(requesterFrom(req), threadId) })
  } catch (error) {
    sendChatError(res, error)
  }
})

/** GET /api/codex-chat/threads/:threadId/media — images the chat generated or looked up, newest first. */
router.get('/threads/:threadId/media', requireAdmin, (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  try {
    res.json({ success: true, data: CodexChatService.listThreadMedia(requesterFrom(req), threadId) })
  } catch (error) {
    sendChatError(res, error)
  }
})

router.delete('/threads/:threadId', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const threadId = parseThreadId(req, res)
  if (threadId === null) return
  try {
    await CodexChatService.deleteThread(requesterFrom(req), threadId)
    res.json({ success: true })
  } catch (error) {
    sendChatError(res, error)
  }
}))

router.post('/threads/:threadId/interrupt', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
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
router.post('/threads/:threadId/messages', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
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
