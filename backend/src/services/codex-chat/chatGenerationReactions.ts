import { getUserSettingsDb } from '../../database/userSettingsDb'
import { AuthAccount } from '../../models/AuthAccount'
import { requireRequesterPermission } from '../../middleware/featureAccess'
import { publishRuntimeEvent, subscribeToRuntimeEvents } from '../runtime-events/runtimeEventBus'
import { previewImage } from '../imagePreview'
import { libraryMediaAllowed } from '../contentRating'
import { profileContentLimit } from './chatContentRating'
import { activeMediaFile } from './chatCardAssets'
import { isProfileAssetHidden } from './chatProfileAssets'
import { onChatReplyFinished } from './chatReplyRegistry'
import { CodexChatStore } from './codexChatStore'
import { ChatProfileStore } from './chatProfiles'
import { ChatGroupStore } from './chatGroupStore'
import { GroupChatService } from './groupChatService'
import { LlmChatService } from './llmChatService'
import { failureMessageOf } from './codexChatMedia'
import { audioCandidatesByQueueJob, audioOrderGroupsByQueueJob } from '../audio/audioJobCandidates'
import type { ChatCompletionMessage, ChatContentPart } from './llmChatCompletion'
import { inBackground } from '../llmRequestScheduler'

type ReactionState = 'pending' | 'running' | 'done' | 'skipped' | 'failed'
type Candidate = { reply_id: string; thread_id: number }
type Job = { id: number; status: 'completed' | 'failed' | 'cancelled'; failure_code: string | null; requested_by_account_id: number | null }

/** Durable, one-shot reactions. Only links opted in at submission can enter this queue. */
export class ChatGenerationReactionService {
  private static unsubscribe: (() => void) | null = null
  private static unsubscribeReplies: (() => void) | null = null
  private static scheduled = new Map<number, NodeJS.Immediate>()
  private static processing = new Map<string, { threadId: number; finished: Promise<void> }>()

  static start() {
    if (this.unsubscribe) return
    const db = getUserSettingsDb()
    db.transaction(() => {
      db.prepare("UPDATE chat_generation_reactions SET state = 'failed', updated_at = CURRENT_TIMESTAMP WHERE state = 'running'").run()
    }).immediate()
    this.unsubscribe = subscribeToRuntimeEvents((record) => {
      if (record.name !== 'queue.job.status') return
      const payload = record.payload as { job_id: number; status: string }
      if (!['completed', 'failed', 'cancelled'].includes(payload.status)) return
      const link = db.prepare('SELECT thread_id FROM chat_generation_links WHERE job_id = ? AND reaction_target = 1').get(payload.job_id) as { thread_id: number } | undefined
      if (link) this.schedule(link.thread_id)
    })
    this.unsubscribeReplies = onChatReplyFinished((context) => this.schedule(context.threadId))
    void this.reconcile().catch((error: unknown) => console.warn('[chat-reaction] recovery failed:', error instanceof Error ? error.message : error))
  }

  private static schedule(threadId: number) {
    if (this.scheduled.has(threadId)) return
    this.scheduled.set(threadId, setImmediate(() => {
      this.scheduled.delete(threadId)
      void this.reconcile(threadId).catch((error: unknown) => console.warn('[chat-reaction] reconciliation failed:', error instanceof Error ? error.message : error))
    }))
  }

  static async reconcile(threadId?: number) {
    const candidates = getUserSettingsDb().prepare(`SELECT l.reply_id, l.thread_id
      FROM chat_generation_links l LEFT JOIN generation_queue_jobs j ON j.id = l.job_id
      LEFT JOIN chat_generation_reactions r ON r.reply_id = l.reply_id
      WHERE (? IS NULL OR l.thread_id = ?) AND (r.reply_id IS NULL OR r.state = 'pending')
      GROUP BY l.thread_id, l.reply_id
      HAVING MAX(l.reaction_target) = 1 AND SUM(CASE WHEN j.status IN ('completed', 'failed', 'cancelled') THEN 0 ELSE 1 END) = 0`)
      .all(threadId ?? null, threadId ?? null) as Candidate[]
    const work = candidates.map((candidate) => {
      const existing = this.processing.get(candidate.reply_id)
      if (existing) return existing.finished
      const work = inBackground(() => this.react(candidate)).finally(() => { this.processing.delete(candidate.reply_id) })
      this.processing.set(candidate.reply_id, { threadId: candidate.thread_id, finished: work })
      return work
    })
    await Promise.all([...work, ...[...this.processing.values()].filter((entry) => threadId === undefined || entry.threadId === threadId).map((entry) => entry.finished)])
  }

  private static transition(replyId: string, from: ReactionState, to: ReactionState) {
    const db = getUserSettingsDb()
    return db.transaction(() => db.prepare('UPDATE chat_generation_reactions SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE reply_id = ? AND state = ?')
      .run(to, replyId, from).changes > 0).immediate()
  }

  private static async react({ reply_id: replyId, thread_id: threadId }: Candidate) {
    const db = getUserSettingsDb()
    const source = CodexChatStore.listMessages(threadId).find((message) => message.role === 'assistant' && message.routing?.replyId === replyId)
    // A fast job may finish while its requesting reply is still being written; its close hook tries again.
    if (!source && (LlmChatService.isRunning(threadId) || GroupChatService.isRunning(threadId))) return
    db.transaction(() => {
      db.prepare("INSERT OR IGNORE INTO chat_generation_reactions (reply_id, thread_id, state) VALUES (?, ?, 'pending')").run(replyId, threadId)
    }).immediate()
    const thread = CodexChatStore.findThreadById(threadId)
    const profileId = thread?.kind === 'group' ? source?.speaker_profile_id : thread?.profile_id
    const profile = profileId ? ChatProfileStore.find(profileId) : null
    const eligible = () => {
      const current = CodexChatStore.findThreadById(threadId)
      const currentProfile = profileId ? ChatProfileStore.find(profileId) : null
      const messages = CodexChatStore.listMessages(threadId)
      return Boolean(current && source && current.reaction_enabled === 1 && currentProfile?.isEnabled && currentProfile.engine === 'llm'
        && messages.some((message) => message.id === source.id && message.routing?.replyId === replyId)
        && (current.kind === 'group' ? ChatGroupStore.member(threadId, currentProfile.id) : current.engine === 'llm' && current.profile_id === currentProfile.id)
        && !messages.some((message) => message.role === 'user' && message.id > source.id)
        && !LlmChatService.isRunning(threadId) && !GroupChatService.isRunning(threadId))
    }
    if (!eligible() || !thread || !profile || !source) {
      this.transition(replyId, 'pending', 'skipped')
      return
    }
    try {
      const requester = { accountId: thread.account_id, accountType: thread.account_id === null ? null : AuthAccount.findById(thread.account_id)?.account_type ?? null }
      const jobs = db.prepare('SELECT j.id, j.status, j.failure_code, j.requested_by_account_id FROM chat_generation_links l JOIN generation_queue_jobs j ON j.id = l.job_id WHERE l.thread_id = ? AND l.reply_id = ? ORDER BY j.id').all(threadId, replyId) as Job[]
      if (jobs.some((job) => job.requested_by_account_id !== thread.account_id)) {
        this.transition(replyId, 'pending', 'skipped')
        return
      }
      const parts: ChatContentPart[] = []
      const lines: string[] = ['[작업 결과]']
      // The reaction model (the chat's own reaction row, else the profile's) decides which results it may be shown.
      const limit = profileContentLimit(thread.reaction_model_slot_id === null ? profile : { ...profile, modelSlotId: thread.reaction_model_slot_id })
      let withheld = 0
      const audioOrderJobs = audioOrderGroupsByQueueJob(jobs.map((job) => job.id))
      for (const job of jobs) {
        const images = db.prepare("SELECT composite_hash FROM api_generation_history WHERE queue_job_id = ? AND requested_by_account_id IS ? AND generation_status = 'completed' AND composite_hash IS NOT NULL ORDER BY id")
          .all(job.id, thread.account_id) as Array<{ composite_hash: string }>
        const sounds = images.length ? 0 : audioCandidatesByQueueJob([job.id]).get(job.id)?.length ?? 0
        lines.push(`작업 #${job.id}: ${images.length ? `이미지 ${images.length}장 첨부됨` : sounds ? `오디오 후보 ${sounds}개 첨부됨 (오디오 탭에서 검수)` : `실패: ${failureMessageOf(job.status, job.status === 'completed' ? 'no_image' : job.failure_code, audioOrderJobs.has(job.id) ? 'audio' : 'image')}`}`)
        if (!profile.visionEnabled) continue
        try { requireRequesterPermission(requester, 'images.view') } catch { continue }
        for (const image of images) {
          if (isProfileAssetHidden(image.composite_hash)) continue
          const file = activeMediaFile(image.composite_hash)
          if (!file?.mimeType.startsWith('image/')) continue
          if (!await libraryMediaAllowed(image.composite_hash, limit)) { withheld++; continue }
          try { parts.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${await previewImage(file.path)}` } }) } catch { /* A missing preview does not hide the job outcome. */ }
        }
      }
      // Said plainly, so the model does not describe pictures it was never shown.
      if (withheld > 0) lines.push(`(이미지 ${withheld}장은 허용 등급을 넘어서 보여주지 않음. 내용을 추측하지 말 것)`)
      // Loading previews yields to user requests; reserve only if the reaction still owns its pending record.
      if (!eligible()) { this.transition(replyId, 'pending', 'skipped'); return }
      const current = CodexChatStore.findThreadById(threadId)!
      const currentProfile = ChatProfileStore.find(profile.id)!
      const claimed = db.transaction(() => db.prepare("UPDATE chat_generation_reactions SET state = 'running', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP WHERE reply_id = ? AND state = 'pending'").run(replyId).changes > 0).immediate()
      if (!claimed) return
      const result: ChatCompletionMessage = { role: 'user', content: parts.length ? [{ type: 'text', text: lines.join('\n') }, ...parts] : lines.join('\n') }
      const message = await LlmChatService.react(requester, current, current.reaction_model_slot_id === null ? currentProfile : { ...currentProfile, modelSlotId: current.reaction_model_slot_id }, {
        result,
        skip: () => { this.transition(replyId, 'running', 'skipped') },
        persist: (save) => db.transaction(() => {
          const row = db.prepare('SELECT state FROM chat_generation_reactions WHERE reply_id = ?').get(replyId) as { state: ReactionState } | undefined
          if (row?.state !== 'running') return null
          const messageId = save?.() ?? null
          db.prepare("UPDATE chat_generation_reactions SET state = 'done', message_id = ?, updated_at = CURRENT_TIMESTAMP WHERE reply_id = ? AND state = 'running'").run(messageId, replyId)
          return messageId
        }).immediate(),
      })
      if (message) publishRuntimeEvent({ name: 'chat.reaction.created', topic: 'generation-queue', visibility: 'owner', accountId: thread.account_id,
        payload: { threadId, messageId: message.id, requestedByAccountId: thread.account_id } })
      else this.transition(replyId, 'running', 'skipped')
    } catch {
      this.transition(replyId, 'pending', 'failed')
      this.transition(replyId, 'running', 'failed')
    }
  }

  static async stop() {
    this.unsubscribe?.()
    this.unsubscribeReplies?.()
    this.unsubscribe = this.unsubscribeReplies = null
    for (const handle of this.scheduled.values()) clearImmediate(handle)
    this.scheduled.clear()
    const db = getUserSettingsDb()
    db.transaction(() => {
      db.prepare("UPDATE chat_generation_reactions SET state = 'skipped', updated_at = CURRENT_TIMESTAMP WHERE state = 'pending'").run()
    }).immediate()
    const threads = getUserSettingsDb().prepare("SELECT DISTINCT thread_id FROM chat_generation_reactions WHERE state = 'running'").all() as Array<{ thread_id: number }>
    for (const thread of threads) LlmChatService.skipReaction(thread.thread_id)
    await Promise.allSettled([...this.processing.values()].map((entry) => entry.finished))
  }
}
