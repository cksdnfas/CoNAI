import fs from 'fs'
import type { PluginInstance, PluginWriteProposal } from '@conai/shared'
import { z } from 'zod'
import type { McpRequester } from '../../mcp/context'
import { FileStoreService, MAX_TEXT_DOCUMENT_BYTES } from '../fileStoreService'
import { requireFileStoreOwner, requireFileStoreAction } from '../fileStoreAccess'
import { pluginDb, pluginToken, sha256 as hash, PluginError, requireProposalRoom, issueProposalApproval, PluginMediaGrants } from './pluginStore'
import { getPlugin } from './pluginRegistry'
import { WorkspaceService } from '../workspaceService'
import { workspaceIdSchema } from '../workspaceSchemas'

export const pluginTokenSchema = z.string().regex(/^[a-f0-9]{48}$/)
const fileIdSchema = z.string().regex(/^[a-f0-9]{32}$/)
export type PluginCaller = { requester: McpRequester; sessionId: string }
export const PLUGIN_CONNECTION_LEASE_MS = 5 * 60_000
type InstanceRow = {
  id: string; plugin_id: string; version: string; digest: string; page_id: string
  session_key: string; owner_key: string; files: string; expires_at: number
  workspace: string | null
}
type ProposalRow = { id: string; instance_id: string; file_id: string; body: string; approval_hash: string | null; result: string | null; expires_at: number }
let lastCleanup = 0
function cleanup() {
  if (Date.now() - lastCleanup < 60_000) return
  const db = pluginDb()
  db.prepare('DELETE FROM plugin_instances WHERE expires_at < ?').run(Date.now())
  db.prepare('DELETE FROM plugin_proposals WHERE expires_at < ? OR instance_id NOT IN (SELECT id FROM plugin_instances)').run(Date.now())
  lastCleanup = Date.now()
}
export function requirePluginInstance(id: string, caller: PluginCaller) {
  pluginTokenSchema.parse(id)
  if (!caller.sessionId) throw new PluginError('세션이 필요해.', 401)
  const owner = requireFileStoreOwner(caller.requester)
  const row = pluginDb().prepare('SELECT * FROM plugin_instances WHERE id = ? AND session_key = ? AND owner_key = ?').get(id, hash(caller.sessionId), owner) as InstanceRow | undefined
  if (!row || row.expires_at <= Date.now()) throw new PluginError('확장 연결이 만료됐어. 다시 열어줘.', 410)
  const plugin = getPlugin(row.plugin_id)
  if (plugin.version !== row.version || plugin.digest !== row.digest) throw new PluginError('확장 버전이 바뀌었어. 다시 열어줘.', 409)
  const page = plugin.definition.pages.find((item) => item.id === row.page_id)
  if (!page) throw new PluginError('페이지가 없어.', 404)
  return { row, plugin: plugin.definition, page, fileIds: JSON.parse(row.files) as string[], workspace: row.workspace ? JSON.parse(row.workspace) as { id: string; name: string; write: boolean } : undefined, owner }
}
export function openPluginInstance(pluginId: string, pageId: string, input: unknown, caller: PluginCaller, workspaceInput?: unknown): PluginInstance {
  cleanup()
  const plugin = getPlugin(pluginId)
  const page = plugin.definition.pages.find((item) => item.id === pageId)
  if (!page) throw new PluginError('페이지가 없어.', 404)
  const ids = [...new Set(z.array(fileIdSchema).max(20).parse(input))]
  const owner = requireFileStoreOwner(caller.requester)
  if (!caller.sessionId) throw new PluginError('세션이 필요해.', 401)
  if ((pluginDb().prepare('SELECT COUNT(*) AS n FROM plugin_instances WHERE session_key = ? AND expires_at > ?').get(hash(caller.sessionId), Date.now()) as { n: number }).n >= 12) throw new PluginError('열린 확장 창이 너무 많아. 기존 창을 닫아줘.', 429)
  const files = ids.map((id) => {
    const file = FileStoreService.get(owner, id)
    if (file.kind !== 'file' || (page.accepts.length && !page.accepts.some((ext) => file.name.toLowerCase().endsWith(ext)))) throw new PluginError('이 확장이 지원하는 파일을 선택해줘.')
    return { id: file.id, name: file.name, mimeType: file.mimeType, size: file.size }
  })
  let workspace: PluginInstance['workspace']
  if (workspaceInput !== undefined) {
    const selected = z.object({ id: workspaceIdSchema, write: z.boolean().default(false) }).strict().parse(workspaceInput)
    if (!plugin.definition.capabilities.includes('workspace.read')) throw new PluginError('프로젝트 연결을 지원하지 않는 확장이야.', 403)
    if (selected.write) {
      if (!plugin.definition.capabilities.includes('workspace.write')) throw new PluginError('프로젝트 쓰기를 지원하지 않는 확장이야.', 403)
      requireFileStoreAction(caller.requester, 'organize')
    }
    const project = WorkspaceService.get(owner, selected.id)
    workspace = { id: project.id, name: project.name, write: selected.write }
  }
  const id = pluginToken(), expiresAt = Date.now() + PLUGIN_CONNECTION_LEASE_MS
  pluginDb().prepare('INSERT INTO plugin_instances (id,plugin_id,version,digest,page_id,session_key,owner_key,files,expires_at,workspace) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, pluginId, plugin.version, plugin.digest, pageId, hash(caller.sessionId), owner, JSON.stringify(ids), expiresAt, workspace ? JSON.stringify(workspace) : null)
  return { id, plugin: plugin.definition, page, files, expiresAt, ...(workspace ? { workspace } : {}) }
}
/** Only the authenticated host can renew a live connection; bearer media reads cannot keep it alive. */
export function renewPluginInstance(id: string, caller: PluginCaller) {
  requirePluginInstance(id, caller)
  const expiresAt = Date.now() + PLUGIN_CONNECTION_LEASE_MS
  pluginDb().prepare('UPDATE plugin_instances SET expires_at = ? WHERE id = ?').run(expiresAt, id)
  return { expiresAt }
}
export function closePluginInstance(id: string, caller: PluginCaller) {
  // Idempotent close also works after disable; it never affects another session.
  pluginTokenSchema.parse(id)
  const db = pluginDb()
  db.transaction(() => {
    db.prepare('DELETE FROM plugin_proposals WHERE instance_id IN (SELECT id FROM plugin_instances WHERE id = ? AND session_key = ?)').run(id, hash(caller.sessionId))
    db.prepare('DELETE FROM plugin_instances WHERE id = ? AND session_key = ?').run(id, hash(caller.sessionId))
  })()
}
/** Logout ends the session's plugin windows at once; their tokens and media links would otherwise outlive it. */
export function closePluginSession(sessionId: string) {
  if (!sessionId) return
  const db = pluginDb()
  db.transaction(() => {
    db.prepare('DELETE FROM plugin_proposals WHERE instance_id IN (SELECT id FROM plugin_instances WHERE session_key = ?)').run(hash(sessionId))
    db.prepare('DELETE FROM plugin_instances WHERE session_key = ?').run(hash(sessionId))
  })()
}
function requireFile(instanceId: string, fileId: string, caller: PluginCaller, capability: 'files.read' | 'files.write' | 'files.media') {
  fileIdSchema.parse(fileId)
  const instance = requirePluginInstance(instanceId, caller)
  if (!instance.plugin.capabilities.includes(capability) || !instance.fileIds.includes(fileId)) throw new PluginError('허용된 자료와 기능만 사용할 수 있어.', 403)
  if (capability === 'files.write') requireFileStoreAction(caller.requester, 'organize')
  return instance
}
export function readPluginFile(instanceId: string, fileId: string, caller: PluginCaller) {
  const instance = requireFile(instanceId, fileId, caller, 'files.read')
  const entry = FileStoreService.get(instance.owner, fileId)
  return { ...FileStoreService.readEditableText(instance.owner, fileId), id: entry.id, name: entry.name }
}
export function proposePluginWrite(instanceId: string, value: unknown, caller: PluginCaller): PluginWriteProposal {
  cleanup()
  const input = z.object({ fileId: fileIdSchema, text: z.string().max(MAX_TEXT_DOCUMENT_BYTES), revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(value)
  if (Buffer.byteLength(input.text, 'utf8') > MAX_TEXT_DOCUMENT_BYTES) throw new PluginError('텍스트가 2MB를 넘었어.', 413)
  const instance = requireFile(instanceId, input.fileId, caller, 'files.write')
  const current = FileStoreService.readEditableText(instance.owner, input.fileId)
  if (current.revision !== input.revision) throw new PluginError('파일이 변경됐어. 초안을 보관하고 최신 파일을 다시 읽어줘.', 409)
  requireProposalRoom(instanceId)
  const db = pluginDb()
  const proposal: PluginWriteProposal = { id: pluginToken(), instanceId, fileId: input.fileId, name: FileStoreService.get(instance.owner, input.fileId).name, before: current.text, text: input.text, revision: input.revision, expiresAt: Date.now() + 5 * 60_000 }
  // This immutable server-side body, not a later iframe message, is what Apply will save.
  db.prepare('INSERT INTO plugin_proposals(id, instance_id, file_id, body, expires_at) VALUES (?, ?, ?, ?, ?)').run(proposal.id, instanceId, input.fileId, JSON.stringify(proposal), proposal.expiresAt)
  return proposal
}
function requireProposal(id: string, caller: PluginCaller) {
  pluginTokenSchema.parse(id)
  const row = pluginDb().prepare('SELECT * FROM plugin_proposals WHERE id = ?').get(id) as ProposalRow | undefined
  if (!row || row.expires_at <= Date.now()) throw new PluginError('저장 제안이 만료됐어.', 410)
  const instance = requireFile(row.instance_id, row.file_id, caller, 'files.write')
  return { row, instance, proposal: JSON.parse(row.body) as PluginWriteProposal }
}
/** Called only by the trusted host UI; the iframe broker has no approve/apply operation. */
export function approvePluginWrite(id: string, caller: PluginCaller) {
  const { row, instance, proposal } = requireProposal(id, caller)
  if (row.result) return { applied: true as const, result: JSON.parse(row.result) }
  if (FileStoreService.readEditableText(instance.owner, row.file_id).revision !== proposal.revision) throw new PluginError('승인 전에 파일이 변경됐어.', 409)
  return { applied: false as const, approval: issueProposalApproval(id) }
}
export function applyPluginWrite(id: string, approval: string, caller: PluginCaller) {
  pluginTokenSchema.parse(approval)
  const { row, instance, proposal } = requireProposal(id, caller)
  if (row.approval_hash !== hash(approval)) throw new PluginError('호스트의 저장 승인이 필요해.', 403)
  if (row.result) return JSON.parse(row.result)
  // Synchronous file store CAS plus an immediate DB transaction serializes competing applies.
  return pluginDb().transaction(() => {
    const result = FileStoreService.updateText(instance.owner, row.file_id, proposal.text, { expectedRevision: proposal.revision, source: { via: 'editor', accountId: caller.requester.accountId } })
    pluginDb().prepare('UPDATE plugin_proposals SET result = ? WHERE id = ?').run(JSON.stringify(result), id)
    return result
  }).immediate()
}
export function dismissPluginWrite(id: string, caller: PluginCaller) {
  requireProposal(id, caller)
  pluginDb().prepare('DELETE FROM plugin_proposals WHERE id = ?').run(id)
}

const mediaGrants = new PluginMediaGrants<{ instanceId: string; fileId: string; caller: PluginCaller; size: number; modified: number }>()
export function issuePluginMedia(instanceId: string, fileId: string, caller: PluginCaller) {
  const instance = requireFile(instanceId, fileId, caller, 'files.media')
  const resolved = FileStoreService.resolveFile(instance.owner, fileId)
  const stat = fs.statSync(resolved.filePath)
  return mediaGrants.issue({ instanceId, fileId, caller, size: stat.size, modified: stat.mtimeMs })
}
export function resolvePluginMedia(token: string) {
  pluginTokenSchema.parse(token)
  const grant = mediaGrants.use(token)
  const instance = requireFile(grant.instanceId, grant.fileId, grant.caller, 'files.media')
  const resolved = FileStoreService.resolveFile(instance.owner, grant.fileId)
  const stat = fs.statSync(resolved.filePath)
  if (stat.size !== grant.size || stat.mtimeMs !== grant.modified) throw new PluginError('미디어가 변경됐어.', 409)
  return { ...resolved, requester: grant.caller.requester }
}
