import { isCodexChatGenerationTool, isCodexChatCreationTool, type ChatProposal } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { ChatProposalStore } from './chatProposals'
import { MediaPostprocessVisibilityService } from '../mediaPostprocessVisibilityService'
import type { CodexChatMessageRecord } from './codexChatStore'

export type CodexChatMediaSource = 'generated' | 'found'

export type CodexChatMediaItem = {
  compositeHash: string
  /** The message whose tool calls brought the image in (for "go to message"). */
  messageId: number
  createdDate: string
  source: CodexChatMediaSource
  mimeType: string | null
  width: number | null
  height: number | null
}

/** Keep comfortably below SQLite's default 999 binding limit. */
const LOOKUP_CHUNK_SIZE = 400

type MediaReference = { messageId: number; createdDate: string; source: CodexChatMediaSource }

function chunked<T>(values: T[]) {
  const chunks: T[][] = []
  for (let start = 0; start < values.length; start += LOOKUP_CHUNK_SIZE) {
    chunks.push(values.slice(start, start + LOOKUP_CHUNK_SIZE))
  }
  return chunks
}

const FINISHED_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled'])
const JOB_TOOLS = new Set(['submit_generation_job', 'get_generation_job', 'wait_generation_job', 'get_generation_artifacts'])

/** The job ids of a call; calls stored before ids were recorded fall back to the job JSON in their result text. */
function jobIdsOf(call: CodexChatMessageRecord['tool_calls'][number]) {
  if (call.jobIds) return call.jobIds
  if (!JOB_TOOLS.has(call.tool) && !/^generate_image(_\d+)?$/.test(call.tool)) return []
  const match = /"(?:job_)?id"\s*:\s*(\d+)/.exec(call.output ?? call.summary ?? '')
  return match ? [Number(match[1])] : []
}

const PROPOSAL_TOOLS: Record<ChatProposal['kind'], string> = {
  display_block: 'propose_display_block',
  profile: 'propose_chat_profile',
  profile_update: 'propose_profile_update',
  lore: 'save_lore',
  page_fields: 'propose_page_changes',
}

/** Tools whose call leaves a proposal card under the reply. */
export function isProposalTool(tool: string) {
  return tool.startsWith('propose_') || tool === 'save_lore'
}

/**
 * Hang each reply's stored proposals on its `propose_*` / save_lore tool calls (read-only, not stored on the message). Calls and
 * proposals both keep their order within a reply, so the i-th proposal belongs to the i-th such call; a failed call
 * stored nothing and is skipped. Replies whose calls were not recorded by name (Codex keeps only a summary) get the
 * leftover proposals as synthetic calls, like generation results below.
 */
export function attachProposals(messages: CodexChatMessageRecord[]): CodexChatMessageRecord[] {
  const byReply = new Map<string, Array<{ id: number; proposal: ChatProposal }>>()
  for (const threadId of new Set(messages.map((message) => message.thread_id))) {
    for (const stored of ChatProposalStore.listForThread(threadId)) {
      const key = `${threadId}:${stored.replyId}`
      byReply.set(key, [...(byReply.get(key) ?? []), { id: stored.id, proposal: stored.proposal }])
    }
  }
  if (byReply.size === 0) return messages
  return messages.map((message) => {
    const replyId = message.routing?.replyId
    const proposals = message.role === 'assistant' && replyId ? byReply.get(`${message.thread_id}:${replyId}`) : undefined
    if (!proposals?.length) return message
    let next = 0
    const calls = message.tool_calls.map((call) => {
      if (!isProposalTool(call.tool) || call.status === 'failed' || next >= proposals.length) return call
      return { ...call, proposal: proposals[next++].proposal }
    })
    const extra = proposals.slice(next).map(({ id, proposal }) => ({ id: `proposal-${id}`, tool: PROPOSAL_TOOLS[proposal.kind], status: 'completed' as const, arguments: null, summary: null, historyIds: [], compositeHashes: [], proposal }))
    return { ...message, tool_calls: [...calls, ...extra] }
  })
}

/**
 * Generation jobs finish after the reply that started them, often after the agent stopped checking. Attach each
 * referenced job's history rows to the tool call (read-only, not stored) and count the jobs still running, so the chat
 * shows results as they land without waiting for another message.
 */
export function attachJobResults(messages: CodexChatMessageRecord[]) {
  messages = attachProposals(messages)
  const db = getUserSettingsDb()
  const owners = new Map<number, string>()
  const links: Array<{ job_id: number; reply_id: string }> = []
  for (const threadId of new Set(messages.map((message) => message.thread_id))) {
    links.push(...db.prepare('SELECT job_id, reply_id FROM chat_generation_links WHERE thread_id = ?').all(threadId) as Array<{ job_id: number; reply_id: string }>)
  }
  links.forEach((link) => owners.set(link.job_id, link.reply_id))
  messages = messages.map((message) => {
    const ownJobs = links.filter((link) => link.reply_id === message.routing?.replyId)
    const recorded = new Set(message.tool_calls.filter((call) => isCodexChatCreationTool(call.tool)).flatMap(jobIdsOf))
    const missing = ownJobs.filter((link) => !recorded.has(link.job_id))
    return missing.length ? { ...message, tool_calls: [...message.tool_calls, ...missing.map((link) => ({ id: `generation-${link.job_id}`, tool: 'generation_result', status: 'completed' as const, arguments: null, summary: null, historyIds: [], compositeHashes: [], jobIds: [link.job_id], generated: true }))] } : message
  })
  const jobIds = [...new Set(messages.flatMap((message) => message.tool_calls.flatMap(jobIdsOf)))]
  if (jobIds.length === 0) {
    return { messages, pendingJobs: 0 }
  }

  const historiesByJob = new Map<number, number[]>()
  const pendingJobIds = new Set<number>()
  for (const chunk of chunked(jobIds)) {
    const placeholders = chunk.map(() => '?').join(',')
    const linked = db.prepare(`SELECT job_id, reply_id FROM chat_generation_links WHERE job_id IN (${placeholders})`).all(...chunk) as Array<{ job_id: number; reply_id: string }>
    linked.forEach((link) => owners.set(link.job_id, link.reply_id))
    const histories = db.prepare(`SELECT id, queue_job_id FROM api_generation_history WHERE queue_job_id IN (${placeholders}) ORDER BY id`).all(...chunk) as Array<{ id: number; queue_job_id: number }>
    histories.forEach((row) => historiesByJob.set(row.queue_job_id, [...(historiesByJob.get(row.queue_job_id) ?? []), row.id]))
    const jobs = db.prepare(`SELECT id, status FROM generation_queue_jobs WHERE id IN (${placeholders})`).all(...chunk) as Array<{ id: number; status: string }>
    jobs.filter((job) => !FINISHED_JOB_STATUSES.has(job.status)).forEach((job) => pendingJobIds.add(job.id))
  }

  return { pendingJobs: pendingJobIds.size, messages: attachResolvedJobResults(messages, historiesByJob, pendingJobIds, owners) }
}

/** What became of a generation job, as a later request should read it. */
export type GenerationOutcome = { status: string; images: number }

/**
 * One line in place of the job JSON a creation call stored at submission (always "queued" there): whether the image
 * landed in the reply, failed, or is still on its way. The model is otherwise never told, and keeps apologising for an
 * image the reader has long seen.
 */
export function generationOutcomeNote(jobId: number, outcome: GenerationOutcome | undefined): string {
  if (!outcome) return `Generation job #${jobId}: no longer in the queue (its result, if any, is attached to this reply).`
  if (outcome.images > 0) return `Generation job #${jobId} finished: ${outcome.images} image${outcome.images === 1 ? '' : 's'} attached to this reply, visible to the reader. Do not describe or re-announce it.`
  if (outcome.status === 'completed') return `Generation job #${jobId} finished but produced no image.`
  if (outcome.status === 'failed') return `Generation job #${jobId} failed: no image was attached to this reply.`
  if (outcome.status === 'cancelled') return `Generation job #${jobId} was cancelled: no image was attached to this reply.`
  return `Generation job #${jobId} is still running; its image attaches to this reply when it finishes.`
}

/** Pure form of withGenerationOutcomes: creation calls get the note as their replayed output (not stored). */
export function applyGenerationOutcomes(messages: CodexChatMessageRecord[], outcomes: ReadonlyMap<number, GenerationOutcome>) {
  return messages.map((message) => {
    if (!message.tool_calls.some((call) => isCodexChatCreationTool(call.tool) && jobIdsOf(call).length > 0)) return message
    return {
      ...message,
      tool_calls: message.tool_calls.map((call) => {
        const ids = isCodexChatCreationTool(call.tool) ? jobIdsOf(call) : []
        return ids.length > 0 ? { ...call, output: ids.map((id) => generationOutcomeNote(id, outcomes.get(id))).join('\n') } : call
      }),
    }
  })
}

/**
 * The messages as a request should replay them: each creation call's stale job JSON replaced by its outcome now
 * (see generationOutcomeNote). Read-only; the stored records keep the submission result.
 */
export function withGenerationOutcomes(messages: CodexChatMessageRecord[]) {
  const jobIds = [...new Set(messages.flatMap((message) => message.tool_calls.filter((call) => isCodexChatCreationTool(call.tool)).flatMap(jobIdsOf)))]
  if (jobIds.length === 0) return messages
  const db = getUserSettingsDb()
  const outcomes = new Map<number, GenerationOutcome>()
  for (const chunk of chunked(jobIds)) {
    const placeholders = chunk.map(() => '?').join(',')
    const jobs = db.prepare(`SELECT id, status FROM generation_queue_jobs WHERE id IN (${placeholders})`).all(...chunk) as Array<{ id: number; status: string }>
    jobs.forEach((job) => outcomes.set(job.id, { status: job.status, images: 0 }))
    const histories = db.prepare(`SELECT queue_job_id, COUNT(*) AS images FROM api_generation_history WHERE generation_status = 'completed' AND composite_hash IS NOT NULL AND queue_job_id IN (${placeholders}) GROUP BY queue_job_id`).all(...chunk) as Array<{ queue_job_id: number; images: number }>
    histories.forEach((row) => outcomes.set(row.queue_job_id, { status: outcomes.get(row.queue_job_id)?.status ?? 'completed', images: row.images }))
  }
  return applyGenerationOutcomes(messages, outcomes)
}

/** Pure ownership resolution, also used by regression coverage. Old records prefer an actual submission. */
export function attachResolvedJobResults(messages: CodexChatMessageRecord[], historiesByJob: ReadonlyMap<number, number[]>, pendingJobIds: ReadonlySet<number>, owners: ReadonlyMap<number, string> = new Map()) {
  const creator = new Map<number, string>()
  for (const message of messages) for (const call of message.tool_calls) {
    if (!isCodexChatCreationTool(call.tool)) continue
    for (const id of jobIdsOf(call)) {
      if (owners.has(id) && owners.get(id) !== message.routing?.replyId) continue
      if (!creator.has(id)) creator.set(id, `${message.id}:${call.id}`)
    }
  }
  return messages.map((message) => ({
      ...message,
      tool_calls: message.tool_calls.map((call) => {
        const ids = jobIdsOf(call)
        const ownIds = ids.filter((id) => creator.get(id) === `${message.id}:${call.id}`)
        const attached = ownIds.flatMap((jobId) => historiesByJob.get(jobId) ?? [])
        const placeholders = ownIds.filter((jobId) => pendingJobIds.has(jobId) && !(historiesByJob.get(jobId)?.length))
        const generated = ids.length ? ownIds.length > 0 : call.generated ?? isCodexChatCreationTool(call.tool)
        // A polling call in the creator's own message need not repeat the large result or its placeholder.
        const duplicateIds = ids.filter((id) => creator.get(id)?.startsWith(`${message.id}:`) && !ownIds.includes(id)).flatMap((id) => historiesByJob.get(id) ?? [])
        return {
          ...call,
          generated,
          historyIds: [...new Set([...call.historyIds.filter((id) => !duplicateIds.includes(id)), ...attached])],
          pendingJobIds: generated ? placeholders : undefined,
        }
      }),
    }))
}

/** Completed history rows → their result image hash. Failed, pending or deleted rows drop out. */
function readHistoryHashes(historyIds: number[]) {
  const db = getUserSettingsDb()
  const hashById = new Map<number, string>()
  for (const chunk of chunked(historyIds)) {
    const rows = db.prepare(`
      SELECT id, composite_hash FROM api_generation_history
      WHERE generation_status = 'completed' AND composite_hash IS NOT NULL AND id IN (${chunk.map(() => '?').join(',')})
    `).all(...chunk) as Array<{ id: number; composite_hash: string }>
    rows.forEach((row) => hashById.set(row.id, row.composite_hash))
  }
  return hashById
}

/** Library images that still exist (an active file, post-processing done), with what the viewer needs to know. */
function readActiveMedia(compositeHashes: string[]) {
  const db = getUserSettingsDb()
  const mediaByHash = new Map<string, { mimeType: string | null; width: number | null; height: number | null }>()
  for (const chunk of chunked(compositeHashes)) {
    const rows = db.prepare(`
      SELECT f.composite_hash, f.mime_type, m.width, m.height
      FROM main_db.image_files f
      JOIN main_db.media_metadata m ON m.composite_hash = f.composite_hash
        AND ${MediaPostprocessVisibilityService.buildReadyCondition('m')}
      WHERE f.file_status = 'active' AND f.composite_hash IN (${chunk.map(() => '?').join(',')})
    `).all(...chunk) as Array<{ composite_hash: string; mime_type: string | null; width: number | null; height: number | null }>
    rows.forEach((row) => mediaByHash.set(row.composite_hash, { mimeType: row.mime_type, width: row.width, height: row.height }))
  }
  return mediaByHash
}

/**
 * Every image a chat's transcript references, newest first and once each. Derived from the stored tool calls on every
 * read, so deleting the chat (its messages) leaves nothing behind, and images removed from the library drop out.
 * An image both generated and later looked up counts as generated, pointing at the message that made it.
 */
export function collectCodexChatMedia(messages: CodexChatMessageRecord[]): CodexChatMediaItem[] {
  const assistantCalls = messages
    .filter((message) => message.role === 'assistant')
    .map((message) => ({ message, calls: message.tool_calls }))

  const historyIds = [...new Set(assistantCalls.flatMap(({ calls }) => calls.flatMap((call) => call.historyIds ?? [])))]
  const historyHashById = readHistoryHashes(historyIds)

  // Same order as the thumbnails in the transcript: per message, history results first, then library hashes.
  const references = new Map<string, MediaReference>()
  for (const { message, calls } of assistantCalls) {
    for (const call of calls) {
      const reference: MediaReference = {
        messageId: message.id,
        createdDate: message.created_date,
        source: (call.generated ?? isCodexChatGenerationTool(call.tool)) ? 'generated' : 'found',
      }
      const hashes = [
        ...(call.historyIds ?? []).map((historyId) => historyHashById.get(historyId)),
        ...(call.compositeHashes ?? []),
      ]
      for (const hash of hashes) {
        if (!hash) {
          continue
        }
        const existing = references.get(hash)
        if (!existing || (existing.source === 'found' && reference.source === 'generated')) {
          references.set(hash, reference)
        }
      }
    }
  }

  const mediaByHash = readActiveMedia([...references.keys()])
  const items: CodexChatMediaItem[] = []
  references.forEach((reference, compositeHash) => {
    const media = mediaByHash.get(compositeHash)
    if (media) {
      items.push({ compositeHash, ...reference, ...media })
    }
  })

  return items.reverse()
}
