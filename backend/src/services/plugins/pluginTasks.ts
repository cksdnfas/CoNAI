import { z } from 'zod'
import type { McpRequester } from '../../mcp/context'
import { requireRequesterPermission } from '../../middleware/featureAccess'
import { RuntimeJobRunner, type RuntimeJobContext } from '../runtimeJobs/runtimeJobRunner'
import { RuntimeJobStore, RuntimeJobConflictError, RUNTIME_JOB_TTL_MS } from '../runtimeJobs/runtimeJobStore'
import { getPlugin } from './pluginRegistry'
import { onPluginChanged, pluginDb, PluginError, sha256 } from './pluginStore'

type Params = { pluginId: string; digest: string; requester: McpRequester; inputKey: string; slot: number }
type Row = { plugin_id: string; owner_key: string; request_key: string; fingerprint: string; digest: string; job_id: string; expires_at: number }
type Input = { requestId: string; data: Record<string, unknown> }
type Invoker = (pluginId: string, data: Record<string, unknown>, requester: McpRequester, ctx: RuntimeJobContext<Params>) => Promise<unknown>
const inputs = new Map<string, Input>()
let invoke: Invoker | undefined
export function setPluginTaskInvoker(value: Invoker) { invoke = value }

function access(pluginId: string, requester: McpRequester | undefined, digest?: string) {
  const plugin = getPlugin(pluginId)
  if (!requester) throw new PluginError('플러그인 작업에는 로그인한 계정이 필요해.', 403)
  requireRequesterPermission(requester, 'generation.execute')
  if (digest && plugin.digest !== digest) throw new PluginError('플러그인 버전이 바뀌었어.', 409)
  return { plugin, requester, owner: String(requester.accountId ?? 'bootstrap') }
}
function view(row: Row) {
  const job = RuntimeJobStore.get(row.job_id)
  if (!job || row.expires_at <= Date.now()) throw new PluginError('작업이 만료됐어. 결과를 확인한 뒤 새 요청을 만들어줘.', 410)
  return { jobId: job.jobId, requestId: row.request_key, status: job.status, progress: job.progress,
    phase: job.phase, cancelRequested: job.cancelRequested, result: job.result, error: job.failureMessage }
}
function register() {
  if (RuntimeJobRunner.isRegistered('plugin-task')) return
  RuntimeJobRunner.register<Params, unknown>({ kind: 'plugin-task', singletonKey: p => `plugin-task:${p.slot}`, handler: async ctx => {
    await ctx.yield()
    const { pluginId, digest, requester, inputKey } = ctx.params
    const input = inputs.get(inputKey)
    inputs.delete(inputKey)
    if (!input || !invoke) throw new PluginError('중단된 플러그인 작업은 자동 재실행하지 않아.')
    access(pluginId, requester, digest); ctx.throwIfCancelled()
    const permissionCheck = setInterval(() => {
      try { access(pluginId, requester, digest) } catch { RuntimeJobRunner.cancel(ctx.jobId) }
    }, 1000)
    permissionCheck.unref()
    try {
      const result = await invoke(pluginId, input.data, requester, ctx)
      access(pluginId, requester, digest); ctx.throwIfCancelled()
      if (Buffer.byteLength(JSON.stringify(result ?? null)) > 60 * 1024) throw new PluginError('작업 결과가 너무 커. 파일 참조를 반환해줘.')
      ctx.flush({ total: 100, processed: 100, succeeded: 100, phase: 'completed' })
      return result
    } finally { clearInterval(permissionCheck) }
  } })
}

/** Background processing for trusted server modules, using the host's durable jobs and cancellation. */
export function callPluginTask(pluginId: string, requester: McpRequester | undefined, method: string, raw: unknown) {
  const { plugin, requester: actor, owner } = access(pluginId, requester)
  const db = pluginDb()
  if (method !== 'start') {
    const { jobId } = z.object({ jobId: z.string().uuid() }).strict().parse(raw)
    const row = db.prepare('SELECT * FROM plugin_task_requests WHERE plugin_id=? AND owner_key=? AND job_id=?').get(pluginId, owner, jobId) as Row | undefined
    if (!row) throw new PluginError('내 플러그인 작업을 찾을 수 없어.', 404)
    if (method === 'cancel') RuntimeJobRunner.cancel(jobId)
    else if (method !== 'get') throw new PluginError('알 수 없는 작업 요청이야.')
    return view(row)
  }
  const input = z.object({ requestId: z.string().min(8).max(100).regex(/^[a-zA-Z0-9_.:-]+$/), data: z.record(z.string(), z.unknown()) }).strict().parse(raw)
  const serialized = JSON.stringify(input.data)
  if (Buffer.byteLength(serialized) > 256 * 1024) throw new PluginError('작업 입력은 256KB까지 지원해.', 413)
  const fingerprint = sha256(serialized)
  register()
  return db.transaction(() => {
    const previous = db.prepare('SELECT * FROM plugin_task_requests WHERE plugin_id=? AND owner_key=? AND request_key=?').get(pluginId, owner, input.requestId) as Row | undefined
    if (previous) {
      if (previous.fingerprint !== fingerprint || previous.digest !== plugin.digest) throw new PluginError('같은 요청 ID의 입력이나 플러그인 버전이 달라.', 409)
      return view(previous)
    }
    db.prepare("DELETE FROM plugin_task_requests WHERE expires_at<? AND job_id NOT IN (SELECT job_id FROM runtime_jobs WHERE status IN ('queued','running'))").run(Date.now())
    if ((db.prepare('SELECT COUNT(*) AS n FROM plugin_task_requests WHERE plugin_id=?').get(pluginId) as { n: number }).n >= 1000) throw new PluginError('작업 기록 한도에 도달했어.', 429)
    if (db.prepare("SELECT 1 FROM plugin_task_requests r JOIN runtime_jobs j ON j.job_id=r.job_id WHERE r.plugin_id=? AND j.status IN ('queued','running') LIMIT 1").get(pluginId)) throw new PluginError('이 플러그인의 작업이 이미 실행 중이야.', 429)
    const inputKey = `${pluginId}:${owner}:${input.requestId}`
    inputs.set(inputKey, input)
    try {
      let job: ReturnType<typeof RuntimeJobRunner.start> | undefined
      for (const slot of [0, 1]) {
        try { job = RuntimeJobRunner.start('plugin-task', { pluginId, digest: plugin.digest, requester: actor, inputKey, slot }, { requestedByAccountId: actor.accountId, total: 100 }); break }
        catch (error) { if (!(error instanceof RuntimeJobConflictError)) throw error }
      }
      if (!job) throw new PluginError('플러그인 처리 작업 2개가 실행 중이야. 완료 후 같은 요청 ID로 다시 시도해줘.', 429)
      const row: Row = { plugin_id: pluginId, owner_key: owner, request_key: input.requestId, fingerprint, digest: plugin.digest, job_id: job.jobId, expires_at: Date.now() + RUNTIME_JOB_TTL_MS }
      db.prepare('INSERT INTO plugin_task_requests VALUES(?,?,?,?,?,?,?)').run(pluginId, owner, input.requestId, fingerprint, plugin.digest, job.jobId, row.expires_at)
      return view(row)
    } catch (error) { inputs.delete(inputKey); throw error }
  }).immediate()
}

onPluginChanged(pluginId => {
  let digest: string | null = null
  try { digest = getPlugin(pluginId).digest } catch { /* disabled/removed */ }
  const rows = pluginDb().prepare("SELECT r.job_id, r.digest FROM plugin_task_requests r JOIN runtime_jobs j ON j.job_id=r.job_id WHERE r.plugin_id=? AND j.status IN ('queued','running')").all(pluginId) as Array<{ job_id: string; digest: string }>
  for (const row of rows) if (row.digest !== digest) RuntimeJobRunner.cancel(row.job_id)
})
