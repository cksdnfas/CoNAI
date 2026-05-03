export type DanbooruBrowserSection = 'tags' | 'artists' | 'characters'
export type DanbooruBrowserRelatedTagCategory = 'general' | 'artist' | 'copyright' | 'character' | 'meta'

export interface DanbooruBrowserTreeNode {
  id: string
  label: string
  translatedLabel?: string | null
  parentId: string | null
  section: DanbooruBrowserSection
  count: number
  directCount?: number
  filter?: {
    categoryCode?: number
    taxonomyNodeId?: number
    copyrightTagId?: number
  }
}

export interface DanbooruBrowserPagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface DanbooruBrowserDatabaseInfo {
  available: boolean
  path: string
  expectedPath: string
  expectedDirectory: string
  downloadUrl: string
  filePatterns: string[]
  matchedBy: 'configured' | 'default' | 'discovered' | 'missing'
}

export interface DanbooruBrowserSummary {
  dbPath: string
  database: DanbooruBrowserDatabaseInfo
  counts: {
    tags: number
    artists: number
    characters: number
  }
  tree: DanbooruBrowserTreeNode[]
}

export interface DanbooruBrowserTagRecord {
  id: number
  name: string
  displayName: string
  translatedName?: string | null
  normalizedName: string
  usageCount: number
}

export interface DanbooruBrowserArtistRecord {
  tagId: number
  name: string
  displayName: string
  normalizedName: string
  worksCount: number
  danbooruUrl: string
}

export interface DanbooruBrowserRelatedTagRecord {
  id: number
  name: string
  displayName: string
  translatedName?: string | null
  categoryName: string
  usageCount: number
  score: number | null
}

export interface DanbooruBrowserCopyrightRecord {
  tagId: number
  name: string
  displayName: string
  confidence: number
  isPrimary: boolean
}

export interface DanbooruBrowserCharacterImageRecord {
  fileName: string
  url: string
}

export interface DanbooruBrowserCharacterRecord {
  tagId: number
  name: string
  displayName: string
  normalizedName: string
  worksCount: number
  copyrights: DanbooruBrowserCopyrightRecord[]
  relatedTags: DanbooruBrowserRelatedTagRecord[]
  images: DanbooruBrowserCharacterImageRecord[]
  danbooruUrl: string
}

export interface DanbooruBrowserListPayload<T> {
  items: T[]
  pagination: DanbooruBrowserPagination
}
