import { isCodexChatGenerationTool } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
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
  if (!JOB_TOOLS.has(call.tool)) return []
  const match = /"(?:job_)?id"\s*:\s*(\d+)/.exec(call.output ?? call.summary ?? '')
  return match ? [Number(match[1])] : []
}

/**
 * Generation jobs finish after the reply that started them, often after the agent stopped checking. Attach each
 * referenced job's history rows to the tool call (read-only, not stored) and count the jobs still running, so the chat
 * shows results as they land without waiting for another message.
 */
export function attachJobResults(messages: CodexChatMessageRecord[]) {
  const jobIds = [...new Set(messages.flatMap((message) => message.tool_calls.flatMap(jobIdsOf)))]
  if (jobIds.length === 0) {
    return { messages, pendingJobs: 0 }
  }

  const db = getUserSettingsDb()
  const historiesByJob = new Map<number, number[]>()
  const pendingJobIds = new Set<number>()
  for (const chunk of chunked(jobIds)) {
    const placeholders = chunk.map(() => '?').join(',')
    const histories = db.prepare(`SELECT id, queue_job_id FROM api_generation_history WHERE queue_job_id IN (${placeholders}) ORDER BY id`).all(...chunk) as Array<{ id: number; queue_job_id: number }>
    histories.forEach((row) => historiesByJob.set(row.queue_job_id, [...(historiesByJob.get(row.queue_job_id) ?? []), row.id]))
    const jobs = db.prepare(`SELECT id, status FROM generation_queue_jobs WHERE id IN (${placeholders})`).all(...chunk) as Array<{ id: number; status: string }>
    jobs.filter((job) => !FINISHED_JOB_STATUSES.has(job.status)).forEach((job) => pendingJobIds.add(job.id))
  }

  // A job shows once in the transcript: as its history rows, or as a placeholder on its last mention while queued.
  const lastMention = new Map<number, string>()
  messages.forEach((message) => message.tool_calls.forEach((call) => jobIdsOf(call).forEach((jobId) => lastMention.set(jobId, `${message.id}:${call.id}`))))

  return {
    pendingJobs: pendingJobIds.size,
    messages: messages.map((message) => ({
      ...message,
      tool_calls: message.tool_calls.map((call) => {
        const ids = jobIdsOf(call)
        const attached = ids.flatMap((jobId) => historiesByJob.get(jobId) ?? [])
        const placeholders = ids.filter((jobId) => pendingJobIds.has(jobId) && !historiesByJob.has(jobId) && lastMention.get(jobId) === `${message.id}:${call.id}`)
        if (attached.length === 0 && placeholders.length === 0) return call
        return {
          ...call,
          historyIds: [...new Set([...call.historyIds, ...attached])],
          ...(placeholders.length > 0 ? { pendingJobIds: placeholders } : {}),
        }
      }),
    })),
  }
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
        source: isCodexChatGenerationTool(call.tool) ? 'generated' : 'found',
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
