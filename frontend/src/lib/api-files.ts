import type { FileStoreListing, StoredFileEntry, StoredFileText } from '@conai/shared'
import { requestApiData } from './api-request'
import { buildApiUrl } from './api-url'

export const FILES_QUERY_KEY = ['file-store'] as const
const headers = { 'Content-Type': 'application/json' }
export const listStoredFiles = (parentId: string | null, offset = 0) => requestApiData<FileStoreListing>(`/api/files?parentId=${parentId ?? ''}&offset=${offset}`)
export const listStoredFolders = () => requestApiData<StoredFileEntry[]>('/api/files/folders')
export const storedFileDownloadUrl = (id: string) => buildApiUrl(`/api/files/${encodeURIComponent(id)}/download`)
export const storedFileViewUrl = (id: string) => buildApiUrl(`/api/files/${encodeURIComponent(id)}/view`)
export const getStoredFileNeighbors = (id: string) => requestApiData<{ previous: StoredFileEntry | null; next: StoredFileEntry | null }>(`/api/files/${encodeURIComponent(id)}/neighbors`)
/** Small WebP preview of image and video files. */
export const storedFileThumbnailUrl = (id: string) => buildApiUrl(`/api/files/${encodeURIComponent(id)}/thumbnail`)
export const readStoredFileText = (id: string, offset = 0) => requestApiData<StoredFileText>(`/api/files/${encodeURIComponent(id)}/text?offset=${offset}`)
export const createStoredFolder = (parentId: string | null, name: string) => requestApiData<StoredFileEntry>('/api/files/folders', { method: 'POST', headers, body: JSON.stringify({ parentId, name }) })
export const renameStoredFile = (id: string, name: string) => requestApiData<StoredFileEntry>(`/api/files/${encodeURIComponent(id)}`, { method: 'PATCH', headers, body: JSON.stringify({ name }) })
export const moveStoredFiles = (ids: string[], parentId: string | null) => requestApiData<void>('/api/files/move', { method: 'POST', headers, body: JSON.stringify({ ids, parentId }) })
export const deleteStoredFiles = (ids: string[]) => requestApiData<void>('/api/files/delete', { method: 'POST', headers, body: JSON.stringify({ ids }) })

export async function uploadStoredFiles(parentId: string | null, files: File[]) {
  if (files.length === 0 || files.length > 20) throw new Error('한 번에 1~20개 파일을 업로드할 수 있어. / Upload 1–20 files at a time.')
  if (files.some((file) => file.size > 500 * 1024 * 1024) || files.reduce((sum, file) => sum + file.size, 0) > 1024 ** 3) {
    throw new Error('파일당 500MB, 한 번에 총 1GB까지 가능해. / Limit: 500 MB per file, 1 GB total.')
  }
  const body = new FormData()
  for (const file of files) body.append('files', file)
  return requestApiData<StoredFileEntry[]>(`/api/files/upload?parentId=${parentId ?? ''}`, { method: 'POST', body })
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
