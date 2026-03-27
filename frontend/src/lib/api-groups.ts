import { buildApiUrl, fetchJson } from '@/lib/api-client'
import type { ApiResponse } from '@/types/image'
import type {
  GroupAutoCollectResult,
  GroupBreadcrumbItem,
  GroupBulkAddResult,
  GroupImagesPayload,
  GroupMutationInput,
  GroupMutationMessage,
  GroupMutationResult,
  GroupRecord,
  GroupWithHierarchy,
} from '@/types/group'

/** Normalize backend boolean-ish group fields for frontend use. */
function normalizeGroupRecord(group: GroupRecord): GroupRecord {
  return {
    ...group,
    auto_collect_enabled: Boolean(group.auto_collect_enabled),
    image_count: Number(group.image_count ?? 0),
    auto_collected_count: Number(group.auto_collected_count ?? 0),
    manual_added_count: Number(group.manual_added_count ?? 0),
  }
}

/** Normalize hierarchy records while preserving hierarchy fields. */
function normalizeGroupWithHierarchy(group: GroupWithHierarchy): GroupWithHierarchy {
  return {
    ...normalizeGroupRecord(group),
    child_count: Number(group.child_count ?? 0),
    has_children: Boolean(group.has_children),
  }
}

export async function getGroupsHierarchyAll() {
  const response = await fetchJson<ApiResponse<GroupWithHierarchy[]>>('/api/groups/hierarchy/all')
  if (!response.success) {
    throw new Error(response.error || '그룹 계층을 불러오지 못했어.')
  }
  return response.data.map(normalizeGroupWithHierarchy)
}

export async function getGroup(groupId: number) {
  const response = await fetchJson<ApiResponse<GroupRecord>>(`/api/groups/${groupId}`)
  if (!response.success) {
    throw new Error(response.error || '그룹 정보를 불러오지 못했어.')
  }
  return normalizeGroupRecord(response.data)
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

export async function createGroup(input: GroupMutationInput) {
  const response = await fetchJson<ApiResponse<GroupMutationResult>>('/api/groups', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (!response.success) {
    throw new Error(response.error || '그룹을 만들지 못했어.')
  }

  return response.data
}

export async function updateGroup(groupId: number, input: Partial<GroupMutationInput>) {
  const response = await fetchJson<ApiResponse<GroupMutationMessage>>(`/api/groups/${groupId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (!response.success) {
    throw new Error(response.error || '그룹을 수정하지 못했어.')
  }

  return response.data
}

export async function deleteGroup(groupId: number, options?: { cascade?: boolean }) {
  const searchParams = new URLSearchParams()
  if (options?.cascade) {
    searchParams.set('cascade', 'true')
  }

  const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : ''
  const response = await fetchJson<ApiResponse<GroupMutationMessage>>(`/api/groups/${groupId}${suffix}`, {
    method: 'DELETE',
  })

  if (!response.success) {
    throw new Error(response.error || '그룹을 삭제하지 못했어.')
  }

  return response.data
}

export async function moveGroup(groupId: number, parentId: number | null) {
  const response = await fetchJson<ApiResponse<GroupMutationMessage>>(`/api/groups/${groupId}/move`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ parent_id: parentId }),
  })

  if (!response.success) {
    throw new Error(response.error || '그룹을 이동하지 못했어.')
  }

  return response.data
}

export async function addImageToGroup(groupId: number, compositeHash: string) {
  const response = await fetchJson<ApiResponse<GroupMutationMessage & { converted?: boolean }>>(`/api/groups/${groupId}/images`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ composite_hash: compositeHash }),
  })

  if (!response.success) {
    throw new Error(response.error || '이미지를 그룹에 추가하지 못했어.')
  }

  return response.data
}

export async function addImagesToGroup(groupId: number, compositeHashes: string[]) {
  const response = await fetchJson<ApiResponse<GroupBulkAddResult>>(`/api/groups/${groupId}/images/bulk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ composite_hashes: compositeHashes }),
  })

  if (!response.success) {
    throw new Error(response.error || '이미지를 그룹에 추가하지 못했어.')
  }

  return response.data
}

export async function removeImageFromGroup(groupId: number, compositeHash: string) {
  const response = await fetchJson<ApiResponse<GroupMutationMessage>>(`/api/groups/${groupId}/images/${encodeURIComponent(compositeHash)}`, {
    method: 'DELETE',
  })

  if (!response.success) {
    throw new Error(response.error || '이미지를 그룹에서 제거하지 못했어.')
  }

  return response.data
}

export async function runGroupAutoCollect(groupId: number) {
  const response = await fetchJson<ApiResponse<GroupAutoCollectResult>>(`/api/groups/${groupId}/auto-collect`, {
    method: 'POST',
  })

  if (!response.success) {
    throw new Error(response.error || '자동수집을 실행하지 못했어.')
  }

  return response.data
}

export function getGroupThumbnailUrl(groupId: number) {
  return buildApiUrl(`/api/groups/${groupId}/thumbnail`)
}
