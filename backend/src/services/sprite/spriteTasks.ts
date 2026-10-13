import fs from 'fs'
import path from 'path'
import { buildSpriteFrames, loadBuildFrameAsync, readBuildMeta, renderSheet, writeFramesZip, writeZip, type BuildProgress, type SpriteBuildMeta, type SpriteZipEntry } from './spriteBuild'
import { decodeImage, encodePreviewPng, encodeStill, spriteOptionsXmp } from './spriteEncode'
import { probeVideo } from './spriteFfmpeg'
import { buildSpriteAnimation, type AnimationOptions } from './spriteAnimation'
import { normalizeSpriteSheets, normalizeSpriteSheetsBulk, type NormalizationOptions, type NormalizationSheetOptions, type NormalizedSheet } from './spriteNormalize'
import { validateImageOutput, type SheetLayout, type SpriteExtractOptions, type SpriteImageFormat, type SpriteVideoInfo } from './spriteOptions'
import { SpriteError } from './spriteErrors'
import type { Rect } from './spritePixels'
import { pillowLanczosResize } from '../imageBatchResize/pillowResample'

/**
 * The heavy sprite operations as plain async functions over files. They never touch the databases, so the same code
 * runs in the sprite worker thread (normal case) or inline on the main thread (fallback when no worker script ships,
 * e.g. the single-file bundle), where `yieldEvery` gives the event loop a turn between frames.
 */

export interface TaskContext {
  signal: AbortSignal
  progress: (progress: TaskProgress) => void
  yieldEvery?: () => Promise<void>
}

export interface TaskProgress {
  phase: string
  processed: number
  total: number
  label?: string
}

export interface RenderSpec {
  columns: number
  spacing: number
  crop: Rect | null
  format: SpriteImageFormat
  quality: number
}

export interface RenderedFile {
  file: string
  width: number
  height: number
  layout: SheetLayout
  cellWidth: number
  cellHeight: number
  format: SpriteImageFormat
}

export interface ExtractTaskPayload {
  buildId: string
  workDir: string
  sourcePath: string
  sourceHash: string | null
  sourceName: string | null
  requestedByAccountId: number | null
  options: SpriteExtractOptions
  /** Server-probed metadata for this immutable library source. */
  video?: SpriteVideoInfo
  frameIndicesOverride?: number[]
  render: RenderSpec
}

export interface ExtractTaskResult {
  meta: SpriteBuildMeta
  sheet: RenderedFile
}

/** Settings describe the build, so repeated saves keep its original creation time. */
export function spriteSheetSettings(meta: SpriteBuildMeta, render: RenderSpec) {
  return {
    kind: 'sprite-sheet', version: 1, source: meta.source,
    video: { width: meta.video.width, height: meta.video.height, fps: meta.video.fps, frameCount: meta.video.frameCount },
    frameIndices: meta.keptFrameIndices, options: meta.options, render, createdAt: meta.createdAt,
  }
}

const INITIAL_RENDER_FILE = 'initial-render.json'

async function renderToFile(workDir: string, meta: SpriteBuildMeta, render: RenderSpec, output: string, xmp?: string): Promise<RenderedFile> {
  const image = validateImageOutput(render.format, render.quality)
  const rendered = renderSheet(workDir, meta, { columns: render.columns, spacing: render.spacing, crop: render.crop })
  fs.writeFileSync(output, await encodeStill(rendered.sheet, image.format as SpriteImageFormat, image.quality, xmp))
  return {
    file: output,
    width: rendered.sheet.width,
    height: rendered.sheet.height,
    layout: rendered.layout,
    cellWidth: rendered.cellWidth,
    cellHeight: rendered.cellHeight,
    format: image.format as SpriteImageFormat,
  }
}

export async function extractTask(payload: ExtractTaskPayload, ctx: TaskContext): Promise<ExtractTaskResult> {
  ctx.progress({ phase: 'probe', processed: 0, total: 0 })
  const video: SpriteVideoInfo = payload.video ?? await probeVideo(payload.sourcePath, ctx.signal)
  const meta = await buildSpriteFrames({
    buildId: payload.buildId,
    workDir: payload.workDir,
    sourcePath: payload.sourcePath,
    sourceHash: payload.sourceHash,
    sourceName: payload.sourceName,
    requestedByAccountId: payload.requestedByAccountId,
    video,
    options: payload.options,
    signal: ctx.signal,
    frameIndicesOverride: payload.frameIndicesOverride,
    yieldEvery: ctx.yieldEvery,
    onProgress: (progress: BuildProgress) => ctx.progress({ phase: progress.phase, processed: progress.processed, total: progress.total }),
  })
  ctx.progress({ phase: 'render', processed: meta.frameCount, total: meta.frameCount })
  const xmp = spriteOptionsXmp(spriteSheetSettings(meta, payload.render))
  const sheet = await renderToFile(payload.workDir, meta, payload.render, path.join(payload.workDir, `sheet.${payload.render.format}`), xmp)
  fs.writeFileSync(path.join(payload.workDir, INITIAL_RENDER_FILE), JSON.stringify({ render: payload.render, xmp, sheet }))
  return { meta, sheet }
}

export interface RenderTaskPayload {
  workDir: string
  render: RenderSpec
  output: string
  xmp?: string
}

export async function renderTask(payload: RenderTaskPayload, ctx: TaskContext): Promise<RenderedFile> {
  ctx.signal.throwIfAborted()
  const meta = readBuildMeta(payload.workDir)
  if (!meta) throw new SpriteError('작업 결과가 만료되었습니다. 다시 생성하세요.', 410)
  const xmp = payload.xmp ?? spriteOptionsXmp(spriteSheetSettings(meta, payload.render))
  let initial: { render: RenderSpec; xmp: string; sheet: RenderedFile } | null = null
  try { initial = JSON.parse(fs.readFileSync(path.join(payload.workDir, INITIAL_RENDER_FILE), 'utf8')) } catch { /* Older builds have no cached render. */ }
  const initialFile = path.join(payload.workDir, `sheet.${payload.render.format}`)
  if (initial && JSON.stringify(initial.render) === JSON.stringify(payload.render) && initial.xmp === xmp && fs.existsSync(initialFile)) {
    await fs.promises.copyFile(initialFile, payload.output)
    ctx.signal.throwIfAborted()
    return { ...initial.sheet, file: payload.output }
  }
  const rendered = await renderToFile(payload.workDir, meta, payload.render, payload.output, xmp)
  ctx.signal.throwIfAborted()
  return rendered
}

export interface FramesZipTaskPayload {
  workDir: string
  crop: Rect | null
  format: SpriteImageFormat
  quality: number
  stem: string
  output: string
}

export async function framesZipTask(payload: FramesZipTaskPayload, ctx: TaskContext): Promise<{ file: string; frameCount: number }> {
  const meta = readBuildMeta(payload.workDir)
  if (!meta) throw new SpriteError('작업 결과가 만료되었습니다. 다시 생성하세요.', 410)
  await writeFramesZip(payload.workDir, meta, { crop: payload.crop, format: payload.format, quality: payload.quality, stem: payload.stem, output: payload.output }, ctx.signal)
  return { file: payload.output, frameCount: meta.frameCount }
}

export interface NormalizeTaskSource {
  filePath: string
  sourceName: string
  outputStem: string
  relativePath?: string | null
  options: NormalizationSheetOptions
}

export interface NormalizeTaskPayload {
  workDir: string
  sources: NormalizeTaskSource[]
  options: NormalizationOptions
  bulk: boolean
  /** When set, each sheet file (the one saved to the library) embeds these settings plus its own metadata as XMP. */
  settings?: Record<string, unknown>
}

export interface NormalizeTaskResult {
  sheets: Array<{ file: string; outputFilename: string; metadataFilename: string; width: number; height: number; metadata: Record<string, unknown> }>
  manifest: Record<string, unknown>
  failures: Array<{ source: string; relative_path: string; error: string }>
  zipFile: string
}

export async function normalizeTask(payload: NormalizeTaskPayload, ctx: TaskContext): Promise<NormalizeTaskResult> {
  const total = payload.sources.length
  const loaders = payload.sources.map((source) => async () => ({
    image: await decodeImage(source.filePath),
    sourceName: source.sourceName,
    outputStem: source.outputStem,
    relativePath: source.relativePath ?? null,
    options: source.options,
  }))
  const outDir = path.join(payload.workDir, 'normalized')
  fs.mkdirSync(outDir, { recursive: true })
  const zipDir = path.join(payload.workDir, 'normalized-zip')
  if (payload.settings) fs.mkdirSync(zipDir, { recursive: true })
  const sheets: NormalizeTaskResult['sheets'] = []
  const entries: SpriteZipEntry[] = []
  const image = { format: payload.options.outputFormat, quality: payload.options.outputFormat === 'webp' ? payload.options.outputQuality : 100 }
  const persistSheet = async (sheet: NormalizedSheet) => {
    ctx.signal.throwIfAborted()
    const name = `${String(sheets.length + 1).padStart(4, '0')}.${path.extname(sheet.outputFilename).slice(1)}`
    const file = path.join(outDir, name)
    const bytes = payload.settings
      ? await encodeStill(sheet.sheet, image.format, image.quality, spriteOptionsXmp({ ...payload.settings, sheet: sheet.metadata }))
      : sheet.image
    fs.writeFileSync(file, bytes)
    // ZIPs preserve the original pixel/metadata format; the library file additionally carries XMP.
    const zipSource = payload.settings ? path.join(zipDir, name) : file
    if (payload.settings) fs.writeFileSync(zipSource, sheet.image)
    sheets.push({ file, outputFilename: sheet.outputFilename, metadataFilename: sheet.metadataFilename, width: sheet.sheet.width, height: sheet.sheet.height, metadata: sheet.metadata })
    entries.push({ name: sheet.outputFilename, file: zipSource }, { name: sheet.metadataFilename, data: Buffer.from(JSON.stringify(sheet.metadata, null, 2)) })
  }
  let result
  if (payload.bulk) {
    result = await normalizeSpriteSheetsBulk(loaders, payload.options, {
      onProgress: (progress) => ctx.progress({ phase: progress.phase, processed: progress.processed, total, label: progress.current }),
      throwIfCancelled: () => { if (ctx.signal.aborted) throw new SpriteError('일괄 정규화 작업이 취소되었습니다.') },
      onSheet: persistSheet,
    })
  } else {
    const sources = []
    for (const load of loaders) sources.push(await load())
    result = { ...(await normalizeSpriteSheets(sources, payload.options)), failures: [] }
    for (const sheet of result.sheets) await persistSheet(sheet)
  }
  const manifestJson = Buffer.from(JSON.stringify(result.manifest, null, 2))
  if (payload.bulk) entries.push({ name: 'batch-manifest.json', data: manifestJson })
  entries.push({ name: 'normalization-manifest.json', data: manifestJson })
  const zipFile = path.join(payload.workDir, payload.bulk ? 'sprite-normalization-batch.zip' : 'normalized-sprite-sheets.zip')
  await writeZip(zipFile, entries, ctx.signal)
  if (payload.settings) fs.rmSync(zipDir, { recursive: true, force: true })
  return { sheets, manifest: result.manifest, failures: result.failures, zipFile }
}

export interface AnimationTaskPayload {
  sheetPath: string
  options: AnimationOptions
  output: string
  xmp?: string
}

export async function animationTask(payload: AnimationTaskPayload, ctx: TaskContext): Promise<{ file: string; mimeType: string; extension: string; frameCount: number; frameWidth: number; frameHeight: number }> {
  const sheet = await decodeImage(payload.sheetPath)
  const result = await buildSpriteAnimation(sheet, payload.options, { xmp: payload.xmp, signal: ctx.signal })
  fs.writeFileSync(payload.output, result.bytes)
  return { file: payload.output, mimeType: result.mimeType, extension: result.extension, frameCount: result.frameCount, frameWidth: result.frameWidth, frameHeight: result.frameHeight }
}

export interface PreviewTaskPayload {
  workDir: string
  index: number
  maxSide: number
}

/** One frame of a build as a small PNG (frame strip / player previews). */
export async function previewTask(payload: PreviewTaskPayload): Promise<{ png: Uint8Array }> {
  const meta = readBuildMeta(payload.workDir)
  if (!meta) throw new SpriteError('작업 결과가 만료되었습니다. 다시 생성하세요.', 410)
  if (!Number.isInteger(payload.index) || payload.index < 0 || payload.index >= meta.frameCount) throw new SpriteError('프레임 번호를 확인하세요.', 404)
  return { png: new Uint8Array(await encodePreviewPng(await loadBuildFrameAsync(payload.workDir, meta, payload.index), payload.maxSide)) }
}

export interface ResizeImageTaskPayload {
  sourcePath: string
  output: string
  width: number
  height: number
  format: SpriteImageFormat
  quality: number
}

/** Library batch resize ("크기 변경"): Pillow-exact Lanczos on this thread, encoded like the other still outputs. */
export async function resizeImageTask(payload: ResizeImageTaskPayload): Promise<{ file: string; width: number; height: number }> {
  const resized = pillowLanczosResize(await decodeImage(payload.sourcePath), payload.width, payload.height)
  fs.writeFileSync(payload.output, await encodeStill(resized, payload.format, payload.quality))
  return { file: payload.output, width: resized.width, height: resized.height }
}

export const SPRITE_TASKS = {
  extract: extractTask,
  render: renderTask,
  framesZip: framesZipTask,
  normalize: normalizeTask,
  animation: animationTask,
  resizeImage: resizeImageTask,
  preview: previewTask,
} as const

export type SpriteTaskName = keyof typeof SPRITE_TASKS
export type SpriteTaskPayload<T extends SpriteTaskName> = Parameters<(typeof SPRITE_TASKS)[T]>[0]
export type SpriteTaskResult<T extends SpriteTaskName> = Awaited<ReturnType<(typeof SPRITE_TASKS)[T]>>
