import fs from 'fs'
import sharp from 'sharp'
import { MEDIA_MAX_PIXELS } from './codex-chat/chatMediaLinks'
import { VideoFrameExtractor } from './videoFrameExtractor'

/** Frames one view_media_frames call returns by default, and at most. */
export const MEDIA_FRAMES_DEFAULT = 8
export const MEDIA_FRAMES_MAX = 16
/** Frames tiled into one picture by default, and at most: one picture carries several frames for the price of one. */
export const FRAMES_PER_SHEET_DEFAULT = 4
export const FRAMES_PER_SHEET_MAX = 4
/** Longest side of a picture holding several frames, and of one holding a single frame (as large as view_images). */
const SHEET_SIZE = 768
const SINGLE_SIZE = 512

/** `image`: PNG fit inside 1024px. */
export type MediaFrame = { index: number | null; time: number; image: Buffer }
export type MediaFrames = {
  kind: 'video' | 'animation'
  duration: number
  /** Frames in the whole animation; null for video. */
  totalFrames: number | null
  frames: MediaFrame[]
}
/** One picture of tiled frames: frames `first`..`first + count - 1` (1-based), left to right, top to bottom. */
export type FrameSheet = { first: number; count: number; columns: number; rows: number; data: string }

export class MediaFramesError extends Error {}

const round = (value: number) => Math.round(value * 1000) / 1000

/** Midpoints of `count` equal slices of [start, end]: no frame lands on the very end, where a seek can come back empty. */
export function sampleTimes(start: number, end: number, count: number) {
  return Array.from({ length: count }, (_, index) => start + ((end - start) * (index + 0.5)) / count)
}

function clampRange(duration: number, start?: number, end?: number) {
  const from = Math.min(Math.max(0, start ?? 0), duration)
  const to = Math.min(Math.max(from, end ?? duration), duration)
  if (to <= from) throw new MediaFramesError(`The range is empty: the media runs ${round(duration)} seconds`)
  return { from, to }
}

/**
 * Frames of an animated GIF or WebP, spread over [start, end] seconds. libvips composites every page, so each frame is
 * the picture as shown, not a partial update. Fewer frames than asked come back when the range holds fewer.
 */
async function animationFrames(filePath: string, count: number, start?: number, end?: number): Promise<MediaFrames> {
  const metadata = await sharp(filePath, { limitInputPixels: MEDIA_MAX_PIXELS }).metadata()
  const pages = metadata.pages ?? 1
  if (pages < 2) throw new MediaFramesError('Not an animation: it has a single frame (use view_images)')
  // Browsers show a 0 or tiny delay as 100ms; do the same so the timeline matches what people see.
  const delays = Array.from({ length: pages }, (_, index) => { const delay = metadata.delay?.[index] ?? 100; return delay > 10 ? delay : 100 })
  const starts: number[] = []
  let total = 0
  for (const delay of delays) { starts.push(total / 1000); total += delay }
  const duration = total / 1000
  const { from, to } = clampRange(duration, start, end)
  const frameAt = (time: number) => { let index = 0; while (index + 1 < pages && starts[index + 1] <= time) index++; return index }
  const indices = [...new Set(sampleTimes(from, to, count).map(frameAt))]
  const frames: MediaFrame[] = []
  for (const index of indices) {
    const image = await sharp(filePath, { page: index, pages: 1, limitInputPixels: MEDIA_MAX_PIXELS })
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()
    frames.push({ index, time: round(starts[index]), image })
  }
  return { kind: 'animation', duration: round(duration), totalFrames: pages, frames }
}

async function videoFrames(filePath: string, count: number, start?: number, end?: number): Promise<MediaFrames> {
  const duration = await VideoFrameExtractor.probeDuration(filePath)
  const { from, to } = clampRange(duration, start, end)
  const times = sampleTimes(from, to, count)
  const paths = await VideoFrameExtractor.extractAnalysisFrames(filePath, times)
  try {
    const frames: MediaFrame[] = []
    for (const [index, framePath] of paths.entries()) frames.push({ index: null, time: round(times[index]), image: await fs.promises.readFile(framePath) })
    return { kind: 'video', duration: round(duration), totalFrames: null, frames }
  } finally {
    await VideoFrameExtractor.cleanupTempFrames(paths)
  }
}

/** Frames of a video or an animated image, for a model to watch it (see frameSheets for what it is sent). */
export async function extractMediaFrames(filePath: string, mimeType: string | null, options: { count?: number; start?: number; end?: number } = {}): Promise<MediaFrames> {
  const count = Math.min(Math.max(1, Math.floor(options.count ?? MEDIA_FRAMES_DEFAULT)), MEDIA_FRAMES_MAX)
  if (mimeType?.startsWith('video/')) return videoFrames(filePath, count, options.start, options.end)
  if (mimeType === 'image/gif' || mimeType === 'image/webp') return animationFrames(filePath, count, options.start, options.end)
  throw new MediaFramesError('Not a video or animated GIF/WebP')
}

/** 5x7 digits, drawn as squares: the number badge needs no font, which slim server images may not have. */
const DIGITS = [
  '01110100011001110101110011000101110', '00100011000010000100001000010001110', '01110100010000100010001000100011111',
  '11110000010000101110000010000111110', '00010001100101010010111110001000010', '11111100001111000001000011000101110',
  '00110010001000011110100011000101110', '11111000010001000100010000100001000', '01110100011000101110100011000101110',
  '01110100011000101111000010001001100',
]

/** A badge with `number` in white on black at (x, y), digits drawn `unit` px per dot. */
function badgeSvg(number: number, x: number, y: number, unit: number) {
  const text = String(number)
  const pad = unit * 2
  const width = pad * 2 + text.length * unit * 5 + (text.length - 1) * unit
  const height = pad * 2 + unit * 7
  const dots = [...text].flatMap((digit, position) => [...DIGITS[Number(digit)]].flatMap((bit, dot) => bit === '1'
    ? [`<rect x="${x + pad + position * unit * 6 + (dot % 5) * unit}" y="${y + pad + Math.floor(dot / 5) * unit}" width="${unit}" height="${unit}"/>`]
    : []))
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${unit}" fill="#000" fill-opacity="0.78"/><g fill="#fff">${dots.join('')}</g>`
}

/** Columns for `count` cells of aspect `aspect` (width / height) that make the picture closest to square. */
export function sheetColumns(count: number, aspect: number) {
  let best = 1
  let bestScore = Infinity
  for (let columns = 1; columns <= count; columns++) {
    const score = Math.abs(Math.log((columns * aspect) / Math.ceil(count / columns)))
    if (score < bestScore - 1e-9) { best = columns; bestScore = score }
  }
  return best
}

/** One picture: `frames` in a grid on a light gray ground, each numbered from `first` in its top-left corner. */
async function composeSheet(frames: MediaFrame[], first: number, aspect: number): Promise<FrameSheet> {
  const columns = sheetColumns(frames.length, aspect)
  const rows = Math.ceil(frames.length / columns)
  const size = frames.length === 1 ? SINGLE_SIZE : SHEET_SIZE
  const gap = frames.length === 1 ? 0 : 8
  const cellWidth = Math.max(16, Math.floor(Math.min((size - (columns + 1) * gap) / columns, ((size - (rows + 1) * gap) / rows) * aspect)))
  const cellHeight = Math.max(16, Math.round(cellWidth / aspect))
  const width = columns * cellWidth + (columns + 1) * gap
  const height = rows * cellHeight + (rows + 1) * gap
  const unit = Math.max(2, Math.round(Math.max(cellWidth, cellHeight) / 90))
  const cells = await Promise.all(frames.map(async (frame, position) => ({
    input: await sharp(frame.image).resize(cellWidth, cellHeight, { fit: 'contain', background: '#000' }).flatten({ background: '#fff' }).toBuffer(),
    left: gap + (position % columns) * (cellWidth + gap),
    top: gap + Math.floor(position / columns) * (cellHeight + gap),
  })))
  const badges = cells.map((cell, position) => badgeSvg(first + position, cell.left + unit, cell.top + unit, unit)).join('')
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${badges}</svg>`)
  const data = await sharp({ create: { width, height, channels: 3, background: '#d4d4d4' } })
    .composite([...cells, { input: overlay, left: 0, top: 0 }])
    .jpeg({ quality: 80 })
    .toBuffer()
  return { first, count: frames.length, columns, rows, data: data.toString('base64') }
}

/**
 * The frames tiled into JPEG pictures of up to `perSheet` frames each, numbered 1.. across all of them, spread evenly
 * (6 frames by 4 make two pictures of 3, not 4 and 2).
 */
export async function frameSheets(frames: MediaFrame[], perSheet = FRAMES_PER_SHEET_DEFAULT): Promise<FrameSheet[]> {
  if (!frames.length) return []
  const per = Math.min(Math.max(1, Math.floor(perSheet)), FRAMES_PER_SHEET_MAX)
  const { width = 1, height = 1 } = await sharp(frames[0].image).metadata()
  const aspect = width / height
  const sheetCount = Math.ceil(frames.length / per)
  const sheets: FrameSheet[] = []
  for (let sheet = 0, start = 0; sheet < sheetCount; sheet++) {
    const count = Math.ceil((frames.length - start) / (sheetCount - sheet))
    sheets.push(await composeSheet(frames.slice(start, start + count), start + 1, aspect))
    start += count
  }
  return sheets
}
