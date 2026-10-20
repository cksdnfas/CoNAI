import type { SystemFolderBatchResult, SystemFolderListing, SystemFolderRoot, SystemFolderRootId } from '@conai/shared'
import { requestApiData } from './api-request'
import { buildApiUrl } from './api-url'

/** Server folders (RecycleBin, uploads, save, temp, logs) for administrators. */
export const SYSTEM_FOLDERS_QUERY_KEY = ['system-folders'] as const
export const SYSTEM_FOLDER_PAGE_SIZE = 100
const headers = { 'Content-Type': 'application/json' }
const pathQuery = (path: string) => `path=${encodeURIComponent(path)}`
const fileUrl = (root: SystemFolderRootId, path: string, action: 'view' | 'download' | 'thumbnail') => buildApiUrl(`/api/system-folders/${root}/${action}?${pathQuery(path)}`)

export const listSystemFolderRoots = () => requestApiData<SystemFolderRoot[]>('/api/system-folders')
export const listSystemFolder = (root: SystemFolderRootId, path: string, offset = 0, limit = SYSTEM_FOLDER_PAGE_SIZE) =>
  requestApiData<SystemFolderListing>(`/api/system-folders/${root}?${pathQuery(path)}&offset=${offset}&limit=${limit}`)
export const systemFolderViewUrl = (root: SystemFolderRootId, path: string) => fileUrl(root, path, 'view')
export const systemFolderDownloadUrl = (root: SystemFolderRootId, path: string) => fileUrl(root, path, 'download')
export const systemFolderThumbnailUrl = (root: SystemFolderRootId, path: string) => fileUrl(root, path, 'thumbnail')
export const restoreRecycleBinFiles = (names: string[], conflict: 'fail' | 'rename' = 'fail') =>
  requestApiData<SystemFolderBatchResult>('/api/system-folders/recycle-bin/restore', { method: 'POST', headers, body: JSON.stringify({ names, conflict }) })
/** Image-delete permission only; the server accepts entries backed by library undo data, never other server files. */
export async function restoreDeletedImageFiles(names: string[]) {
  const result: SystemFolderBatchResult = { done: [], failed: [] }
  for (let offset = 0; offset < names.length; offset += 1000) {
    const batch = await requestApiData<SystemFolderBatchResult>('/api/images/restore', { method: 'POST', headers, body: JSON.stringify({ names: names.slice(offset, offset + 1000) }) })
    result.done.push(...batch.done)
    result.failed.push(...batch.failed)
  }
  return result
}
export const deleteRecycleBinFiles = (names: string[]) =>
  requestApiData<SystemFolderBatchResult>('/api/system-folders/recycle-bin/delete', { method: 'POST', headers, body: JSON.stringify({ names }) })
export const emptyRecycleBin = () => requestApiData<{ deleted: number; failed: number }>('/api/system-folders/recycle-bin/empty', { method: 'POST', headers, body: '{}' })
