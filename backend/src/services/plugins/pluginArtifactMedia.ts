import fs from 'fs'
import { z } from 'zod'
import { McpArtifactService } from '../mcpArtifactService'
import { requireRequesterImagePermission } from '../../middleware/imageAccess'
import { requireRequesterPermission } from '../../middleware/featureAccess'
import { requireMcpResourceOwner } from '../../mcp/toolAccess'
import { HistoryQueryRepository } from '../../repositories/history/HistoryQueryRepository'
import { canAccessSpriteWorkspace, getSpriteWorkspace } from '../sprite/spriteCache'
import { canAccessAudioExport, getAudioExportWorkspace } from '../audio/audioExport'
import { requirePluginInstance, pluginTokenSchema, type PluginCaller } from './pluginHost'
import { PluginMediaGrants, PluginError } from './pluginStore'

const grants = new PluginMediaGrants<{ instanceId: string; artifactId: string; caller: PluginCaller; fingerprint: string }>()
function resolve(instanceId: string, artifactId: string, caller: PluginCaller) {
  requirePluginInstance(instanceId, caller)
  const identity = McpArtifactService.identity(artifactId)
  if (!identity || identity.kind === 'graph') throw new PluginError('이 미디어 결과를 열 수 없어.', 404)
  const requester = caller.requester
  if (identity.kind === 'audio' || identity.kind === 'audio-export') requireRequesterPermission(requester, 'audio.view')
  else requireRequesterImagePermission(requester)
  if (identity.kind === 'history') requireMcpResourceOwner({ scopes: [], requester }, HistoryQueryRepository.findAllWithMetadata({ ids: [identity.id], limit: 1 })[0], true)
  if (identity.kind === 'sprite-frames') {
    const owner = getSpriteWorkspace(identity.id)?.owner
    if (!owner || !canAccessSpriteWorkspace(owner, requester)) throw new PluginError('이 결과를 볼 권한이 없어.', 403)
  }
  if (identity.kind === 'audio-export') {
    const owner = getAudioExportWorkspace(identity.id)?.owner
    if (!owner || !canAccessAudioExport(owner, requester)) throw new PluginError('이 결과를 볼 권한이 없어.', 403)
  }
  const artifact = McpArtifactService.resolve(artifactId)
  if (!artifact) throw new PluginError('미디어 결과가 없거나 만료됐어.', 404)
  const stat = fs.statSync(artifact.absolutePath, { bigint: true })
  return { artifact, fingerprint: `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}` }
}
export function issuePluginArtifactMedia(instanceId: string, raw: unknown, caller: PluginCaller) {
  const { artifactId } = z.object({ artifactId: z.string().min(1).max(2000) }).strict().parse(raw)
  const { artifact, fingerprint } = resolve(instanceId, artifactId, caller)
  return { ...grants.issue({ instanceId, artifactId, caller, fingerprint }), mimeType: artifact.mimeType, name: artifact.fileName }
}
export function resolvePluginArtifactMedia(token: string) {
  pluginTokenSchema.parse(token)
  const grant = grants.use(token)
  const resolved = resolve(grant.instanceId, grant.artifactId, grant.caller)
  if (resolved.fingerprint !== grant.fingerprint) throw new PluginError('미디어 결과가 변경됐어. 링크를 다시 받아줘.', 409)
  return resolved.artifact
}
