import { buildApiUrl } from '@/lib/api-client'
import { requestApiData, requestJson } from '@/lib/api-request'
import type { RuntimeJobRecord } from '@/types/runtime-job'
import type { GroupMoveOptions, GroupMoveResult } from '@conai/shared'
import { createApiFallbackError } from '@/i18n/api-error-fallbacks'
import { startGroupRematchJob } from '@/lib/api-group-rematch-jobs'
import { getDownloadFileName, prepareDownloadTarget, readDownloadBlob, saveDownloadBlob } from '@/lib/download-utils'
import type { ApiResponse, ImageRecord } from '@/types/image'
import type {
  EmoticonEntry,
  EmoticonKeywordResult,
  GroupAutoCollectAllResult,
  GroupAutoCollectResult,
  GroupBreadcrumbItem,
  GroupBulkAddResult,
  GroupBulkRemoveResult,
  GroupDownloadType,
  GroupFileCounts,
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

function normalizeOptionalCount(value: unknown) {
  return value === null || value === undefined ? undefined : Number(value)
}

/** Normalize hierarchy records while preserving hierarchy fields. */
function normalizeGroupWithHierarchy(group: GroupWithHierarchy): GroupWithHierarchy {
  return {
    ...normalizeGroupRecord(group),
    child_count: Number(group.child_count ?? 0),
    has_children: Boolean(group.has_children),
    visible_image_count: normalizeOptionalCount(group.visible_image_count),
    total_visible_image_count: normalizeOptionalCount(group.total_visible_image_count),
  }
}

function normalizeGroupFileCounts(counts: GroupFileCounts): GroupFileCounts {
  return {
    thumbnail: Number(counts.thumbnail ?? 0),
    original: Number(counts.original ?? 0),
    video: Number(counts.video ?? 0),
  }
}

/** The whole custom group tree has one cache entry, shared by the group page and every picker. */
export const GROUPS_HIERARCHY_ALL_QUERY_KEY = ['groups-hierarchy-all', 'custom'] as const

export async function getGroupsHierarchyAll() {
  const response = await requestJson<ApiResponse<GroupWithHierarchy[]>>('/api/groups/hierarchy/all')
  if (!response.success) {
    throw createApiFallbackError(response.error, 'groups.hierarchy.load')
  }
  return response.data.map(normalizeGroupWithHierarchy)
}

export async function getGroup(groupId: number) {
  const response = await requestJson<ApiResponse<GroupRecord>>(`/api/groups/${groupId}`)
  if (!response.success) {
    throw createApiFallbackError(response.error, 'groups.detail.load')
  }
  return normalizeGroupRecord(response.data)
}

export async function getGroupBreadcrumb(groupId: number) {
  const response = await requestJson<ApiResponse<GroupBreadcrumbItem[]>>(`/api/groups/${groupId}/breadcrumb`)
  if (!response.success) {
    throw createApiFallbackError(response.error, 'groups.breadcrumb.load')
  }
  return response.data
}

export async function getGroupImages(groupId: number, params?: {
  page?: number
  limit?: number
  collectionType?: 'manual' | 'auto' | 'all'
  cursorOrderIndex?: number | null
  cursorAddedDate?: string | null
  cursorHash?: string | null
  includeChildren?: boolean
}, init?: RequestInit): Promise<GroupImagesPayload> {
  const searchParams = new URLSearchParams()
  searchParams.set('page', String(params?.page ?? 1))
  searchParams.set('limit', String(params?.limit ?? 40))
  searchParams.set('pagination', 'cursor')
  searchParams.set('include_total', params?.cursorHash ? 'false' : 'true')
  searchParams.set('include_children', String(params?.includeChildren ?? false))
  if (params?.cursorOrderIndex !== null && params?.cursorOrderIndex !== undefined) {
    searchParams.set('cursor_order_index', String(params.cursorOrderIndex))
  }
  if (params?.cursorAddedDate) {
    searchParams.set('cursor_added_date', params.cursorAddedDate)
  }
  if (params?.cursorHash) {
    searchParams.set('cursor_hash', params.cursorHash)
  }
  if (params?.collectionType && params.collectionType !== 'all') {
    searchParams.set('collection_type', params.collectionType)
  }

  const response = await requestJson<ApiResponse<GroupImagesPayload>>(`/api/groups/${groupId}/images?${searchParams.toString()}`, init)
  if (!response.success) {
    throw createApiFallbackError(response.error, 'groups.images.load')
  }
  return response.data
}

export async function createGroup(input: GroupMutationInput) {
  const response = await requestJson<ApiResponse<GroupMutationResult>>('/api/groups', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (!response.success) {
    throw createApiFallbackError(response.error, 'groups.create')
  }

  return response.data
}

export async function updateGroup(groupId: number, input: Partial<GroupMutationInput>) {
  const response = await requestJson<ApiResponse<GroupMutationMessage>>(`/api/groups/${groupId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (!response.success) {
    throw createApiFallbackError(response.error, 'groups.update')
  }

  return response.data
}

/** Delete groups in one transaction; without `cascade` their child groups move to the top level. */
export async function deleteGroups(groupIds: number[], options?: { cascade?: boolean }) {
  const response = await requestJson<ApiResponse<{ deleted: number; missing_ids: number[] }>>('/api/groups/bulk-delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ids: groupIds, cascade: options?.cascade === true }),
  })

  if (!response.success) {
    throw createApiFallbackError(response.error, 'groups.delete')
  }

  return response.data
}

/** Move groups under one parent (`null`: top level); an invalid move cancels the whole batch. */
export async function moveGroups(groupIds: number[], parentId: number | null, options: GroupMoveOptions = {}) {
  const response = await requestJson<ApiResponse<GroupMoveResult>>('/api/groups/bulk-move', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ids: groupIds, parent_id: parentId, ...options }),
  })

  if (!response.success) {
    throw createApiFallbackError(response.error, 'groups.update')
  }

  return response.data
}

export async function addImagesToGroup(groupId: number, compositeHashes: string[]) {
  const response = await requestJson<ApiResponse<GroupBulkAddResult>>(`/api/groups/${groupId}/images/bulk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ composite_hashes: compositeHashes }),
  })

  if (!response.success) {
    throw createApiFallbackError(response.error, 'groups.image.add')
  }

  return response.data
}

export async function removeImagesFromGroup(groupId: number, compositeHashes: string[]) {
  const response = await requestJson<ApiResponse<GroupBulkRemoveResult>>(`/api/groups/${groupId}/images/bulk-remove`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ composite_hashes: compositeHashes }),
  })

  if (!response.success) {
    throw createApiFallbackError(response.error, 'groups.images.remove')
  }

  return response.data
}

/** Start one group's auto-collect job (runtime job `group-auto-collect`). */
export function startGroupAutoCollect(groupId: number) {
  return startGroupRematchJob<GroupAutoCollectResult>(`/api/groups/${groupId}/auto-collect`, 'groups.autoCollect.run')
}

/** That group's queued or running auto-collect job, or null (resumes its progress when the page opens again). */
export function getLiveGroupAutoCollectJob(groupId: number) {
  return requestApiData<RuntimeJobRecord<GroupAutoCollectResult> | null>(`/api/groups/${groupId}/auto-collect`, 'groups.autoCollect.run')
}

/** Start the auto-collect job for every custom group (runtime job `all-auto-collect`). */
export function startAllGroupsAutoCollect() {
  return startGroupRematchJob<GroupAutoCollectAllResult>('/api/groups/auto-collect-all', 'groups.autoCollectAll.run')
}

export async function getGroupFileCounts(groupId: number, options?: { includeChildren?: boolean }) {
  const searchParams = new URLSearchParams({ include_children: String(options?.includeChildren ?? false) })
  const response = await requestJson<ApiResponse<GroupFileCounts>>(`/api/groups/${groupId}/file-counts?${searchParams.toString()}`)

  if (!response.success) {
    throw createApiFallbackError(response.error, 'groups.fileCounts.load')
  }

  return normalizeGroupFileCounts(response.data)
}

/** Most groups one preview request may name (the server enforces the same limit). */
export const GROUP_PREVIEW_BATCH_MAX = 100

/** Query string shared by the custom and watched-folder batch preview routes. */
export function groupPreviewBatchQuery(groupIds: number[], params: { includeChildren: boolean; count: number }) {
  return new URLSearchParams({ ids: groupIds.join(','), count: String(params.count), includeChildren: String(params.includeChildren) }).toString()
}

/** Preview images of several custom groups in one request, by group id. */
export async function getGroupsPreviewImages(groupIds: number[], params: { includeChildren: boolean; count: number }) {
  const response = await requestJson<ApiResponse<Record<string, ImageRecord[]>>>(`/api/groups/preview-images?${groupPreviewBatchQuery(groupIds, params)}`)

  if (!response.success) {
    throw createApiFallbackError(response.error, 'groups.preview.load')
  }

  return new Map(Object.entries(response.data).map(([id, images]) => [Number(id), images]))
}

export async function downloadGroupArchive(
  groupId: number,
  options: {
    type: GroupDownloadType
    compositeHashes?: string[]
    captionMode?: 'auto_tags' | 'merged'
    includeChildren?: boolean
  },
) {
  const fallbackFileName = `group-${groupId}-${options.type}.zip`
  const target = await prepareDownloadTarget(fallbackFileName)
  if (!target) {
    return { fileName: fallbackFileName }
  }

  const searchParams = new URLSearchParams()
  searchParams.set('type', options.type)
  searchParams.set('include_children', String(options.includeChildren ?? false))

  if (options.compositeHashes && options.compositeHashes.length > 0) {
    searchParams.set('hashes', JSON.stringify(options.compositeHashes))
  }

  if (options.captionMode) {
    searchParams.set('captionMode', options.captionMode)
  }

  const response = await fetch(buildApiUrl(`/api/groups/${groupId}/download?${searchParams.toString()}`), {
    headers: {
      Accept: 'application/zip',
    },
  })

  const blob = await readDownloadBlob(response)
  const fileName = getDownloadFileName(response.headers.get('Content-Disposition'), fallbackFileName)
  await saveDownloadBlob(target, blob, fileName)

  return {
    fileName,
  }
}


export const groupEmoticonsQueryKey = (groupId: number) => ['group-emoticons', groupId] as const

export async function getGroupEmoticons(groupId: number) {
  const response = await requestJson<ApiResponse<{ entries: EmoticonEntry[]; promptBudget: number }>>(`/api/groups/${groupId}/emoticons`)
  if (!response.success || !response.data) {
    throw createApiFallbackError(response.error, 'groups.images.load')
  }
  return response.data
}

/** `keywords: null` puts an image back on its file-name keyword. */
export async function setGroupEmoticonKeywords(groupId: number, items: Array<{ compositeHash: string; keywords: string[] | null }>) {
  const response = await requestJson<ApiResponse<EmoticonKeywordResult>>(`/api/groups/${groupId}/emoticons/keywords`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: items.map((item) => ({ composite_hash: item.compositeHash, keywords: item.keywords })) }),
  })
  if (!response.success || !response.data) {
    throw createApiFallbackError(response.error, 'groups.update')
  }
  return response.data
}

export async function addGroupEmoticons(groupId: number, items: Array<{ compositeHash: string; keywords?: string[] }>) {
  const response = await requestJson<ApiResponse<{ added: number; missing: string[]; conflicts: EmoticonKeywordResult['conflicts'] }>>(`/api/groups/${groupId}/emoticons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: items.map((item) => ({ composite_hash: item.compositeHash, keywords: item.keywords })) }),
  })
  if (!response.success || !response.data) {
    throw createApiFallbackError(response.error, 'groups.image.add')
  }
  return response.data
}
