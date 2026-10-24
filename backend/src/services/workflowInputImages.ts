import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { resolveUploadsPath, runtimePaths } from '../config/runtimePaths'
import type { ModulePortDefinition } from '../types/moduleGraph'
import { BackgroundProcessorService } from './backgroundProcessorService'
import { MEDIA_HASH_PATTERN, MEDIA_MAX_PIXELS, MEDIA_MIME_TYPES, sniffMediaExtension } from './codex-chat/chatMediaLinks'
import { assignGeneratedMediaToGroup } from './generationTargetGroupService'
import { GroupPathService } from './groupPathService'
import { resolveImageIdentity } from './imageIdentityService'
import { ImageSimilarityService } from './imageSimilarity'
import { ImageUploadService } from './imageUploadService'
import { CODEX_MAX_ATTACHMENT_BYTES } from './codexImageInputs'
import { parseJsonishInput } from '../utils/jsonishInput'

/**
 * Images put into workflow nodes and run inputs live in the image library like any other upload: the file lands in
 * the Upload folder, is indexed by processSavedMediaFile and filed under "워크플로 입력". Graphs, run inputs and
 * schedules keep only `{ composite_hash }`; the executor turns that back into bytes for engines that need them.
 */

export const WORKFLOW_INPUT_IMAGE_GROUP_PATH = '워크플로 입력'

export type LibraryImageRef = { composite_hash: string }

export class WorkflowInputImageError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = 'WorkflowInputImageError'
  }
}

/** `{ composite_hash }` pointing at a library image (other keys are ignored). */
export function isLibraryImageRef(value: unknown): value is LibraryImageRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const hash = (value as { composite_hash?: unknown }).composite_hash
  return typeof hash === 'string' && MEDIA_HASH_PATTERN.test(hash)
}

const IMAGE_DATA_URL = /^data:image\/[a-z0-9.+-]+;base64,([\s\S]+)$/i

function workflowInputDir() {
  const dir = path.join(runtimePaths.uploadsDir, 'workflow-inputs')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const ingestions = new Map<string, Promise<LibraryImageRef>>()

/** Put one image (a data URL) into the library; an image that is already there is reused instead of copied. */
export async function ingestWorkflowInputImage(dataUrl: string): Promise<LibraryImageRef> {
  const match = IMAGE_DATA_URL.exec(dataUrl.trim())
  if (!match) throw new WorkflowInputImageError('이미지 data URL 형식이 아니야.')
  const buffer = Buffer.from(match[1], 'base64')
  if (buffer.length === 0) throw new WorkflowInputImageError('빈 이미지야.')

  let extension: string
  try {
    extension = await sniffMediaExtension(buffer)
  } catch {
    throw new WorkflowInputImageError('이미지 파일이 아니야.')
  }
  const mimeType = MEDIA_MIME_TYPES[extension]
  if (!mimeType?.startsWith('image/')) throw new WorkflowInputImageError('이미지 파일만 넣을 수 있어.')

  const file = path.join(workflowInputDir(), `${crypto.createHash('sha256').update(buffer).digest('hex')}.${extension}`)
  const source = sharp(buffer, { limitInputPixels: MEDIA_MAX_PIXELS })
  const generated = await ImageSimilarityService.generateHashAndHistogram(file, source)
  const identity = await resolveImageIdentity({ filePath: file, perceptualCompositeHash: generated.hashes.compositeHash, source })

  const key = identity.compositeHash
  const previous = ingestions.get(key)
  const pending = (async () => {
    if (previous) await previous.catch(() => {})
    const existing = ImageUploadService.getActiveFilePath(identity.compositeHash)
    if (existing && fs.existsSync(resolveUploadsPath(existing))) return { composite_hash: identity.compositeHash }
    if (!fs.existsSync(file)) await fs.promises.writeFile(file, buffer)
    const result = await BackgroundProcessorService.processSavedMediaFile(file, { mimeType, metadataMode: 'background', quiet: true })
    if (!result.compositeHash) throw new WorkflowInputImageError('라이브러리에 저장하지 못했어.', 500)
    assignGeneratedMediaToGroup(GroupPathService.resolveOrCreate(WORKFLOW_INPUT_IMAGE_GROUP_PATH).groupId, [result.compositeHash])
    return { composite_hash: result.compositeHash }
  })()
  ingestions.set(key, pending)
  try {
    return await pending
  } finally {
    if (ingestions.get(key) === pending) ingestions.delete(key)
  }
}

/** The library image behind a ref as a data URL. */
export async function readLibraryImageAsDataUrl(ref: LibraryImageRef, maxBytes = Infinity, maxSide?: number): Promise<string> {
  const storedPath = ImageUploadService.getActiveFilePath(ref.composite_hash)
  const filePath = storedPath ? resolveUploadsPath(storedPath) : null
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`라이브러리에서 이미지를 찾을 수 없어: ${ref.composite_hash}`)
  const extension = path.extname(filePath).slice(1).toLowerCase()
  const mimeType = MEDIA_MIME_TYPES[extension === 'jpeg' ? 'jpg' : extension]
  if (!mimeType?.startsWith('image/')) throw new WorkflowInputImageError('Workflow image input must reference an image, not video or other media')
  const stat = await fs.promises.stat(filePath)
  if (!stat.isFile() || stat.size > maxBytes) throw new WorkflowInputImageError('Workflow image input exceeds the byte limit (10 MiB for Codex)')
  // Header probing is file-backed, before loading/encoding the complete library file.
  const metadata = await sharp(filePath, { limitInputPixels: MEDIA_MAX_PIXELS }).metadata()
  if (!metadata.width || !metadata.height) throw new WorkflowInputImageError('Workflow input is not a decodable image')
  if (maxSide && (metadata.width > maxSide || metadata.height > maxSide)) throw new WorkflowInputImageError('Codex attachment dimensions must be at most 4096 pixels per side')
  const buffer = await fs.promises.readFile(filePath)
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

/**
 * Image inputs given as library refs become data URLs for every engine except ComfyUI, which uploads the library
 * file itself (prepareComfyPromptData reads `{ composite_hash }`).
 */
export async function materializeLibraryImageInputs(
  engineType: string,
  exposedInputs: ModulePortDefinition[],
  inputs: Record<string, any>,
): Promise<Record<string, any>> {
  if (engineType === 'comfyui') return inputs
  const isCodex = engineType === 'codex' || (engineType === 'system' && exposedInputs.some((port) => port.key === 'references'))
  const readImage = (ref: LibraryImageRef) => readLibraryImageAsDataUrl(ref, isCodex ? CODEX_MAX_ATTACHMENT_BYTES : Infinity, isCodex ? 4096 : undefined)
  let next = inputs
  for (const port of exposedInputs) {
    // Codex/system Codex nodes use an ordered JSON references port with the same data_url field as the API.
    if ((engineType === 'codex' || engineType === 'system') && port.key === 'references') {
      const references = parseJsonishInput(inputs[port.key], undefined)
      const resolved = []
      if (Array.isArray(references)) {
        if (references.length + Number(Boolean(inputs.image)) + Number(Boolean(inputs.mask)) > 5) throw new WorkflowInputImageError('Codex accepts at most 5 attachments including source and mask')
        for (const reference of references) {
          resolved.push(reference && isLibraryImageRef(reference.data_url)
            ? { ...reference, data_url: await readImage(reference.data_url) }
            : reference)
        }
      }
      if (next === inputs) next = { ...inputs }
      next[port.key] = Array.isArray(references) ? resolved : references
      continue
    }
    if (port.data_type !== 'image' && port.data_type !== 'mask') continue
    const value = inputs[port.key]
    let resolved: unknown = value
    if (isLibraryImageRef(value)) {
      resolved = await readImage(value)
    } else if (Array.isArray(value) && value.some(isLibraryImageRef)) {
      resolved = await Promise.all(value.map((item) => (isLibraryImageRef(item) ? readImage(item) : item)))
    }
    if (resolved !== value) {
      if (next === inputs) next = { ...inputs }
      next[port.key] = resolved
    }
  }
  return next
}
