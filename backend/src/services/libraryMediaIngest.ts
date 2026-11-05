import fs from 'fs'
import path from 'path'
import { runtimePaths } from '../config/runtimePaths'
import { BackgroundProcessorService } from './backgroundProcessorService'
import { assignGeneratedMediaToGroup } from './generationTargetGroupService'
import { generateDatedRandomFilename, generateUniqueOriginalFilename, getDateFolder } from '../utils/mediaStoragePaths'

/**
 * Write in-app output (sprite sheets, captured frames, converted media, agent uploads…) into the image library the
 * same way every other produced file is stored: a dated folder under uploads, registration through
 * processSavedMediaFile, and filing under one custom group. Callers resolve the group id and permissions first.
 */

export class LibraryIngestError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message)
    this.name = 'LibraryIngestError'
  }
}

export interface LibraryIngestInput {
  /** File extension without the dot (png, webp, mp4…). */
  extension: string
  mimeType: string
  /** Custom group the new item is filed under, or null for an ungrouped upload. */
  groupId: number | null
  /** Optional original name; the stored name still includes a unique generated prefix. */
  name?: string
}

async function allocateLibraryPath(extension: string, mimeType: string, name?: string): Promise<string> {
  const isVideo = mimeType.startsWith('video/')
  const directory = path.join(runtimePaths.uploadsDir, ...(isVideo ? ['videos', 'API'] : ['API', 'images']), getDateFolder())
  await fs.promises.mkdir(directory, { recursive: true })
  return path.join(directory, name ? generateUniqueOriginalFilename(name, extension) : generateDatedRandomFilename(extension))
}

async function registerLibraryFile(filePath: string, mimeType: string, groupId: number | null): Promise<string> {
  const processed = await BackgroundProcessorService.processSavedMediaFile(filePath, { mimeType, metadataMode: 'background', quiet: true })
  if (!processed.compositeHash) throw new LibraryIngestError('라이브러리에 저장하지 못했습니다.', 500)
  assignGeneratedMediaToGroup(groupId, [processed.compositeHash])
  return processed.compositeHash
}

/** Save bytes held in memory as a new library item; returns its composite hash. */
export async function saveMediaBytesToLibrary(input: LibraryIngestInput & { bytes: Buffer }): Promise<string> {
  const filePath = await allocateLibraryPath(input.extension, input.mimeType, input.name)
  try {
    await fs.promises.writeFile(filePath, input.bytes)
    return await registerLibraryFile(filePath, input.mimeType, input.groupId)
  } catch (error) {
    await fs.promises.rm(filePath, { force: true })
    throw error
  }
}

/** Copy an existing file (a stored file, a temp ffmpeg output…) into the library; the source is left in place. */
export async function saveMediaFileToLibrary(input: LibraryIngestInput & { sourcePath: string }): Promise<string> {
  const filePath = await allocateLibraryPath(input.extension, input.mimeType, input.name)
  try {
    await fs.promises.copyFile(input.sourcePath, filePath)
    return await registerLibraryFile(filePath, input.mimeType, input.groupId)
  } catch (error) {
    await fs.promises.rm(filePath, { force: true })
    throw error
  }
}
