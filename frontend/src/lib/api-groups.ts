import { buildApiUrl, fetchJson } from '@/lib/api-client'
import type { ApiResponse } from '@/types/image'
import type { GroupBreadcrumbItem, GroupImagesPayload, GroupRecord, GroupWithHierarchy } from '@/types/group'

export async function getGroupsHierarchyAll() {
  const response = await fetchJson<ApiResponse<GroupWithHierarchy[]>>('/api/groups/hierarchy/all')
  if (!response.success) {
    throw new Error(response.error || '그룹 계층을 불러오지 못했어.')
  }
  return response.data
}

export async function getGroup(groupId: number) {
  const response = await fetchJson<ApiResponse<GroupRecord>>(`/api/groups/${groupId}`)
  if (!response.success) {
    throw new Error(response.error || '그룹 정보를 불러오지 못했어.')
  }
  return response.data
}

export async function getGroupBreadcrumb(groupId: number) {
  const response = await fetchJson<ApiResponse<GroupBreadcrumbItem[]>>(`/api/groups/${groupId}/breadcrumb`)
  if (!response.success) {
    throw new Error(response.error || '그룹 경로를 불러오지 못했어.')
  }
  return response.data
}

export async function getGroupImages(groupId: number, params?: { page?: number; limit?: number }) {
  const searchParams = new URLSearchParams()
  searchParams.set('page', String(params?.page ?? 1))
  searchParams.set('limit', String(params?.limit ?? 40))

  const response = await fetchJson<ApiResponse<GroupImagesPayload>>(`/api/groups/${groupId}/images?${searchParams.toString()}`)
  if (!response.success) {
    throw new Error(response.error || '그룹 이미지를 불러오지 못했어.')
  }
  return response.data
}

export function getGroupThumbnailUrl(groupId: number) {
  return buildApiUrl(`/api/groups/${groupId}/thumbnail`)
}
