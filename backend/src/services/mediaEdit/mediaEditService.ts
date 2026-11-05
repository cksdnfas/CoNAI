import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import sharp, { type Sharp } from 'sharp'
import { runtimePaths } from '../../config/runtimePaths'
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel'
import { ImageFileModel } from '../../models/Image/ImageFileModel'
import type { RuntimeJobRecord } from '../../types/runtimeJob'
import { CONTENT_RATING_BLOCKED, libraryMediaAllowed, type ContentRatingLimit } from '../contentRating'
import { ImageSafetyService } from '../imageSafetyService'
import { ImageManagementService } from '../imageManagementService'
import { assignGeneratedMediaToGroup } from '../generationTargetGroupService'
import { saveMediaBytesToLibrary, saveMediaFileToLibrary } from '../libraryMediaIngest'
import { MediaPostprocessVisibilityService } from '../mediaPostprocessVisibilityService'
import { RuntimeJobRunner, type RuntimeJobContext } from '../runtimeJobs/runtimeJobRunner'
import { findLibraryMedia, resolveSpriteGroup, type LibraryMedia } from '../sprite/spriteLibrary'
import { inLane } from '../sprite/spriteService'
import { MAX_IMAGE_PIXELS } from '../sprite/spriteOptions'
import { probeVideo } from '../sprite/spriteFfmpeg'
import { captureVideoFrame, CLIP_MIME, encodeVideoClip, sourceClipFormat, type FrameSelection } from './mediaEditFfmpeg'

interface EditTarget {
  groupId?: number
  groupPath?: string
  requestedByAccountId?: number | null
  contentRatingLimit: ContentRatingLimit
}
export interface SaveVideoFrameParams extends EditTarget {
  operation: 'save_video_frame'
  compositeHash: string
  atSeconds?: number[]
  position?: 'first' | 'middle' | 'last'
  frameIndex?: number
  format: 'png' | 'webp'
}
export interface CropImagesParams extends EditTarget {
  operation: 'crop_images'
  compositeHashes: string[]
  rect: { x: number; y: number; width: number; height: number }
}
export interface ConvertImagesParams extends EditTarget {
  operation: 'convert_images'
  compositeHashes: string[]
  format: 'png' | 'webp' | 'jpeg'
  quality: number
  background: string
}
export interface ClipVideoParams extends EditTarget {
  operation: 'clip_video'
  compositeHash: string
  startSeconds: number
  endSeconds: number
  format?: 'mp4' | 'webm' | 'gif' | 'webp'
  fps?: number
  width?: number
}
export type MediaEditParams = SaveVideoFrameParams | CropImagesParams | ConvertImagesParams | ClipVideoParams
export interface MediaEditResult {
  groupId: number
  saved: Array<{ source: string; compositeHash: string; seconds?: number }>
  identical: Array<{ source: string; compositeHash: string }>
  skipped: Array<{ source: string; reason: string }>
  failed: Array<{ source: string; error: string; seconds?: number; frame_index?: number; position?: 'first' | 'middle' | 'last' }>
  streamCopy?: boolean
}

const DEFAULT_GROUP = {
  save_video_frame: '영상 캡처', crop_images: '이미지 자르기', convert_images: '이미지 변환', clip_video: '영상 편집',
}

async function readableMedia(hash: string, limit: ContentRatingLimit): Promise<LibraryMedia> {
  const metadata = MediaMetadataModel.findByHash(hash)
  if (!metadata || !MediaPostprocessVisibilityService.isReadyRecord(metadata) || ImageSafetyService.isHidden(metadata.rating_score)) {
    throw new Error('Not an available media item.')
  }
  if (!await libraryMediaAllowed(hash, limit)) throw new Error(CONTENT_RATING_BLOCKED)
  if (ImageSafetyService.isHidden(MediaMetadataModel.findByHash(hash)?.rating_score)) throw new Error('Not an available media item.')
  const media = findLibraryMedia(hash)
  if (!media) throw new Error('Not an available media item.')
  return media
}

function checkPixels(width: number, height: number): void {
  if (width * height > MAX_IMAGE_PIXELS) throw new Error(`Output exceeds ${MAX_IMAGE_PIXELS} pixels.`)
}

function requireEditableVideo(media: LibraryMedia): void {
  if (media.fileType !== 'video' && !media.mimeType.startsWith('video/')) throw new Error('Media editing requires a library video; use crop_images or convert_images for still images.')
}

async function captureFrames(ctx: RuntimeJobContext<MediaEditParams>, params: SaveVideoFrameParams, directory: string, result: MediaEditResult): Promise<void> {
  const media = await readableMedia(params.compositeHash, params.contentRatingLimit)
  const animation = media.mimeType.startsWith('image/')
  // libvips can retain an animated WebP file handle after metadata(); bytes let Windows remove source/temp files.
  const animationBytes = animation ? await fs.promises.readFile(media.filePath) : null
  const metadata = animationBytes ? await sharp(animationBytes, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata() : null
  // Animated WebP is registered as an image by the shared ingest pipeline; inspect its pages rather than file_type.
  if (metadata) {
    if ((metadata.pages ?? 1) < 2) throw new Error('Not an animated image; use crop_images or convert_images for still images.')
  } else requireEditableVideo(media)
  const video = animation ? null : await probeVideo(media.filePath, ctx.signal)
  checkPixels(metadata?.width ?? video!.width, metadata?.pageHeight ?? metadata?.height ?? video!.height)
  const starts: number[] = []
  let duration = video?.duration ?? 0
  if (metadata) {
    duration = 0
    for (let index = 0; index < (metadata.pages ?? 1); index++) {
      starts.push(duration)
      const delay = metadata.delay?.[index] ?? 100
      duration += (delay > 10 ? delay : 100) / 1000
    }
  }
  const selections: FrameSelection[] = (params.atSeconds ?? []).map((seconds) => ({ seconds }))
  if (params.position === 'last') selections.push({ last: true, position: 'last' })
  else if (params.position) selections.push({ seconds: params.position === 'middle' ? duration / 2 : 0, position: params.position })
  if (params.frameIndex !== undefined) selections.push({ frameIndex: params.frameIndex })
  if (!selections.length) selections.push({ seconds: 0, position: 'first' })
  ctx.flush({ total: selections.length })
  for (const [index, selection] of selections.entries()) {
    ctx.throwIfCancelled()
    try {
      let seconds: number
      let image: Sharp
      if (metadata) {
        if ('seconds' in selection && selection.seconds >= duration) throw new Error('Timestamp is past the end of the animation.')
        const page = 'last' in selection ? starts.length - 1 : 'frameIndex' in selection
          ? selection.frameIndex : starts.findIndex((start, next) => start <= selection.seconds && (starts[next + 1] ?? duration) > selection.seconds)
        if (page < 0 || page >= starts.length) throw new Error('Frame index is past the end of the animation.')
        seconds = starts[page]
        image = sharp(animationBytes!, { page, pages: 1, limitInputPixels: MAX_IMAGE_PIXELS })
      } else {
        if ('seconds' in selection && selection.seconds >= duration) throw new Error('Timestamp is past the end of the video.')
        const output = path.join(directory, `frame-${index}.png`)
        seconds = await captureVideoFrame(media.filePath, selection, output, ctx.signal)
        image = sharp(await fs.promises.readFile(output), { limitInputPixels: MAX_IMAGE_PIXELS })
      }
      const bytes = await (params.format === 'webp' ? image.webp({ quality: 90 }) : image.png()).toBuffer()
      ctx.throwIfCancelled()
      const compositeHash = await saveMediaBytesToLibrary({ bytes, extension: params.format, mimeType: `image/${params.format}`, groupId: result.groupId })
      result.saved.push({ source: params.compositeHash, compositeHash, seconds })
    } catch (error) {
      ctx.throwIfCancelled()
      ctx.recordError(JSON.stringify(selection), error)
      result.failed.push({
        source: params.compositeHash, error: error instanceof Error ? error.message : String(error),
        ...('seconds' in selection ? { seconds: selection.seconds } : {}),
        ...('frameIndex' in selection ? { frame_index: selection.frameIndex } : {}),
        ...(selection.position ? { position: selection.position } : {}),
      })
    }
    ctx.report({ processed: index + 1 })
    await ctx.yield()
  }
}

async function editImages(ctx: RuntimeJobContext<MediaEditParams>, params: CropImagesParams | ConvertImagesParams, result: MediaEditResult): Promise<void> {
  for (const [index, source] of params.compositeHashes.entries()) {
    ctx.throwIfCancelled()
    try {
      const media = await readableMedia(source, params.contentRatingLimit)
      if (media.fileType === 'video' || media.fileType === 'animated' || !media.mimeType.startsWith('image/')) {
        result.skipped.push({ source, reason: 'Only still images are supported; videos and animations are skipped.' })
      } else {
        let image = sharp(await fs.promises.readFile(media.filePath), { limitInputPixels: MAX_IMAGE_PIXELS }).rotate()
        const metadata = await image.metadata()
        if ((metadata.pages ?? 1) > 1) {
          result.skipped.push({ source, reason: 'Animated images are skipped.' })
        } else {
          if (params.operation === 'crop_images') {
            const { x, y, width, height } = params.rect
            const swapped = (metadata.orientation ?? 1) >= 5
            const sourceWidth = (swapped ? metadata.height : metadata.width)!
            const sourceHeight = (swapped ? metadata.width : metadata.height)!
            if (x + width > sourceWidth || y + height > sourceHeight) throw new Error(`Crop rectangle exceeds the oriented source size ${sourceWidth}×${sourceHeight}.`)
            checkPixels(width, height)
            image = image.extract({ left: x, top: y, width, height })
          }
          const format = params.operation === 'crop_images' ? 'png' : params.format
          const quality = params.operation === 'convert_images' ? params.quality : 90
          if (params.operation === 'convert_images' && format === 'jpeg') image = image.flatten({ background: params.background })
          const bytes = await (format === 'png' ? image.png() : image.toFormat(format, { quality })).toBuffer()
          ctx.throwIfCancelled()
          const extension = format === 'jpeg' ? 'jpg' : format
          // The ingest filename preserves this UUID suffix, so concurrent uploads of identical pixels are never deleted.
          const name = `media-edit-${randomUUID()}.${extension}`
          const compositeHash = await saveMediaBytesToLibrary({ bytes, extension, mimeType: `image/${format}`, groupId: null, name })
          if (compositeHash === source) {
            const duplicate = ImageFileModel.findAllByHash(source).find((file) => path.basename(file.original_file_path).endsWith(`_${name}`))
            if (!duplicate) throw new Error('Could not locate the identical output file registration.')
            const removed = await ImageManagementService.deleteImageFilesBulk([duplicate.id])
            if (removed.details.failed) throw new Error(removed.details.errors.join('; '))
            result.identical.push({ source, compositeHash: source })
          } else {
            assignGeneratedMediaToGroup(result.groupId, [compositeHash])
            result.saved.push({ source, compositeHash })
          }
        }
      }
    } catch (error) {
      ctx.throwIfCancelled()
      ctx.recordError(source, error)
      result.failed.push({ source, error: error instanceof Error ? error.message : String(error) })
    }
    ctx.report({ processed: index + 1 })
    await ctx.yield()
  }
}

async function clipVideo(ctx: RuntimeJobContext<MediaEditParams>, params: ClipVideoParams, directory: string, result: MediaEditResult): Promise<void> {
  const media = await readableMedia(params.compositeHash, params.contentRatingLimit)
  requireEditableVideo(media)
  const info = await probeVideo(media.filePath, ctx.signal)
  if (params.startSeconds >= info.duration || params.endSeconds > info.duration) throw new Error(`Range exceeds the source duration (${info.duration} seconds).`)
  const sourceFormat = sourceClipFormat(media.filePath, media.mimeType)
  const format = params.format ?? sourceFormat
  const copy = format === sourceFormat && !['gif', 'webp'].includes(format) && params.fps === undefined && params.width === undefined
  const width = params.width ?? info.width
  checkPixels(width + 1, Math.ceil(info.height * width / info.width) + 1)
  const output = path.join(directory, `clip.${format}`)
  await encodeVideoClip({ source: media.filePath, output, start: params.startSeconds, end: params.endSeconds, format, copy, fps: params.fps, width: params.width, signal: ctx.signal })
  ctx.throwIfCancelled()
  const compositeHash = await saveMediaFileToLibrary({ sourcePath: output, extension: format, mimeType: CLIP_MIME[format], groupId: result.groupId })
  result.saved.push({ source: params.compositeHash, compositeHash })
  result.streamCopy = copy
  ctx.report({ processed: 1 })
}

async function runMediaEdit(ctx: RuntimeJobContext<MediaEditParams>): Promise<MediaEditResult> {
  ctx.throwIfCancelled()
  ctx.flush({ phase: 'editing', message: 'Editing library media' })
  const params = ctx.params
  const groupId = resolveSpriteGroup({ groupId: params.groupId, groupPath: params.groupPath || DEFAULT_GROUP[params.operation] })
  const result: MediaEditResult = { groupId, saved: [], identical: [], skipped: [], failed: [] }
  await fs.promises.mkdir(runtimePaths.tempDir, { recursive: true })
  const directory = await fs.promises.mkdtemp(path.join(runtimePaths.tempDir, 'media-edit-'))
  try {
    if (params.operation === 'save_video_frame') await captureFrames(ctx, params, directory, result)
    else if (params.operation === 'clip_video') await clipVideo(ctx, params, directory, result)
    else await editImages(ctx, params, result)
    return result
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}

export function registerMediaEditJobHandlers(): void {
  RuntimeJobRunner.register<MediaEditParams, MediaEditResult>({ kind: 'media-edit', singletonKey: () => null, handler: (ctx) => inLane(ctx, () => runMediaEdit(ctx), 'Waiting for the previous media job') })
}

export function startMediaEditJob(params: MediaEditParams): RuntimeJobRecord {
  if (params.groupId !== undefined) resolveSpriteGroup({ groupId: params.groupId })
  const total = 'compositeHashes' in params ? params.compositeHashes.length : 1
  return RuntimeJobRunner.start('media-edit', params, { requestedByAccountId: params.requestedByAccountId ?? null, total })
}
