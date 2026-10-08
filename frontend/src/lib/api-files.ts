import type { FileStoreListing, StoredFileEntry, StoredFileOwner, StoredFileText } from '@conai/shared'
import { requestApiData } from './api-request'
import { buildApiUrl } from './api-url'

export const FILES_QUERY_KEY = ['file-store'] as const
const headers = { 'Content-Type': 'application/json' }
/** `owner` is another account's store key (administrators); null/undefined means the caller's own store. */
export type StoredFileOwnerKey = string | null | undefined
const ownerQuery = (owner: StoredFileOwnerKey, first = false) => (owner ? `${first ? '?' : '&'}owner=${encodeURIComponent(owner)}` : '')

export const listStoredFiles = (parentId: string | null, offset = 0, owner?: StoredFileOwnerKey) => requestApiData<FileStoreListing>(`/api/files?parentId=${parentId ?? ''}&offset=${offset}${ownerQuery(owner)}`)
export const listStoredFolders = (owner?: StoredFileOwnerKey) => requestApiData<StoredFileEntry[]>(`/api/files/folders${ownerQuery(owner, true)}`)
export const listStoredFileOwners = () => requestApiData<StoredFileOwner[]>('/api/files/owners')
export const storedFileDownloadUrl = (id: string, owner?: StoredFileOwnerKey) => buildApiUrl(`/api/files/${encodeURIComponent(id)}/download${ownerQuery(owner, true)}`)
export const storedFileViewUrl = (id: string, owner?: StoredFileOwnerKey) => buildApiUrl(`/api/files/${encodeURIComponent(id)}/view${ownerQuery(owner, true)}`)
export const getStoredFileNeighbors = (id: string, owner?: StoredFileOwnerKey) => requestApiData<{ previous: StoredFileEntry | null; next: StoredFileEntry | null }>(`/api/files/${encodeURIComponent(id)}/neighbors${ownerQuery(owner, true)}`)
/** Small WebP preview of image and video files. */
export const storedFileThumbnailUrl = (id: string, owner?: StoredFileOwnerKey) => buildApiUrl(`/api/files/${encodeURIComponent(id)}/thumbnail${ownerQuery(owner, true)}`)
export const readStoredFileText = (id: string, offset = 0, owner?: StoredFileOwnerKey) => requestApiData<StoredFileText>(`/api/files/${encodeURIComponent(id)}/text?offset=${offset}${ownerQuery(owner)}`)
export const createStoredFolder = (parentId: string | null, name: string, owner?: StoredFileOwnerKey) => requestApiData<StoredFileEntry>(`/api/files/folders${ownerQuery(owner, true)}`, { method: 'POST', headers, body: JSON.stringify({ parentId, name }) })
export const renameStoredFile = (id: string, name: string, owner?: StoredFileOwnerKey) => requestApiData<StoredFileEntry>(`/api/files/${encodeURIComponent(id)}${ownerQuery(owner, true)}`, { method: 'PATCH', headers, body: JSON.stringify({ name }) })
export const moveStoredFiles = (ids: string[], parentId: string | null, owner?: StoredFileOwnerKey) => requestApiData<void>(`/api/files/move${ownerQuery(owner, true)}`, { method: 'POST', headers, body: JSON.stringify({ ids, parentId }) })
export const deleteStoredFiles = (ids: string[], owner?: StoredFileOwnerKey) => requestApiData<void>(`/api/files/delete${ownerQuery(owner, true)}`, { method: 'POST', headers, body: JSON.stringify({ ids }) })

/** Mirrors the server's default upload policy so a restricted pick fails before the bytes leave the browser. */
export const DEFAULT_UPLOAD_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonl', 'csv', 'tsv', 'yaml', 'yml', 'xml', 'html', 'htm', 'svg', 'css', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'sh', 'sql', 'log', 'ini', 'toml', 'srt', 'vtt',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'ico', 'psd',
  'mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'ogv',
  'mp3', 'wav', 'flac', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'weba',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'hwp', 'hwpx', 'odt', 'ods', 'odp', 'rtf', 'epub',
])
export function isRestrictedFileName(name: string) {
  const extension = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase()
  return !extension || !DEFAULT_UPLOAD_EXTENSIONS.has(extension)
}

export async function uploadStoredFiles(parentId: string | null, files: File[], options: { owner?: StoredFileOwnerKey; allowAnyType?: boolean } = {}) {
  if (files.length === 0 || files.length > 20) throw new Error('한 번에 1~20개 파일을 업로드할 수 있어. / Upload 1–20 files at a time.')
  if (files.some((file) => file.size > 500 * 1024 * 1024) || files.reduce((sum, file) => sum + file.size, 0) > 1024 ** 3) {
    throw new Error('파일당 500MB, 한 번에 총 1GB까지 가능해. / Limit: 500 MB per file, 1 GB total.')
  }
  // Only a caller that knows the user is not an administrator pre-checks; otherwise the server decides.
  const restricted = options.allowAnyType === false ? files.find((file) => isRestrictedFileName(file.name)) : null
  if (restricted) throw new Error(`이 형식은 올릴 수 없어: ${restricted.name}. 텍스트·이미지·영상·오디오·문서만 가능해. / Restricted file type: ${restricted.name}.`)
  const body = new FormData()
  for (const file of files) body.append('files', file)
  return requestApiData<StoredFileEntry[]>(`/api/files/upload?parentId=${parentId ?? ''}${ownerQuery(options.owner)}`, { method: 'POST', body })
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
