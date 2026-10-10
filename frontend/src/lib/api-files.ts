import type { FileStoreListing, StoredFileEntry, StoredFileOwner, StoredFileSearchResult, StoredFileText } from '@conai/shared'
import { requestApiData } from './api-request'
import { buildApiUrl } from './api-url'

export const FILES_QUERY_KEY = ['file-store'] as const
const headers = { 'Content-Type': 'application/json' }
/** `owner` is another account's store key (administrators); null/undefined means the caller's own store. */
export type StoredFileOwnerKey = string | null | undefined
const ownerQuery = (owner: StoredFileOwnerKey, first = false) => (owner ? `${first ? '?' : '&'}owner=${encodeURIComponent(owner)}` : '')

export const listStoredFiles = (parentId: string | null, offset = 0, owner?: StoredFileOwnerKey) => requestApiData<FileStoreListing>(`/api/files?parentId=${parentId ?? ''}&offset=${offset}${ownerQuery(owner)}`)
/** Files and folders whose name or text contains every word of `query` (a "quoted phrase" is one term). */
export const searchStoredFiles = (query: string, owner?: StoredFileOwnerKey) => requestApiData<StoredFileSearchResult>(`/api/files/search?q=${encodeURIComponent(query)}${ownerQuery(owner)}`)
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
/** Files the server stores and serves as UTF-8 text (fileStoreService TEXT_EXTENSIONS); the editor opens these. */
export const TEXT_FILE_PATTERN = /\.(txt|md|markdown|json|jsonl|csv|tsv|ya?ml|xml|html?|svg|css|m?js|cjs|jsx|tsx?|py|sh|sql|log|ini|toml|srt|vtt)$/i
/** Mirrors the server's MAX_TEXT_DOCUMENT_BYTES. */
export const MAX_TEXT_DOCUMENT_BYTES = 2 * 1024 * 1024
export const createStoredTextFile = (parentId: string | null, name: string, text: string, owner?: StoredFileOwnerKey) => requestApiData<StoredFileEntry>(`/api/files/text${ownerQuery(owner, true)}`, { method: 'POST', headers, body: JSON.stringify({ parentId, name, text }) })
export const saveStoredFileText = (id: string, text: string, owner?: StoredFileOwnerKey) => requestApiData<StoredFileEntry>(`/api/files/${encodeURIComponent(id)}/text${ownerQuery(owner, true)}`, { method: 'PUT', headers, body: JSON.stringify({ text }) })
/** The whole file as text, for editing; refuses what is not UTF-8 text so a save cannot mangle it. */
export async function readWholeStoredFileText(id: string, owner?: StoredFileOwnerKey) {
  const response = await fetch(storedFileViewUrl(id, owner), { credentials: 'include', cache: 'no-store' })
  if (!response.ok) throw new Error('파일을 열지 못했어. / Could not open the file.')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.includes(0)) throw new Error('바이너리 파일은 편집할 수 없어. / Binary files cannot be edited.')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('UTF-8 텍스트 파일만 편집할 수 있어. / Only UTF-8 text files can be edited.')
  }
}
export const deleteStoredFiles =(ids: string[], owner?: StoredFileOwnerKey) => requestApiData<void>(`/api/files/delete${ownerQuery(owner, true)}`, { method: 'POST', headers, body: JSON.stringify({ ids }) })

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
