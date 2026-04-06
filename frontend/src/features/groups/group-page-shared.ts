import {
  getAutoFolderGroup,
  getAutoFolderGroupBreadcrumb,
  getAutoFolderGroupImages,
  getAutoFolderGroupPreviewImage,
  getAutoFolderGroupsHierarchyAll,
  getGroup,
  getGroupBreadcrumb,
  getGroupImages,
  getGroupPreviewImage,
  getGroupsHierarchyAll,
} from '@/lib/api'
import type { GroupFileCounts, GroupRecord } from '@/types/group'
import type { ImageRecord } from '@/types/image'
import type { GroupExplorerCardStyle } from '@/types/settings'

export const groupSources = {
  custom: {
    key: 'custom',
    tabLabel: '커스텀 그룹',
    rootTitle: '사용자 커스텀 그룹',
    rootSectionTitle: '루트 그룹',
    getAllGroups: getGroupsHierarchyAll,
    getGroup,
    getBreadcrumb: getGroupBreadcrumb,
    getImages: getGroupImages,
    getPreviewImage: getGroupPreviewImage,
  },
  folders: {
    key: 'folders',
    tabLabel: '감시폴더 그룹',
    rootTitle: '감시폴더 그룹',
    rootSectionTitle: '감시폴더 루트',
    getAllGroups: getAutoFolderGroupsHierarchyAll,
    getGroup: getAutoFolderGroup,
    getBreadcrumb: getAutoFolderGroupBreadcrumb,
    getImages: getAutoFolderGroupImages,
    getPreviewImage: getAutoFolderGroupPreviewImage,
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

/** Read the current group's collection type from the enriched image payload. */
export function getImageCollectionType(image: ImageRecord) {
  return image.groups?.[0]?.collection_type ?? 'manual'
}

/** Format a backend timestamp into a compact Korean label for group metadata. */
export function formatGroupTimestamp(value?: string | null) {
  if (!value) {
    return '아직 없음'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString('ko-KR')
}

/** Build an empty download-count record for group archive actions. */
export function createEmptyGroupFileCounts(): GroupFileCounts {
  return {
    thumbnail: 0,
    original: 0,
    video: 0,
  }
}

/** Resolve the group-navigation grid layout for the selected card style. */
export function getGroupCardGridClassName(cardStyle: GroupExplorerCardStyle) {
  return cardStyle === 'media-tile'
    ? 'grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'
    : 'grid gap-4 md:grid-cols-2 xl:grid-cols-3'
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
