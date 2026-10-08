import fs from 'fs'
import path from 'path'
import { RuntimeJobRunner, type RuntimeJobContext } from '../runtimeJobs/runtimeJobRunner'
import { RuntimeJobStore } from '../runtimeJobs/runtimeJobStore'
import { isRuntimeJobTerminalStatus, type RuntimeJobKind, type RuntimeJobRecord } from '../../types/runtimeJob'
import { readBuildMeta, type SpriteBuildMeta } from './spriteBuild'
import { canAccessSpriteWorkspace, createSpriteWorkspace, getSpriteWorkspace, removeSpriteWorkspace, workspaceFile, type SpriteWorkspace } from './spriteCache'
import { spriteOptionsXmp } from './spriteEncode'
import { SpriteError } from './spriteErrors'
import { probeVideo } from './spriteFfmpeg'
import { ANIMATION_DEFAULTS, ANIMATION_MIME, type AnimationOptions } from './spriteAnimation'
import { NORMALIZATION_DEFAULTS, type NormalizationOptions, type NormalizationSheetOptions } from './spriteNormalize'
import { resolveExtractOptions, validateImageOutput, type SpriteExtractOptionsInput, type SpriteImageFormat, type SpriteVideoInfo } from './spriteOptions'
import type { Rect } from './spritePixels'
import { requireLibraryImage, requireLibraryVideo, saveSpriteOutputToLibrary, type SpriteGroupTarget } from './spriteLibrary'
import { runSpriteTask } from './spriteWorkerClient'
import type { RenderSpec } from './spriteTasks'

/**
 * Sprite operations shared by the REST routes and the MCP tools: start runtime jobs, look up build workspaces with
 * an ownership check, re-render / save / download from a build without re-extracting.
 */

export const SPRITE_JOB_KINDS = ['sprite-extract', 'sprite-extract-batch', 'sprite-normalize', 'sprite-animation'] as const satisfies readonly RuntimeJobKind[]
export type SpriteJobKind = (typeof SPRITE_JOB_KINDS)[number]

export interface SpriteRequester {
  accountId: number | null
  accountType: string | null
}

export interface RenderInput {
  columns?: number
  spacing?: number
  crop?: Rect | null
  format?: SpriteImageFormat
  quality?: number
}

export function resolveRender(input: RenderInput | undefined, fallback?: { format: SpriteImageFormat; quality: number; columns: number; spacing: number }): RenderSpec {
  const format = input?.format ?? fallback?.format ?? 'png'
  const quality = input?.quality ?? fallback?.quality ?? 90
  const image = validateImageOutput(format, quality)
  return {
    columns: input?.columns ?? fallback?.columns ?? 0,
    spacing: input?.spacing ?? fallback?.spacing ?? 0,
    crop: input?.crop ?? null,
    format: image.format as SpriteImageFormat,
    quality: image.quality,
  }
}

/** A build/normalise/animation workspace of this requester (admins see all). 410 when it expired. */
export function requireWorkspace(id: string, requester: SpriteRequester): SpriteWorkspace {
  const workspace = getSpriteWorkspace(id)
  if (!workspace) throw new SpriteError('작업 결과가 만료되었거나 없습니다. 다시 생성하세요.', 410)
  if (!canAccessSpriteWorkspace(workspace.owner, requester)) throw new SpriteError('이 작업 결과에 접근할 수 없습니다.', 403)
  return workspace
}

export function requireBuild(id: string, requester: SpriteRequester): { workspace: SpriteWorkspace; meta: SpriteBuildMeta } {
  const workspace = requireWorkspace(id, requester)
  const meta = readBuildMeta(workspace.dir)
  if (!meta) throw new SpriteError('작업 결과가 아직 준비되지 않았거나 만료되었습니다.', 410)
  return { workspace, meta }
}

export async function probeLibraryVideo(compositeHash: string): Promise<SpriteVideoInfo & { compositeHash: string; name: string }> {
  const media = requireLibraryVideo(compositeHash)
  return { ...(await probeVideo(media.filePath)), compositeHash, name: media.name }
}

// ---------------------------------------------------------------------------------------------------------------------
// Runtime jobs
// ---------------------------------------------------------------------------------------------------------------------

/** One sprite job runs at a time (ffmpeg + pixel work); later ones wait in order, visible as phase "waiting". */
let lane: Promise<void> = Promise.resolve()
async function inLane<T>(ctx: RuntimeJobContext<unknown>, run: () => Promise<T>): Promise<T> {
  const previous = lane
  let release!: () => void
  lane = new Promise<void>((resolve) => { release = resolve })
  try {
    ctx.flush({ phase: 'waiting', message: '앞선 스프라이트 작업을 기다리는 중' })
    await Promise.race([previous, new Promise<void>((resolve) => ctx.signal.addEventListener('abort', () => resolve(), { once: true }))])
    ctx.throwIfCancelled()
    return await run()
  } finally {
    release()
  }
}

function progressReporter(ctx: RuntimeJobContext<unknown>, offset = 0, scale = 1, totalOverride?: number) {
  return (progress: { phase: string; processed: number; total: number; label?: string }) => {
    ctx.report({
      phase: progress.phase,
      total: totalOverride ?? progress.total,
      processed: Math.round(offset + progress.processed * scale),
      ...(progress.label ? { currentLabel: progress.label } : {}),
    })
  }
}

export interface ExtractJobParams {
  videoHash: string
  options: SpriteExtractOptionsInput
  frameIndices?: number[]
  render?: RenderInput
  /** When set, the rendered sheet is saved to the library (images.upload checked by the caller). */
  save?: SpriteGroupTarget | null
  requester: SpriteRequester
}

export interface ExtractJobResult {
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

function settingsRecord(meta: SpriteBuildMeta, render: RenderSpec) {
  return {
    kind: 'sprite-sheet',
    version: 1,
    source: meta.source,
    video: { width: meta.video.width, height: meta.video.height, fps: meta.video.fps, frameCount: meta.video.frameCount },
    frameIndices: meta.keptFrameIndices,
    options: meta.options,
    render,
    createdAt: new Date().toISOString(),
  }
}

/** Render a build with the settings XMP and save it to the library. */
export async function saveBuildSheet(workspace: SpriteWorkspace, meta: SpriteBuildMeta, render: RenderSpec, group: SpriteGroupTarget | undefined, signal?: AbortSignal) {
  const output = workspaceFile(workspace, `save-${Date.now()}.${render.format}`)
  try {
    await runSpriteTask('render', { workDir: workspace.dir, render, output, xmp: spriteOptionsXmp(settingsRecord(meta, render)) }, { signal })
    return await saveSpriteOutputToLibrary({ bytes: fs.readFileSync(output), extension: render.format, mimeType: `image/${render.format}`, group })
  } finally {
    fs.rmSync(output, { force: true })
  }
}

async function runExtract(params: ExtractJobParams, ctx: RuntimeJobContext<unknown>, onProgress = progressReporter(ctx)): Promise<ExtractJobResult> {
  const media = requireLibraryVideo(params.videoHash)
  const options = resolveExtractOptions(params.options)
  const render = resolveRender(params.render, { format: options.outputFormat, quality: options.outputQuality, columns: options.columns, spacing: options.spacing })
  const workspace = createSpriteWorkspace('build', params.requester)
  try {
    const { meta, sheet } = await runSpriteTask('extract', {
      buildId: workspace.id,
      workDir: workspace.dir,
      sourcePath: media.filePath,
      sourceHash: media.compositeHash,
      sourceName: media.name,
      requestedByAccountId: params.requester.accountId,
      options,
      frameIndicesOverride: params.frameIndices,
      render,
    }, { signal: ctx.signal, onProgress })
    let saved: ExtractJobResult['saved'] = null
    if (params.save) {
      ctx.flush({ phase: 'save' })
      saved = await saveBuildSheet(workspace, meta, render, params.save, ctx.signal)
    }
    return {
      buildId: workspace.id,
      videoHash: media.compositeHash,
      frameCount: meta.frameCount,
      removedFrameCount: meta.removedFrameCount,
      frameWidth: meta.frameWidth,
      frameHeight: meta.frameHeight,
      frameIndices: meta.keptFrameIndices,
      sheet: { width: sheet.width, height: sheet.height, columns: sheet.layout.columns, rows: sheet.layout.rows, format: sheet.format },
      saved,
    }
  } catch (error) {
    removeSpriteWorkspace(workspace.id)
    throw error
  }
}

export interface ExtractBatchJobParams {
  videoHashes: string[]
  options: SpriteExtractOptionsInput
  render?: RenderInput
  save: SpriteGroupTarget
  requester: SpriteRequester
}

export interface ExtractBatchJobResult {
  total: number
  succeeded: number
  failed: number
  items: Array<{ videoHash: string; compositeHash?: string; frameCount?: number; sheet?: { width: number; height: number }; error?: string }>
}

async function runExtractBatch(params: ExtractBatchJobParams, ctx: RuntimeJobContext<unknown>): Promise<ExtractBatchJobResult> {
  const items: ExtractBatchJobResult['items'] = []
  const total = params.videoHashes.length
  for (let index = 0; index < total; index += 1) {
    ctx.throwIfCancelled()
    const videoHash = params.videoHashes[index]
    ctx.report({ phase: 'batch', total, processed: index, currentLabel: videoHash })
    try {
      const result = await runExtract({ videoHash, options: params.options, render: params.render, save: params.save, requester: params.requester }, ctx, () => {})
      // Batch outputs live in the library; drop the workspace right away to keep the temp folder small.
      removeSpriteWorkspace(result.buildId)
      items.push({ videoHash, compositeHash: result.saved?.compositeHash, frameCount: result.frameCount, sheet: { width: result.sheet.width, height: result.sheet.height } })
    } catch (error) {
      if (ctx.isCancelRequested()) throw error
      const message = error instanceof Error ? error.message : String(error)
      ctx.recordError(videoHash, message)
      items.push({ videoHash, error: message })
    }
  }
  ctx.report({ phase: 'done', total, processed: total })
  const failed = items.filter((item) => item.error).length
  if (failed === total) throw new SpriteError(items[0]?.error ?? '모든 영상 처리에 실패했습니다.')
  return { total, succeeded: total - failed, failed, items }
}

export interface NormalizeJobSheet {
  imageHash: string
  options: NormalizationSheetOptions
}

export interface NormalizeJobParams {
  sheets: NormalizeJobSheet[]
  options: Partial<NormalizationOptions>
  save?: SpriteGroupTarget | null
  requester: SpriteRequester
}

export interface NormalizeJobResult {
  workspaceId: string
  sheets: Array<{ source: string; outputFilename: string; width: number; height: number; compositeHash?: string; warnings: unknown }>
  failures: Array<{ source: string; relative_path: string; error: string }>
  common: unknown
}

async function runNormalize(params: NormalizeJobParams, ctx: RuntimeJobContext<unknown>): Promise<NormalizeJobResult> {
  const options: NormalizationOptions = { ...NORMALIZATION_DEFAULTS, ...params.options }
  const bulk = params.sheets.length > 16
  const used = new Map<string, number>()
  const sources = params.sheets.map((sheet) => {
    const media = requireLibraryImage(sheet.imageHash)
    const stem = path.parse(media.name).name || sheet.imageHash.slice(0, 12)
    const count = (used.get(stem) ?? 0) + 1
    used.set(stem, count)
    return { filePath: media.filePath, sourceName: media.name, outputStem: `${stem}${count > 1 ? `-${count}` : ''}-normalized`, relativePath: null, options: sheet.options }
  })
  const workspace = createSpriteWorkspace('normalize', params.requester)
  try {
    const settings = params.save ? { kind: 'sprite-normalized', version: 1, options, createdAt: new Date().toISOString() } : undefined
    const result = await runSpriteTask('normalize', { workDir: workspace.dir, sources, options, bulk, settings }, { signal: ctx.signal, onProgress: progressReporter(ctx) })
    const sheets: NormalizeJobResult['sheets'] = []
    for (const sheet of result.sheets) {
      let compositeHash: string | undefined
      if (params.save) {
        const extension = path.extname(sheet.outputFilename).slice(1)
        compositeHash = (await saveSpriteOutputToLibrary({ bytes: fs.readFileSync(sheet.file), extension, mimeType: `image/${extension}`, group: params.save })).compositeHash
      }
      sheets.push({ source: String(sheet.metadata.source), outputFilename: sheet.outputFilename, width: sheet.width, height: sheet.height, compositeHash, warnings: sheet.metadata.warnings })
    }
    return {
      workspaceId: workspace.id,
      sheets,
      failures: result.failures,
      common: result.manifest.common_output_cell_size ? { cellSize: result.manifest.common_output_cell_size, anchor: result.manifest.common_output_anchor } : null,
    }
  } catch (error) {
    removeSpriteWorkspace(workspace.id)
    throw error
  }
}

export interface AnimationJobParams {
  sheetHash: string
  options: Partial<AnimationOptions> & Pick<AnimationOptions, 'columns' | 'rows' | 'frameCount'>
  save?: SpriteGroupTarget | null
  requester: SpriteRequester
}

export interface AnimationJobResult {
  workspaceId: string
  fileName: string
  mimeType: string
  frameCount: number
  frameWidth: number
  frameHeight: number
  saved: { compositeHash: string; groupId: number } | null
}

async function runAnimation(params: AnimationJobParams, ctx: RuntimeJobContext<unknown>): Promise<AnimationJobResult> {
  const media = requireLibraryImage(params.sheetHash)
  const options: AnimationOptions = { ...ANIMATION_DEFAULTS, ...params.options } as AnimationOptions
  const workspace = createSpriteWorkspace('animation', params.requester)
  try {
    const fileName = `${path.parse(media.name).name || 'sprite'}-animation.${options.outputFormat}`
    const output = workspaceFile(workspace, fileName)
    const xmp = spriteOptionsXmp({ kind: 'sprite-animation', version: 1, source: { compositeHash: media.compositeHash, name: media.name }, options, createdAt: new Date().toISOString() })
    ctx.flush({ phase: 'animation' })
    const result = await runSpriteTask('animation', { sheetPath: media.filePath, options, output, xmp }, { signal: ctx.signal })
    let saved: AnimationJobResult['saved'] = null
    if (params.save) {
      ctx.flush({ phase: 'save' })
      saved = await saveSpriteOutputToLibrary({ bytes: fs.readFileSync(output), extension: result.extension, mimeType: ANIMATION_MIME[options.outputFormat], group: params.save })
    }
    return { workspaceId: workspace.id, fileName, mimeType: result.mimeType, frameCount: result.frameCount, frameWidth: result.frameWidth, frameHeight: result.frameHeight, saved }
  } catch (error) {
    removeSpriteWorkspace(workspace.id)
    throw error
  }
}

let registered = false

/** Register the four sprite job kinds (idempotent; runtimeJobs/index.ts calls it with the other handlers). */
export function registerSpriteJobHandlers(): void {
  if (registered) return
  registered = true
  RuntimeJobRunner.register<ExtractJobParams, ExtractJobResult>({ kind: 'sprite-extract', singletonKey: () => null, handler: (ctx) => inLane(ctx, () => runExtract(ctx.params, ctx)) })
  RuntimeJobRunner.register<ExtractBatchJobParams, ExtractBatchJobResult>({ kind: 'sprite-extract-batch', singletonKey: () => null, handler: (ctx) => inLane(ctx, () => runExtractBatch(ctx.params, ctx)) })
  RuntimeJobRunner.register<NormalizeJobParams, NormalizeJobResult>({ kind: 'sprite-normalize', singletonKey: () => null, handler: (ctx) => inLane(ctx, () => runNormalize(ctx.params, ctx)) })
  RuntimeJobRunner.register<AnimationJobParams, AnimationJobResult>({ kind: 'sprite-animation', singletonKey: () => null, handler: (ctx) => inLane(ctx, () => runAnimation(ctx.params, ctx)) })
}

// ---------------------------------------------------------------------------------------------------------------------
// Entry points (validate early so callers get a 4xx instead of a failed job)
// ---------------------------------------------------------------------------------------------------------------------

export function startExtractJob(params: ExtractJobParams): RuntimeJobRecord {
  requireLibraryVideo(params.videoHash)
  const options = resolveExtractOptions(params.options)
  resolveRender(params.render, { format: options.outputFormat, quality: options.outputQuality, columns: options.columns, spacing: options.spacing })
  return RuntimeJobRunner.start('sprite-extract', params, { requestedByAccountId: params.requester.accountId })
}

export function startExtractBatchJob(params: ExtractBatchJobParams): RuntimeJobRecord {
  if (!Array.isArray(params.videoHashes) || params.videoHashes.length < 1 || params.videoHashes.length > 100) {
    throw new SpriteError('영상은 한 번에 1개에서 100개까지 처리할 수 있습니다.')
  }
  if (new Set(params.videoHashes).size !== params.videoHashes.length) throw new SpriteError('같은 영상이 두 번 들어 있습니다.')
  params.videoHashes.forEach(requireLibraryVideo)
  resolveExtractOptions(params.options)
  return RuntimeJobRunner.start('sprite-extract-batch', params, { requestedByAccountId: params.requester.accountId, total: params.videoHashes.length })
}

/** Fill the per-sheet fields callers may leave out: no input spacing, row-major, same column count as the input. */
export function withSheetDefaults(options: Partial<NormalizationSheetOptions> & Pick<NormalizationSheetOptions, 'columns' | 'rows' | 'frameCount'>): NormalizationSheetOptions {
  return {
    inputSpacing: 0,
    readOrder: 'row_major',
    customAnchorX: 0,
    customAnchorY: 0,
    ...options,
    outputColumns: options.outputColumns ?? Math.max(1, Math.min(Number(options.columns), Number(options.frameCount))),
  }
}

export function startNormalizeJob(params: NormalizeJobParams): RuntimeJobRecord {
  if (!Array.isArray(params.sheets) || params.sheets.length < 1 || params.sheets.length > 500) {
    throw new SpriteError('한 번에 1개에서 500개의 시트를 처리할 수 있습니다.')
  }
  params.sheets.forEach((sheet) => requireLibraryImage(sheet.imageHash))
  params = { ...params, sheets: params.sheets.map((sheet) => ({ imageHash: sheet.imageHash, options: withSheetDefaults(sheet.options ?? ({} as NormalizationSheetOptions)) })) }
  return RuntimeJobRunner.start('sprite-normalize', params, { requestedByAccountId: params.requester.accountId, total: params.sheets.length })
}

export function startAnimationJob(params: AnimationJobParams): RuntimeJobRecord {
  requireLibraryImage(params.sheetHash)
  return RuntimeJobRunner.start('sprite-animation', params, { requestedByAccountId: params.requester.accountId })
}

/** Wait for a job to end, polling the job table (works for subprocess and in-process jobs alike). */
export async function waitForRuntimeJob(jobId: string, timeoutMs: number): Promise<RuntimeJobRecord | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const job = RuntimeJobStore.get(jobId)
    if (!job || isRuntimeJobTerminalStatus(job.status) || Date.now() >= deadline) return job
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

export function isSpriteJobKind(kind: string): kind is SpriteJobKind {
  return (SPRITE_JOB_KINDS as readonly string[]).includes(kind)
}

// ---------------------------------------------------------------------------------------------------------------------
// Build follow-ups (no re-extraction)
// ---------------------------------------------------------------------------------------------------------------------

export function buildSummary(meta: SpriteBuildMeta) {
  return {
    buildId: meta.buildId,
    createdAt: meta.createdAt,
    source: meta.source,
    video: meta.video,
    options: meta.options,
    frameIndices: meta.keptFrameIndices,
    frameCount: meta.frameCount,
    removedFrameCount: meta.removedFrameCount,
    frameWidth: meta.frameWidth,
    frameHeight: meta.frameHeight,
    autoCropBounds: meta.autoCropBounds,
  }
}

export async function renderBuildSheet(buildId: string, input: RenderInput, requester: SpriteRequester) {
  const { workspace, meta } = requireBuild(buildId, requester)
  const render = resolveRender(input, { format: meta.options.outputFormat, quality: meta.options.outputQuality, columns: meta.options.columns, spacing: meta.options.spacing })
  const output = workspaceFile(workspace, `render-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${render.format}`)
  const rendered = await runSpriteTask('render', { workDir: workspace.dir, render, output })
  return { ...rendered, mimeType: `image/${render.format}` }
}

export async function saveBuild(buildId: string, input: RenderInput, group: SpriteGroupTarget | undefined, requester: SpriteRequester) {
  const { workspace, meta } = requireBuild(buildId, requester)
  const render = resolveRender(input, { format: meta.options.outputFormat, quality: meta.options.outputQuality, columns: meta.options.columns, spacing: meta.options.spacing })
  return saveBuildSheet(workspace, meta, render, group)
}

export async function buildFramesZip(buildId: string, input: { crop?: Rect | null; format?: SpriteImageFormat; quality?: number; stem?: string }, requester: SpriteRequester) {
  const { workspace, meta } = requireBuild(buildId, requester)
  const image = validateImageOutput(input.format ?? 'png', input.quality ?? 90)
  const stem = (input.stem || path.parse(meta.source.name ?? 'sprite').name || 'sprite').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 80) || 'sprite'
  // A unique name per request: the REST route deletes its copy after streaming, the MCP artifact keeps its own.
  const output = workspaceFile(workspace, `${stem}-frames-${Math.random().toString(36).slice(2, 8)}.zip`)
  const { frameCount } = await runSpriteTask('framesZip', { workDir: workspace.dir, crop: input.crop ?? null, format: image.format as SpriteImageFormat, quality: image.quality, stem, output })
  return { file: output, fileName: `${stem}.zip`, workspaceId: workspace.id, frameCount }
}

export async function buildFramePreview(buildId: string, index: number, maxSide: number, requester: SpriteRequester) {
  const { workspace } = requireBuild(buildId, requester)
  const { png } = await runSpriteTask('preview', { workDir: workspace.dir, index, maxSide: Math.min(1024, Math.max(16, maxSide)) }, { inline: true })
  return Buffer.from(png.buffer, png.byteOffset, png.byteLength)
}

/** Download of a finished normalisation (ZIP) or animation file, or a named file (a kept frames ZIP). */
export function workspaceDownload(workspaceId: string, requester: SpriteRequester, name?: string): { file: string; fileName: string } {
  const workspace = requireWorkspace(workspaceId, requester)
  if (name) {
    if (!/^[^\\/:*?"<>|]{1,120}\.(zip|gif|webp|mp4)$/i.test(name)) throw new SpriteError('파일 이름을 확인하세요.')
    const file = workspaceFile(workspace, name)
    if (!fs.existsSync(file)) throw new SpriteError('내려받을 결과가 없습니다.', 404)
    return { file, fileName: name }
  }
  const candidates = fs.readdirSync(workspace.dir).filter((name) => /\.(zip|gif|webp|mp4)$/i.test(name) && !name.startsWith('save-') && !name.startsWith('render-'))
  if (candidates.length === 0) throw new SpriteError('내려받을 결과가 없습니다.', 404)
  const fileName = candidates.sort()[0]
  return { file: path.join(workspace.dir, fileName), fileName }
}
