export type PluginDraftSummary = {
  id: string
  pluginId: string
  name: string
  revision: number
  baseDigest: string | null
  updatedAt: string
}

export type PluginDraft = PluginDraftSummary & {
  files: Array<{ name: string; size: number; editable: boolean }>
}

export type PluginDraftFile = { name: string; text: string; revision: number; nextOffset: number | null; size: number }

export type PluginPackageReview = {
  draftId: string
  revision: number
  pluginId: string
  name: string
  version: string
  digest: string
  baseDigest: string | null
  updated: boolean
  enabled: boolean
  /** The installed package the review compared against (null: not installed); installation requires it unchanged. */
  installedDigest: string | null
  /** How that installation relates to the draft's base: changed elsewhere, or removed since the draft was based on it. */
  conflict: 'none' | 'changed' | 'removed'
  server: boolean
  size: number
  files: Array<{ name: string; size: number; change: 'added' | 'changed' | 'unchanged' | 'removed' }>
}
