import { fetchJson } from '@/lib/api-client'
import type { ApiResponse } from '@/types/image'
import type { GroupBreadcrumbItem, GroupImagesPayload, GroupRecord, GroupWithHierarchy } from '@/types/group'

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

export async function getAutoFolderGroupsHierarchyAll() {
  const response = await fetchJson<ApiResponse<AutoFolderGroupApiRecord[]>>('/api/auto-folder-groups')
  if (!response.success) {
    throw new Error(response.error || '감시폴더 그룹을 불러오지 못했어.')
  }
  return response.data.map(normalizeAutoFolderGroup)
}

export async function getAutoFolderGroup(groupId: number) {
  const response = await fetchJson<ApiResponse<AutoFolderGroupApiRecord>>(`/api/auto-folder-groups/${groupId}`)
  if (!response.success) {
    throw new Error(response.error || '감시폴더 그룹 정보를 불러오지 못했어.')
  }
  return normalizeAutoFolderGroupDetail(response.data)
}

export async function getAutoFolderGroupBreadcrumb(groupId: number) {
  const response = await fetchJson<ApiResponse<AutoFolderGroupBreadcrumbItem[]>>(`/api/auto-folder-groups/${groupId}/breadcrumb`)
  if (!response.success) {
    throw new Error(response.error || '감시폴더 그룹 경로를 불러오지 못했어.')
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
    throw new Error(response.error || '감시폴더 그룹 이미지를 불러오지 못했어.')
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

export function getAutoFolderGroupThumbnailUrl(groupId: number) {
  return `/api/auto-folder-groups/${groupId}/thumbnail`
}
