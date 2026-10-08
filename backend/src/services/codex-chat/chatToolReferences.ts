const TOOL_SUMMARY_LENGTH = 600
const MAX_REFERENCES_PER_CALL = 24

type McpToolResult = { content?: unknown[]; structuredContent?: unknown } | null | undefined

/** Tools whose result is one generation queue job (its `id`). */
const JOB_RESULT_TOOLS = new Set(['submit_generation_job', 'get_generation_job', 'wait_generation_job', 'get_generation_artifacts'])
/** Tools whose result is an audio order: several queue jobs (`job_ids`, with per-job status in `jobs`). */
const AUDIO_ORDER_RESULT_TOOLS = new Set(['order_audio', 'get_audio_order', 'wait_audio_order', 'cancel_audio_order', 'retry_audio_order_job'])
const AUDIO_CANDIDATE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Queue job ids of an audio order result and the ones not finished yet. */
function readAudioOrderJobs(value: unknown, jobIds: Set<number>, pendingJobIds: Set<number>) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const jobs = (value as { jobs?: unknown }).jobs
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const id = (job as { job_id?: unknown })?.job_id
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) continue
    jobIds.add(id)
    if (!['completed', 'failed', 'cancelled'].includes(String((job as { status?: unknown }).status))) pendingJobIds.add(id)
  }
}

function readJobId(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const id = record.job_id ?? record.id
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * The scene the model asked for with a creation tool call: the `prompt` of a preset tool (generate_image_N), or the
 * prompt / inputs of a submit_generation_job payload. What a summary or another member keeps of the call, since the
 * job JSON in its result says nothing about the picture.
 */
export function generationPromptOf(call: { tool: string; arguments: unknown }): string | null {
  if (!call.arguments || typeof call.arguments !== 'object') return null
  const args = call.arguments as Record<string, unknown>
  const direct = args.prompt
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  const payload = args.request_payload
  if (payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).prompt === 'string') {
    const prompt = ((payload as Record<string, unknown>).prompt as string).trim()
    if (prompt) return prompt
  }
  const inputs = args.inputs
  if (inputs && typeof inputs === 'object' && Object.keys(inputs as object).length > 0) {
    return Object.entries(inputs as Record<string, unknown>).map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`).join('; ')
  }
  return null
}

export function truncateToolSummary(value: string) {
  return value.length > TOOL_SUMMARY_LENGTH ? `${value.slice(0, TOOL_SUMMARY_LENGTH)}…` : value
}

/** Pull history ids, composite hashes and audio candidate ids out of a tool result so the UI can show them. */
function collectReferences(value: unknown, historyIds: Set<number>, compositeHashes: Set<string>, depth = 0, audioCandidateIds?: Set<string>) {
  if (depth > 8 || value === null || typeof value !== 'object') {
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectReferences(item, historyIds, compositeHashes, depth + 1, audioCandidateIds))
    return
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/^history_?ids?$/i.test(key)) {
      for (const id of Array.isArray(entry) ? entry : [entry]) {
        if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0 && historyIds.size < MAX_REFERENCES_PER_CALL) {
          historyIds.add(id)
        }
      }
    } else if (/^composite_?hash(es)?$/i.test(key)) {
      for (const hash of Array.isArray(entry) ? entry : [entry]) {
        if (typeof hash === 'string' && /^[0-9a-f]{16,128}$/i.test(hash) && compositeHashes.size < MAX_REFERENCES_PER_CALL) {
          compositeHashes.add(hash)
        }
      }
    } else if (audioCandidateIds && /^audio_?candidate_?ids?$/i.test(key)) {
      for (const id of Array.isArray(entry) ? entry : [entry]) {
        if (typeof id === 'string' && AUDIO_CANDIDATE_ID.test(id) && audioCandidateIds.size < MAX_REFERENCES_PER_CALL) {
          audioCandidateIds.add(id)
        }
      }
    } else {
      collectReferences(entry, historyIds, compositeHashes, depth + 1, audioCandidateIds)
    }
  }
}

/**
 * The text parts of an MCP tool result plus the history ids / composite hashes it mentions (JSON text or structured
 * content), and for generation-job tools the job id, so results can be attached later when the job finishes.
 */
export function readMcpToolResult(result: McpToolResult, toolName?: string) {
  const historyIds = new Set<number>()
  const compositeHashes = new Set<string>()
  const jobIds = new Set<number>()
  const pendingJobIds = new Set<number>()
  const audioCandidateIds = new Set<string>()
  const texts: string[] = []
  const readsJob = toolName !== undefined && (JOB_RESULT_TOOLS.has(toolName) || /^generate_image(_\d+)?$/.test(toolName))
  const readsAudioOrder = toolName !== undefined && AUDIO_ORDER_RESULT_TOOLS.has(toolName)

  for (const content of result?.content ?? []) {
    const text = content && typeof content === 'object' ? (content as { text?: unknown }).text : undefined
    if (typeof text !== 'string') {
      continue
    }
    texts.push(text)
    try {
      const parsed = JSON.parse(text)
      collectReferences(parsed, historyIds, compositeHashes, 0, audioCandidateIds)
      if (readsAudioOrder) readAudioOrderJobs(parsed, jobIds, pendingJobIds)
      const jobId = readsJob ? readJobId(parsed) : null
      if (jobId !== null) {
        jobIds.add(jobId)
        if (!['completed', 'failed', 'cancelled'].includes(parsed.status)) pendingJobIds.add(jobId)
      }
    } catch {
      // Plain-text tool output carries no references.
    }
  }
  if (result?.structuredContent) {
    collectReferences(result.structuredContent, historyIds, compositeHashes, 0, audioCandidateIds)
    if (readsAudioOrder) readAudioOrderJobs(result.structuredContent, jobIds, pendingJobIds)
    const jobId = readsJob ? readJobId(result.structuredContent) : null
    if (jobId !== null) {
      jobIds.add(jobId)
      if (!['completed', 'failed', 'cancelled'].includes((result.structuredContent as { status?: string }).status ?? '')) pendingJobIds.add(jobId)
    }
  }

  return { texts, historyIds: [...historyIds], compositeHashes: [...compositeHashes], jobIds: [...jobIds], pendingJobIds: [...pendingJobIds], audioCandidateIds: [...audioCandidateIds] }
}
