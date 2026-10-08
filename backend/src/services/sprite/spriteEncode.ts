import fs from 'fs'
import sharp from 'sharp'
import { SpriteError } from './spriteErrors'
import { MAX_IMAGE_PIXELS, type SpriteImageFormat } from './spriteOptions'
import type { RgbaFrame } from './spritePixels'

/**
 * Image encode/decode for the sprite engine (sharp). PNG and WebP like the original `image_output.py`
 * (WebP: method 6 → effort 6, `exact` keeps RGB under transparent pixels).
 */

export async function decodeImage(input: string | Buffer): Promise<RgbaFrame> {
  try {
    const image = sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, animated: false })
    const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    if (info.channels !== 4) throw new Error('unexpected channel count')
    return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) }
  } catch (error) {
    if (error instanceof Error && /pixel limit/i.test(error.message)) {
      throw new SpriteError(`이미지는 최대 ${MAX_IMAGE_PIXELS.toLocaleString('en-US')}픽셀까지 처리할 수 있습니다.`)
    }
    throw new SpriteError('읽을 수 있는 이미지 파일이 아닙니다.')
  }
}

function rawInput(frame: RgbaFrame) {
  return sharp(Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength), {
    raw: { width: frame.width, height: frame.height, channels: 4 },
    limitInputPixels: false,
  })
}

/** Encode one still image. `xmp` (optional) is embedded so the library copy carries the settings that made it. */
export async function encodeStill(frame: RgbaFrame, format: SpriteImageFormat, quality: number, xmp?: string): Promise<Buffer> {
  let image = rawInput(frame)
  if (xmp) image = image.withXmp(xmp)
  try {
    if (format === 'webp') return await image.webp({ quality, effort: 6, exact: true }).toBuffer()
    return await image.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
  } catch {
    throw new SpriteError('이미지를 저장하지 못했습니다.')
  }
}

/** Fast PNG for previews and cache thumbnails (no metadata). */
export async function encodePreviewPng(frame: RgbaFrame, maxSide: number): Promise<Buffer> {
  const scale = Math.min(1, maxSide / Math.max(frame.width, frame.height))
  let image = rawInput(frame)
  if (scale < 1) {
    image = image.resize({ width: Math.max(1, Math.round(frame.width * scale)), height: Math.max(1, Math.round(frame.height * scale)), kernel: 'nearest' })
  }
  return image.png({ compressionLevel: 3 }).toBuffer()
}

/** Animated GIF/WebP from equally sized frames (`build_sprite_animation`). */
export async function encodeAnimation(frames: RgbaFrame[], format: 'gif' | 'webp', fps: number, xmp?: string): Promise<Buffer> {
  const width = frames[0].width
  const height = frames[0].height
  const strip = Buffer.alloc(width * height * 4 * frames.length)
  frames.forEach((frame, index) => strip.set(frame.data, index * width * height * 4))
  const delay = Math.max(1, Math.round(1000 / fps))
  let image = sharp(strip, { raw: { width, height: height * frames.length, channels: 4, pageHeight: height }, limitInputPixels: false })
  if (xmp && format === 'webp') image = image.withXmp(xmp)
  try {
    if (format === 'gif') {
      return await image.gif({ loop: 0, delay: frames.map(() => delay), colours: 256, effort: 7 }).toBuffer()
    }
    return await image.webp({ loop: 0, delay: frames.map(() => delay), lossless: true, quality: 100, effort: 6 }).toBuffer()
  } catch {
    throw new SpriteError(`${format.toUpperCase()} 파일을 생성하지 못했습니다.`)
  }
}

const XMP_NAMESPACE = 'https://co-nai.com/ns/sprite/1.0/'

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function unescapeXml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
}

/** XMP packet carrying the applied sprite options as JSON (works for PNG and WebP). */
export function spriteOptionsXmp(record: unknown): string {
  return '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>'
    + '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    + `<rdf:Description rdf:about="" xmlns:conaiSprite="${XMP_NAMESPACE}">`
    + `<conaiSprite:settings>${escapeXml(JSON.stringify(record))}</conaiSprite:settings>`
    + '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
}

/** Read the options a sprite output was made with, or null for other images. */
export async function readSpriteOptionsXmp(filePath: string): Promise<unknown | null> {
  if (!fs.existsSync(filePath)) return null
  try {
    const metadata = await sharp(filePath, { animated: false }).metadata()
    const xmp = metadata.xmp?.toString('utf8')
    const match = xmp?.match(/<conaiSprite:settings>([\s\S]*?)<\/conaiSprite:settings>/)
    return match ? JSON.parse(unescapeXml(match[1])) : null
  } catch {
    return null
  }
}
