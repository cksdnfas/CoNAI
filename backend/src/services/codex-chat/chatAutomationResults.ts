import type { ChatToolCall, PluginProfileRun } from '@conai/shared'
import { attachJobResults } from './codexChatMedia'
import type { CodexChatMessageRecord } from './codexChatStore'

/** Private messages keep full tool records; plugin/log summaries are bounded and omit arguments. */
export function automationResults(replies: CodexChatMessageRecord[]) {
  const tools: PluginProfileRun['tools'] = []
  const calls: ChatToolCall[] = []
  let bytes = 0, summaryToolsTruncated = false
  for (const reply of attachJobResults(replies).messages) {
    for (const call of reply.tool_calls) {
      // The private caller-room message retains the actual tool results. Only external summaries are bounded.
      calls.push(call)
      const entry = { id: call.id.slice(0, 160), name: call.tool.slice(0, 128), status: call.status,
        summary: (call.summary ?? '').slice(0, 300), output: (call.output ?? '').slice(0, 600),
        historyIds: call.historyIds.slice(0, 20), compositeHashes: call.compositeHashes.slice(0, 20),
        audioCandidateIds: (call.audioCandidateIds ?? []).slice(0, 20), pendingJobIds: (call.pendingJobIds ?? []).slice(0, 20),
        proposalId: call.proposal?.id ?? null, failedJobs: (call.failedJobs ?? []).slice(0, 20).map(job => ({ jobId: job.jobId, message: job.failureMessage.slice(0, 300) })),
        ...(call.deferred ? { deferred: { state: call.deferred.state, error: call.deferred.error?.slice(0, 300) ?? null } } : {}) }
      const size = Buffer.byteLength(JSON.stringify(entry))
      const keepSummary = tools.length < 32 && bytes + size <= 24 * 1024
      if (!keepSummary || [call.historyIds, call.compositeHashes, call.audioCandidateIds, call.pendingJobIds, call.failedJobs].some(items => (items?.length ?? 0) > 20)
        || call.id.length > 160 || call.tool.length > 128 || (call.summary?.length ?? 0) > 300 || (call.output?.length ?? 0) > 600
        || call.failedJobs?.some(job => job.failureMessage.length > 300) || (call.deferred?.error?.length ?? 0) > 300) summaryToolsTruncated = true
      if (keepSummary) { tools.push(entry); bytes += size }
    }
  }
  return { tools, calls, summaryToolsTruncated, messageToolsTruncated: false }
}
