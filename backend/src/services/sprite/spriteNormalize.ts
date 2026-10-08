import { SpriteError } from './spriteErrors'
import { encodeStill } from './spriteEncode'
import { MAX_IMAGE_PIXELS, MAX_SHEET_DIMENSION, MAX_SPRITE_FRAMES, validateImageOutput, type SpriteImageFormat } from './spriteOptions'
import { alphaBounds, cropFrame, pasteCell, type RgbaFrame } from './spritePixels'

/**
 * Anchor-preserving sprite sheet normalisation ("여백 정규화", `build_normalized_sprite_archive` and the bulk variant).
 * Every whole input cell is pasted at `output_anchor - input_anchor` into a cell sized to the union of all visible
 * bounds (per sheet or across the group) plus padding; the visible pixels are verified to survive unchanged.
 */

export const MAX_NORMALIZATION_SHEETS = 16
export const MAX_BULK_NORMALIZATION_SHEETS = 500
export const MAX_NORMALIZATION_TOTAL_PIXELS = 64 * 1024 * 1024

export type NormalizationMode = 'per_sheet' | 'group'
export type AnchorPolicy = 'center' | 'bottom_center' | 'custom'
export type ReadOrder = 'row_major' | 'column_major'

export interface NormalizationSheetOptions {
  columns: number
  rows: number
  frameCount: number
  inputSpacing: number
  outputColumns: number
  readOrder: ReadOrder
  customAnchorX: number
  customAnchorY: number
}

export interface NormalizationOptions {
  mode: NormalizationMode
  alphaThreshold: number
  /** D5: the web default 2 (the original MCP defaulted to 0). */
  padding: number
  outputSpacing: number
  anchorPolicy: AnchorPolicy
  outputFormat: SpriteImageFormat
  outputQuality: number
}

export const NORMALIZATION_DEFAULTS: NormalizationOptions = {
  mode: 'per_sheet',
  alphaThreshold: 20,
  padding: 2,
  outputSpacing: 0,
  anchorPolicy: 'bottom_center',
  outputFormat: 'png',
  outputQuality: 90,
}

export interface NormalizationSource {
  image: RgbaFrame
  sourceName: string
  outputStem: string
  relativePath?: string | null
  options: NormalizationSheetOptions
}

type Bounds = [number, number, number, number]

interface PreparedSheet {
  source: NormalizationSource
  frames: RgbaFrame[]
  bounds: Array<Bounds | null>
  frameWidth: number
  frameHeight: number
  inputAnchor: [number, number]
  warnings: string[]
}

export interface NormalizedSheet {
  outputFilename: string
  metadataFilename: string
  image: Buffer
  /** The decoded result, for previews and saving. */
  sheet: RgbaFrame
  metadata: Record<string, unknown>
}

function anchorFor(width: number, height: number, policy: AnchorPolicy, sheet: NormalizationSheetOptions): [number, number] {
  if (policy === 'center') return [Math.floor(width / 2), Math.floor(height / 2)]
  if (policy === 'bottom_center') return [Math.floor(width / 2), height]
  if (policy !== 'custom') throw new SpriteError('지원하지 않는 기준점 정책입니다.')
  if (!(sheet.customAnchorX >= 0 && sheet.customAnchorX <= width)) throw new SpriteError('사용자 지정 기준점 X가 원본 셀 범위를 벗어났습니다.')
  if (!(sheet.customAnchorY >= 0 && sheet.customAnchorY <= height)) throw new SpriteError('사용자 지정 기준점 Y가 원본 셀 범위를 벗어났습니다.')
  return [sheet.customAnchorX, sheet.customAnchorY]
}

function framePosition(index: number, columns: number, rows: number, order: ReadOrder): [number, number] {
  if (order === 'row_major') return [index % columns, Math.floor(index / columns)]
  if (order === 'column_major') return [Math.floor(index / rows), index % rows]
  throw new SpriteError('지원하지 않는 프레임 읽기 순서입니다.')
}

export function validateNormalizationOptions(options: NormalizationOptions): { format: SpriteImageFormat; quality: number } {
  if (options.mode !== 'per_sheet' && options.mode !== 'group') throw new SpriteError('지원하지 않는 정규화 모드입니다.')
  if (!(options.alphaThreshold >= 1 && options.alphaThreshold <= 255)) throw new SpriteError('알파 임계값은 1에서 255 사이여야 합니다.')
  if (!(options.padding >= 0 && options.padding <= 512)) throw new SpriteError('안전 패딩은 0에서 512px 사이여야 합니다.')
  if (!(options.outputSpacing >= 0 && options.outputSpacing <= 64)) throw new SpriteError('출력 프레임 간격은 0에서 64px 사이여야 합니다.')
  if (!['center', 'bottom_center', 'custom'].includes(options.anchorPolicy)) throw new SpriteError('지원하지 않는 기준점 정책입니다.')
  const image = validateImageOutput(options.outputFormat, options.outputQuality)
  return { format: image.format as SpriteImageFormat, quality: image.quality }
}

function prepareSheet(source: NormalizationSource, options: NormalizationOptions): PreparedSheet {
  const sheetOptions = source.options
  if (!(sheetOptions.columns >= 1 && sheetOptions.columns <= 64) || !(sheetOptions.rows >= 1 && sheetOptions.rows <= 64)) {
    throw new SpriteError('열과 행 수는 각각 1에서 64 사이여야 합니다.')
  }
  const capacity = sheetOptions.columns * sheetOptions.rows
  if (capacity > MAX_SPRITE_FRAMES) throw new SpriteError(`한 시트는 최대 ${MAX_SPRITE_FRAMES}칸까지 처리할 수 있습니다.`)
  if (!(sheetOptions.frameCount >= 1 && sheetOptions.frameCount <= capacity)) throw new SpriteError('실제 프레임 수가 입력 시트의 칸 수를 벗어났습니다.')
  if (!(sheetOptions.inputSpacing >= 0 && sheetOptions.inputSpacing <= 64)) throw new SpriteError('입력 프레임 간격은 0에서 64px 사이여야 합니다.')
  if (!(sheetOptions.outputColumns >= 1 && sheetOptions.outputColumns <= sheetOptions.frameCount)) throw new SpriteError('출력 열 수는 실제 프레임 수 안에서 지정해야 합니다.')

  const sheet = source.image
  const contentWidth = sheet.width - (sheetOptions.columns - 1) * sheetOptions.inputSpacing
  const contentHeight = sheet.height - (sheetOptions.rows - 1) * sheetOptions.inputSpacing
  if (contentWidth <= 0 || contentHeight <= 0) throw new SpriteError('입력 프레임 간격이 이미지 크기보다 큽니다.')
  if (contentWidth % sheetOptions.columns || contentHeight % sheetOptions.rows) {
    throw new SpriteError('이미지 크기와 입력 간격을 열·행 수로 정확히 나눌 수 없습니다.')
  }
  const frameWidth = contentWidth / sheetOptions.columns
  const frameHeight = contentHeight / sheetOptions.rows
  const inputAnchor = anchorFor(frameWidth, frameHeight, options.anchorPolicy, sheetOptions)
  const frames: RgbaFrame[] = []
  const bounds: Array<Bounds | null> = []
  const edgeFrames: number[] = []
  const emptyFrames: number[] = []
  for (let index = 0; index < sheetOptions.frameCount; index += 1) {
    const [column, row] = framePosition(index, sheetOptions.columns, sheetOptions.rows, sheetOptions.readOrder)
    const frame = cropFrame(sheet, { x: column * (frameWidth + sheetOptions.inputSpacing), y: row * (frameHeight + sheetOptions.inputSpacing), width: frameWidth, height: frameHeight })
    const frameBounds = alphaBounds(frame, options.alphaThreshold)
    frames.push(frame)
    bounds.push(frameBounds)
    if (!frameBounds) emptyFrames.push(index + 1)
    else if (frameBounds[0] === 0 || frameBounds[1] === 0 || frameBounds[2] === frameWidth || frameBounds[3] === frameHeight) edgeFrames.push(index + 1)
  }
  const warnings: string[] = []
  if (edgeFrames.length) warnings.push(`원본 셀 경계에 불투명 픽셀이 닿은 프레임: ${edgeFrames.join(', ')}. 원본에서 이미 잘렸거나 인접 셀로 넘어갔는지 확인하세요.`)
  if (emptyFrames.length) warnings.push(`완전히 투명한 프레임을 빈 셀로 유지했습니다: ${emptyFrames.join(', ')}.`)
  return { source, frames, bounds, frameWidth, frameHeight, inputAnchor, warnings }
}

function unionRelativeBounds(sheets: PreparedSheet[], padding: number): Bounds {
  const relative: Bounds[] = []
  for (const sheet of sheets) {
    for (const bounds of sheet.bounds) {
      if (!bounds) continue
      relative.push([bounds[0] - sheet.inputAnchor[0], bounds[1] - sheet.inputAnchor[1], bounds[2] - sheet.inputAnchor[0], bounds[3] - sheet.inputAnchor[1]])
    }
  }
  if (!relative.length) throw new SpriteError('모든 프레임이 완전히 투명하여 정규화할 영역이 없습니다.')
  return [
    Math.min(...relative.map((bounds) => bounds[0])) - padding,
    Math.min(...relative.map((bounds) => bounds[1])) - padding,
    Math.max(...relative.map((bounds) => bounds[2])) + padding,
    Math.max(...relative.map((bounds) => bounds[3])) + padding,
  ]
}

/** PIL `paste(frame, (x, y))` without a mask: copy every pixel that lands inside, alpha included. */
function pasteClipped(target: RgbaFrame, frame: RgbaFrame, x: number, y: number): void {
  for (let row = 0; row < frame.height; row += 1) {
    const targetY = y + row
    if (targetY < 0 || targetY >= target.height) continue
    const startX = Math.max(0, x)
    const endX = Math.min(target.width, x + frame.width)
    if (endX <= startX) continue
    target.data.set(frame.data.subarray((row * frame.width + (startX - x)) * 4, (row * frame.width + (endX - x)) * 4), (targetY * target.width + startX) * 4)
  }
}

function sameRegion(a: RgbaFrame, aBounds: Bounds, b: RgbaFrame, bBounds: Bounds): boolean {
  const width = aBounds[2] - aBounds[0]
  const height = aBounds[3] - aBounds[1]
  for (let row = 0; row < height; row += 1) {
    const aStart = ((aBounds[1] + row) * a.width + aBounds[0]) * 4
    const bStart = ((bBounds[1] + row) * b.width + bBounds[0]) * 4
    for (let offset = 0; offset < width * 4; offset += 1) {
      if (a.data[aStart + offset] !== b.data[bStart + offset]) return false
    }
  }
  return true
}

async function renderSheet(prepared: PreparedSheet, options: NormalizationOptions, image: { format: SpriteImageFormat; quality: number }, union: Bounds, outputFilename: string): Promise<{ bytes: Buffer; sheet: RgbaFrame; metadata: Record<string, unknown> }> {
  const outputWidth = union[2] - union[0]
  const outputHeight = union[3] - union[1]
  const outputAnchor: [number, number] = [-union[0], -union[1]]
  const sheetOptions = prepared.source.options
  const outputRows = Math.ceil(sheetOptions.frameCount / sheetOptions.outputColumns)
  const sheetWidth = sheetOptions.outputColumns * outputWidth + (sheetOptions.outputColumns - 1) * options.outputSpacing
  const sheetHeight = outputRows * outputHeight + (outputRows - 1) * options.outputSpacing
  if (sheetWidth > MAX_SHEET_DIMENSION || sheetHeight > MAX_SHEET_DIMENSION) {
    throw new SpriteError(`정규화 결과 한 변은 최대 ${MAX_SHEET_DIMENSION.toLocaleString('en-US')}px까지 만들 수 있습니다.`)
  }
  if (sheetWidth * sheetHeight > MAX_IMAGE_PIXELS) {
    throw new SpriteError(`정규화 결과는 최대 ${MAX_IMAGE_PIXELS.toLocaleString('en-US')}픽셀까지 만들 수 있습니다.`)
  }
  const sheet: RgbaFrame = { width: sheetWidth, height: sheetHeight, data: new Uint8Array(sheetWidth * sheetHeight * 4) }
  const drawX = outputAnchor[0] - prepared.inputAnchor[0]
  const drawY = outputAnchor[1] - prepared.inputAnchor[1]
  prepared.frames.forEach((frame, index) => {
    const cell: RgbaFrame = { width: outputWidth, height: outputHeight, data: new Uint8Array(outputWidth * outputHeight * 4) }
    pasteClipped(cell, frame, drawX, drawY)
    const bounds = prepared.bounds[index]
    if (bounds) {
      const target: Bounds = [drawX + bounds[0], drawY + bounds[1], drawX + bounds[2], drawY + bounds[3]]
      if (target[0] < 0 || target[1] < 0 || target[2] > outputWidth || target[3] > outputHeight || !sameRegion(frame, bounds, cell, target)) {
        throw new SpriteError('정규화 검증 중 원본 픽셀 손실을 감지했습니다.')
      }
    }
    const x = (index % sheetOptions.outputColumns) * (outputWidth + options.outputSpacing)
    const y = Math.floor(index / sheetOptions.outputColumns) * (outputHeight + options.outputSpacing)
    pasteCell(sheet.data, sheetWidth, cell, x, y)
  })
  const metadata: Record<string, unknown> = {
    source: prepared.source.sourceName,
    output: outputFilename,
    mode: options.mode,
    input_grid: {
      columns: sheetOptions.columns,
      rows: sheetOptions.rows,
      frame_count: sheetOptions.frameCount,
      spacing: sheetOptions.inputSpacing,
      read_order: sheetOptions.readOrder,
    },
    input_cell_size: [prepared.frameWidth, prepared.frameHeight],
    output_grid: {
      columns: sheetOptions.outputColumns,
      rows: outputRows,
      frame_count: sheetOptions.frameCount,
      spacing: options.outputSpacing,
      read_order: 'row_major',
    },
    output_cell_size: [outputWidth, outputHeight],
    anchor_policy: options.anchorPolicy,
    input_anchor: [...prepared.inputAnchor],
    output_anchor: [...outputAnchor],
    alpha_threshold: options.alphaThreshold,
    padding: options.padding,
    output_format: image.format,
    output_quality: image.quality,
    frame_order_preserved: true,
    warnings: prepared.warnings,
  }
  if (prepared.source.relativePath) metadata.source_relative_path = prepared.source.relativePath
  return { bytes: await encodeStill(sheet, image.format, image.quality), sheet, metadata }
}

export interface NormalizationResult {
  sheets: NormalizedSheet[]
  manifest: Record<string, unknown>
}

/** `build_normalized_sprite_archive`: 1..16 sheets, any failure fails the whole request. */
export async function normalizeSpriteSheets(sources: NormalizationSource[], options: NormalizationOptions): Promise<NormalizationResult> {
  if (sources.length < 1 || sources.length > MAX_NORMALIZATION_SHEETS) {
    throw new SpriteError(`한 번에 1개에서 ${MAX_NORMALIZATION_SHEETS}개의 시트를 처리할 수 있습니다.`)
  }
  const image = validateNormalizationOptions(options)
  const prepared: PreparedSheet[] = []
  let totalPixels = 0
  for (const source of sources) {
    const sheet = prepareSheet(source, options)
    totalPixels += sheet.frameWidth * sheet.frameHeight * source.options.frameCount
    if (totalPixels > MAX_NORMALIZATION_TOTAL_PIXELS) throw new SpriteError('정규화할 실제 프레임의 전체 크기가 처리 한도를 초과했습니다.')
    prepared.push(sheet)
  }
  const common = options.mode === 'group' ? unionRelativeBounds(prepared, options.padding) : null
  const sheets: NormalizedSheet[] = []
  for (const sheet of prepared) {
    const union = common ?? unionRelativeBounds([sheet], options.padding)
    const outputFilename = `${sheet.source.outputStem}.${image.format}`
    const metadataFilename = `${sheet.source.outputStem}.json`
    const rendered = await renderSheet(sheet, options, image, union, outputFilename)
    rendered.metadata.metadata_file = metadataFilename
    sheets.push({ outputFilename, metadataFilename, image: rendered.bytes, sheet: rendered.sheet, metadata: rendered.metadata })
  }
  const manifest: Record<string, unknown> = {
    mode: options.mode,
    sheet_count: sheets.length,
    anchor_policy: options.anchorPolicy,
    alpha_threshold: options.alphaThreshold,
    padding: options.padding,
    output_format: image.format,
    output_quality: image.quality,
    sheets: sheets.map((sheet) => sheet.metadata),
  }
  if (common) {
    manifest.common_output_cell_size = [common[2] - common[0], common[3] - common[1]]
    manifest.common_output_anchor = [-common[0], -common[1]]
  }
  return { sheets, manifest }
}

export interface BulkNormalizationProgress {
  percent: number
  processed: number
  total: number
  phase: 'scan' | 'render'
  current: string
}

export interface BulkNormalizationResult extends NormalizationResult {
  failures: Array<{ source: string; relative_path: string; error: string }>
}

function failure(source: NormalizationSource, error: unknown) {
  return {
    source: source.sourceName,
    relative_path: source.relativePath || source.sourceName,
    error: error instanceof Error ? error.message : String(error),
  }
}

function batchNames(source: NormalizationSource, extension: string): [string, string] {
  const relative = (source.relativePath || source.sourceName).replace(/\\/g, '/')
  const slash = relative.lastIndexOf('/')
  const parent = slash >= 0 ? `${relative.slice(0, slash)}/` : ''
  return [`${parent}${source.outputStem}.${extension}`, `${parent}${source.outputStem}.json`]
}

/**
 * `build_bulk_normalized_sprite_archive`: up to 500 sheets; a failing sheet is skipped and reported. Group mode scans
 * every sheet first (bounds without padding), pads the common bounds once, then renders.
 */
export async function normalizeSpriteSheetsBulk(
  sources: Array<NormalizationSource | (() => Promise<NormalizationSource>)>,
  options: NormalizationOptions,
  hooks: { onProgress?: (progress: BulkNormalizationProgress) => void; throwIfCancelled?: () => void } = {},
): Promise<BulkNormalizationResult> {
  if (sources.length < 1 || sources.length > MAX_BULK_NORMALIZATION_SHEETS) {
    throw new SpriteError(`한 번에 1개에서 ${MAX_BULK_NORMALIZATION_SHEETS}개의 시트를 처리할 수 있습니다.`)
  }
  const image = validateNormalizationOptions(options)
  const total = sources.length
  const load = async (entry: NormalizationSource | (() => Promise<NormalizationSource>)) => (typeof entry === 'function' ? entry() : entry)
  const failures: BulkNormalizationResult['failures'] = []
  const sheets: NormalizedSheet[] = []
  let common: Bounds | null = null
  let renderList = sources

  if (options.mode === 'group') {
    const scanned: typeof sources = []
    for (let index = 0; index < sources.length; index += 1) {
      hooks.throwIfCancelled?.()
      let source: NormalizationSource | null = null
      try {
        source = await load(sources[index])
        const bounds = unionRelativeBounds([prepareSheet(source, options)], 0)
        common = common ? [Math.min(common[0], bounds[0]), Math.min(common[1], bounds[1]), Math.max(common[2], bounds[2]), Math.max(common[3], bounds[3])] : bounds
        scanned.push(source)
      } catch (error) {
        failures.push(source ? failure(source, error) : { source: `#${index + 1}`, relative_path: `#${index + 1}`, error: error instanceof Error ? error.message : String(error) })
      }
      hooks.onProgress?.({ percent: (index + 1) / total * 50, processed: 0, total, phase: 'scan', current: source?.relativePath || source?.sourceName || '' })
    }
    renderList = scanned
    if (common) common = [common[0] - options.padding, common[1] - options.padding, common[2] + options.padding, common[3] + options.padding]
  }

  for (let index = 0; index < renderList.length; index += 1) {
    hooks.throwIfCancelled?.()
    let source: NormalizationSource | null = null
    try {
      source = await load(renderList[index])
      const prepared = prepareSheet(source, options)
      const union = common ?? unionRelativeBounds([prepared], options.padding)
      const [outputFilename, metadataFilename] = batchNames(source, image.format)
      const rendered = await renderSheet(prepared, options, image, union, outputFilename)
      rendered.metadata.metadata_file = metadataFilename
      sheets.push({ outputFilename, metadataFilename, image: rendered.bytes, sheet: rendered.sheet, metadata: rendered.metadata })
    } catch (error) {
      if (hooks.throwIfCancelled) hooks.throwIfCancelled()
      failures.push(source ? failure(source, error) : { source: `#${index + 1}`, relative_path: `#${index + 1}`, error: error instanceof Error ? error.message : String(error) })
    }
    const percent = options.mode === 'group' ? 50 + (index + 1) / Math.max(1, renderList.length) * 50 : (index + 1) / total * 100
    hooks.onProgress?.({ percent, processed: sheets.length + failures.length, total, phase: 'render', current: source?.relativePath || source?.sourceName || '' })
  }

  const manifest: Record<string, unknown> = {
    kind: 'sprite_normalization_batch',
    mode: options.mode,
    requested_sheet_count: total,
    succeeded: sheets.length,
    failed: failures.length,
    anchor_policy: options.anchorPolicy,
    alpha_threshold: options.alphaThreshold,
    padding: options.padding,
    output_spacing: options.outputSpacing,
    output_format: image.format,
    output_quality: image.quality,
    sheets: sheets.map((sheet) => sheet.metadata),
    failures,
  }
  if (common) {
    manifest.common_output_cell_size = [common[2] - common[0], common[3] - common[1]]
    manifest.common_output_anchor = [-common[0], -common[1]]
  }
  return { sheets, manifest, failures }
}
