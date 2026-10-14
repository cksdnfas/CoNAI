import { z } from 'zod'
import type { PluginLlmJob, PluginLlmProfile } from '@conai/shared'
import type { McpRequester } from '../../mcp/context'
import { ChatProfileStore } from '../codex-chat/chatProfiles'
import { canUseChatProfile, resolveChatAccess } from '../codex-chat/codexChatAccess'
import { loadChatSettings } from '../codex-chat/chatSettings'
import { buildChatProfileReplyMessages } from '../codex-chat/chatProfileReply'
import { runWorkflowLlmText } from '../graph-workflow-executor/workflow-llm-runtime'
import { RuntimeJobRunner } from '../runtimeJobs/runtimeJobRunner'
import { RuntimeJobConflictError, RuntimeJobStore, RUNTIME_JOB_TTL_MS } from '../runtimeJobs/runtimeJobStore'
import { getPlugin } from './pluginRegistry'
import { onPluginChanged, pluginDb, PluginError, sha256 } from './pluginStore'

const inputSchema = z.object({
  requestId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_.:-]+$/),
  profileId: z.number().int().positive(), message: z.string().trim().min(1).max(16_000),
  history: z.string().max(32_000).default(''), userName: z.string().trim().min(1).max(100).default('사용자'),
  useLorebooks: z.boolean().default(true), maxTokens: z.number().int().min(1).max(4096).default(512),
  timeoutMs: z.number().int().min(1000).max(600_000).default(120_000),
}).strict()
type Input = z.infer<typeof inputSchema>
type Row = { plugin_id: string; owner_key: string; request_key: string; fingerprint: string; digest: string; profile_id: number; job_id: string; expires_at: number }
type Params = { pluginId: string; requester: McpRequester; digest: string; slot: number; inputKey: string }
// Prompts live only for admitted work, never in runtime_jobs.params or the idempotency table.
const inputs = new Map<string, Input>()

function access(pluginId: string, requester: McpRequester | undefined) {
  const plugin = getPlugin(pluginId)
  if (!plugin.definition.server) throw new PluginError('LLM 연결에는 신뢰된 서버 플러그인이 필요해.', 403)
  if (!requester || !loadChatSettings().enabled) throw new PluginError('채팅이 꺼졌거나 사용할 계정이 없어.', 403)
  const chat = resolveChatAccess(requester.accountId)
  if (!chat.llm && !chat.claude && !chat.codex) throw new PluginError('채팅 권한이 없어.', 403)
  return { plugin, chat, requester, owner: String(requester.accountId ?? 'bootstrap') }
}
function profileAccess(pluginId: string, requester: McpRequester | undefined, profileId: number, digest?: string) {
  const current = access(pluginId, requester)
  if (digest && current.plugin.digest !== digest) throw new PluginError('플러그인 버전이 바뀌었어.', 409)
  const profile = ChatProfileStore.find(profileId)
  if (!profile?.isEnabled || !canUseChatProfile(current.chat, profile)) throw new PluginError('사용할 수 없는 프로필이야.', 403)
  return { ...current, profile }
}

export function listPluginLlmProfiles(pluginId: string, requester: McpRequester | undefined): PluginLlmProfile[] {
  const { chat } = access(pluginId, requester)
  return ChatProfileStore.list({ enabledOnly: true }).filter(profile => canUseChatProfile(chat, profile))
    .map(({ id, name, tagline, engine }) => ({ id, name, tagline, engine }))
}
function view(row: Row): PluginLlmJob {
  const job = RuntimeJobStore.get(row.job_id)
  if (!job || row.expires_at <= Date.now()) throw new PluginError('답변 작업이 만료됐어. 같은 요청을 자동 재전송하지 마.', 410)
  return { jobId: job.jobId, requestId: row.request_key, profileId: row.profile_id, status: job.status,
    cancelRequested: job.cancelRequested, result: job.result as PluginLlmJob['result'], error: job.failureMessage, expiresAt: row.expires_at }
}
function owned(pluginId: string, requester: McpRequester | undefined, jobId: unknown) {
  const { owner } = access(pluginId, requester)
  const id = z.string().uuid().parse(jobId)
  const row = pluginDb().prepare('SELECT * FROM plugin_llm_requests WHERE job_id=? AND plugin_id=? AND owner_key=?').get(id, pluginId, owner) as Row | undefined
  if (!row) throw new PluginError('답변 작업을 찾을 수 없어.', 404)
  return row
}
export function getPluginLlmJob(pluginId: string, requester: McpRequester | undefined, jobId: unknown) {
  const row = owned(pluginId, requester, jobId)
  profileAccess(pluginId, requester, row.profile_id)
  return view(row)
}
export function cancelPluginLlmJob(pluginId: string, requester: McpRequester | undefined, jobId: unknown) {
  const row = owned(pluginId, requester, jobId)
  // A removed/disabled profile must not prevent stopping a previously admitted call.
  RuntimeJobRunner.cancel(row.job_id)
  return view(row)
}

function registerJob() {
  if (RuntimeJobRunner.isRegistered('plugin-llm')) return
  RuntimeJobRunner.register<Params, NonNullable<PluginLlmJob['result']>>({
    kind: 'plugin-llm', singletonKey: params => `plugin-llm:${params.slot}`,
    handler: async ctx => {
      // Start returns a durable ID before any provider request is made.
      await ctx.yield()
      const { pluginId, requester, digest, inputKey } = ctx.params
      const input = inputs.get(inputKey)
      inputs.delete(inputKey)
      if (!input) throw new PluginError('중단된 답변은 자동 재실행하지 않아. 새 요청이 필요해.')
      ctx.throwIfCancelled()
      const { profile } = profileAccess(pluginId, requester, input.profileId, digest)
      const controller = new AbortController()
      const abort = () => controller.abort(ctx.signal.reason)
      ctx.signal.addEventListener('abort', abort, { once: true })
      const timeout = setTimeout(() => controller.abort(new DOMException('답변 제한 시간을 넘었어.', 'TimeoutError')), input.timeoutMs)
      const permissionCheck = setInterval(() => {
        try {
          ctx.throwIfCancelled()
          profileAccess(pluginId, requester, input.profileId, digest)
        } catch (error) { controller.abort(error) }
      }, 1000)
      timeout.unref(); permissionCheck.unref()
      try {
        ctx.flush({ phase: 'generating', currentLabel: profile.name, total: 1 })
        const messages = buildChatProfileReplyMessages({ profile, message: input.message, history: input.history || null, userName: input.userName, useLorebooks: input.useLorebooks })
        const result = await runWorkflowLlmText({
          target: { profileId: profile.id, requesterAccountId: requester.accountId }, messages,
          task: `Reply as ${profile.name}.`, signal: controller.signal,
          overrides: { maxTokens: Math.min(input.maxTokens, profile.maxTokens ?? input.maxTokens) },
          usage: { purpose: 'plugin', replyId: `plugin:${pluginId}:${ctx.jobId}` },
        })
        controller.signal.throwIfAborted(); ctx.throwIfCancelled()
        profileAccess(pluginId, requester, input.profileId, digest)
        // Even escape-heavy text fits the runtime job's 64 KiB JSON result cap.
        const text = result.text.slice(0, 8000)
        ctx.flush({ processed: 1, succeeded: 1 })
        return { text, truncated: text.length !== result.text.length, model: result.model.slice(0, 200), engine: result.engine }
      } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason
        // Provider errors can contain request bodies or credentials; keep them out of job results/logs.
        throw new PluginError('프로필 답변 생성에 실패했어. 모델 연결과 입력 길이를 확인해줘.')
      } finally {
        clearTimeout(timeout); clearInterval(permissionCheck)
        ctx.signal.removeEventListener('abort', abort)
      }
    },
  })
}

export function startPluginLlmJob(pluginId: string, requester: McpRequester | undefined, raw: unknown): PluginLlmJob {
  const input = inputSchema.parse(raw)
  const { plugin, owner, requester: actor } = profileAccess(pluginId, requester, input.profileId)
  const fingerprint = sha256(JSON.stringify(input))
  const db = pluginDb()
  registerJob()
  // SQLite admission and request identity are atomic, including between API processes.
  return db.transaction(() => {
    const previous = db.prepare('SELECT * FROM plugin_llm_requests WHERE plugin_id=? AND owner_key=? AND request_key=?').get(pluginId, owner, input.requestId) as Row | undefined
    if (previous) {
      if (previous.fingerprint !== fingerprint || previous.digest !== plugin.digest) throw new PluginError('같은 요청 ID에 다른 입력이나 플러그인 버전을 사용할 수 없어.', 409)
      return view(previous)
    }
    db.prepare('DELETE FROM plugin_llm_requests WHERE expires_at<? AND job_id NOT IN (SELECT job_id FROM runtime_jobs WHERE status IN (\'queued\',\'running\'))').run(Date.now())
    const count = db.prepare('SELECT COUNT(*) AS n FROM plugin_llm_requests WHERE plugin_id=?').get(pluginId) as { n: number }
    if (count.n >= 10_000) throw new PluginError('플러그인 답변 기록 한도에 도달했어. 만료 후 다시 요청해줘.', 429)
    const inputKey = `${pluginId}:${owner}:${input.requestId}`
    inputs.set(inputKey, input)
    try {
      for (const slot of [0, 1, 2, 3]) {
        try {
          const job = RuntimeJobRunner.start('plugin-llm', { pluginId, requester: actor, digest: plugin.digest, inputKey, slot }, { requestedByAccountId: actor.accountId, total: 1 })
          const row: Row = { plugin_id: pluginId, owner_key: owner, request_key: input.requestId, fingerprint, digest: plugin.digest, profile_id: input.profileId, job_id: job.jobId, expires_at: Date.now() + RUNTIME_JOB_TTL_MS }
          db.prepare('INSERT INTO plugin_llm_requests(plugin_id,owner_key,request_key,fingerprint,digest,profile_id,job_id,expires_at) VALUES(?,?,?,?,?,?,?,?)').run(pluginId, owner, input.requestId, fingerprint, plugin.digest, input.profileId, job.jobId, row.expires_at)
          return view(row)
        } catch (error) { if (!(error instanceof RuntimeJobConflictError)) throw error }
      }
      throw new PluginError('플러그인 답변 4개가 실행 중이야. 완료 후 같은 요청 ID로 다시 시도해줘.', 429)
    } catch (error) { inputs.delete(inputKey); throw error }
  }).immediate()
}

/** One dispatcher for the authenticated page bridge and server worker SDK. */
export function callPluginLlm(pluginId: string, requester: McpRequester | undefined, method: string, args: unknown) {
  if (method === 'profiles') return listPluginLlmProfiles(pluginId, requester)
  if (method === 'start') return startPluginLlmJob(pluginId, requester, args)
  const { jobId } = z.object({ jobId: z.string().uuid() }).strict().parse(args)
  if (method === 'get') return getPluginLlmJob(pluginId, requester, jobId)
  if (method === 'cancel') return cancelPluginLlmJob(pluginId, requester, jobId)
  throw new PluginError('알 수 없는 LLM 요청이야.')
}

// Cancels native provider requests as well as stopping the plugin's worker on disable/update/removal.
onPluginChanged(pluginId => {
  let digest: string | null = null
  try { const plugin = getPlugin(pluginId); if (plugin.definition.server) digest = plugin.digest } catch { /* disabled or removed */ }
  const rows = pluginDb().prepare("SELECT r.job_id, r.digest FROM plugin_llm_requests r JOIN runtime_jobs j ON j.job_id=r.job_id WHERE r.plugin_id=? AND j.status IN ('queued','running')").all(pluginId) as Array<{ job_id: string; digest: string }>
  for (const row of rows) if (row.digest !== digest) RuntimeJobRunner.cancel(row.job_id)
})
