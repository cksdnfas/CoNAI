import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { McpRequester } from '../../mcp/context'
import { requireRequesterPermission } from '../../middleware/featureAccess'
import { resolvePluginMediaReference } from './pluginWorkspace'
import { getPlugin } from './pluginRegistry'
import { pluginDataDir } from './pluginData'
import { PluginError } from './pluginStore'
import { runtimePaths } from '../../config/runtimePaths'
import { BackgroundProcessorService } from '../backgroundProcessorService'
import { resolveSpriteGroup } from '../sprite/spriteLibrary'
import { assignGeneratedMediaToGroup } from '../generationTargetGroupService'
import { generateDatedRandomFilename, getDateFolder } from '../../utils/mediaStoragePaths'

/** Only trusted server modules receive paths. Browser clients keep short-lived, permission-checked media grants. */
export async function callPluginServerMedia(pluginId: string, requester: McpRequester | undefined, method: string, raw: unknown, signal?: AbortSignal) {
  const digest = getPlugin(pluginId).digest
  if (!requester) throw new PluginError('미디어 처리에는 계정이 필요해.', 403)
  const check = () => {
    signal?.throwIfAborted()
    if (getPlugin(pluginId).digest !== digest) throw new PluginError('플러그인 버전이 바뀌었어.', 409)
  }
  check()
  if (method === 'resolve') {
    const source = await resolvePluginMediaReference(raw, requester)
    check()
    return { path: source.filePath, name: source.entry.name, mimeType: source.entry.mimeType, size: source.size, fingerprint: source.fingerprint }
  }
  if (method !== 'save') throw new PluginError('알 수 없는 미디어 작업이야.')
  const input = z.object({ path: z.string().min(1).max(1000), groupPath: z.string().trim().min(1).max(200).optional() }).strict().parse(raw)
  const authorize = () => { check(); for (const permission of ['images.view', 'images.upload', 'images.edit']) requireRequesterPermission(requester, permission) }
  authorize()
  // Restrict imports to ordinary output files underneath this package's private data folder.
  const root = pluginDataDir(pluginId), source = path.resolve(root, input.path), relative = path.relative(root, source)
  if (!relative || path.isAbsolute(input.path) || path.isAbsolute(relative) || relative.split(path.sep).includes('..')) throw new PluginError('플러그인 데이터 폴더의 결과만 저장할 수 있어.', 403)
  let current = root
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part)
    const stat = await fs.promises.lstat(current)
    if (stat.isSymbolicLink()) throw new PluginError('결과 경로에 링크가 있어.', 403)
  }
  const extension = path.extname(source).toLowerCase().slice(1)
  const mimeType = ({ mp4: 'video/mp4', webm: 'video/webm', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as Record<string, string>)[extension]
  const before = await fs.promises.stat(source, { bigint: true })
  if (!mimeType || !before.isFile() || before.nlink !== 1n || before.size < 1n || before.size > 512n * 1024n * 1024n) throw new PluginError('지원하는 이미지·영상 결과(512MB 이하)만 저장할 수 있어.')
  const directory = path.join(runtimePaths.uploadsDir, ...(mimeType.startsWith('video/') ? ['videos', 'API'] : ['API', 'images']), getDateFolder())
  await fs.promises.mkdir(directory, { recursive: true })
  const target = path.join(directory, generateDatedRandomFilename(extension))
  let processing = false
  try {
    await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL)
    const after = await fs.promises.stat(source, { bigint: true })
    if (before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new PluginError('저장 도중 결과 파일이 바뀌었어.', 409)
    authorize()
    const groupId = resolveSpriteGroup({ groupPath: input.groupPath ?? `플러그인/${pluginId}` })
    processing = true
    const result = await BackgroundProcessorService.processSavedMediaFile(target, { mimeType, metadataMode: 'background', quiet: true })
    if (!result.compositeHash) throw new PluginError('라이브러리 등록에 실패했어.', 500)
    // After ingestion, keep the native result recoverable even if a late cancellation arrives.
    assignGeneratedMediaToGroup(groupId, [result.compositeHash])
    return { source: 'library', compositeHash: result.compositeHash, groupId }
  } catch (error) {
    if (!processing) await fs.promises.unlink(target).catch(() => undefined)
    throw error
  }
}
