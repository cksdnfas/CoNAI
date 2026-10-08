import fs from 'fs'
import path from 'path'
import { buildSpriteFrames, loadBuildFrame, readBuildMeta, renderSheet, writeFramesZip, writeZip, type BuildProgress, type SpriteBuildMeta } from './spriteBuild'
import { decodeImage, encodePreviewPng, encodeStill, spriteOptionsXmp } from './spriteEncode'
import { probeVideo } from './spriteFfmpeg'
import { buildSpriteAnimation, type AnimationOptions } from './spriteAnimation'
import { normalizeSpriteSheets, normalizeSpriteSheetsBulk, type NormalizationOptions, type NormalizationSheetOptions } from './spriteNormalize'
import { validateImageOutput, type SheetLayout, type SpriteExtractOptions, type SpriteImageFormat, type SpriteVideoInfo } from './spriteOptions'
import { SpriteError } from './spriteErrors'
import type { Rect } from './spritePixels'

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
  frameIndicesOverride?: number[]
  render: RenderSpec
}

export interface ExtractTaskResult {
  meta: SpriteBuildMeta
  sheet: RenderedFile
}

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
  const video: SpriteVideoInfo = await probeVideo(payload.sourcePath, ctx.signal)
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
  const sheet = await renderToFile(payload.workDir, meta, payload.render, path.join(payload.workDir, `sheet.${payload.render.format}`))
  return { meta, sheet }
}

export interface RenderTaskPayload {
  workDir: string
  render: RenderSpec
  output: string
  xmp?: string
}

export async function renderTask(payload: RenderTaskPayload): Promise<RenderedFile> {
  const meta = readBuildMeta(payload.workDir)
  if (!meta) throw new SpriteError('작업 결과가 만료되었습니다. 다시 생성하세요.', 410)
  return renderToFile(payload.workDir, meta, payload.render, payload.output, payload.xmp)
}

export interface FramesZipTaskPayload {
  workDir: string
  crop: Rect | null
  format: SpriteImageFormat
  quality: number
  stem: string
  output: string
}

export async function framesZipTask(payload: FramesZipTaskPayload): Promise<{ file: string; frameCount: number }> {
  const meta = readBuildMeta(payload.workDir)
  if (!meta) throw new SpriteError('작업 결과가 만료되었습니다. 다시 생성하세요.', 410)
  await writeFramesZip(payload.workDir, meta, { crop: payload.crop, format: payload.format, quality: payload.quality, stem: payload.stem, output: payload.output })
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
  let result
  if (payload.bulk) {
    result = await normalizeSpriteSheetsBulk(loaders, payload.options, {
      onProgress: (progress) => ctx.progress({ phase: progress.phase, processed: progress.processed, total, label: progress.current }),
      throwIfCancelled: () => { if (ctx.signal.aborted) throw new SpriteError('일괄 정규화 작업이 취소되었습니다.') },
    })
  } else {
    const sources = []
    for (const load of loaders) sources.push(await load())
    result = { ...(await normalizeSpriteSheets(sources, payload.options)), failures: [] }
  }
  const outDir = path.join(payload.workDir, 'normalized')
  fs.mkdirSync(outDir, { recursive: true })
  const sheets: NormalizeTaskResult['sheets'] = []
  const entries: Array<{ name: string; data: Buffer }> = []
  const image = { format: payload.options.outputFormat, quality: payload.options.outputFormat === 'webp' ? payload.options.outputQuality : 100 }
  for (const [index, sheet] of result.sheets.entries()) {
    const file = path.join(outDir, `${String(index + 1).padStart(4, '0')}.${path.extname(sheet.outputFilename).slice(1)}`)
    const bytes = payload.settings
      ? await encodeStill(sheet.sheet, image.format, image.quality, spriteOptionsXmp({ ...payload.settings, sheet: sheet.metadata }))
      : sheet.image
    fs.writeFileSync(file, bytes)
    sheets.push({ file, outputFilename: sheet.outputFilename, metadataFilename: sheet.metadataFilename, width: sheet.sheet.width, height: sheet.sheet.height, metadata: sheet.metadata })
    entries.push({ name: sheet.outputFilename, data: sheet.image }, { name: sheet.metadataFilename, data: Buffer.from(JSON.stringify(sheet.metadata, null, 2)) })
  }
  const manifestJson = Buffer.from(JSON.stringify(result.manifest, null, 2))
  if (payload.bulk) entries.push({ name: 'batch-manifest.json', data: manifestJson })
  entries.push({ name: 'normalization-manifest.json', data: manifestJson })
  const zipFile = path.join(payload.workDir, payload.bulk ? 'sprite-normalization-batch.zip' : 'normalized-sprite-sheets.zip')
  await writeZip(zipFile, entries)
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
  return { png: new Uint8Array(await encodePreviewPng(loadBuildFrame(payload.workDir, meta, payload.index), payload.maxSide)) }
}

export const SPRITE_TASKS = {
  extract: extractTask,
  render: renderTask,
  framesZip: framesZipTask,
  normalize: normalizeTask,
  animation: animationTask,
  preview: previewTask,
} as const

export type SpriteTaskName = keyof typeof SPRITE_TASKS
export type SpriteTaskPayload<T extends SpriteTaskName> = Parameters<(typeof SPRITE_TASKS)[T]>[0]
export type SpriteTaskResult<T extends SpriteTaskName> = Awaited<ReturnType<(typeof SPRITE_TASKS)[T]>>
