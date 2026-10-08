import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { runtimePaths } from '../../config/runtimePaths'
import { RuntimeJobRunner, type RuntimeJobContext } from '../runtimeJobs/runtimeJobRunner'
import { RuntimeJobStore } from '../runtimeJobs/runtimeJobStore'
import { isRuntimeJobTerminalStatus, type RuntimeJobRecord } from '../../types/runtimeJob'
import { SpriteError } from '../sprite/spriteErrors'
import { findLibraryMedia, resolveSpriteGroup, saveSpriteOutputToLibrary } from '../sprite/spriteLibrary'
import { MAX_IMAGE_PIXELS, MAX_SHEET_DIMENSION, validateImageOutput, type SpriteImageFormat } from '../sprite/spriteOptions'
import { runSpriteTask } from '../sprite/spriteWorkerClient'

/**
 * Batch resize of library images (the original video-sprite-extractor `image_resize.py`): every selected image is
 * resized to exactly W×H with Lanczos (alpha kept), encoded as PNG or WebP and saved as a NEW library item filed under
 * a group ("크기 변경" unless the caller picks one). Originals are never touched; videos and animations are skipped.
 */

export const IMAGE_BATCH_RESIZE_GROUP_PATH = '크기 변경'
export const MAX_IMAGE_BATCH_RESIZE_ITEMS = 500

export interface ImageBatchResizeOptions {
  width: number
  height: number
  format: SpriteImageFormat
  quality: number
}

export interface ImageBatchResizeParams extends ImageBatchResizeOptions {
  compositeHashes: string[]
  groupId?: number | null
  groupPath?: string | null
  requestedByAccountId?: number | null
}

export interface ImageBatchResizeResult {
  groupId: number
  saved: Array<{ source: string; compositeHash: string }>
  skipped: Array<{ source: string; reason: string }>
  failed: Array<{ source: string; error: string }>
  options: ImageBatchResizeOptions
}

/** Same limits and messages as the original: each side 1–16384 px, at most 64 Mi output pixels. */
export function resolveImageBatchResizeOptions(input: { width?: unknown; height?: unknown; format?: unknown; quality?: unknown }): ImageBatchResizeOptions {
  const width = Number(input.width)
  const height = Number(input.height)
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_SHEET_DIMENSION || height > MAX_SHEET_DIMENSION) {
    throw new SpriteError(`출력 가로와 세로는 각각 1에서 ${MAX_SHEET_DIMENSION.toLocaleString('en-US')}px 사이여야 합니다.`)
  }
  if (width * height > MAX_IMAGE_PIXELS) {
    throw new SpriteError(`출력 이미지는 최대 ${MAX_IMAGE_PIXELS.toLocaleString('en-US')}픽셀까지 처리할 수 있습니다.`)
  }
  const output = validateImageOutput(String(input.format ?? 'png'), input.quality === undefined || input.quality === null ? 90 : Number(input.quality))
  return { width, height, format: output.format, quality: output.quality }
}

/**
 * Resize one image file to exactly W×H with Pillow's Lanczos (byte-identical to the original app; libvips' lanczos3
 * and sharp's bicubic upsampling are not). The pixel work runs on the sprite worker thread.
 */
export async function resizeImageFile(filePath: string, options: ImageBatchResizeOptions, signal?: AbortSignal): Promise<Buffer> {
  const directory = path.join(runtimePaths.tempDir, 'image-batch-resize')
  await fs.promises.mkdir(directory, { recursive: true })
  const output = path.join(directory, `${crypto.randomUUID()}.${options.format}`)
  try {
    await runSpriteTask('resizeImage', { sourcePath: filePath, output, ...options }, { signal })
    return await fs.promises.readFile(output)
  } finally {
    await fs.promises.rm(output, { force: true }).catch(() => undefined)
  }
}

/** Why an item cannot be resized (not in the library, a video or an animation), or null when it can. */
function skipReason(compositeHash: string): string | null {
  const media = findLibraryMedia(compositeHash)
  if (!media) return '라이브러리에서 찾을 수 없어'
  if (media.fileType === 'video' || media.mimeType.startsWith('video/')) return '영상은 건너뛰어'
  if (media.fileType === 'animated') return '움직이는 이미지는 건너뛰어'
  if (!media.mimeType.startsWith('image/')) return '이미지가 아니야'
  return null
}

async function runImageBatchResize(ctx: RuntimeJobContext<ImageBatchResizeParams>): Promise<ImageBatchResizeResult> {
  const options = resolveImageBatchResizeOptions(ctx.params)
  const groupId = resolveSpriteGroup({ groupId: ctx.params.groupId ?? null, groupPath: ctx.params.groupPath || IMAGE_BATCH_RESIZE_GROUP_PATH })
  const result: ImageBatchResizeResult = { groupId, saved: [], skipped: [], failed: [], options }
  const hashes = ctx.params.compositeHashes
  ctx.flush({ processed: 0, total: hashes.length })
  for (const [index, source] of hashes.entries()) {
    ctx.throwIfCancelled()
    const reason = skipReason(source)
    if (reason) {
      result.skipped.push({ source, reason })
    } else {
      try {
        const bytes = await resizeImageFile(findLibraryMedia(source)!.filePath, options, ctx.signal)
        const saved = await saveSpriteOutputToLibrary({ bytes, extension: options.format, mimeType: `image/${options.format}`, group: { groupId } })
        result.saved.push({ source, compositeHash: saved.compositeHash })
      } catch (error) {
        ctx.recordError(source, error)
        result.failed.push({ source, error: error instanceof Error ? error.message : String(error) })
      }
    }
    ctx.report({ processed: index + 1, total: hashes.length })
    await ctx.yield()
  }
  if (result.saved.length === 0) {
    throw new Error(result.failed[0]?.error ?? result.skipped[0]?.reason ?? '크기를 바꾼 이미지가 없어')
  }
  return result
}

export function registerImageBatchResizeJobHandlers(): void {
  RuntimeJobRunner.register<ImageBatchResizeParams, ImageBatchResizeResult>({
    kind: 'image-batch-resize',
    singletonKey: () => null,
    handler: runImageBatchResize,
  })
}

/** Validate up front (4xx instead of a failed job), then start the job. */
export function startImageBatchResizeJob(params: ImageBatchResizeParams): RuntimeJobRecord {
  const hashes = Array.isArray(params.compositeHashes) ? params.compositeHashes.map(String) : []
  if (hashes.length < 1 || hashes.length > MAX_IMAGE_BATCH_RESIZE_ITEMS) {
    throw new SpriteError(`이미지는 한 번에 1개에서 ${MAX_IMAGE_BATCH_RESIZE_ITEMS}개까지 처리할 수 있어.`)
  }
  if (new Set(hashes).size !== hashes.length) throw new SpriteError('같은 이미지가 두 번 들어 있어.')
  const options = resolveImageBatchResizeOptions(params)
  if (hashes.every((hash) => skipReason(hash) !== null)) throw new SpriteError('크기를 바꿀 수 있는 이미지가 없어 (영상·움직이는 이미지는 제외돼).')
  // An explicit group id must exist; the default group path is created when the job runs.
  if (params.groupId !== undefined && params.groupId !== null) resolveSpriteGroup({ groupId: params.groupId })
  return RuntimeJobRunner.start<ImageBatchResizeParams>('image-batch-resize', {
    compositeHashes: hashes,
    ...options,
    groupId: params.groupId ?? null,
    groupPath: params.groupPath?.trim() || null,
    requestedByAccountId: params.requestedByAccountId ?? null,
  }, { requestedByAccountId: params.requestedByAccountId ?? null, total: hashes.length })
}

/** Wait for the job to end, polling the job table (bounded; returns the latest record on timeout). */
export async function waitForImageBatchResizeJob(jobId: string, timeoutMs: number): Promise<RuntimeJobRecord | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const job = RuntimeJobStore.get(jobId)
    if (!job || isRuntimeJobTerminalStatus(job.status) || Date.now() >= deadline) return job
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}
