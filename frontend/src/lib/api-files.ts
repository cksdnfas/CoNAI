import type { FileStoreListing, FileWriteSource, StoredFileEntry, StoredFileRevision, StoredFileSearchResult, StoredFileText } from '@conai/shared'
import { requestApiData } from './api-request'
import { buildApiUrl } from './api-url'
import { UPLOAD_LIMITS } from './upload-limits'

export const FILES_QUERY_KEY = ['file-store'] as const
const headers = { 'Content-Type': 'application/json' }

export const listStoredFiles = (parentId: string | null, offset = 0, signal?: AbortSignal) => requestApiData<FileStoreListing>(`/api/files?parentId=${parentId ?? ''}&offset=${offset}`, { signal })
/** Files and folders whose name or text contains every word of `query` (a "quoted phrase" is one term). */
export const searchStoredFiles = (query: string, signal?: AbortSignal) => requestApiData<StoredFileSearchResult>(`/api/files/search?q=${encodeURIComponent(query)}`, { signal })
export const listStoredFolders = (signal?: AbortSignal) => requestApiData<StoredFileEntry[]>(`/api/files/folders`, { signal })
export const storedFileDownloadUrl = (id: string) => buildApiUrl(`/api/files/${encodeURIComponent(id)}/download`)
export const storedFileViewUrl = (id: string) => buildApiUrl(`/api/files/${encodeURIComponent(id)}/view`)
export const getStoredFileNeighbors = (id: string) => requestApiData<{ previous: StoredFileEntry | null; next: StoredFileEntry | null }>(`/api/files/${encodeURIComponent(id)}/neighbors`)
/** Small WebP preview of image and video files. */
export const storedFileThumbnailUrl = (id: string) => buildApiUrl(`/api/files/${encodeURIComponent(id)}/thumbnail`)
export const readStoredFileText = (id: string, offset = 0, revision?: string, signal?: AbortSignal) => requestApiData<StoredFileText>(`/api/files/${encodeURIComponent(id)}/text?offset=${offset}${revision ? `&revision=${encodeURIComponent(revision)}` : ''}`, { signal })
export const createStoredFolder = (parentId: string | null, name: string) => requestApiData<StoredFileEntry>(`/api/files/folders`, { method: 'POST', headers, body: JSON.stringify({ parentId, name }) })
export const renameStoredFile = (id: string, name: string) => requestApiData<StoredFileEntry>(`/api/files/${encodeURIComponent(id)}`, { method: 'PATCH', headers, body: JSON.stringify({ name }) })
export const moveStoredFiles = (ids: string[], parentId: string | null) => requestApiData<void>(`/api/files/move`, { method: 'POST', headers, body: JSON.stringify({ ids, parentId }) })
/** Files the server stores and serves as UTF-8 text (fileStoreService TEXT_EXTENSIONS); the editor opens these. */
export const TEXT_FILE_PATTERN = /\.(txt|md|markdown|json|jsonl|csv|tsv|ya?ml|xml|html?|svg|css|m?js|cjs|jsx|tsx?|py|sh|sql|log|ini|toml|srt|vtt)$/i
/** Mirrors the server's MAX_TEXT_DOCUMENT_BYTES. */
export const MAX_TEXT_DOCUMENT_BYTES = 2 * 1024 * 1024
export const createStoredTextFile = (parentId: string | null, name: string, text: string) => requestApiData<StoredFileEntry>(`/api/files/text`, { method: 'POST', headers, body: JSON.stringify({ parentId, name, text }) })
export const readStoredFileForEdit = (id: string) => requestApiData<{ text: string; revision: string }>(`/api/files/${encodeURIComponent(id)}/edit`)
export const saveStoredFileText = (id: string, text: string, expectedRevision: string | null) => requestApiData<StoredFileEntry>(`/api/files/${encodeURIComponent(id)}/text`, { method: 'PUT', headers, body: JSON.stringify({ text, expectedRevision }) })
/** The whole file as text, for editing; refuses what is not UTF-8 text so a save cannot mangle it. */
export async function readWholeStoredFileText(id: string) {
  const response = await fetch(storedFileViewUrl(id), { credentials: 'include', cache: 'no-store' })
  if (!response.ok) throw new Error('파일을 열지 못했어. / Could not open the file.')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.includes(0)) throw new Error('바이너리 파일은 편집할 수 없어. / Binary files cannot be edited.')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('UTF-8 텍스트 파일만 편집할 수 있어. / Only UTF-8 text files can be edited.')
  }
}
/** A text file's earlier versions (newest first) and who wrote its current text. */
export type StoredFileRevisions = { current: { writtenAt: string; writtenBy: FileWriteSource | null }; revisions: StoredFileRevision[] }
export const listStoredFileRevisions = (id: string) => requestApiData<StoredFileRevisions>(`/api/files/${encodeURIComponent(id)}/revisions`)
export const readStoredFileRevision = (id: string, revisionId: string) => requestApiData<{ revision: StoredFileRevision; text: string }>(`/api/files/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}`)
/** Put an earlier version back; the current text is kept as a version too. */
export const restoreStoredFileRevision = (id: string, revisionId: string) => requestApiData<StoredFileEntry>(`/api/files/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}/restore`, { method: 'POST', headers, body: '{}' })
export const getStoredFile = (id: string) => requestApiData<StoredFileEntry>(`/api/files/${encodeURIComponent(id)}`)
export const deleteStoredFiles =(ids: string[]) => requestApiData<void>(`/api/files/delete`, { method: 'POST', headers, body: JSON.stringify({ ids }) })

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

export async function uploadStoredFiles(parentId: string | null, files: File[], options: { allowAnyType?: boolean } = {}) {
  if (files.length === 0 || files.length > UPLOAD_LIMITS.maxFilesPerRequest) throw new Error('한 번에 1~20개 파일을 업로드할 수 있어. / Upload 1–20 files at a time.')
  if (files.some((file) => file.size > UPLOAD_LIMITS.maxFileBytes) || files.reduce((sum, file) => sum + file.size, 0) > UPLOAD_LIMITS.maxRequestBytes) {
    throw new Error('파일당 500MB, 한 번에 총 1GB까지 가능해. / Limit: 500 MB per file, 1 GB total.')
  }
  // Only a caller that knows the user is not an administrator pre-checks; otherwise the server decides.
  const restricted = options.allowAnyType === false ? files.find((file) => isRestrictedFileName(file.name)) : null
  if (restricted) throw new Error(`이 형식은 올릴 수 없어: ${restricted.name}. 텍스트·이미지·영상·오디오·문서만 가능해. / Restricted file type: ${restricted.name}.`)
  const body = new FormData()
  for (const file of files) body.append('files', file)
  return requestApiData<StoredFileEntry[]>(`/api/files/upload?parentId=${parentId ?? ''}`, { method: 'POST', body })
}

/** Retry derived content extraction without modifying the original file. */
export const retryStoredFileIndex = (id: string) => requestApiData<{ fileId: string }>(`/api/files/${id}/reindex`, { method: 'POST' })
