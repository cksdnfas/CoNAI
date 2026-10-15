import fs from 'fs'
import path from 'path'
import { z } from 'zod'
import type { PluginWorkspaceProposal, StoredFileEntry } from '@conai/shared'
import { requirePluginInstance, pluginTokenSchema, type PluginCaller } from './pluginHost'
import { pluginDb, pluginToken as token, sha256 as hash, PluginError, requireProposalRoom, issueProposalApproval, PluginMediaGrants } from './pluginStore'
import { WorkspaceService, workspaceTarget } from '../workspaceService'
import { workspaceListSchema, workspaceReadSchema, workspaceApplySchema } from '../workspaceSchemas'
import type { WorkspaceOperation } from '@conai/shared'
import { requireFileStoreAction, requireFileStoreOwner } from '../fileStoreAccess'
import { FileStoreService } from '../fileStoreService'
import { requireRequesterImagePermission } from '../../middleware/imageAccess'
import { db } from '../../database/init'
import { ImageFileModel } from '../../models/Image/ImageFileModel'
import { MediaMetadataFileQueries } from '../../models/Image/MediaMetadataFileQueries'
import { ImageSafetyService } from '../imageSafetyService'
import { MediaPostprocessVisibilityService } from '../mediaPostprocessVisibilityService'
import { resolveUploadsPath } from '../../config/runtimePaths'
import { MEDIA_HASH_PATTERN } from '../codex-chat/chatMediaLinks'
import { requireRequesterPermission } from '../../middleware/featureAccess'
import { audioCandidateFile } from '../audio/audioService'
import { audioBlobPath, AUDIO_MIME_BY_EXTENSION } from '../audio/audioStore'

const MAX_TEXT = 1024 * 1024
const revision = z.string().regex(/^[a-f0-9]{64}$/)
export function requirePluginWorkspace(id: string, caller: PluginCaller, capability: 'workspace.read' | 'workspace.write' | 'workspace.media' = 'workspace.read') {
  const instance = requirePluginInstance(id, caller)
  if (!instance.workspace) throw new PluginError('프로젝트를 연결해줘.', 400)
  requireFileStoreOwner(caller.requester)
  if (capability === 'workspace.write') {
    if (!instance.workspace.write) throw new PluginError('읽기 전용 프로젝트 연결이야.', 403)
    requireFileStoreAction(caller.requester, 'organize')
  }
  WorkspaceService.get(instance.owner, instance.workspace.id)
  return { ...instance, workspace: instance.workspace }
}
export function listPluginWorkspace(id: string, input: unknown, caller: PluginCaller) {
  const instance = requirePluginWorkspace(id, caller)
  const args = workspaceListSchema.parse(input)
  return WorkspaceService.entries(instance.owner, instance.workspace.id, args.target, args.offset)
}
export function readPluginWorkspace(id: string, input: unknown, caller: PluginCaller, signal?: AbortSignal) {
  const instance = requirePluginWorkspace(id, caller)
  const args = workspaceReadSchema.parse(input)
  return WorkspaceService.read(instance.owner, instance.workspace.id, args.targets, signal)
}
export async function statPluginWorkspace(id: string, input: unknown, caller: PluginCaller) {
  const instance = requirePluginWorkspace(id, caller)
  const target = z.string().min(1).max(1000)
  const args = z.union([z.object({ target }).strict(), z.object({ targets: z.array(target).min(1).max(32) }).strict()]).parse(input)
  const read = async (target: string) => {
    try { return { ...await WorkspaceService.stat(instance.owner, instance.workspace.id, target), exists: true } } catch (error) {
      if (error instanceof Error && 'status' in error && error.status === 404) return { target, exists: false, revision: null, kind: null }
      throw error
    }
  }
  if ('target' in args) return read(args.target)
  const entries = []
  for (let start = 0; start < args.targets.length; start += 4) entries.push(...await Promise.all(args.targets.slice(start, start + 4).map(read)))
  return { entries }
}
async function checkOperations(id: string, operations: WorkspaceOperation[], caller: PluginCaller) {
  const instance = requirePluginWorkspace(id, caller, 'workspace.write')
  const moves: Array<{ target: string; destination: string }> = []
  const created = new Set<string>()
  const before = []
  for (const operation of operations) {
    let target = workspaceTarget(operation.target)
    for (const move of [...moves].reverse()) if (target === move.destination || target.startsWith(`${move.destination}/`)) target = move.target + target.slice(move.destination.length)
    let current = null
    try { current = await WorkspaceService.stat(instance.owner, instance.workspace.id, target) } catch (error) { if (!(error instanceof Error && 'status' in error && error.status === 404)) throw error }
    const expected = operation.kind === 'mkdir' ? null : operation.expectedRevision
    if ((current?.revision ?? null) !== expected) throw new PluginError(`대상이 변경됐어: ${operation.target}`, 409)
    if (operation.kind === 'mkdir' && created.has(target)) throw new PluginError('폴더 생성 대상이 중복됐어.')
    if (operation.kind === 'move') {
      const destination = workspaceTarget(operation.destination)
      try { await WorkspaceService.stat(instance.owner, instance.workspace.id, destination); throw new PluginError(`이동 대상이 이미 있어: ${destination}`, 409) } catch (error) { if (!(error instanceof Error && 'status' in error && error.status === 404)) throw error }
      moves.push({ target, destination })
    }
    if (operation.kind === 'mkdir') created.add(target)
    before.push(current ?? { target, revision: null })
  }
  return before
}
export async function proposePluginWorkspaceChanges(id: string, value: unknown, caller: PluginCaller): Promise<PluginWorkspaceProposal> {
  const { operations } = workspaceApplySchema.parse({ requestId: 'plugin-proposal', ...(value as object) })
  if (Buffer.byteLength(JSON.stringify(operations)) > MAX_TEXT) throw new PluginError('검토 내용은 1MB까지 지원해.', 413)
  const before = await checkOperations(id, operations, caller)
  const instance = requirePluginWorkspace(id, caller, 'workspace.write')
  requireProposalRoom(id)
  const store = pluginDb()
  const proposal: PluginWorkspaceProposal = { source: 'workspace', id: token(), instanceId: id, projectId: instance.workspace.id, target: operations[0].target, name: `${instance.workspace.name} · 파일 변경 ${operations.length}건`, before: JSON.stringify(before, null, 2), text: JSON.stringify(operations, null, 2), revision: null, operations, expiresAt: Date.now() + 5 * 60_000 }
  store.prepare('INSERT INTO plugin_proposals(id,instance_id,file_id,body,expires_at) VALUES(?,?,?,?,?)').run(proposal.id, id, proposal.target, JSON.stringify(proposal), proposal.expiresAt)
  return proposal
}
async function currentText(id: string, target: string, caller: PluginCaller) {
  const instance = requirePluginWorkspace(id, caller, 'workspace.write')
  try {
    const { files: [file] } = await WorkspaceService.read(instance.owner, instance.workspace.id, [{ target, limit: MAX_TEXT }])
    if (file.nextOffset !== null) throw new PluginError('확장 저장 검토는 1MB까지 지원해.', 413)
    return { text: file.text, revision: file.revision as string | null }
  } catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 404) return { text: '', revision: null }
    throw error
  }
}
export async function proposePluginWorkspaceWrite(id: string, value: unknown, caller: PluginCaller): Promise<PluginWorkspaceProposal> {
  const input = z.object({ target: z.string().min(1).max(1000), text: z.string().max(MAX_TEXT), revision: revision.nullable() }).strict().parse(value)
  const target = workspaceTarget(input.target)
  if (Buffer.byteLength(input.text) > MAX_TEXT) throw new PluginError('확장 저장 검토는 1MB까지 지원해.', 413)
  const instance = requirePluginWorkspace(id, caller, 'workspace.write')
  const current = await currentText(id, target, caller)
  if (current.revision !== input.revision) throw new PluginError('문서가 변경됐어. 초안을 보관하고 최신 문서와 비교해줘.', 409)
  requirePluginWorkspace(id, caller, 'workspace.write')
  requireProposalRoom(id)
  const store = pluginDb()
  const proposal: PluginWorkspaceProposal = { source: 'workspace', id: token(), instanceId: id, projectId: instance.workspace.id, target, name: `${instance.workspace.name} / ${target}`, before: current.text, text: input.text, revision: input.revision, expiresAt: Date.now() + 5 * 60_000 }
  store.prepare('INSERT INTO plugin_proposals(id,instance_id,file_id,body,expires_at) VALUES(?,?,?,?,?)').run(proposal.id, id, target, JSON.stringify(proposal), proposal.expiresAt)
  return proposal
}
function requireProposal(id: string, caller: PluginCaller) {
  pluginTokenSchema.parse(id)
  const row = pluginDb().prepare('SELECT * FROM plugin_proposals WHERE id=?').get(id) as { instance_id: string; body: string; result: string | null; approval_hash: string | null; expires_at: number } | undefined
  if (!row || row.expires_at <= Date.now()) throw new PluginError('검토가 만료됐어.', 410)
  const proposal = JSON.parse(row.body) as PluginWorkspaceProposal
  const instance = requirePluginWorkspace(row.instance_id, caller, 'workspace.write')
  if (proposal.source !== 'workspace' || proposal.projectId !== instance.workspace.id) throw new PluginError('프로젝트 검토 대상이 달라.', 403)
  return { row, proposal, instance }
}
export async function approvePluginWorkspaceWrite(id: string, caller: PluginCaller) {
  const { row, proposal } = requireProposal(id, caller)
  if (row.result) return { applied: true, result: JSON.parse(row.result) }
  if (proposal.operations) await checkOperations(proposal.instanceId, proposal.operations, caller)
  else if ((await currentText(proposal.instanceId, proposal.target, caller)).revision !== proposal.revision) throw new PluginError('승인 전에 문서가 변경됐어.', 409)
  requireProposal(id, caller)
  return { applied: false, approval: issueProposalApproval(id) }
}
export async function applyPluginWorkspaceWrite(id: string, approval: string, caller: PluginCaller) {
  pluginTokenSchema.parse(approval)
  const { row, proposal, instance } = requireProposal(id, caller)
  if (row.approval_hash !== hash(approval)) throw new PluginError('호스트의 저장 승인이 필요해.', 403)
  if (row.result) return JSON.parse(row.result)
  const result = await WorkspaceService.apply(instance.owner, instance.workspace.id, `plugin-${id}`, proposal.operations ?? [{ kind: 'write', target: proposal.target, text: proposal.text, expectedRevision: proposal.revision }], () => { requireProposal(id, caller) })
  if (result.status !== 'completed') throw new PluginError(`${result.error ?? '프로젝트 저장 실패'} · 적용된 항목 ${result.results.length}개: ${result.results.slice(0, 10).map(item => item.target).join(', ')}. 최신 파일과 작업 내역을 확인해줘.`, 409)
  pluginDb().prepare('UPDATE plugin_proposals SET result=? WHERE id=?').run(JSON.stringify(result), id)
  return result
}
export function dismissPluginWorkspaceWrite(id: string, caller: PluginCaller) {
  requireProposal(id, caller)
  pluginDb().prepare('DELETE FROM plugin_proposals WHERE id=?').run(id)
}

// A project keeps small source references; media originals stay in their existing store.
const mediaReferenceSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('library'), groupId: z.number().int().positive().optional(), compositeHash: z.string().regex(MEDIA_HASH_PATTERN) }).strict(),
  z.object({ source: z.literal('files'), fileId: z.string().regex(/^[a-f0-9]{32}$/) }).strict(),
  z.object({ source: z.literal('audio'), candidateId: z.string().uuid() }).strict(),
])
const grants = new PluginMediaGrants<{ instanceId: string; target: string; revision: string; caller: PluginCaller; fingerprint: string }>()
export async function mediaTarget(id: string, target: string, caller: PluginCaller, expected?: string) {
  const instance = requirePluginWorkspace(id, caller, 'workspace.media')
  const { files: [file] } = await WorkspaceService.read(instance.owner, instance.workspace.id, [{ target, limit: 16384, ...(expected ? { revision: expected } : {}) }])
  if (file.nextOffset !== null) throw new PluginError('미디어 참조 문서가 너무 커.')
  let value: unknown
  try { value = JSON.parse(file.text) } catch { throw new PluginError('미디어 참조 문서의 JSON 형식을 확인해줘.') }
  const reference = mediaReferenceSchema.parse(value)
  let resolved: { entry: StoredFileEntry; filePath: string }
  if (reference.source === 'files') {
    resolved = FileStoreService.resolveFile(instance.owner, reference.fileId)
  } else if (reference.source === 'audio') {
    requireRequesterPermission(caller.requester, 'audio.view')
    const { candidate, file } = audioCandidateFile(reference.candidateId)
    if (candidate.deleted_at) throw new PluginError('지운 오디오는 열 수 없어.', 404)
    resolved = { filePath: audioBlobPath(file.hash, file.ext), entry: { id: candidate.id, parentId: null, kind: 'file', name: `${candidate.name}.${file.ext}`, mimeType: AUDIO_MIME_BY_EXTENSION[file.ext], size: file.size, createdAt: '', updatedAt: '' } }
  } else {
    requireRequesterImagePermission(caller.requester)
    if (reference.groupId !== undefined && !db.prepare('SELECT 1 FROM image_groups WHERE group_id=? AND composite_hash=?').get(reference.groupId, reference.compositeHash)) throw new PluginError('그룹에서 미디어 참조를 찾을 수 없어.', 404)
    const metadata = MediaMetadataFileQueries.findVisibilityGuardByHash(reference.compositeHash)
    if (!metadata || !MediaPostprocessVisibilityService.isReadyRecord(metadata)) throw new PluginError('아직 사용할 수 없는 미디어야.', 404)
    if (ImageSafetyService.isHidden(metadata.rating_score)) throw new PluginError('현재 표시 정책에서 숨긴 미디어야.', 403)
    const media = ImageFileModel.findActiveByHash(reference.compositeHash)[0]
    if (!media) throw new PluginError('원본 미디어가 없어.', 404)
    resolved = { filePath: resolveUploadsPath(media.original_file_path), entry: { id: reference.compositeHash, parentId: null, kind: 'file', name: path.basename(media.original_file_path), mimeType: media.mime_type, size: 0, createdAt: '', updatedAt: '' } }
  }
  const stat = await fs.promises.stat(resolved.filePath, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    throw new PluginError(error.code === 'ENOENT' ? '원본 미디어가 디스크에 없어.' : '원본 미디어를 읽을 수 없어.', error.code === 'ENOENT' ? 404 : 403)
  })
  if (!stat.isFile()) throw new PluginError('일반 미디어 파일이 아니야.', 403)
  const fingerprint = hash(`${resolved.filePath}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`)
  return { ...resolved, revision: file.revision, fingerprint, requester: caller.requester }
}
export async function issuePluginWorkspaceMedia(id: string, input: unknown, caller: PluginCaller) {
  const args = z.object({ target: z.string().min(1).max(1000) }).strict().parse(input)
  const target = workspaceTarget(args.target)
  const media = await mediaTarget(id, target, caller)
  requirePluginWorkspace(id, caller, 'workspace.media')
  return grants.issue({ instanceId: id, target, caller, revision: media.revision, fingerprint: media.fingerprint })
}
export async function resolvePluginWorkspaceMedia(key: string) {
  pluginTokenSchema.parse(key)
  const grant = grants.use(key)
  const media = await mediaTarget(grant.instanceId, grant.target, grant.caller, grant.revision)
  if (media.fingerprint !== grant.fingerprint) throw new PluginError('원본 미디어가 변경됐어.', 409)
  return media
}
