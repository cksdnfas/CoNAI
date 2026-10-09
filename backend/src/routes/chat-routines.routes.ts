import express, { type Request, type Response } from 'express'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireAdmin } from '../middleware/authMiddleware'
import { ChatRoutineRunner, ChatRoutineStore, chatRoutineFirstRunAt, normalizeChatRoutineInput } from '../services/codex-chat/chatRoutines'
import { forgetAutomationRoom } from '../services/codex-chat/chatRoomWake'
import { CodexChatError } from '../services/codex-chat/codexChatService'
import { getRequesterAccountId } from './requester-session-helpers'
import { AutomationSwitch } from '../services/automationSwitch'
import { AuthAccount } from '../models/AuthAccount'
import { ChatProfileStore } from '../services/codex-chat/chatProfiles'
import { CodexChatStore } from '../services/codex-chat/codexChatStore'
import type { ChatRoutine } from '@conai/shared'

/**
 * Chat routines (/api/chat-routines). Administrators make them; each runs as the account that last saved it, and its
 * character's tools are what that profile grants.
 */
const router = express.Router()

/** Whether every automation is stopped. Anyone signed in may read it (the reservations tab shows it); only administrators flip it. */
router.get('/switch', (_req: Request, res: Response) => {
  res.json({ success: true, data: { paused: AutomationSwitch.isPaused() } })
})

router.use(requireAdmin)

router.put('/switch', (req: Request, res: Response) => {
  res.json({ success: true, data: { paused: AutomationSwitch.setPaused(req.body?.paused === true) } })
})

/** A routine with the names its list row shows, and whether it is answering right now. */
function view(routine: ChatRoutine) {
  const profile = routine.profileId === null ? null : ChatProfileStore.find(routine.profileId)
  const room = routine.threadId === null ? null : CodexChatStore.findThreadById(routine.threadId)
  return {
    ...routine,
    running: ChatRoutineRunner.isRunning(routine.id),
    profileName: profile?.name ?? null,
    roomTitle: room?.title ?? null,
    roomKind: room?.kind ?? null,
    roomProfileId: room?.profile_id ?? null,
    accountName: routine.accountId === null ? null : AuthAccount.findById(routine.accountId)?.username ?? null,
  }
}

function routineId(req: Request, res: Response) {
  const id = Number(req.params.id)
  if (Number.isInteger(id) && id > 0 && ChatRoutineStore.find(id)) return id
  res.status(404).json({ success: false, error: '루틴을 찾을 수 없어.' })
  return null
}

function sendError(res: Response, error: unknown) {
  if (!(error instanceof CodexChatError)) throw error
  res.status(error.status).json({ success: false, error: error.message })
}

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const threadId = Number(req.query.threadId)
  const routines = Number.isInteger(threadId) && threadId > 0 ? ChatRoutineStore.forThread(threadId) : ChatRoutineStore.list('all')
  res.json({ success: true, data: routines.map(view) })
}))

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  try {
    const values = normalizeChatRoutineInput(req.body ?? {}, getRequesterAccountId(req))
    const active = req.body?.active !== false
    const nextRunAt = active ? chatRoutineFirstRunAt({ scheduleType: values.schedule_type, runAt: values.run_at, intervalMinutes: values.interval_minutes, dailyTime: values.daily_time, timezone: values.timezone }) : null
    const routine = ChatRoutineStore.create({ ...values, status: active ? 'active' : 'paused', next_run_at: nextRunAt, stop_reason: active ? null : '꺼진 채로 만들었어.' })
    res.status(201).json({ success: true, data: view(routine) })
  } catch (error) {
    sendError(res, error)
  }
}))

router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = routineId(req, res)
  if (id === null) return
  const existing = ChatRoutineStore.find(id)!
  if (ChatRoutineRunner.isRunning(id)) { res.status(409).json({ success: false, error: '루틴이 실행 중이야. 끝나면 다시 저장해줘.' }); return }
  try {
    const values = normalizeChatRoutineInput({ ...req.body }, getRequesterAccountId(req))
    const active = req.body?.active === undefined ? existing.status === 'active' : req.body.active !== false
    const nextRunAt = active ? chatRoutineFirstRunAt({ scheduleType: values.schedule_type, runAt: values.run_at, intervalMinutes: values.interval_minutes, dailyTime: values.daily_time, timezone: values.timezone }) : null
    // A dedicated room belongs to one character of one account; a different one gets a new room on the next run.
    const keepsRoom = existing.target === 'dedicated' && values.target === 'dedicated' && existing.profileId === values.profile_id && existing.accountId === values.account_id
    if (existing.target === 'dedicated' && !keepsRoom) forgetAutomationRoom(existing.accountId, `routine:${id}`)
    const routine = ChatRoutineStore.update(id, {
      ...values,
      thread_id: values.target === 'room' ? values.thread_id : keepsRoom ? existing.threadId : null,
      status: active ? 'active' : 'paused', stop_reason: active ? null : existing.stopReason ?? '꺼 뒀어.', next_run_at: nextRunAt, fail_streak: 0,
    })
    res.json({ success: true, data: routine ? view(routine) : null })
  } catch (error) {
    sendError(res, error)
  }
}))

router.post('/:id/pause', asyncHandler(async (req: Request, res: Response) => {
  const id = routineId(req, res)
  if (id === null) return
  res.json({ success: true, data: ChatRoutineStore.update(id, { status: 'paused', stop_reason: '꺼 뒀어.', next_run_at: null }) })
}))

router.post('/:id/resume', asyncHandler(async (req: Request, res: Response) => {
  const id = routineId(req, res)
  if (id === null) return
  const routine = ChatRoutineStore.find(id)!
  const nextRunAt = chatRoutineFirstRunAt(routine)
  if (!nextRunAt) { res.status(400).json({ success: false, error: '다음 실행 시각이 없어. 시각을 고쳐서 저장해줘.' }); return }
  res.json({ success: true, data: ChatRoutineStore.update(id, { status: 'active', stop_reason: null, next_run_at: nextRunAt, fail_streak: 0 }) })
}))

/** Wake the room once now. Answers at once; the outcome lands on the routine when the room has answered. */
router.post('/:id/run', asyncHandler(async (req: Request, res: Response) => {
  const id = routineId(req, res)
  if (id === null) return
  if (ChatRoutineRunner.isRunning(id)) { res.status(409).json({ success: false, error: '이미 실행 중이야.' }); return }
  void ChatRoutineRunner.fire(id, { manual: true }).catch((error: unknown) => {
    console.warn(`[chat-routine] manual run of ${id} failed:`, error instanceof Error ? error.message : error)
  })
  res.status(202).json({ success: true, data: { id, started: true } })
}))

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = routineId(req, res)
  if (id === null) return
  if (ChatRoutineRunner.isRunning(id)) { res.status(409).json({ success: false, error: '루틴이 실행 중이야. 끝나면 지워줘.' }); return }
  res.json({ success: ChatRoutineStore.delete(id) })
}))

export default router
