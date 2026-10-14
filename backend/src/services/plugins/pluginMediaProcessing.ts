import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { z } from 'zod'
import type { PluginMediaProposal } from '@conai/shared'
import { pluginDb, pluginToken as token, sha256 as hash, PluginError, requireProposalRoom, issueProposalApproval } from './pluginStore'
import { pluginTokenSchema, type PluginCaller } from './pluginHost'
import { requirePluginWorkspace, mediaTarget } from './pluginWorkspace'
import { WorkspaceService, workspaceTarget } from '../workspaceService'
import { requireRequesterPermission } from '../../middleware/featureAccess'
import { RuntimeJobRunner } from '../runtimeJobs/runtimeJobRunner'
import { RuntimeJobConflictError } from '../runtimeJobs/runtimeJobStore'
import { runtimePaths } from '../../config/runtimePaths'
import { saveSpriteOutputToLibrary } from '../sprite/spriteLibrary'
import { runAudioFfmpeg } from '../audio/audioFfmpeg'
import { ensureNamedAudioProjectInbox } from '../audio/audioMaintenance'
import { importAudioUpload } from '../audio/audioService'

const coordinate = z.number().int().min(0).max(32768)
const size = z.number().int().min(1).max(8192)
const schema = z.object({
  sourceTarget: z.string().min(1).max(1000), target: z.string().min(1).max(1000),
  revision: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  operation: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('crop'), left: coordinate, top: coordinate, width: size, height: size, outputWidth: size, outputHeight: size, quality: z.number().int().min(1).max(100) }).strict(),
    z.object({ kind: z.literal('extract_audio'), quality: z.number().int().min(0).max(10) }).strict(),
  ]),
}).strict()
function access(id: string, caller: PluginCaller, kind: string) {
  const instance = requirePluginWorkspace(id, caller, 'workspace.write')
  for (const permission of kind === 'crop' ? ['images.view', 'images.edit', 'images.upload'] : ['images.view', 'audio.view', 'audio.edit']) requireRequesterPermission(caller.requester, permission)
  return instance
}
async function outputRevision(id: string, target: string, caller: PluginCaller) {
  const instance = requirePluginWorkspace(id, caller, 'workspace.write')
  try { return (await WorkspaceService.stat(instance.owner, instance.workspace.id, target)).revision } catch (error) { if (error instanceof Error && 'status' in error && error.status === 404) return null; throw error }
}
export async function proposePluginMedia(id: string, value: unknown, caller: PluginCaller): Promise<PluginMediaProposal> {
  const input = schema.parse(value)
  const target = workspaceTarget(input.target), sourceTarget = workspaceTarget(input.sourceTarget)
  if (!target.endsWith('.json') || target === sourceTarget) throw new PluginError('결과는 원본과 다른 JSON 참조 문서에 저장해줘.')
  if (input.operation.kind === 'crop' && (input.operation.width * input.operation.height > 50000000 || input.operation.outputWidth * input.operation.outputHeight > 16000000)) throw new PluginError('자르기 입력은 5천만, 출력은 1천6백만 픽셀까지 지원해.')
  const instance = access(id, caller, input.operation.kind)
  const parent = path.posix.dirname(target)
  if (parent !== '.' && (await WorkspaceService.stat(instance.owner, instance.workspace.id, parent)).kind !== 'folder') throw new PluginError('출력 폴더를 먼저 만들어줘.')
  const source = await mediaTarget(id, sourceTarget, caller)
  if ((await outputRevision(id, target, caller)) !== input.revision) throw new PluginError('출력 참조 문서가 변경됐어.', 409)
  let previous = '(새 참조 문서)'
  if (input.revision !== null) {
    const file = (await WorkspaceService.read(instance.owner, instance.workspace.id, [{ target, limit: 16384, revision: input.revision }])).files[0]
    if (file.nextOffset !== null) throw new PluginError('기존 결과 참조 문서는 16KB까지 교체할 수 있어.')
    previous = file.text
  }
  requireProposalRoom(id)
  const store = pluginDb()
  access(id, caller, input.operation.kind)
  const proposal: PluginMediaProposal = { ...input, target, sourceTarget, source: 'media', id: token(), instanceId: id, projectId: instance.workspace.id, name: `${instance.workspace.name} / ${target}`, sourceRevision: source.revision, fingerprint: source.fingerprint, before: `원본: ${sourceTarget}\n원본 미디어는 보존합니다.\n현재 결과 참조 문서:\n${previous}`, text: JSON.stringify({ ...input, storage: input.operation.kind === 'crop' ? `라이브러리: 플러그인/${instance.plugin.id}` : `오디오: ${instance.workspace.name} · ${instance.plugin.id}` }, null, 2), expiresAt: Date.now() + 5 * 60_000 }
  store.prepare('INSERT INTO plugin_proposals(id,instance_id,file_id,body,expires_at) VALUES(?,?,?,?,?)').run(proposal.id, id, target, JSON.stringify(proposal), proposal.expiresAt)
  return proposal
}
function requireProposal(id: string, caller: PluginCaller) {
  pluginTokenSchema.parse(id)
  const row = pluginDb().prepare('SELECT * FROM plugin_proposals WHERE id=?').get(id) as { body: string; result: string | null; approval_hash: string | null; expires_at: number } | undefined
  if (!row || row.expires_at <= Date.now()) throw new PluginError('검토가 만료됐어.', 410)
  const proposal = JSON.parse(row.body) as PluginMediaProposal
  if (proposal.source !== 'media') throw new PluginError('미디어 처리 검토가 아니야.')
  const instance = access(proposal.instanceId, caller, proposal.operation.kind)
  if (proposal.projectId !== instance.workspace.id) throw new PluginError('프로젝트가 달라.', 403)
  return { row, proposal, instance }
}
async function validate(proposal: PluginMediaProposal, caller: PluginCaller) {
  const source = await mediaTarget(proposal.instanceId, proposal.sourceTarget, caller, proposal.sourceRevision)
  if (source.fingerprint !== proposal.fingerprint || await outputRevision(proposal.instanceId, proposal.target, caller) !== proposal.revision) throw new PluginError('원본이나 출력 문서가 변경됐어.', 409)
  return source
}
export async function approvePluginMedia(id: string, caller: PluginCaller) {
  const { proposal, row } = requireProposal(id, caller)
  if (row.result) return { applied: true, result: JSON.parse(row.result) }
  await validate(proposal, caller); requireProposal(id, caller)
  return { applied: false, approval: issueProposalApproval(id) }
}
// Session credentials stay in memory. Interrupted jobs fail on restart; they are never silently replayed.
const callers = new Map<string, PluginCaller>()
let registered = false
function registerHandler() {
  if (registered) return
  registered = true
  // One media job per account at a time: crops and audio extraction are heavy, but one person's job must not hold up everyone's.
  RuntimeJobRunner.register<{ proposalId: string; owner?: string }, unknown>({ kind: 'plugin-media', singletonKey: params => `plugin-media:${params.owner ?? 'any'}`, handler: async ctx => {
    const caller = callers.get(ctx.params.proposalId)
    if (!caller) throw new PluginError('연결이 종료됐어. 결과를 확인한 뒤 다시 요청해줘.', 410)
    let temporary: string | undefined
    try {
      const { proposal, instance } = requireProposal(ctx.params.proposalId, caller)
      const source = await validate(proposal, caller), operation = proposal.operation
      ctx.flush({ total: 1, phase: 'processing', currentLabel: proposal.target })
      ctx.throwIfCancelled()
      let reference: object
      if (operation.kind === 'crop') {
        const bytes = await sharp(source.filePath, { limitInputPixels: 50000000, animated: false }).extract({ left: operation.left, top: operation.top, width: operation.width, height: operation.height }).resize(operation.outputWidth, operation.outputHeight, { fit: 'fill', kernel: 'lanczos3' }).webp({ quality: operation.quality }).timeout({ seconds: 60 }).toBuffer()
        ctx.throwIfCancelled(); await validate(proposal, caller); access(proposal.instanceId, caller, operation.kind)
        reference = { source: 'library', ...await saveSpriteOutputToLibrary({ bytes, extension: 'webp', mimeType: 'image/webp', group: { groupPath: `플러그인/${instance.plugin.id}` } }) }
      } else {
        await fs.promises.mkdir(runtimePaths.tempDir, { recursive: true })
        temporary = path.join(runtimePaths.tempDir, `plugin-${token()}.ogg`)
        try {
          await runAudioFfmpeg(['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', source.filePath, '-map', '0:a:0', '-vn', '-c:a', 'libvorbis', '-q:a', String(operation.quality), '-fs', String(200 * 1024 * 1024), temporary], { signal: ctx.signal })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          throw new PluginError(message.includes('matches no streams') ? '원본 영상에 추출할 오디오 트랙이 없어.' : message.split(source.filePath).join('[원본]').split(temporary).join('[출력]'), 422)
        }
        if ((await fs.promises.stat(temporary)).size >= 200 * 1024 * 1024) throw new PluginError('추출한 소리가 200MB를 넘어 저장하지 않았어.')
        ctx.throwIfCancelled(); await validate(proposal, caller); access(proposal.instanceId, caller, operation.kind)
        const candidate = await importAudioUpload({ groupId: ensureNamedAudioProjectInbox(`${instance.workspace.name} · ${instance.plugin.id}`) }, temporary, `${path.basename(proposal.target, '.json')}.ogg`, caller.requester.accountId)
        reference = { source: 'audio', candidateId: candidate.id }
      }
      // Preserve output identity even if linking conflicts or the connection closes after storage.
      ctx.flush({ phase: 'linking', message: '미디어 저장 완료 · 프로젝트 참조 연결 중' })
      let link
      try {
        link = await WorkspaceService.apply(instance.owner, instance.workspace.id, `plugin-media-${proposal.id}`, [{ kind: 'write', target: proposal.target, text: JSON.stringify(reference, null, 2) + '\n', expectedRevision: proposal.revision }], () => { access(proposal.instanceId, caller, operation.kind) }, ctx.signal)
      } catch (error) { link = { status: 'failed', error: error instanceof Error ? error.message : String(error) } }
      if (link.status !== 'completed') ctx.recordWarning('미디어는 저장됐지만 프로젝트 참조 연결에 실패했어. 결과의 참조를 확인해줘.')
      ctx.flush({ processed: 1, succeeded: 1 })
      return { reference, target: proposal.target, link }
    } finally {
      callers.delete(ctx.params.proposalId)
      if (temporary) await fs.promises.unlink(temporary).catch(() => undefined)
    }
  } })
}
export async function applyPluginMedia(id: string, approval: string, caller: PluginCaller) {
  pluginTokenSchema.parse(approval)
  let state = requireProposal(id, caller)
  if (state.row.approval_hash !== hash(approval)) throw new PluginError('호스트 승인이 필요해.', 403)
  if (state.row.result) return JSON.parse(state.row.result)
  await validate(state.proposal, caller)
  state = requireProposal(id, caller)
  if (state.row.approval_hash !== hash(approval)) throw new PluginError('승인이 변경됐어.', 409)
  if (state.row.result) return JSON.parse(state.row.result)
  registerHandler(); callers.set(id, caller)
  try {
    const job = RuntimeJobRunner.start('plugin-media', { proposalId: id, owner: String(caller.requester.accountId ?? 'bootstrap') }, { requestedByAccountId: caller.requester.accountId, total: 1 })
    const result = { jobId: job.jobId }
    pluginDb().prepare('UPDATE plugin_proposals SET result=? WHERE id=?').run(JSON.stringify(result), id)
    return result
  } catch (error) {
    callers.delete(id)
    if (error instanceof RuntimeJobConflictError) throw new PluginError('내 다른 확장 미디어 작업이 진행 중이야. 완료 후 같은 검토 카드에서 다시 적용해줘.', 409)
    throw error
  }
}
export function dismissPluginMedia(id: string, caller: PluginCaller) {
  const { row } = requireProposal(id, caller)
  if (row.result) throw new PluginError('실행한 작업은 작업 취소를 사용해줘.', 409)
  pluginDb().prepare('DELETE FROM plugin_proposals WHERE id=?').run(id)
}
