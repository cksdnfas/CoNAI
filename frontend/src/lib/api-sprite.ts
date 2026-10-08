import { requestApiData } from '@/lib/api-request'
import { buildApiUrl } from '@/lib/api-url'
import type { RuntimeJobRecord } from '@/types/runtime-job'

/** /api/sprite — sprite sheets from library videos, sheet normalisation and sheet → animation. */

export type SpriteResizeMode = 'none' | 'contain' | 'cover' | 'stretch'
export type SpriteImageFormat = 'png' | 'webp'

export interface SpriteVideoInfo {
  compositeHash: string
  name: string
  duration: number
  width: number
  height: number
  fps: number
  frameCount: number
  lastFrameTime: number
  formatName: string
}

/** Extraction options; omitted fields take the server defaults (magenta key with despill). */
export interface SpriteExtractOptions {
  startTime: number
  endTime: number | null
  intervalSeconds: number
  /** 0 = interval sampling. */
  sampleCount: number
  backgroundMode: 'none' | 'key'
  keyColors: string[]
  tolerance: number
  softness: number
  despill: boolean
  edgeCleanup: boolean
  autoCrop: boolean
  alphaThreshold: number
  cropX: number
  cropY: number
  cropWidth: number
  cropHeight: number
  resizeMode: SpriteResizeMode
  outputWidth: number
  outputHeight: number
  removeDuplicateFrames: boolean
  frameSimilarityThreshold: number
  columns: number
  spacing: number
  outputFormat: SpriteImageFormat
  outputQuality: number
}

export interface SpriteRect { x: number; y: number; width: number; height: number }

/** Re-layout / re-encode of a cached build; nothing is extracted again. */
export interface SpriteRender {
  columns?: number
  spacing?: number
  crop?: SpriteRect | null
  format?: SpriteImageFormat
  quality?: number
}

export interface SpriteGroupTarget { groupId?: number | null; groupPath?: string | null }

export interface SpriteExtractResult {
  buildId: string
  videoHash: string
  frameCount: number
  removedFrameCount: number
  frameWidth: number
  frameHeight: number
  frameIndices: number[]
  sheet: { width: number; height: number; columns: number; rows: number; format: SpriteImageFormat }
  saved: { compositeHash: string; groupId: number } | null
}

export type SpriteBatchItemStatus = 'waiting' | 'running' | 'done' | 'failed' | 'skipped'

export interface SpriteBatchItem {
  videoHash: string
  status: SpriteBatchItemStatus
  compositeHash?: string
  frameCount?: number
  sheet?: { width: number; height: number }
  error?: string
}

export interface SpriteExtractBatchResult {
  total: number
  succeeded: number
  failed: number
  skipped: number
  stopped: boolean
  items: SpriteBatchItem[]
  zip: { workspaceId: string; fileName: string } | null
}

/** Shared (every account) extraction preset: the full options plus the batch output choices. */
export interface SpritePreset {
  id: string
  name: string
  options: SpriteExtractOptions
  output: { groupPath: string | null; zip: boolean }
  updatedAt: string
}

export type SpritePresetInput = { name?: string; options?: Partial<SpriteExtractOptions>; output?: SpritePreset['output'] }

/** The settings record embedded in a saved sheet (`GET /api/sprite/settings/:hash`). */
export interface SpriteSheetSettings {
  kind: string
  options?: SpriteExtractOptions
  render?: SpriteRender
}

export type SpriteReadOrder = 'row_major' | 'column_major'
export type SpriteAnchorPolicy = 'center' | 'bottom_center' | 'custom'

export interface SpriteNormalizeSheet {
  imageHash: string
  options: {
    columns: number
    rows: number
    frameCount: number
    inputSpacing: number
    outputColumns: number
    readOrder: SpriteReadOrder
    customAnchorX: number
    customAnchorY: number
  }
}

export interface SpriteNormalizeOptions {
  mode: 'per_sheet' | 'group'
  alphaThreshold: number
  padding: number
  outputSpacing: number
  anchorPolicy: SpriteAnchorPolicy
  outputFormat: SpriteImageFormat
  outputQuality: number
}

export interface SpriteNormalizeResult {
  workspaceId: string
  sheets: Array<{ source: string; outputFilename: string; width: number; height: number; compositeHash?: string; warnings: unknown }>
  failures: Array<{ source: string; relative_path: string; error: string }>
  common: { cellSize: unknown; anchor: unknown } | null
}

export type SpriteAnimationFormat = 'gif' | 'webp' | 'mp4'

export interface SpriteAnimationOptions {
  columns: number
  rows: number
  frameCount: number
  spacing: number
  fps: number
  outputFormat: SpriteAnimationFormat
  backgroundColor: string
}

export interface SpriteAnimationResult {
  workspaceId: string
  fileName: string
  mimeType: string
  frameCount: number
  frameWidth: number
  frameHeight: number
  saved: { compositeHash: string; groupId: number } | null
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export function getSpriteVideoInfo(compositeHash: string) {
  return requestApiData<SpriteVideoInfo>(`/api/sprite/videos/${encodeURIComponent(compositeHash)}/info`)
}

export function startSpriteExtract(input: { videoHash: string; options: Partial<SpriteExtractOptions>; save?: SpriteGroupTarget | boolean | null }) {
  return requestApiData<RuntimeJobRecord<SpriteExtractResult>>('/api/sprite/extract', json(input))
}

export function startSpriteExtractBatch(input: { videoHashes: string[]; options: Partial<SpriteExtractOptions>; render?: SpriteRender; save?: SpriteGroupTarget | boolean; zip?: boolean }) {
  return requestApiData<RuntimeJobRecord<SpriteExtractBatchResult>>('/api/sprite/extract-batch', json(input))
}

/** Per-video states of a running batch; null when the run is long finished. */
export function getSpriteBatchItems(jobId: string) {
  return requestApiData<{ items: SpriteBatchItem[]; stopRequested: boolean } | null>(`/api/sprite/batches/${encodeURIComponent(jobId)}/items`)
}

/** Finish the current video, then end the batch. */
export function stopSpriteBatch(jobId: string) {
  return requestApiData<{ stopping: boolean }>(`/api/sprite/batches/${encodeURIComponent(jobId)}/stop`, { method: 'POST' })
}

export function listSpritePresets() {
  return requestApiData<SpritePreset[]>('/api/sprite/presets')
}

export function createSpritePreset(input: SpritePresetInput) {
  return requestApiData<SpritePreset>('/api/sprite/presets', json(input))
}

export function updateSpritePreset(id: string, input: SpritePresetInput) {
  return requestApiData<SpritePreset>(`/api/sprite/presets/${encodeURIComponent(id)}`, { ...json(input), method: 'PUT' })
}

export function deleteSpritePreset(id: string) {
  return requestApiData<{ deleted: boolean }>(`/api/sprite/presets/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function getSpriteSheetSettings(compositeHash: string) {
  return requestApiData<SpriteSheetSettings | null>(`/api/sprite/settings/${encodeURIComponent(compositeHash)}`)
}

/** A still of a library video at `time` seconds (PNG), for browsers that cannot play the file. */
export function spriteVideoFrameUrl(compositeHash: string, time: number, size = 1024) {
  return buildApiUrl(`/api/sprite/videos/${encodeURIComponent(compositeHash)}/frame?t=${time.toFixed(3)}&size=${size}`)
}

export function saveSpriteBuild(buildId: string, render: SpriteRender, group?: SpriteGroupTarget) {
  return requestApiData<{ compositeHash: string; groupId: number }>(`/api/sprite/builds/${encodeURIComponent(buildId)}/save`, json({ render, group: group ?? true }))
}

export function startSpriteNormalize(input: { sheets: SpriteNormalizeSheet[]; options: Partial<SpriteNormalizeOptions>; save?: SpriteGroupTarget | boolean | null }) {
  return requestApiData<RuntimeJobRecord<SpriteNormalizeResult>>('/api/sprite/normalize', json(input))
}

export function startSpriteAnimation(input: { sheetHash: string; options: SpriteAnimationOptions; save?: SpriteGroupTarget | boolean | null }) {
  return requestApiData<RuntimeJobRecord<SpriteAnimationResult>>('/api/sprite/animation', json(input))
}

function rectParam(rect: SpriteRect | null | undefined) {
  return rect ? `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)}` : null
}

function renderQuery(render: SpriteRender, extra: Record<string, string> = {}) {
  const params = new URLSearchParams(extra)
  if (render.columns !== undefined) params.set('columns', String(render.columns))
  if (render.spacing !== undefined) params.set('spacing', String(render.spacing))
  const crop = rectParam(render.crop)
  if (crop) params.set('crop', crop)
  if (render.format) params.set('format', render.format)
  if (render.quality !== undefined) params.set('quality', String(render.quality))
  return params.toString()
}

/** One processed frame (transparent PNG), scaled so its longer side is at most `size`. */
export function spriteFrameUrl(buildId: string, index: number, size = 512) {
  return buildApiUrl(`/api/sprite/builds/${encodeURIComponent(buildId)}/frames/${index}?size=${size}`)
}

export function spriteSheetUrl(buildId: string, render: SpriteRender, download = false) {
  return buildApiUrl(`/api/sprite/builds/${encodeURIComponent(buildId)}/sheet?${renderQuery(render, download ? { download: '1' } : {})}`)
}

export function spriteFramesZipUrl(buildId: string, input: { crop?: SpriteRect | null; format: SpriteImageFormat; quality: number }) {
  const params = new URLSearchParams({ format: input.format, quality: String(input.quality) })
  const crop = rectParam(input.crop)
  if (crop) params.set('crop', crop)
  return buildApiUrl(`/api/sprite/builds/${encodeURIComponent(buildId)}/frames.zip?${params.toString()}`)
}

export function spriteResultDownloadUrl(workspaceId: string, file?: string) {
  return buildApiUrl(`/api/sprite/results/${encodeURIComponent(workspaceId)}/download${file ? `?file=${encodeURIComponent(file)}` : ''}`)
}

export function libraryMediaFileUrl(compositeHash: string) {
  return buildApiUrl(`/api/images/${encodeURIComponent(compositeHash)}/file`)
}

export function libraryThumbnailUrl(compositeHash: string) {
  return buildApiUrl(`/api/images/${encodeURIComponent(compositeHash)}/thumbnail`)
}
