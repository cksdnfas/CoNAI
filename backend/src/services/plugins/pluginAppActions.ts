import { z } from 'zod'
import { validateChatPageArguments, type PluginAppRequest } from '@conai/shared'
import type { McpRequestContext } from '../../mcp/context'
import { ALL_MCP_HTTP_SCOPES } from '../../mcp/context'
import { requireMcpToolAccess, refreshMcpRequester } from '../../mcp/toolAccess'
import { isRequesterAdmin, requireRequesterPermission } from '../../middleware/featureAccess'
import { mcpHttpSettingsService } from '../mcpHttpSettingsService'
import { pluginDb, pluginToken as token, sha256 as hash, PluginError } from './pluginStore'
import { getPlugin } from './pluginRegistry'
import { requirePluginInstance, type PluginCaller } from './pluginHost'
import { pluginAppToolScope, pluginAppTools, trustedAppTools } from './pluginAppPolicy'
import { callPluginAppTool, pluginAppDefinitions } from './pluginAppBridge'
import { RuntimeJobRunner } from '../runtimeJobs/runtimeJobRunner'
import { RuntimeJobStore, RuntimeJobConflictError } from '../runtimeJobs/runtimeJobStore'
import { WorkspaceService } from '../workspaceService'
import { requireFileStoreOwner } from '../fileStoreAccess'

type Context = Pick<McpRequestContext, 'requester' | 'scopes' | 'keyId' | 'keyGroup' | 'baseUrl' | 'contentRatingLimit' | 'toolAllowlist' | 'workspace'> & { projectGrant?: { id: string; revision: number; write: boolean; threadId?: number; bindingRevision?: string } }
type Row = { id: string; owner_key: string; request_key: string; fingerprint: string; plugin_id: string; digest: string; body: string; context: string; status: PluginAppRequest['status']; job_id: string | null; expires_at: number }
const REQUEST_LIFETIME_MS = 24 * 60 * 60_000
const requestKey = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/)
const argsSchema = z.record(z.string(), z.unknown())
export const pluginAppCallSchema = z.object({ tool: z.string().max(64), arguments: argsSchema.default({}), requestId: requestKey.optional() }).strict()
export const pluginActionRunSchema = z.object({ pluginId: z.string().max(48), action: z.string().max(100), arguments: argsSchema.default({}), requestId: requestKey.optional() }).strict()
function owner(context: Context) {
  if (context.requester) { refreshMcpRequester(context.requester); return context.requester.accountId === null ? 'bootstrap' : `account:${context.requester.accountId}` }
  if (context.keyId) return `key:${context.keyId}`
  throw new PluginError('계정 또는 인증된 MCP 키가 필요해.', 403)
}
function fresh(context: Context) {
  // A TypeScript Pick is not a runtime filter: never persist chat/page snapshots or bridge metadata.
  const origin = context as McpRequestContext
  const projectGrant = context.projectGrant ?? (context.workspace ? { id: context.workspace.project.id, revision: context.workspace.project.revision, write: context.workspace.write, threadId: origin.chatContext?.threadId, bindingRevision: origin.chatContext ? context.workspace.bindingRevision : undefined } : undefined)
  context = { requester: context.requester ? { accountId: context.requester.accountId, accountType: context.requester.accountType } : undefined, scopes: [...context.scopes], keyId: context.keyId, keyGroup: context.keyGroup, baseUrl: context.baseUrl, contentRatingLimit: context.contentRatingLimit, toolAllowlist: context.toolAllowlist ? [...context.toolAllowlist] : undefined, projectGrant }
  owner(context)
  if (projectGrant) {
    const actor = requireFileStoreOwner(context.requester)
    const current = WorkspaceService.get(actor, projectGrant.id)
    if (current.revision !== projectGrant.revision) throw new PluginError('프로젝트 지침이 변경됐어. 새 작업을 요청해줘.', 409)
    if (projectGrant.threadId) {
      const binding = WorkspaceService.binding(actor, projectGrant.threadId)
      if (!binding || binding.bindingRevision !== projectGrant.bindingRevision || binding.project.id !== projectGrant.id || (projectGrant.write && !binding.write)) throw new PluginError('채팅의 프로젝트 연결이 변경됐어.', 403)
    }
    context.workspace = { project: { ...current, guidelines: '' }, write: projectGrant.write, bindingRevision: projectGrant.bindingRevision ?? 'plugin-approved-project' }
  }
  if (context.keyId && !context.requester) {
    const settings = mcpHttpSettingsService.loadSettings()
    const key = settings.keys.find(key => key.id === context.keyId)
    if (!settings.enabled || !key) throw new PluginError('MCP 키가 비활성화되거나 회수됐어.', 403)
    // The key's current permission group decides its tools (requireMcpToolAccess); scopes no longer narrow a key.
    context = { ...context, keyGroup: key.groupKey }
  }
  return context
}
/** A package with a server module is trusted code: it reaches every app tool without declaring it or waiting for approval. */
export const isTrustedPlugin = (definition: { capabilities: readonly string[] }) => definition.capabilities.includes('server')
function authorize(pluginId: string, tool: string, context: Context, args: Record<string, unknown>) {
  const plugin = getPlugin(pluginId), trusted = isTrustedPlugin(plugin.definition), scope = pluginAppToolScope(tool, trusted)
  if (!scope || (!trusted && !plugin.definition.appTools?.includes(tool))) throw new PluginError('확장에 선언하지 않은 앱 도구야.', 403)
  context = fresh(tool.startsWith('workspace_') ? context : { ...context, workspace: undefined, projectGrant: undefined })
  // A caller's scope/allowlist stays narrower than the package's grant.
  if (!context.scopes.includes(scope) || (context.toolAllowlist && !context.toolAllowlist.includes(tool))) throw new PluginError('요청 주체에게 허용되지 않은 앱 기능이야.', 403)
  requireMcpToolAccess({ ...context, source: 'plugin' }, tool, args)
  return { plugin, scope, context, trusted }
}
// `configure` only matters to trusted packages (others never get a configure tool); the account still has to be an admin.
export function pluginBrowserContext(caller: PluginCaller, baseUrl?: string): Context { return { requester: caller.requester, scopes: [...ALL_MCP_HTTP_SCOPES, 'configure'], baseUrl } }
export async function listPluginAppTools(pluginId: string | null, context: Context, input: unknown) {
  const options = z.object({ query: z.string().max(200).default(''), offset: z.number().int().min(0).max(1000).default(0), tool: z.string().max(64).optional() }).parse(input)
  context = fresh(context)
  const definition = pluginId ? getPlugin(pluginId).definition : null
  const trusted = definition !== null && isTrustedPlugin(definition)
  const permitted = definition ? trusted ? trustedAppTools() : definition.appTools ?? [] : pluginAppTools()
  const names = permitted.filter(name => pluginAppToolScope(name, trusted) && context.scopes.includes(pluginAppToolScope(name, trusted)!) && (!context.toolAllowlist || context.toolAllowlist.includes(name)))
  const definitions = (await pluginAppDefinitions(context, names)).filter(tool => `${tool.name} ${tool.description}`.toLowerCase().includes(options.query.toLowerCase()) && (!options.tool || tool.name === options.tool))
  const selected = definitions.slice(options.offset, options.offset + (options.tool ? 1 : 20))
  return { tools: selected.map(tool => ({ name: tool.name, description: options.tool ? tool.description : tool.description?.slice(0, 180), requiresApproval: !trusted && pluginAppToolScope(tool.name) !== 'read', ...(options.tool ? { inputSchema: tool.inputSchema } : {}) })), nextOffset: options.offset + selected.length < definitions.length ? options.offset + selected.length : null }
}
function inputValue(value: unknown, input: Record<string, unknown>, depth = 0): unknown {
  if (depth > 15) throw new PluginError('작업 인자 중첩이 너무 깊어.')
  if (Array.isArray(value)) return value.map(item => inputValue(item, input, depth + 1))
  if (!value || typeof value !== 'object') return value
  const object = value as Record<string, unknown>
  if (Object.keys(object).length === 1 && typeof object.$input === 'string') {
    if (object.$input === '') return input
    let selected: unknown = input
    for (const key of object.$input.split('.')) {
      if (['__proto__', 'prototype', 'constructor'].includes(key) || !selected || typeof selected !== 'object' || !Object.prototype.hasOwnProperty.call(selected, key)) throw new PluginError(`작업 입력이 없어: ${object.$input}`)
      selected = (selected as Record<string, unknown>)[key]
    }
    return selected
  }
  return Object.fromEntries(Object.entries(object).map(([key, item]) => {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new PluginError('허용하지 않는 인자 키야.')
    return [key, inputValue(item, input, depth + 1)]
  }))
}
export async function runPluginServerAction(value: unknown, context: Context) {
  const args = pluginActionRunSchema.parse(value), plugin = getPlugin(args.pluginId)
  const action = plugin.definition.serverActions?.find(action => action.id === args.action)
  if (!action) throw new PluginError('등록된 서버 작업이 없어.', 404)
  const validated = validateChatPageArguments(action.schema, args.arguments) as Record<string, unknown>
  const resolved = action.arguments ? inputValue(action.arguments, validated) as Record<string, unknown> : validated
  return runPluginAppTool(args.pluginId, { tool: action.tool, arguments: resolved, requestId: args.requestId }, context, action.label)
}
export async function runPluginAppTool(pluginId: string, value: unknown, context: Context, label?: string) {
  const input = pluginAppCallSchema.parse(value)
  if (Buffer.byteLength(JSON.stringify(input.arguments)) > 256 * 1024) throw new PluginError('앱 작업 입력은 256KB까지 지원해.', 413)
  const authorized = authorize(pluginId, input.tool, context, input.arguments)
  if (authorized.scope === 'read') {
    const result = await callPluginAppTool(authorized.context, input.tool, input.arguments, authorized.trusted)
    return { status: result.isError ? 'failed' : 'completed', result }
  }
  if (!input.requestId) throw new PluginError('변경 요청에는 재시도용 requestId가 필요해.')
  const store = pluginDb(), ownerKey = owner(context)
  for (const row of store.prepare("SELECT * FROM plugin_app_requests WHERE status IN ('starting','running')").all() as Row[]) {
    const job = row.job_id ? RuntimeJobStore.get(row.job_id) : null
    if (job && ['completed', 'failed', 'cancelled'].includes(job.status)) store.prepare('UPDATE plugin_app_requests SET status=? WHERE id=?').run(job.status, row.id)
    // A start that never got its job (a crash between the two writes) stops holding a pending slot after a minute.
    else if (!job && (row.expires_at < Date.now() || (row.status === 'starting' && !row.job_id && Date.now() - (row.expires_at - REQUEST_LIFETIME_MS) > 60_000))) store.prepare("UPDATE plugin_app_requests SET status='failed' WHERE id=?").run(row.id)
  }
  store.prepare("DELETE FROM plugin_app_requests WHERE expires_at<? AND status NOT IN ('starting','running')").run(Date.now())
  const fingerprint = hash(JSON.stringify({ pluginId, digest: authorized.plugin.digest, tool: input.tool, args: input.arguments, projectGrant: authorized.context.projectGrant }))
  const previous = store.prepare('SELECT * FROM plugin_app_requests WHERE owner_key=? AND request_key=?').get(ownerKey, input.requestId) as Row | undefined
  if (previous) { if (previous.fingerprint !== fingerprint) throw new PluginError('같은 요청 ID에 다른 변경을 넣을 수 없어.', 409); return view(previous) }
  const count = store.prepare("SELECT COUNT(*) AS n FROM plugin_app_requests WHERE owner_key=? AND status IN ('pending','starting','running')").get(ownerKey) as { n: number }
  if (count.n >= 16 || (store.prepare('SELECT COUNT(*) AS n FROM plugin_app_requests').get() as { n: number }).n >= 1000) throw new PluginError('대기 중인 확장 작업을 먼저 처리해줘.', 429)
  const project = authorized.context.workspace?.project
  const body: PluginAppRequest = { id: token(), pluginId, version: authorized.plugin.version, label: label ?? input.tool, tool: input.tool, scope: authorized.scope, ...(project ? { project: { id: project.id, name: project.name } } : {}), arguments: input.arguments, status: 'pending', jobId: null, expiresAt: Date.now() + REQUEST_LIFETIME_MS }
  const { workspace: _workspace, ...storedContext } = authorized.context
  store.prepare('INSERT INTO plugin_app_requests(id,owner_key,request_key,fingerprint,plugin_id,digest,body,context,expires_at) VALUES(?,?,?,?,?,?,?,?,?)').run(body.id, ownerKey, input.requestId, fingerprint, pluginId, authorized.plugin.digest, JSON.stringify(body), JSON.stringify(storedContext), body.expiresAt)
  // A trusted package's change starts at once, as the account that asked; others wait for the person's approval.
  if (authorized.trusted && context.requester) return startRequest(body.id, pluginBrowserContext({ requester: context.requester, sessionId: '' }), body, context.requester.accountId)
  return body
}
function view(row: Row, includeResult = true): PluginAppRequest {
  const body = JSON.parse(row.body) as PluginAppRequest
  const job = row.job_id ? RuntimeJobStore.get(row.job_id, { includeResultFile: includeResult }) : null
  if (job && ['completed', 'failed', 'cancelled'].includes(job.status) && row.status !== job.status) pluginDb().prepare('UPDATE plugin_app_requests SET status=? WHERE id=?').run(job.status, row.id)
  return { ...body, status: job ? job.status === 'queued' ? 'running' : job.status : row.job_id ? 'failed' : row.status, jobId: row.job_id, ...(includeResult && job?.result ? { result: job.result } : {}), ...(job?.failureMessage ? { error: job.failureMessage } : {}), ...(row.status === 'starting' && !row.job_id ? { error: '작업 시작이 중단됐을 수 있어. 자동 재실행하지 않고 실행 이력을 확인해줘.' } : {}) }
}
function requireRequest(id: string, context: Context, admin = false) {
  z.string().regex(/^[a-f0-9]{48}$/).parse(id)
  const row = pluginDb().prepare('SELECT * FROM plugin_app_requests WHERE id=?').get(id) as Row | undefined
  if (!row || (row.owner_key !== owner(context) && !(admin && context.requester && isRequesterAdmin(context.requester)))) throw new PluginError('확장 작업을 찾을 수 없어.', 404)
  return row
}
export function getPluginAppRequest(id: string, context: Context, admin = false) { return view(requireRequest(id, fresh(context), admin)) }
/**
 * Newest first, 20 a page. `pending`: every request still waiting for approval (at most 100), so an older one never
 * falls off the approval list; `ids`: these requests (a plugin window following the ones it started).
 */
export function listPluginAppRequests(context: Context, offset = 0, filter: { pending?: boolean; ids?: string[] } = {}) {
  const isAdmin = context.requester && isRequesterAdmin(context.requester), key = owner(context)
  const where = ['expires_at>?', ...(isAdmin ? [] : ['owner_key=?'])]
  const values: Array<string | number> = [Date.now(), ...(isAdmin ? [] : [key])]
  if (filter.pending) where.push("status='pending'")
  if (filter.ids) {
    const ids = filter.ids.filter(id => /^[a-f0-9]{48}$/.test(id)).slice(0, 32)
    if (!ids.length) return { requests: [], nextOffset: null }
    where.push(`id IN (${ids.map(() => '?').join(',')})`)
    values.push(...ids)
  }
  const page = filter.pending || filter.ids ? 100 : 20
  const rows = pluginDb().prepare(`SELECT * FROM plugin_app_requests WHERE ${where.join(' AND ')} ORDER BY rowid DESC LIMIT ? OFFSET ?`).all(...values, page + 1, offset) as Row[]
  return { requests: rows.slice(0, page).map(row => view(row, false)), nextOffset: rows.length > page ? offset + page : null }
}
let registered = false
function registerJob() {
  if (registered) return
  registered = true
  RuntimeJobRunner.register<{ id: string; actor: Context; slot: number }, unknown>({ kind: 'plugin-action', singletonKey: params => `plugin-action:${params.slot}`, handler: async ctx => {
    const row = requireRequest(ctx.params.id, ctx.params.actor, true)
    const request = JSON.parse(row.body) as PluginAppRequest
    try {
      const original = fresh(JSON.parse(row.context) as Context)
      authorize(request.pluginId, request.tool, original, request.arguments)
      const execution = { ...original, requester: original.requester ?? ctx.params.actor.requester }
      const { plugin, trusted } = authorize(request.pluginId, request.tool, execution, request.arguments)
      if (plugin.digest !== row.digest) throw new PluginError('확장 버전이 바뀌었어. 새 작업을 요청해줘.', 409)
      ctx.throwIfCancelled(); ctx.flush({ total: 1, currentLabel: request.label, phase: 'executing' })
      const args = request.tool === 'workspace_apply' && request.arguments.requestId === undefined ? { ...request.arguments, requestId: `plugin-app-${row.id}` } : request.arguments
      const result = await callPluginAppTool(execution, request.tool, args, trusted)
      if (result.isError) throw new PluginError(JSON.stringify(result.content).slice(0, 1500))
      if (ctx.isCancelRequested()) ctx.recordWarning('이미 전달된 앱 작업은 완료됐어. 생성된 개별 작업의 취소 기능을 사용해줘.')
      pluginDb().prepare("UPDATE plugin_app_requests SET status='completed' WHERE id=?").run(row.id)
      ctx.flush({ processed: 1, succeeded: 1 }); return result
    } catch (error) { pluginDb().prepare("UPDATE plugin_app_requests SET status='failed' WHERE id=?").run(row.id); throw error }
  } })
}
/** Authenticated host only: no MCP tool or iframe method exposes this function. */
export function applyPluginAppRequest(id: string, caller: PluginCaller) {
  const actor = pluginBrowserContext(caller), row = requireRequest(id, actor, true), request = JSON.parse(row.body) as PluginAppRequest
  const original = fresh(JSON.parse(row.context) as Context)
  authorize(request.pluginId, request.tool, original, request.arguments)
  const execution = { ...original, requester: original.requester ?? caller.requester }
  const { plugin } = authorize(request.pluginId, request.tool, execution, request.arguments)
  if (plugin.digest !== row.digest) throw new PluginError('확장 버전이 바뀌었어.', 409)
  if (row.job_id) return view(row)
  if (row.expires_at <= Date.now() || row.status !== 'pending') throw new PluginError('만료되거나 이미 처리된 요청이야.', 409)
  return startRequest(id, actor, request, caller.requester.accountId)
}
function startRequest(id: string, actor: Context, request: PluginAppRequest, accountId: number | null) {
  registerJob()
  const changed = pluginDb().prepare("UPDATE plugin_app_requests SET status='starting' WHERE id=? AND status='pending'").run(id)
  if (!changed.changes) throw new PluginError('이미 실행을 시작한 요청이야.', 409)
  try {
    let job: ReturnType<typeof RuntimeJobRunner.start> | undefined
    let conflict: RuntimeJobConflictError | undefined
    // Four bounded execution slots; cancellation has a separate slot so a slow native call cannot block it.
    for (const slot of request.tool.startsWith('cancel_') ? [4] : [0, 1, 2, 3]) {
      try { job = RuntimeJobRunner.start('plugin-action', { id, actor, slot }, { requestedByAccountId: accountId, total: 1 }); break }
      catch (error) { if (!(error instanceof RuntimeJobConflictError)) throw error; conflict = error }
    }
    if (!job) throw conflict ?? new PluginError('실행 가능한 작업 슬롯이 없어.', 409)
    pluginDb().prepare("UPDATE plugin_app_requests SET job_id=?,status='running' WHERE id=?").run(job.jobId, id)
    return getPluginAppRequest(id, actor, true)
  } catch (error) {
    // Only a rejected admission is safe to retry. Other start failures have uncertain side effects.
    if (error instanceof RuntimeJobConflictError) { pluginDb().prepare("UPDATE plugin_app_requests SET status='pending' WHERE id=? AND job_id IS NULL").run(id); throw new PluginError('확장 작업 실행 슬롯이 사용 중이야. 완료 후 같은 요청을 다시 적용해줘.', 409) }
    throw error
  }
}
export function cancelPluginAppRequest(id: string, context: Context, admin = false) {
  const row = requireRequest(id, fresh(context), admin)
  if (row.job_id) RuntimeJobRunner.cancel(row.job_id)
  else pluginDb().prepare("UPDATE plugin_app_requests SET status='cancelled' WHERE id=? AND status='pending'").run(id)
  return getPluginAppRequest(id, context, admin)
}
export function pluginInstanceAppContext(id: string, caller: PluginCaller, baseUrl: string) {
  const instance = requirePluginInstance(id, caller)
  requireRequesterPermission(caller.requester, 'files.view')
  const context = pluginBrowserContext(caller, baseUrl)
  if (instance.workspace) context.projectGrant = { id: instance.workspace.id, write: instance.workspace.write, revision: WorkspaceService.get(instance.owner, instance.workspace.id).revision }
  return { pluginId: instance.plugin.id, context }
}
