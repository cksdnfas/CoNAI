import fs from 'fs'
import path from 'path'
import { runtimePaths } from '../config/runtimePaths'
import { BackgroundProcessorService } from './backgroundProcessorService'
import { assignGeneratedMediaToGroup } from './generationTargetGroupService'
import { getDateFolder } from '../utils/mediaStoragePaths'
import { exclusiveWrites, writeMediaFileWithUniqueName } from '../utils/mediaFileNames'

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
  /** Optional original name: stored by the upload-name pattern; without one, by the generated-name pattern. */
  name?: string
}

/** Write a new library file under a free name in today's folder (settings › 파일 이름). */
function writeLibraryFile(input: LibraryIngestInput, write: (target: string) => Promise<void>): Promise<string> {
  const isVideo = input.mimeType.startsWith('video/')
  const directory = path.join(runtimePaths.uploadsDir, ...(isVideo ? ['videos', 'API'] : ['API', 'images']), getDateFolder())
  return writeMediaFileWithUniqueName({ directory, extension: input.extension, kind: input.name ? 'upload' : 'generated', originalName: input.name }, write)
}

async function registerLibraryFile(filePath: string, mimeType: string, groupId: number | null): Promise<string> {
  const processed = await BackgroundProcessorService.processSavedMediaFile(filePath, { mimeType, metadataMode: 'background', quiet: true })
  if (!processed.compositeHash) throw new LibraryIngestError('라이브러리에 저장하지 못했습니다.', 500)
  assignGeneratedMediaToGroup(groupId, [processed.compositeHash])
  return processed.compositeHash
}

/** Save bytes held in memory as a new library item; returns its composite hash and the stored file. */
export async function storeMediaBytesInLibrary(input: LibraryIngestInput & { bytes: Buffer }): Promise<{ compositeHash: string; filePath: string }> {
  const filePath = await writeLibraryFile(input, exclusiveWrites.bytes(input.bytes))
  try {
    return { compositeHash: await registerLibraryFile(filePath, input.mimeType, input.groupId), filePath }
  } catch (error) {
    await fs.promises.rm(filePath, { force: true })
    throw error
  }
}

/** Save bytes held in memory as a new library item; returns its composite hash. */
export async function saveMediaBytesToLibrary(input: LibraryIngestInput & { bytes: Buffer }): Promise<string> {
  return (await storeMediaBytesInLibrary(input)).compositeHash
}

/** Copy an existing file (a stored file, a temp ffmpeg output…) into the library; the source is left in place. */
export async function saveMediaFileToLibrary(input: LibraryIngestInput & { sourcePath: string }): Promise<string> {
  const filePath = await writeLibraryFile(input, exclusiveWrites.copy(input.sourcePath))
  try {
    return await registerLibraryFile(filePath, input.mimeType, input.groupId)
  } catch (error) {
    await fs.promises.rm(filePath, { force: true })
    throw error
  }
}
