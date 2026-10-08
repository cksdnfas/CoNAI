import fs from 'fs'
import path from 'path'
import { ZipArchive } from 'archiver'
import { SpriteError } from './spriteErrors'
import { extractRawFrames, resizeFilters, scaleRawFrames } from './spriteFfmpeg'
import { encodeStill } from './spriteEncode'
import {
  MAX_SHEET_DIMENSION,
  resolveSheetLayout,
  validateExtractOptions,
  validateImageOutput,
  type SheetLayout,
  type SpriteExtractOptions,
  type SpriteImageFormat,
  type SpriteVideoInfo,
} from './spriteOptions'
import {
  alphaBounds,
  applyColorKey,
  cellOrigin,
  cropFrame,
  despillFrame,
  framesSimilar,
  padToSize,
  pasteCell,
  unionBounds,
  type Rect,
  type RgbaFrame,
} from './spritePixels'

/**
 * The extraction pipeline (`build_sprite_sheet`), streaming one frame at a time through a build workspace:
 *
 *   ffmpeg select/pre-crop/(scale) → raw RGBA file
 *   → key colour (colour-distance key, D1) | despill (D4) → contain pad (D2) → auto-crop union → dedupe → frames/
 *
 * The workspace keeps the final frames so re-layout, post-crop, re-encode and saving never re-run extraction.
 */

export const BUILD_META_FILE = 'meta.json'
const FRAMES_DIR = 'frames'

export interface SpriteBuildMeta {
  version: 1
  buildId: string
  createdAt: string
  requestedByAccountId: number | null
  source: { compositeHash: string | null; name: string | null }
  video: SpriteVideoInfo
  options: SpriteExtractOptions
  /** Decode-order source frame index of every extracted frame. */
  frameIndices: number[]
  /** Source frame index of every frame kept after duplicate removal. */
  keptFrameIndices: number[]
  frameWidth: number
  frameHeight: number
  frameCount: number
  removedFrameCount: number
  autoCropBounds: [number, number, number, number] | null
}

export interface BuildProgress {
  phase: 'extract' | 'process' | 'finalize'
  processed: number
  total: number
}

export interface BuildInput {
  buildId: string
  workDir: string
  sourcePath: string
  sourceHash: string | null
  sourceName: string | null
  requestedByAccountId: number | null
  video: SpriteVideoInfo
  options: SpriteExtractOptions
  signal?: AbortSignal
  onProgress?: (progress: BuildProgress) => void
  /** Called between frames; a sync pixel loop gives the event loop a turn here when running inline. */
  yieldEvery?: () => Promise<void>
  /**
   * Explicit decode-order frames instead of the sampled ones (manual frame picks; tests replay the original app's
   * frame choice). Validated like sampled frames.
   */
  frameIndicesOverride?: number[]
}

const frameFile = (workDir: string, index: number) => path.join(workDir, FRAMES_DIR, `${String(index + 1).padStart(6, '0')}.rgba`)

function readFrameAt(fd: number, index: number, width: number, height: number): RgbaFrame {
  const size = width * height * 4
  const data = new Uint8Array(size)
  const read = fs.readSync(fd, data, 0, size, index * size)
  if (read !== size) throw new SpriteError('프레임 데이터를 읽지 못했습니다.')
  return { width, height, data }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new SpriteError('작업이 취소되었습니다.')
}

export async function buildSpriteFrames(input: BuildInput): Promise<SpriteBuildMeta> {
  const plan = validateExtractOptions(input.video, input.options)
  if (input.frameIndicesOverride) {
    const indices = input.frameIndicesOverride
    // ffmpeg's select emits frames in decode order, so the list must be strictly increasing.
    if (indices.length < 1 || indices.length > 256 || indices.some((index, position) => !Number.isInteger(index) || index < 0 || index >= input.video.frameCount || (position > 0 && index <= indices[position - 1]))) {
      throw new SpriteError('선택한 프레임 번호를 확인하세요.')
    }
    plan.frameIndices = [...indices]
  }
  const { options } = plan
  fs.mkdirSync(path.join(input.workDir, FRAMES_DIR), { recursive: true })
  const stagePath = (name: string) => path.join(input.workDir, name)
  const keyOnly = options.backgroundMode === 'key' && !options.despill
  const scale = resizeFilters(options.resizeMode, options.outputWidth, options.outputHeight)
  const total = plan.frameIndices.length
  const report = (phase: BuildProgress['phase'], processed: number) => input.onProgress?.({ phase, processed, total })
  const pause = async () => { if (input.yieldEvery) await input.yieldEvery() }

  report('extract', 0)
  const crop = options.cropWidth > 0 && options.cropHeight > 0
    ? { x: options.cropX, y: options.cropY, width: options.cropWidth, height: options.cropHeight }
    : null
  // Colour-key mode keyed before scaling in the original (colorkey sat before scale in the filter graph); despill
  // and no-key modes scaled first, then processed. Keep both orders so the golden outputs still match.
  let stage = await extractRawFrames({
    source: input.sourcePath,
    frameIndices: plan.frameIndices,
    crop,
    scale: keyOnly ? [] : scale,
    output: stagePath('stage-a.rgba'),
    signal: input.signal,
  })
  if (stage.count !== total) {
    throw new SpriteError(`요청한 ${total}장 중 ${stage.count}장만 추출되었습니다. 범위를 확인하세요.`)
  }

  if (keyOnly) {
    const keyedPath = stagePath('stage-keyed.rgba')
    const fd = fs.openSync(stage.file, 'r')
    const out = fs.openSync(keyedPath, 'w')
    try {
      for (let index = 0; index < stage.count; index += 1) {
        throwIfAborted(input.signal)
        const frame = readFrameAt(fd, index, stage.width, stage.height)
        applyColorKey(frame, plan.keyRgb, options.tolerance, options.softness)
        fs.writeSync(out, frame.data)
        await pause()
      }
    } finally {
      fs.closeSync(fd)
      fs.closeSync(out)
    }
    fs.rmSync(stage.file, { force: true })
    stage = { ...stage, file: keyedPath }
    if (scale.length > 0) {
      const scaled = await scaleRawFrames({ file: keyedPath, width: stage.width, height: stage.height, scale, output: stagePath('stage-b.rgba'), signal: input.signal })
      fs.rmSync(keyedPath, { force: true })
      stage = scaled
    }
  }

  // Per-frame processing: despill, contain padding, auto-crop bounds.
  const processedPath = stagePath('stage-processed.rgba')
  let bounds: [number, number, number, number] | null = null
  let processedWidth = 0
  let processedHeight = 0
  {
    const fd = fs.openSync(stage.file, 'r')
    const out = fs.openSync(processedPath, 'w')
    try {
      for (let index = 0; index < stage.count; index += 1) {
        throwIfAborted(input.signal)
        let frame = readFrameAt(fd, index, stage.width, stage.height)
        if (options.backgroundMode === 'key' && options.despill) {
          frame = { ...frame, data: despillFrame(frame, { key: plan.keyRgb[0], tolerance: options.tolerance, softness: options.softness, edgeCleanup: options.edgeCleanup, frameNumber: index + 1 }) }
        }
        if (options.resizeMode === 'contain') frame = padToSize(frame, options.outputWidth, options.outputHeight)
        processedWidth = frame.width
        processedHeight = frame.height
        if (options.autoCrop) bounds = unionBounds(bounds, alphaBounds(frame, options.alphaThreshold))
        fs.writeSync(out, frame.data)
        report('process', index + 1)
        await pause()
      }
    } finally {
      fs.closeSync(fd)
      fs.closeSync(out)
    }
    fs.rmSync(stage.file, { force: true })
  }

  const fullFrame = bounds && bounds[0] === 0 && bounds[1] === 0 && bounds[2] === processedWidth && bounds[3] === processedHeight
  const cropRect: Rect | null = options.autoCrop && bounds && !fullFrame
    ? { x: bounds[0], y: bounds[1], width: bounds[2] - bounds[0], height: bounds[3] - bounds[1] }
    : null
  const frameWidth = cropRect?.width ?? processedWidth
  const frameHeight = cropRect?.height ?? processedHeight

  // Crop and drop consecutive duplicates (compared with the last kept frame) into the final frame files.
  const kept: number[] = []
  {
    const fd = fs.openSync(processedPath, 'r')
    let previous: RgbaFrame | null = null
    try {
      for (let index = 0; index < total; index += 1) {
        throwIfAborted(input.signal)
        let frame = readFrameAt(fd, index, processedWidth, processedHeight)
        if (cropRect) frame = cropFrame(frame, cropRect)
        if (options.removeDuplicateFrames && previous && framesSimilar(previous, frame, options.frameSimilarityThreshold)) {
          continue
        }
        fs.writeFileSync(frameFile(input.workDir, kept.length), frame.data)
        kept.push(index)
        previous = frame
        await pause()
      }
    } finally {
      fs.closeSync(fd)
    }
    fs.rmSync(processedPath, { force: true })
  }
  report('finalize', total)

  if (!resolveSheetLayout(kept.length, frameWidth, frameHeight, options.columns, options.spacing)) {
    throw new SpriteError(`스프라이트 시트의 한 변은 ${MAX_SHEET_DIMENSION.toLocaleString('en-US')}px를 넘을 수 없습니다.`)
  }

  const meta: SpriteBuildMeta = {
    version: 1,
    buildId: input.buildId,
    createdAt: new Date().toISOString(),
    requestedByAccountId: input.requestedByAccountId,
    source: { compositeHash: input.sourceHash, name: input.sourceName },
    video: input.video,
    options: { ...options, endTime: plan.endTime },
    frameIndices: plan.frameIndices,
    keptFrameIndices: kept.map((index) => plan.frameIndices[index]),
    frameWidth,
    frameHeight,
    frameCount: kept.length,
    removedFrameCount: total - kept.length,
    autoCropBounds: cropRect ? [cropRect.x, cropRect.y, cropRect.x + cropRect.width, cropRect.y + cropRect.height] : null,
  }
  fs.writeFileSync(path.join(input.workDir, BUILD_META_FILE), JSON.stringify(meta))
  return meta
}

export function readBuildMeta(workDir: string): SpriteBuildMeta | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(workDir, BUILD_META_FILE), 'utf8')) as SpriteBuildMeta
  } catch {
    return null
  }
}

export function loadBuildFrame(workDir: string, meta: SpriteBuildMeta, index: number): RgbaFrame {
  const data = fs.readFileSync(frameFile(workDir, index))
  return { width: meta.frameWidth, height: meta.frameHeight, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) }
}

export interface RenderOptions {
  /** 0 = automatic layout. */
  columns: number
  spacing: number
  /** Post-crop applied to every frame (frame coordinates). */
  crop: Rect | null
}

export function validatePostCrop(meta: Pick<SpriteBuildMeta, 'frameWidth' | 'frameHeight'>, crop: Rect | null): Rect | null {
  if (!crop) return null
  const values = [crop.x, crop.y, crop.width, crop.height]
  if (!values.every((value) => Number.isInteger(value))) throw new SpriteError('크롭 값은 정수여야 합니다.')
  if (crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0) throw new SpriteError('크롭 영역을 확인하세요.')
  if (crop.x + crop.width > meta.frameWidth || crop.y + crop.height > meta.frameHeight) {
    throw new SpriteError('크롭 영역이 프레임을 벗어났습니다.')
  }
  if (crop.x === 0 && crop.y === 0 && crop.width === meta.frameWidth && crop.height === meta.frameHeight) return null
  return crop
}

export interface RenderedSheet {
  sheet: RgbaFrame
  layout: SheetLayout
  cellWidth: number
  cellHeight: number
}

/** Tile the build's frames row-major (transparent gaps), optionally post-cropping every frame first. */
export function renderSheet(workDir: string, meta: SpriteBuildMeta, render: RenderOptions): RenderedSheet {
  if (render.columns < 0 || render.columns > 64) throw new SpriteError('열 수는 1에서 64 사이여야 합니다.')
  if (render.spacing < 0 || render.spacing > 64) throw new SpriteError('프레임 간격은 0에서 64px 사이여야 합니다.')
  const crop = validatePostCrop(meta, render.crop)
  const cellWidth = crop?.width ?? meta.frameWidth
  const cellHeight = crop?.height ?? meta.frameHeight
  const layout = resolveSheetLayout(meta.frameCount, cellWidth, cellHeight, render.columns, render.spacing)
  if (!layout) throw new SpriteError(`스프라이트 시트의 한 변은 ${MAX_SHEET_DIMENSION.toLocaleString('en-US')}px를 넘을 수 없습니다.`)
  const data = new Uint8Array(layout.width * layout.height * 4)
  for (let index = 0; index < meta.frameCount; index += 1) {
    let frame = loadBuildFrame(workDir, meta, index)
    if (crop) frame = cropFrame(frame, crop)
    const [x, y] = cellOrigin(index, layout.columns, cellWidth, cellHeight, render.spacing)
    pasteCell(data, layout.width, frame, x, y)
  }
  return { sheet: { width: layout.width, height: layout.height, data }, layout, cellWidth, cellHeight }
}

export async function writeZip(output: string, entries: Array<{ name: string; data: Buffer }>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createWriteStream(output)
    const archive = new ZipArchive({ zlib: { level: 6 } })
    archive.once('error', reject)
    stream.once('error', reject)
    stream.once('close', () => resolve())
    archive.pipe(stream)
    for (const entry of entries) archive.append(entry.data, { name: entry.name })
    void archive.finalize()
  })
}

/** `build_frame_archive`: every final frame as `<stem>-0001.<ext>`. */
export async function writeFramesZip(workDir: string, meta: SpriteBuildMeta, options: { crop: Rect | null; format: SpriteImageFormat; quality: number; stem: string; output: string }): Promise<void> {
  const image = validateImageOutput(options.format, options.quality)
  const crop = validatePostCrop(meta, options.crop)
  const entries: Array<{ name: string; data: Buffer }> = []
  for (let index = 0; index < meta.frameCount; index += 1) {
    let frame = loadBuildFrame(workDir, meta, index)
    if (crop) frame = cropFrame(frame, crop)
    entries.push({ name: `${options.stem}-${String(index + 1).padStart(4, '0')}.${image.format}`, data: await encodeStill(frame, image.format as SpriteImageFormat, image.quality) })
  }
  await writeZip(options.output, entries)
}
