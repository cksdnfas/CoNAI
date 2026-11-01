import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query'
import { emptyCharacterAppearanceSections } from '@conai/shared'
import {
  CHARACTER_FOLDERS_QUERY_KEY,
  characterFacetsQueryKey,
  characterSettingsQueryKey,
  getCharacterLibraryFacets,
  invalidateCharacterLibrary,
  listCharacterFolders,
  listCharacterSettings,
  type CharacterAppearanceSections,
  type CharacterAvatarCrop,
  type CharacterOutfit,
  type CharacterSetting,
  type CharacterSettingScope,
} from '@/lib/api-character-library'
import { buildApiUrl } from '@/lib/api-url'
import { libraryThumbnailUrl } from '@/lib/api-sprite'

/**
 * The editable fields of one appearance setting (what a save sends). The look is its sections and outfits; the text
 * profiles and generation read is `composeCharacterAppearance(draft)`.
 */
export type SettingDraft = {
  name: string
  folderId: number | null
  sections: CharacterAppearanceSections
  outfits: CharacterOutfit[]
  referenceHash: string | null
  avatarHash: string | null
  avatarCrop: CharacterAvatarCrop | null
}
export const SETTING_DRAFT_KEYS = ['name', 'folderId', 'sections', 'outfits', 'referenceHash', 'avatarHash', 'avatarCrop'] as const satisfies ReadonlyArray<keyof SettingDraft>

export function emptySettingDraft(folderId: number | null): SettingDraft {
  return { name: '', folderId, sections: emptyCharacterAppearanceSections(), outfits: [], referenceHash: null, avatarHash: null, avatarCrop: null }
}
export function settingDraftOf(setting: CharacterSetting): SettingDraft {
  return { name: setting.name, folderId: setting.folderId, sections: setting.sections, outfits: setting.outfits, referenceHash: setting.referenceHash, avatarHash: setting.avatarHash, avatarCrop: setting.avatarCrop }
}

export { folderPath, folderSubtreeIds, sortFoldersByName, type LibraryFolder } from '@conai/shared'

/** Library originals for unsaved or full-size views; thumbnails for lists. */
export const characterImageUrl = (hash: string) => buildApiUrl(`/api/images/${encodeURIComponent(hash)}/file`)
export const characterThumbnailUrl = libraryThumbnailUrl

/** Every folder of the library (one small list; the tree, paths and pickers read it). */
export function useCharacterFolders(enabled = true) {
  return useQuery({ queryKey: CHARACTER_FOLDERS_QUERY_KEY, queryFn: ({ signal }) => listCharacterFolders(signal), enabled })
}

/** One page of settings; the previous page stays on screen while the next one loads. */
export function useCharacterSettingsPage(scope: CharacterSettingScope, enabled = true) {
  return useQuery({ queryKey: characterSettingsQueryKey(scope), queryFn: ({ signal }) => listCharacterSettings(scope, signal), placeholderData: keepPreviousData, enabled })
}

/** The filter dimensions of a scope with their counts (the previous ones stay while a new selection recounts). */
export function useCharacterFacets(scope: Omit<CharacterSettingScope, 'offset' | 'limit' | 'sort'>, enabled = true) {
  return useQuery({ queryKey: characterFacetsQueryKey(scope), queryFn: ({ signal }) => getCharacterLibraryFacets(scope, signal), placeholderData: keepPreviousData, enabled })
}

/** Refresh the views a local change touched right away (the runtime event repeats it for other tabs). */
export function refreshCharacterViews(queryClient: QueryClient, change: { folderIds: Array<number | null>; settingIds: number[]; foldersChanged?: boolean }) {
  const folderIds = new Set(change.folderIds.filter((id): id is number => id !== null))
  if (change.foldersChanged) void queryClient.invalidateQueries({ queryKey: CHARACTER_FOLDERS_QUERY_KEY })
  return invalidateCharacterLibrary(queryClient, { folderIds, settingIds: new Set(change.settingIds) })
}
