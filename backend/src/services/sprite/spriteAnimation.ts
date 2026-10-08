import fs from 'fs'
import os from 'os'
import path from 'path'
import { SpriteError } from './spriteErrors'
import { encodeAnimation } from './spriteEncode'
import { encodeAnimationMp4 } from './spriteFfmpeg'
import { MAX_SPRITE_FRAMES, normalizeHexColor } from './spriteOptions'
import { cropFrame, type RgbaFrame } from './spritePixels'

/** Sheet → animation (`build_sprite_animation`): GIF/WebP through sharp, MP4 through ffmpeg. D5: WebP is the default. */

export type AnimationFormat = 'gif' | 'webp' | 'mp4'

export interface AnimationOptions {
  columns: number
  rows: number
  frameCount: number
  spacing: number
  fps: number
  outputFormat: AnimationFormat
  /** MP4 only (no alpha): the colour behind transparent pixels. */
  backgroundColor: string
}

export const ANIMATION_DEFAULTS: Pick<AnimationOptions, 'spacing' | 'fps' | 'outputFormat' | 'backgroundColor'> = {
  spacing: 0,
  fps: 12,
  outputFormat: 'webp',
  backgroundColor: '#000000',
}

export const ANIMATION_MIME: Record<AnimationFormat, string> = { gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4' }

export function sliceAnimationFrames(sheet: RgbaFrame, options: AnimationOptions): { frames: RgbaFrame[]; frameWidth: number; frameHeight: number } {
  if (!(options.columns >= 1 && options.columns <= 64) || !(options.rows >= 1 && options.rows <= 64)) throw new SpriteError('열과 행 수는 각각 1에서 64 사이여야 합니다.')
  if (options.columns * options.rows > MAX_SPRITE_FRAMES) throw new SpriteError(`한 번에 최대 ${MAX_SPRITE_FRAMES}프레임까지 변환할 수 있습니다.`)
  if (!(options.frameCount >= 1 && options.frameCount <= options.columns * options.rows)) throw new SpriteError('프레임 수가 스프라이트 배치 범위를 벗어났습니다.')
  if (!(options.spacing >= 0 && options.spacing <= 64)) throw new SpriteError('프레임 간격은 0에서 64px 사이여야 합니다.')
  if (!Number.isFinite(options.fps) || options.fps < 1 || options.fps > 60) throw new SpriteError('재생 속도는 1에서 60 FPS 사이여야 합니다.')
  if (!['gif', 'webp', 'mp4'].includes(options.outputFormat)) throw new SpriteError('지원하지 않는 애니메이션 형식입니다.')
  const contentWidth = sheet.width - (options.columns - 1) * options.spacing
  const contentHeight = sheet.height - (options.rows - 1) * options.spacing
  if (contentWidth <= 0 || contentHeight <= 0) throw new SpriteError('프레임 간격이 스프라이트 크기보다 큽니다.')
  if (contentWidth % options.columns || contentHeight % options.rows) throw new SpriteError('이미지 크기와 간격을 열·행 수로 정확히 나눌 수 없습니다.')
  const frameWidth = contentWidth / options.columns
  const frameHeight = contentHeight / options.rows
  const frames: RgbaFrame[] = []
  for (let index = 0; index < options.frameCount; index += 1) {
    const x = (index % options.columns) * (frameWidth + options.spacing)
    const y = Math.floor(index / options.columns) * (frameHeight + options.spacing)
    frames.push(cropFrame(sheet, { x, y, width: frameWidth, height: frameHeight }))
  }
  return { frames, frameWidth, frameHeight }
}

export interface AnimationResult {
  bytes: Buffer
  mimeType: string
  extension: AnimationFormat
  frameCount: number
  frameWidth: number
  frameHeight: number
}

export async function buildSpriteAnimation(sheet: RgbaFrame, options: AnimationOptions, extra: { xmp?: string; signal?: AbortSignal } = {}): Promise<AnimationResult> {
  const { frames, frameWidth, frameHeight } = sliceAnimationFrames(sheet, options)
  let bytes: Buffer
  if (options.outputFormat === 'mp4') {
    const background = normalizeHexColor(options.backgroundColor)
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-sprite-mp4-'))
    try {
      const framesFile = path.join(workDir, 'frames.rgba')
      const fd = fs.openSync(framesFile, 'w')
      try { for (const frame of frames) fs.writeSync(fd, frame.data) } finally { fs.closeSync(fd) }
      const output = path.join(workDir, 'sprite-animation.mp4')
      await encodeAnimationMp4({ framesFile, width: frameWidth, height: frameHeight, frameCount: frames.length, fps: options.fps, background, output, signal: extra.signal })
      bytes = fs.readFileSync(output)
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
    }
  } else {
    bytes = await encodeAnimation(frames, options.outputFormat, options.fps, extra.xmp)
  }
  if (!bytes.length) throw new SpriteError('애니메이션 파일을 생성하지 못했습니다.')
  return { bytes, mimeType: ANIMATION_MIME[options.outputFormat], extension: options.outputFormat, frameCount: frames.length, frameWidth, frameHeight }
}
