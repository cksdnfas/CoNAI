import fs from 'fs'
import path from 'path'
import { runtimePaths } from '../config/runtimePaths'
import type { WorkflowArtifactDirectoryMode, WorkflowRecord } from '../types/workflow'

export type WorkflowArtifactEntry = {
  name: string
  relativePath: string
  kind: 'directory' | 'file'
  size: number
  modifiedAt: string
  mimeType: string | null
  fileUrl?: string
  downloadUrl?: string
  thumbnailUrl?: string
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.apng': 'image/apng',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.txt': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.zip': 'application/zip',
  '.safetensors': 'application/octet-stream',
  '.ckpt': 'application/octet-stream',
  '.pt': 'application/octet-stream',
  '.pth': 'application/octet-stream',
}

function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s_-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return slug.length > 0 ? slug : 'workflow'
}

function normalizeRelativePath(value: string | undefined | null) {
  const raw = typeof value === 'string' ? value : ''
  const normalized = path.normalize(raw.replace(/\\/g, '/')).replace(/^([/\\])+/, '')
  return normalized === '.' ? '' : normalized
}

function isSubPath(candidate: string, root: string) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function getMimeType(filePath: string) {
  return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? null
}

function isImageMimeType(mimeType: string | null) {
  return Boolean(mimeType?.startsWith('image/'))
}

async function findDirectoryThumbnail(root: string, directory: string, depth = 3): Promise<string | null> {
  const candidates: Array<{ absolutePath: string; mtimeMs: number }> = []

  const scan = async (currentDirectory: string, currentDepth: number) => {
    const entries = await fs.promises.readdir(currentDirectory, { withFileTypes: true }).catch(() => [])
    await Promise.all(entries.map(async (entry) => {
      const absolutePath = path.join(currentDirectory, entry.name)
      if (entry.isDirectory() && currentDepth > 0) {
        await scan(absolutePath, currentDepth - 1)
        return
      }

      if (!entry.isFile()) {
        return
      }

      const mimeType = getMimeType(absolutePath)
      if (!isImageMimeType(mimeType)) {
        return
      }

      const stat = await fs.promises.stat(absolutePath).catch(() => null)
      if (stat) {
        candidates.push({ absolutePath, mtimeMs: stat.mtimeMs })
      }
    }))
  }

  await scan(directory, depth)
  const latestImage = candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]

  return latestImage ? path.relative(root, latestImage.absolutePath).replace(/\\/g, '/') : null
}

function sanitizeArtifactRelativePath(value: string | undefined | null) {
  const normalized = normalizeRelativePath(value)
  if (!normalized) {
    return ''
  }

  const parts = normalized
    .split(/[\\/]+/)
    .filter((part) => part && part !== '.' && part !== '..')
    .map((part) => part.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_'))

  const conaiArtifactsIndex = parts.lastIndexOf('conai_artifacts')
  let visibleParts = conaiArtifactsIndex >= 0 ? parts.slice(conaiArtifactsIndex + 1) : parts

  // CoNAI's custom ComfyUI artifact node stages folder bundles under
  // conai_artifacts/<timestamp_bundle>/file. The workflow artifact run folder
  // is already the user-facing execution folder, so flatten that staging bundle.
  if (conaiArtifactsIndex >= 0 && visibleParts.length > 1 && /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}_/.test(visibleParts[0])) {
    visibleParts = visibleParts.slice(1)
  }

  return visibleParts.join('/')
}

export function resolveWorkflowArtifactRoot(workflow: Pick<WorkflowRecord, 'id' | 'name' | 'artifact_root_path'>) {
  const configured = workflow.artifact_root_path?.trim()
  if (configured) {
    return path.resolve(path.isAbsolute(configured) ? configured : path.join(runtimePaths.artifactsDir, configured))
  }

  return path.join(runtimePaths.artifactsDir, 'comfy-workflows', `${workflow.id}-${slugify(workflow.name)}`)
}

export function resolveWorkflowArtifactPath(workflow: Pick<WorkflowRecord, 'id' | 'name' | 'artifact_root_path'>, relativePath?: string | null) {
  const root = resolveWorkflowArtifactRoot(workflow)
  const normalizedRelativePath = normalizeRelativePath(relativePath)
  const target = path.resolve(root, normalizedRelativePath)

  if (!isSubPath(target, root)) {
    throw new Error('Artifact path escapes workflow root')
  }

  return { root, target, relativePath: normalizedRelativePath }
}

function buildArtifactUrl(workflowId: number, relativePath: string, download = false) {
  const params = new URLSearchParams({ path: relativePath })
  if (download) {
    params.set('download', '1')
  }
  return `/api/workflows/${workflowId}/artifacts/file?${params.toString()}`
}

function buildArtifactArchiveUrl(workflowId: number, relativePath: string) {
  const params = new URLSearchParams({ path: relativePath })
  return `/api/workflows/${workflowId}/artifacts/archive?${params.toString()}`
}

export async function listWorkflowArtifacts(workflow: WorkflowRecord, relativePath?: string | null) {
  const resolved = resolveWorkflowArtifactPath(workflow, relativePath)
  await fs.promises.mkdir(resolved.root, { recursive: true })

  const stat = await fs.promises.stat(resolved.target).catch(() => null)
  if (!stat) {
    return {
      root: resolved.root,
      relativePath: resolved.relativePath,
      entries: [] as WorkflowArtifactEntry[],
    }
  }

  if (!stat.isDirectory()) {
    throw new Error('Artifact path is not a directory')
  }

  const dirents = await fs.promises.readdir(resolved.target, { withFileTypes: true })
  const entries = await Promise.all(dirents.map(async (dirent) => {
    const absolutePath = path.join(resolved.target, dirent.name)
    const itemStat = await fs.promises.stat(absolutePath)
    const itemRelativePath = path.relative(resolved.root, absolutePath).replace(/\\/g, '/')
    const isDirectory = dirent.isDirectory()
    const entry: WorkflowArtifactEntry = {
      name: dirent.name,
      relativePath: itemRelativePath,
      kind: isDirectory ? 'directory' : 'file',
      size: isDirectory ? 0 : itemStat.size,
      modifiedAt: itemStat.mtime.toISOString(),
      mimeType: isDirectory ? null : getMimeType(absolutePath),
    }

    if (isDirectory) {
      entry.downloadUrl = buildArtifactArchiveUrl(workflow.id, itemRelativePath)
      const thumbnailRelativePath = await findDirectoryThumbnail(resolved.root, absolutePath)
      if (thumbnailRelativePath) {
        entry.thumbnailUrl = buildArtifactUrl(workflow.id, thumbnailRelativePath)
      }
    } else {
      entry.fileUrl = buildArtifactUrl(workflow.id, itemRelativePath)
      entry.downloadUrl = buildArtifactUrl(workflow.id, itemRelativePath, true)
      if (isImageMimeType(entry.mimeType)) {
        entry.thumbnailUrl = entry.fileUrl
      }
    }

    return entry
  }))

  entries.sort((a, b) => {
    const dateDiff = new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
    if (dateDiff !== 0) {
      return dateDiff
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })

  return {
    root: resolved.root,
    relativePath: resolved.relativePath,
    entries,
  }
}

export function buildWorkflowArtifactRunDirectory(input: {
  workflow: WorkflowRecord
  promptId: string
  directoryMode?: WorkflowArtifactDirectoryMode
  now?: Date
}) {
  const root = resolveWorkflowArtifactRoot(input.workflow)
  const directoryMode = input.directoryMode ?? input.workflow.artifact_directory_mode ?? 'shared'

  if (directoryMode !== 'per_run') {
    return root
  }

  const timestamp = (input.now ?? new Date()).toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  const promptSuffix = input.promptId.trim().length > 0 ? `_${input.promptId.slice(0, 8)}` : ''
  return path.join(root, `${timestamp}${promptSuffix}`)
}

function safeArtifactFileName(value: string) {
  const baseName = path.basename(value).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
  return baseName.trim().length > 0 ? baseName : `artifact-${Date.now()}`
}

async function resolveAvailableFilePath(directory: string, fileName: string) {
  const parsed = path.parse(safeArtifactFileName(fileName))
  let candidate = path.join(directory, `${parsed.name}${parsed.ext}`)
  let suffix = 2

  while (await fs.promises.stat(candidate).then(() => true).catch(() => false)) {
    candidate = path.join(directory, `${parsed.name}-${suffix}${parsed.ext}`)
    suffix += 1
  }

  return candidate
}

export async function moveFileIntoWorkflowArtifacts(input: {
  workflow: WorkflowRecord
  sourcePath: string
  originalFileName?: string | null
  originalRelativePath?: string | null
  promptId: string
  directoryMode?: WorkflowArtifactDirectoryMode
  runStartedAt?: Date
}) {
  const targetDirectory = buildWorkflowArtifactRunDirectory({
    workflow: input.workflow,
    promptId: input.promptId,
    directoryMode: input.directoryMode,
    now: input.runStartedAt,
  })
  const root = resolveWorkflowArtifactRoot(input.workflow)
  await fs.promises.mkdir(targetDirectory, { recursive: true })

  if (!isSubPath(targetDirectory, root)) {
    throw new Error('Artifact target directory escapes workflow root')
  }

  const sanitizedRelativePath = sanitizeArtifactRelativePath(input.originalRelativePath)
  const targetSubdirectory = sanitizedRelativePath ? path.join(targetDirectory, path.dirname(sanitizedRelativePath)) : targetDirectory
  if (!isSubPath(targetSubdirectory, root)) {
    throw new Error('Artifact target subdirectory escapes workflow root')
  }
  await fs.promises.mkdir(targetSubdirectory, { recursive: true })

  const targetPath = await resolveAvailableFilePath(targetSubdirectory, sanitizedRelativePath ? path.basename(sanitizedRelativePath) : input.originalFileName || input.sourcePath)
  await fs.promises.rename(input.sourcePath, targetPath).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EXDEV') {
      throw error
    }

    await fs.promises.copyFile(input.sourcePath, targetPath)
    await fs.promises.unlink(input.sourcePath)
  })

  return {
    absolutePath: targetPath,
    relativePath: path.relative(root, targetPath).replace(/\\/g, '/'),
    directoryRelativePath: path.relative(root, targetDirectory).replace(/\\/g, '/'),
    size: (await fs.promises.stat(targetPath)).size,
  }
}
