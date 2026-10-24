import { createHash } from 'crypto'
import fs from 'fs/promises'
import sharp from 'sharp'
import { setImmediate as yieldToEventLoop } from 'timers/promises'
import { normalizeBase64ImageData } from '../utils/base64ImageData'

export type CodexReference = {
  role: 'reference' | 'style' | 'material' | 'scale' | 'item'
  label?: string
  data_url: string
}

export type CodexAttachmentDescriptor = {
  index: number
  role: CodexReference['role'] | 'source' | 'mask'
  label?: string
  sha256: string
  width: number
  height: number
}

type ImageInputs = {
  operation?: 'generate' | 'edit' | 'infill'
  image?: string
  mask?: string
  references?: CodexReference[]
  preserve?: 'strict'
}

export const CODEX_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_BYTES = 32 * 1024 * 1024
const MAX_SIDE = 4096

export function codexImageInputs(payload: ImageInputs) {
  return [
    ...(payload.image !== undefined ? [{
      role: payload.operation === 'edit' || payload.operation === 'infill' ? 'source' as const : 'reference' as const,
      data_url: payload.image,
    }] : []),
    ...(payload.mask !== undefined ? [{ role: 'mask' as const, data_url: payload.mask }] : []),
    ...(payload.references ?? []),
  ]
}

/** Only canonical base64 data URLs are accepted; Buffer.from alone silently ignores invalid bytes. */
export function decodeCodexImage(dataUrl: string) {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl)
  if (!match || !match[2] || match[2].length % 4 !== 0) {
    throw new Error('Codex attachments require strict PNG/JPEG/WebP base64 data URLs')
  }
  if (match[2].length > Math.ceil(CODEX_MAX_ATTACHMENT_BYTES / 3) * 4) {
    throw new Error('Codex attachment exceeds 10 MiB decoded')
  }
  const buffer = Buffer.from(match[2], 'base64')
  if (buffer.length > CODEX_MAX_ATTACHMENT_BYTES) throw new Error('Codex attachment exceeds 10 MiB decoded')
  if (buffer.toString('base64') !== match[2]) throw new Error('Invalid Codex attachment base64')
  return { buffer, format: match[1], extension: match[1] === 'jpeg' ? '.jpg' : `.${match[1]}` }
}

/** Legacy image/mask fields accepted raw base64 and image MIME aliases. Still reject malformed encoding. */
function decodeLegacyImage(value: string) {
  const mime = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(value.trim())?.[1].toLowerCase()
  const base64 = (normalizeBase64ImageData(value.trim()) ?? '').replace(/\s/g, '')
  const unpadded = base64.replace(/=+$/, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || unpadded.length % 4 === 1) {
    throw new Error('Invalid Codex attachment base64')
  }
  const canonical = unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, '=')
  const decoded = decodeCodexImage(`data:image/png;base64,${canonical}`)
  return { ...decoded, claimedFormat: mime?.slice('image/'.length).replace(/^jpg$/, 'jpeg') }
}

function checkDimensions(metadata: sharp.Metadata) {
  if (!metadata.width || !metadata.height || metadata.width > MAX_SIDE || metadata.height > MAX_SIDE) {
    throw new Error('Codex attachment dimensions must be at most 4096 pixels per side')
  }
  if ((metadata.pages ?? 1) !== 1) throw new Error('Codex attachments must be single-frame images')
}

// Compare complete profiles, never infer a colour space from a description containing "sRGB".
let srgbProfile: Promise<Buffer | undefined> | undefined
async function assertStrictSource(metadata: sharp.Metadata) {
  if (metadata.depth !== 'uchar' || (metadata.bitsPerSample ?? 8) > 8) {
    throw new Error('Strict preservation requires an 8-bit source; 16-bit/high-depth sources are unsupported')
  }
  if (metadata.orientation && metadata.orientation !== 1) {
    throw new Error('Strict preservation requires an EXIF-unrotated source (orientation 1)')
  }
  if (metadata.space !== 'srgb' && metadata.space !== 'b-w') {
    throw new Error('Strict preservation requires an sRGB or grayscale source')
  }
  if (metadata.icc) {
    srgbProfile ??= sharp({ create: { width: 1, height: 1, channels: 3, background: 'black' } })
      .withIccProfile('srgb').png().toBuffer().then(async (buffer) => (await sharp(buffer).metadata()).icc)
    const supported = await srgbProfile
    if (!supported || !metadata.icc.equals(supported)) {
      throw new Error('Strict preservation rejects unsupported ICC profiles (including P3); use untagged sRGB or the standard Sharp sRGB profile')
    }
  }
}

async function strictMask(buffer: Buffer) {
  const image = sharp(buffer, { limitInputPixels: MAX_SIDE * MAX_SIDE, failOn: 'warning' })
  if (!(await image.stats()).isOpaque) throw new Error('Strict mask must be fully opaque (alpha 255); transparent-hole masks are unsupported')
  const mask = await image.removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true })
  if (!mask.data.includes(0)) throw new Error('Strict mask must contain at least one black (0) protected pixel')
  return mask
}

/** Normalize only legacy image/mask fields, then validate all attachments before storage or execution. */
export async function validateCodexImageInputs(payload: ImageInputs) {
  payload = { ...payload, image: payload.image?.trim() || undefined, mask: payload.mask?.trim() || undefined }
  const inputs = codexImageInputs(payload)
  if (inputs.length > 5) throw new Error('Codex accepts at most 5 attachments including source and mask')
  const legacyCount = Number(Boolean(payload.image)) + Number(Boolean(payload.mask))
  const decoded = inputs.map((input, index) => index < legacyCount ? decodeLegacyImage(input.data_url) : decodeCodexImage(input.data_url))
  if (decoded.reduce((sum, input) => sum + input.buffer.length, 0) > MAX_TOTAL_BYTES) {
    throw new Error('Codex attachments exceed 32 MiB aggregate decoded')
  }
  const descriptors: CodexAttachmentDescriptor[] = []
  let normalizedBytes = 0
  for (const [index, input] of inputs.entries()) {
    let { buffer } = decoded[index]
    const image = sharp(buffer, { limitInputPixels: MAX_SIDE * MAX_SIDE, failOn: 'warning' })
    let metadata = await image.metadata()
    checkDimensions(metadata)
    const legacy = index < legacyCount
    const claimedFormat = legacy ? (decoded[index] as ReturnType<typeof decodeLegacyImage>).claimedFormat : decoded[index].format
    if (claimedFormat && ['png', 'jpeg', 'webp'].includes(claimedFormat) && metadata.format !== claimedFormat) {
      throw new Error('Codex attachment MIME does not match decoded image')
    }
    if (payload.preserve === 'strict') {
      if (index === 0) await assertStrictSource(metadata)
      if (input.role === 'mask') {
        if (metadata.format !== 'png') throw new Error('Codex strict mask must be PNG')
        await strictMask(buffer)
      }
    }
    if (legacy && (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (input.role === 'mask' && metadata.format !== 'png'))) {
      if (!['png', 'jpeg', 'webp', 'gif', 'tiff', 'heif', 'avif'].includes(metadata.format ?? '')) {
        throw new Error('Unsupported Codex legacy raster image format')
      }
      buffer = await image.png().toBuffer()
      metadata = await sharp(buffer).metadata()
    }
    await image.stats() // Force a complete decode, including truncated/corrupt pixel data.
    normalizedBytes += buffer.length
    if (buffer.length > CODEX_MAX_ATTACHMENT_BYTES) throw new Error('Codex attachment exceeds 10 MiB decoded after normalization')
    if (normalizedBytes > MAX_TOTAL_BYTES) throw new Error('Codex attachments exceed 32 MiB aggregate decoded after normalization')
    if (legacy) {
      const normalized = `data:image/${metadata.format};base64,${buffer.toString('base64')}`
      if (input.role === 'mask') payload.mask = normalized
      else payload.image = normalized
    }
    descriptors.push({
      index: index + 1, role: input.role, ...('label' in input ? { label: input.label } : {}),
      sha256: createHash('sha256').update(buffer).digest('hex'),
      width: metadata.width!, height: metadata.height!,
    })
  }
  const source = descriptors[0]
  const mask = descriptors.find((input) => input.role === 'mask')
  if (mask && (mask.width !== source.width || mask.height !== source.height)) {
    throw new Error('Codex mask dimensions must match the source image')
  }
  return { image: payload.image, mask: payload.mask, attachment_descriptors: descriptors }
}

async function rgba(input: Buffer | string) {
  return sharp(input, { limitInputPixels: MAX_SIDE * MAX_SIDE }).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true })
}

/** Black is protected; gray masks blend proportionally. Alpha does not redefine the mask. */
export async function createCodexStrictPreservation(sourceUrl: string, maskUrl: string) {
  const sourceBuffer = decodeCodexImage(sourceUrl).buffer
  await assertStrictSource(await sharp(sourceBuffer).metadata())
  const source = await rgba(sourceBuffer)
  const mask = await strictMask(decodeCodexImage(maskUrl).buffer)
  const { width, height } = source.info
  if (mask.info.width !== width || mask.info.height !== height) throw new Error('Strict mask dimensions must match source')
  const checkSize = (info: { width: number; height: number }) => {
    if (info.width !== width || info.height !== height) throw new Error(`Strict preservation requires ${width}x${height}; got ${info.width}x${info.height}; resizing is forbidden`)
  }
  return {
    async composite(generatedPath: string, outputPath: string) {
      const generated = await rgba(generatedPath)
      checkSize(generated.info)
      const pixels = Buffer.from(source.data)
      for (let pixel = 0; pixel < mask.data.length; pixel++) {
        if (pixel % (width * 64) === 0) await yieldToEventLoop()
        const weight = mask.data[pixel] / 255
        if (weight === 0) continue
        for (let channel = 0; channel < 4; channel++) {
          const offset = pixel * 4 + channel
          pixels[offset] = Math.round(source.data[offset] * (1 - weight) + generated.data[offset] * weight)
        }
      }
      await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toFile(outputPath)
    },
    async verifySavedFile(savedPath: string) {
      const bytes = await fs.readFile(savedPath)
      if ((await sharp(bytes).metadata()).format !== 'png') throw new Error('Strict preservation requires lossless PNG')
      const saved = await rgba(bytes)
      checkSize(saved.info)
      for (let pixel = 0; pixel < mask.data.length; pixel++) {
        if (pixel % (width * 64) === 0) await yieldToEventLoop()
        if (mask.data[pixel] !== 0) continue
        for (let channel = 0; channel < 4; channel++) {
          const offset = pixel * 4 + channel
          if (saved.data[offset] !== source.data[offset]) throw new Error('Strict preservation failed: protected pixels changed after save')
        }
      }
    },
  }
}
