import { createApiFallbackError } from '@/i18n/api-error-fallbacks'
import { buildApiUrl, fetchJson, triggerBlobDownload } from '@/lib/api-client'
import { getDownloadFileName, readDownloadError } from '@/lib/download-utils'
import type { ApiResponse, ImageRecord } from '@/types/image'
import type { GroupBreadcrumbItem, GroupDownloadType, GroupFileCounts, GroupImagesPayload, GroupRecord, GroupWithHierarchy } from '@/types/group'

interface AutoFolderGroupApiRecord {
  id: number
  display_name: string
  parent_id: number | null
  folder_path: string
  absolute_path: string
  depth: number
  has_images: boolean
  image_count: number
  child_count?: number
  created_date?: string
  last_updated?: string
}

interface AutoFolderGroupBreadcrumbItem {
  id: number
  name: string
  folder_path: string
}

interface AutoFolderGroupImagesApiPayload {
  items: GroupImagesPayload['images']
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

function normalizeAutoFolderGroup(group: AutoFolderGroupApiRecord): GroupWithHierarchy {
  return {
    id: group.id,
    name: group.display_name,
    parent_id: group.parent_id,
    description: group.absolute_path,
    image_count: group.image_count,
    child_count: group.child_count ?? 0,
    has_children: (group.child_count ?? 0) > 0,
    depth: group.depth,
    created_date: group.created_date,
    updated_date: group.last_updated,
  }
}

function normalizeAutoFolderGroupDetail(group: AutoFolderGroupApiRecord): GroupRecord {
  return {
    id: group.id,
    name: group.display_name,
    parent_id: group.parent_id,
    description: group.absolute_path,
    image_count: group.image_count,
    created_date: group.created_date,
    updated_date: group.last_updated,
  }
}

function normalizeGroupFileCounts(counts: GroupFileCounts): GroupFileCounts {
  return {
    thumbnail: Number(counts.thumbnail ?? 0),
    original: Number(counts.original ?? 0),
    video: Number(counts.video ?? 0),
  }
}

export async function getAutoFolderGroupsHierarchyAll() {
  const response = await fetchJson<ApiResponse<AutoFolderGroupApiRecord[]>>('/api/auto-folder-groups')
  if (!response.success) {
    throw createApiFallbackError(response.error, 'autoFolderGroups.hierarchy.load')
  }
  return response.data.map(normalizeAutoFolderGroup)
}

export async function getAutoFolderGroup(groupId: number) {
  const response = await fetchJson<ApiResponse<AutoFolderGroupApiRecord>>(`/api/auto-folder-groups/${groupId}`)
  if (!response.success) {
    throw createApiFallbackError(response.error, 'autoFolderGroups.detail.load')
  }
  return normalizeAutoFolderGroupDetail(response.data)
}

export async function getAutoFolderGroupBreadcrumb(groupId: number) {
  const response = await fetchJson<ApiResponse<AutoFolderGroupBreadcrumbItem[]>>(`/api/auto-folder-groups/${groupId}/breadcrumb`)
  if (!response.success) {
    throw createApiFallbackError(response.error, 'autoFolderGroups.breadcrumb.load')
  }
  return response.data.map((item): GroupBreadcrumbItem => ({
    id: item.id,
    name: item.name,
  }))
}

export async function getAutoFolderGroupImages(groupId: number, params?: { page?: number; limit?: number }) {
  const searchParams = new URLSearchParams()
  searchParams.set('page', String(params?.page ?? 1))
  searchParams.set('pageSize', String(params?.limit ?? 40))

  const response = await fetchJson<ApiResponse<AutoFolderGroupImagesApiPayload>>(`/api/auto-folder-groups/${groupId}/images?${searchParams.toString()}`)
  if (!response.success) {
    throw createApiFallbackError(response.error, 'autoFolderGroups.images.load')
  }

  return {
    images: response.data.items,
    pagination: {
      page: response.data.pagination.page,
      limit: response.data.pagination.pageSize,
      total: response.data.pagination.total,
      totalPages: response.data.pagination.totalPages,
    },
  } satisfies GroupImagesPayload
}

export async function getAutoFolderGroupFileCounts(groupId: number) {
  const response = await fetchJson<ApiResponse<GroupFileCounts>>(`/api/auto-folder-groups/${groupId}/file-counts`)
  if (!response.success) {
    throw createApiFallbackError(response.error, 'autoFolderGroups.fileCounts.load')
  }
  return normalizeGroupFileCounts(response.data)
}

export async function rebuildAutoFolderGroups() {
  const response = await fetchJson<ApiResponse<{ success?: boolean; message?: string; rebuilt?: number }>>('/api/auto-folder-groups/rebuild', {
    method: 'POST',
  })

  if (!response.success) {
    throw createApiFallbackError(response.error, 'autoFolderGroups.rebuild')
  }

  return response.data
}

export async function getAutoFolderGroupPreviewImage(groupId: number, params?: { includeChildren?: boolean }) {
  const searchParams = new URLSearchParams()
  searchParams.set('count', '1')
  searchParams.set('includeChildren', String(params?.includeChildren ?? true))

  const response = await fetchJson<ApiResponse<ImageRecord[]>>(`/api/auto-folder-groups/${groupId}/preview-images?${searchParams.toString()}`)

  if (!response.success) {
    throw createApiFallbackError(response.error, 'autoFolderGroups.preview.load')
  }

  return response.data[0] ?? null
}

export async function downloadAutoFolderGroupArchive(
  groupId: number,
  options: {
    type: GroupDownloadType
    compositeHashes?: string[]
    captionMode?: 'auto_tags' | 'merged'
  },
) {
  const searchParams = new URLSearchParams()
  searchParams.set('type', options.type)

  if (options.compositeHashes && options.compositeHashes.length > 0) {
    searchParams.set('hashes', options.compositeHashes.join(','))
  }

  if (options.captionMode) {
    searchParams.set('captionMode', options.captionMode)
  }

  const response = await fetch(buildApiUrl(`/api/auto-folder-groups/${groupId}/download?${searchParams.toString()}`), {
    headers: {
      Accept: 'application/zip',
    },
  })

  if (!response.ok) {
    throw new Error(await readDownloadError(response))
  }

  const blob = await response.blob()
  const fallbackFileName = `auto-folder-group-${groupId}-${options.type}.zip`
  const fileName = getDownloadFileName(response.headers.get('Content-Disposition'), fallbackFileName)
  triggerBlobDownload(blob, fileName)

  return {
    fileName,
  }
}

