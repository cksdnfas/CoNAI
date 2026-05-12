import path from 'path'
import { FileDiscoveryService } from '../folderScan/fileDiscoveryService'
import { type ModulePortDataType } from '../../types/moduleGraph'

export type ComfyGraphOutputKind = 'image' | 'animated' | 'video' | 'file'

export type ComfyGraphOutputDescriptor = {
  artifactType: ModulePortDataType | 'file'
  outputKind: ComfyGraphOutputKind
  mimeType: string
}

const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi'])
const ANIMATED_IMAGE_EXTENSIONS = new Set(['.gif', '.webp', '.apng'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.apng'])

export function resolveComfyOutputMimeType(output: { format?: string; filename: string; tempPath: string }) {
  const normalizedFormat = typeof output.format === 'string' ? output.format.trim().toLowerCase() : ''
  if (normalizedFormat.includes('/')) {
    return normalizedFormat
  }

  return FileDiscoveryService.getMimeType(output.filename || output.tempPath)
}

function normalizeExplicitOutputKind(outputKind?: string | null): ComfyGraphOutputKind | null {
  if (outputKind === 'video' || outputKind === 'animated' || outputKind === 'image') {
    return outputKind
  }

  return null
}

function inferComfyGraphOutputKind(params: {
  mimeType?: string | null
  filePath?: string | null
  fileName?: string | null
  explicitKind?: string | null
}): ComfyGraphOutputKind {
  const explicitKind = normalizeExplicitOutputKind(params.explicitKind)
  if (explicitKind) {
    return explicitKind
  }

  const normalizedMimeType = (params.mimeType || '').trim().toLowerCase()
  const extension = path.extname(params.fileName || params.filePath || '').toLowerCase()

  if (normalizedMimeType.startsWith('video/') || VIDEO_EXTENSIONS.has(extension)) {
    return 'video'
  }

  if (normalizedMimeType === 'image/gif' || normalizedMimeType === 'image/apng' || ANIMATED_IMAGE_EXTENSIONS.has(extension)) {
    return 'animated'
  }

  if (normalizedMimeType.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) {
    return 'image'
  }

  return 'file'
}

export function resolveComfyGraphOutputDescriptor(params: {
  mimeType?: string | null
  filePath?: string | null
  fileName?: string | null
  explicitKind?: string | null
}): ComfyGraphOutputDescriptor {
  const outputKind = inferComfyGraphOutputKind(params)
  const artifactType: ModulePortDataType | 'file' = outputKind === 'video' || outputKind === 'file' ? 'file' : 'image'
  const mimeType = (params.mimeType || '').trim() || (outputKind === 'file' ? 'application/octet-stream' : outputKind === 'video' ? 'video/mp4' : 'image/png')

  return {
    artifactType,
    outputKind,
    mimeType,
  }
}
