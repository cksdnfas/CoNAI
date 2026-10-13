import { createHash, randomBytes } from 'crypto'
import fs from 'fs'
import type { PluginInstance, PluginWriteProposal } from '@conai/shared'
import { z } from 'zod'
import type { McpRequester } from '../../mcp/context'
import { FileStoreService, MAX_TEXT_DOCUMENT_BYTES } from '../fileStoreService'
import { requireFileStoreOwner, requireFileStoreAction } from '../fileStoreAccess'
import { pluginDb } from './pluginStore'
import { getPlugin, PluginError } from './pluginRegistry'

const random = () => randomBytes(24).toString('hex')
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export const pluginTokenSchema = z.string().regex(/^[a-f0-9]{48}$/)
const fileIdSchema = z.string().regex(/^[a-f0-9]{32}$/)
export type PluginCaller = { requester: McpRequester; sessionId: string }
export const PLUGIN_CONNECTION_LEASE_MS = 5 * 60_000
type InstanceRow = {
  id: string; plugin_id: string; version: string; digest: string; page_id: string
  session_key: string; owner_key: string; files: string; expires_at: number
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
  return { row, plugin: plugin.definition, page, fileIds: JSON.parse(row.files) as string[], owner }
}
export function openPluginInstance(pluginId: string, pageId: string, input: unknown, caller: PluginCaller): PluginInstance {
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
  const id = random(), expiresAt = Date.now() + PLUGIN_CONNECTION_LEASE_MS
  pluginDb().prepare('INSERT INTO plugin_instances VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, pluginId, plugin.version, plugin.digest, pageId, hash(caller.sessionId), owner, JSON.stringify(ids), expiresAt)
  return { id, plugin: plugin.definition, page, files, expiresAt }
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
  const db = pluginDb()
  if ((db.prepare('SELECT COUNT(*) AS n FROM plugin_proposals WHERE instance_id = ? AND expires_at > ?').get(instanceId, Date.now()) as { n: number }).n >= 24) throw new PluginError('저장 요청이 너무 많아. 잠시 후 다시 시도해줘.', 429)
  if ((db.prepare('SELECT COUNT(*) AS n FROM plugin_proposals WHERE instance_id = ? AND expires_at > ? AND result IS NULL').get(instanceId, Date.now()) as { n: number }).n >= 4) throw new PluginError('대기 중인 저장 제안을 먼저 처리해줘.', 429)
  const proposal: PluginWriteProposal = { id: random(), instanceId, fileId: input.fileId, name: FileStoreService.get(instance.owner, input.fileId).name, before: current.text, text: input.text, revision: input.revision, expiresAt: Date.now() + 5 * 60_000 }
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
  const approval = random()
  pluginDb().prepare('UPDATE plugin_proposals SET approval_hash = ? WHERE id = ?').run(hash(approval), id)
  return { applied: false as const, approval }
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

type MediaGrant = { instanceId: string; fileId: string; caller: PluginCaller; expiresAt: number; size: number; modified: number }
const mediaGrants = new Map<string, MediaGrant>()
export function issuePluginMedia(instanceId: string, fileId: string, caller: PluginCaller) {
  const instance = requireFile(instanceId, fileId, caller, 'files.media')
  const resolved = FileStoreService.resolveFile(instance.owner, fileId)
  const stat = fs.statSync(resolved.filePath)
  for (const [key, grant] of mediaGrants) if (grant.expiresAt <= Date.now()) mediaGrants.delete(key)
  if (mediaGrants.size >= 1000) throw new PluginError('미디어 요청이 너무 많아.', 429)
  const token = random(), expiresAt = Date.now() + 60_000
  mediaGrants.set(hash(token), { instanceId, fileId, caller, expiresAt, size: stat.size, modified: stat.mtimeMs })
  return { token, expiresAt }
}
export function resolvePluginMedia(token: string) {
  pluginTokenSchema.parse(token)
  const grant = mediaGrants.get(hash(token))
  if (!grant || grant.expiresAt <= Date.now()) throw new PluginError('미디어 링크가 만료됐어.', 410)
  const instance = requireFile(grant.instanceId, grant.fileId, grant.caller, 'files.media')
  const resolved = FileStoreService.resolveFile(instance.owner, grant.fileId)
  const stat = fs.statSync(resolved.filePath)
  if (stat.size !== grant.size || stat.mtimeMs !== grant.modified) throw new PluginError('미디어가 변경됐어.', 409)
  return { ...resolved, requester: grant.caller.requester }
}
