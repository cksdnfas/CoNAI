import { z } from 'zod'
import { requireRequesterPermission } from '../../middleware/featureAccess'
import { requirePluginInstance, pluginTokenSchema, type PluginCaller } from './pluginHost'
import { resolvePluginMediaReference } from './pluginWorkspace'
import { packageFile } from './pluginRegistry'
import { pluginToken, sha256, PluginError } from './pluginStore'

/**
 * A page's live preview: its own HTML document plus named files mapped to library/files/audio media (read with the
 * caller's permissions on every request) or to this package's files. Served sandboxed, scripts only, no network
 * beyond its own folder, and only while the plugin window that made it stays open.
 */
export const PLUGIN_PREVIEW_LIMITS = { html: 256 * 1024, files: 64, perInstance: 4, total: 200, ttlMs: 10 * 60_000 } as const
const filePathSchema = z.string().max(200).regex(/^[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/).refine(value => value !== 'index.html', 'index.html is the document itself')
const referenceSchema = z.union([
  z.object({ source: z.literal('package'), path: z.string().min(1).max(200) }).strict(),
  z.object({ source: z.enum(['library', 'files', 'audio']) }).loose(),
])
const inputSchema = z.object({
  html: z.string().min(1).max(PLUGIN_PREVIEW_LIMITS.html),
  files: z.record(filePathSchema, referenceSchema).default({}).refine(files => Object.keys(files).length <= PLUGIN_PREVIEW_LIMITS.files, `${PLUGIN_PREVIEW_LIMITS.files} files at most`),
}).strict()
type PreviewFile = { source: 'package'; path: string } | { source: 'media'; reference: unknown; fingerprint: string; mimeType: string }
type Preview = { instanceId: string; caller: PluginCaller; pluginId: string; version: string; html: string; files: Map<string, PreviewFile>; createdAt: number; expiresAt: number }
const previews = new Map<string, Preview>()
const MEDIA = /^(image|video|audio)\//

function prune(now = Date.now()) {
  for (const [key, preview] of previews) if (preview.expiresAt <= now) previews.delete(key)
}
async function mediaFile(reference: unknown, caller: PluginCaller) {
  const media = await resolvePluginMediaReference(reference, caller.requester)
  const mimeType = media.entry.mimeType ?? ''
  if (!MEDIA.test(mimeType)) throw new PluginError('미리보기에는 이미지·영상·오디오만 연결할 수 있어.', 415)
  if (!mimeType.startsWith('audio/') && caller.requester.accountId !== null) requireRequesterPermission(caller.requester, 'images.view')
  return { media, mimeType }
}
/** A new preview, or with `token` the same address with new contents, so a page can redraw it as it is edited. */
export async function issuePluginPreview(instanceId: string, raw: unknown, caller: PluginCaller, token?: string) {
  const input = inputSchema.parse(raw)
  if (Buffer.byteLength(input.html, 'utf8') > PLUGIN_PREVIEW_LIMITS.html) throw new PluginError('미리보기 문서는 256KB까지야.', 413)
  const instance = requirePluginInstance(instanceId, caller)
  const existing = token === undefined ? undefined : previews.get(sha256(pluginTokenSchema.parse(token)))
  if (token !== undefined && (!existing || existing.expiresAt <= Date.now() || existing.instanceId !== instanceId)) throw new PluginError('미리보기가 만료됐어.', 410)
  const files = new Map<string, PreviewFile>()
  for (const [name, reference] of Object.entries(input.files)) {
    if (reference.source === 'package') { packageFile(instance.plugin.id, instance.plugin.version, reference.path); files.set(name, { source: 'package', path: reference.path }); continue }
    const { media, mimeType } = await mediaFile(reference, caller)
    files.set(name, { source: 'media', reference, fingerprint: media.fingerprint, mimeType })
  }
  requirePluginInstance(instanceId, caller)
  const now = Date.now(), expiresAt = now + PLUGIN_PREVIEW_LIMITS.ttlMs
  if (existing && token) {
    if (!previews.has(sha256(token))) throw new PluginError('미리보기가 만료됐어.', 410)
    Object.assign(existing, { html: input.html, files, expiresAt })
    return { token, expiresAt }
  }
  prune(now)
  // Keep only a page's newest few, and a hard cap for the whole server.
  const own = [...previews].filter(([, preview]) => preview.instanceId === instanceId).sort((a, b) => a[1].createdAt - b[1].createdAt)
  for (const [key] of own.slice(0, Math.max(0, own.length - PLUGIN_PREVIEW_LIMITS.perInstance + 1))) previews.delete(key)
  if (previews.size >= PLUGIN_PREVIEW_LIMITS.total) throw new PluginError('열린 미리보기가 너무 많아.', 429)
  const created = pluginToken()
  previews.set(sha256(created), { instanceId, caller, pluginId: instance.plugin.id, version: instance.plugin.version, html: input.html, files, createdAt: now, expiresAt })
  return { token: created, expiresAt }
}
/** The document (empty name or index.html) or one mapped file; media is re-checked against the caller and its fingerprint each time. */
export async function resolvePluginPreview(token: string, name: string) {
  pluginTokenSchema.parse(token)
  const key = sha256(token), preview = previews.get(key)
  if (!preview || preview.expiresAt <= Date.now()) { previews.delete(key); throw new PluginError('미리보기가 만료됐어.', 410) }
  requirePluginInstance(preview.instanceId, preview.caller)
  preview.expiresAt = Date.now() + PLUGIN_PREVIEW_LIMITS.ttlMs
  if (name === '' || name === 'index.html') return { kind: 'html' as const, html: preview.html }
  const file = preview.files.get(name)
  if (!file) throw new PluginError('미리보기에 없는 파일이야.', 404)
  if (file.source === 'package') return { kind: 'file' as const, filePath: packageFile(preview.pluginId, preview.version, file.path), immutable: true }
  const { media, mimeType } = await mediaFile(file.reference, preview.caller)
  if (media.fingerprint !== file.fingerprint) throw new PluginError('원본 미디어가 변경됐어. 미리보기를 다시 열어줘.', 409)
  return { kind: 'file' as const, filePath: media.filePath, mimeType }
}
