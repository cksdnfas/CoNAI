import {
  getAutoFolderGroup,
  getAutoFolderGroupBreadcrumb,
  getAutoFolderGroupImages,
  getAutoFolderGroupPreviewImages,
  getAutoFolderGroupsHierarchyAll,
} from '@/lib/api-auto-folder-groups'
import {
  getGroup,
  getGroupBreadcrumb,
  getGroupImages,
  getGroupPreviewImages,
  getGroupsHierarchyAll,
} from '@/lib/api-groups'
import type { GroupBreadcrumbItem, GroupFileCounts, GroupRecord, GroupWithHierarchy } from '@/types/group'
import type { ImageRecord } from '@/types/image'

export const groupSources = {
  custom: {
    key: 'custom',
    getAllGroups: getGroupsHierarchyAll,
    getGroup,
    getBreadcrumb: getGroupBreadcrumb,
    getImages: getGroupImages,
    getPreviewImages: getGroupPreviewImages,
  },
  folders: {
    key: 'folders',
    getAllGroups: getAutoFolderGroupsHierarchyAll,
    getGroup: getAutoFolderGroup,
    getBreadcrumb: getAutoFolderGroupBreadcrumb,
    getImages: getAutoFolderGroupImages,
    getPreviewImages: getAutoFolderGroupPreviewImages,
  },
} as const

export type GroupSourceKey = keyof typeof groupSources
export type GroupSourceDefinition = (typeof groupSources)[GroupSourceKey]

export type GroupEditorState =
  | {
    mode: 'create'
    defaultParentId: number | null
  }
  | {
    mode: 'edit'
    group: GroupRecord
  }

/** Normalize the current tab query value to one supported group source key. */
export function normalizeGroupSourceKey(value: string | null): GroupSourceKey {
  return value === 'folders' ? 'folders' : 'custom'
}

/** Build an empty download-count record for group archive actions. */
export function createEmptyGroupFileCounts(): GroupFileCounts {
  return {
    thumbnail: 0,
    original: 0,
    video: 0,
  }
}

/** Build the selected group path from the already-loaded hierarchy. */
export function buildGroupPathItems(groups: GroupWithHierarchy[], selectedGroupId: number | undefined): GroupBreadcrumbItem[] {
  if (!Number.isFinite(selectedGroupId)) {
    return []
  }

  const groupsById = new Map(groups.map((group) => [group.id, group]))
  const path: GroupBreadcrumbItem[] = []
  let current = groupsById.get(selectedGroupId!)

  while (current) {
    path.unshift({ id: current.id, name: current.name })
    current = current.parent_id == null ? undefined : groupsById.get(current.parent_id)
  }

  return path
}

/** Calculate downloadable original/thumbnail/video counts from one image list. */
export function getDownloadCountsFromImages(images: ImageRecord[]): GroupFileCounts {
  const counts = createEmptyGroupFileCounts()

  for (const image of images) {
    if (image.thumbnail_url) {
      counts.thumbnail += 1
    }

    const ext = image.original_file_path?.split('.').pop()?.toLowerCase() ?? ''
    const isVideoOrAnimated = image.file_type === 'video' || image.file_type === 'animated' || ['gif', 'mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)

    if (isVideoOrAnimated) {
      counts.video += 1
      continue
    }

    if (image.original_file_path || image.thumbnail_url) {
      counts.original += 1
    }
  }

  return counts
}

/** Number of auto-collect conditions stored on a group (flat list or and/or/exclude groups). */
export function countAutoCollectConditions(rawConditions: string | null | undefined): number {
  if (!rawConditions?.trim()) {
    return 0
  }

  try {
    const parsed: unknown = JSON.parse(rawConditions)
    if (Array.isArray(parsed)) {
      return parsed.length
    }
    if (parsed && typeof parsed === 'object') {
      const groups = parsed as Record<string, unknown>
      return ['and_group', 'or_group', 'exclude_group'].reduce(
        (sum, key) => sum + (Array.isArray(groups[key]) ? (groups[key] as unknown[]).length : 0),
        0,
      )
    }
  } catch {
    return 0
  }

  return 0
}
