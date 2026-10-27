import type { QueryClient } from '@tanstack/react-query'
import type {
  CharacterAppearanceDraftInput,
  CharacterFolder,
  CharacterFolderCreateInput,
  CharacterFolderPatch,
  CharacterLibraryDeletePreview,
  CharacterLibraryDeleteResult,
  CharacterSetting,
  CharacterSettingCreateInput,
  CharacterSettingFromProfileInput,
  CharacterSettingPage,
  CharacterSettingPatch,
  ChatAssetApplyResult,
} from '@conai/shared'
import { ApiRequestError, requestApiData } from '@/lib/api-request'
import { chatAssetBatchQueryKey, chatAssetCandidatesQueryKey } from '@/lib/api-codex-chat'
import { groupEmoticonsQueryKey } from '@/lib/api-groups'

export type {
  CharacterAvatarCrop,
  CharacterFolder,
  CharacterLibraryDeletePreview,
  CharacterSetting,
  CharacterSettingCreateInput,
  CharacterSettingPage,
  CharacterSettingPatch,
  CharacterSettingSummary,
} from '@conai/shared'

const BASE = '/api/character-library'
const JSON_HEADERS = { 'Content-Type': 'application/json' }

/** A settings list scope: one folder's direct settings, the top level, or a search across the whole library. */
export type CharacterSettingScope = { folder: number | 'root' | 'all'; query: string; offset: number; limit: number }
export const CHARACTER_SETTINGS_PAGE_SIZE = 60

export const CHARACTER_LIBRARY_QUERY_KEY = 'character-library'
export const CHARACTER_FOLDERS_QUERY_KEY = [CHARACTER_LIBRARY_QUERY_KEY, 'folders'] as const
export const characterSettingsQueryKey = (scope: CharacterSettingScope) => [CHARACTER_LIBRARY_QUERY_KEY, 'settings', scope.folder, scope.query, scope.offset, scope.limit] as const
export const characterSettingQueryKey = (settingId: number) => [CHARACTER_LIBRARY_QUERY_KEY, 'setting', settingId] as const

export function listCharacterFolders(signal?: AbortSignal) {
  return requestApiData<CharacterFolder[]>(`${BASE}/folders`, { signal })
}
export function createCharacterFolder(input: CharacterFolderCreateInput) {
  return requestApiData<CharacterFolder>(`${BASE}/folders`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}
export function updateCharacterFolder(folderId: number, patch: CharacterFolderPatch) {
  return requestApiData<CharacterFolder>(`${BASE}/folders/${folderId}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}
export function getCharacterFolderDeletePreview(folderId: number) {
  return requestApiData<CharacterLibraryDeletePreview>(`${BASE}/folders/${folderId}/delete-preview`)
}
/** Removes the folder, its subfolders and every setting in them. */
export function deleteCharacterFolder(folderId: number) {
  return requestApiData<CharacterLibraryDeleteResult>(`${BASE}/folders/${folderId}`, { method: 'DELETE' })
}

export function listCharacterSettings(scope: CharacterSettingScope, signal?: AbortSignal) {
  const params = new URLSearchParams({ limit: String(scope.limit), offset: String(scope.offset) })
  if (scope.folder !== 'all') params.set('folderId', String(scope.folder))
  if (scope.query) params.set('query', scope.query)
  return requestApiData<CharacterSettingPage>(`${BASE}/settings?${params.toString()}`, { signal })
}
export function getCharacterSetting(settingId: number, signal?: AbortSignal) {
  return requestApiData<CharacterSetting>(`${BASE}/settings/${settingId}`, { signal, cache: 'no-store' })
}
export function createCharacterSetting(input: CharacterSettingCreateInput) {
  return requestApiData<CharacterSetting>(`${BASE}/settings`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}
/** Refused with 409 when `revision` is not the stored one (see `isCharacterRevisionConflict`). */
export function updateCharacterSetting(settingId: number, patch: CharacterSettingPatch) {
  return requestApiData<CharacterSetting>(`${BASE}/settings/${settingId}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}
export function getCharacterSettingDeletePreview(settingId: number) {
  return requestApiData<CharacterLibraryDeletePreview>(`${BASE}/settings/${settingId}/delete-preview`)
}
/** With `revision`, refused with 409 when the setting changed since it was read. */
export function deleteCharacterSetting(settingId: number, revision?: number) {
  return requestApiData<CharacterLibraryDeleteResult>(`${BASE}/settings/${settingId}${revision === undefined ? '' : `?revision=${revision}`}`, { method: 'DELETE' })
}
/**
 * Store a saved profile's look (the editor's current values) in the library, as a new setting or over the one it is
 * detached from (`revision` checked, 409 when stale); the profile is synced to it afterwards.
 */
export function createCharacterSettingFromProfile(input: CharacterSettingFromProfileInput) {
  return requestApiData<CharacterSetting>(`${BASE}/settings/from-profile`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}
/** Unsaved appearance tags from the name and reference image (administrators). */
export function draftCharacterAppearance(input: CharacterAppearanceDraftInput, signal?: AbortSignal) {
  return requestApiData<{ appearance: string }>(`${BASE}/settings/appearance-draft`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input), signal }, { timeoutMs: 120000 })
}

/** The setting changed since it was read (stale `revision`); other 409s (a taken name) carry their own message. */
export function isCharacterRevisionConflict(error: unknown) {
  return error instanceof ApiRequestError && error.status === 409 && error.code === 'revision_conflict'
}

/** After an asset of the setting was applied: re-read the setting (new fields and revision) and the groups it touched. */
export async function refreshCharacterSettingAssets(queryClient: QueryClient, settingId: number, results: Array<Pick<ChatAssetApplyResult['applied'], 'expressionGroupId'>>, batchId?: number) {
  const setting = await getCharacterSetting(settingId)
  queryClient.setQueryData(characterSettingQueryKey(settingId), setting)
  const expressionGroups = [...new Set(results.flatMap((result) => result.expressionGroupId ? [result.expressionGroupId] : []))]
  await Promise.all([
    ...(batchId === undefined ? [] : [queryClient.invalidateQueries({ queryKey: chatAssetBatchQueryKey({ kind: 'setting', id: settingId }, batchId) })]),
    ...(setting.candidateGroupId ? [queryClient.invalidateQueries({ queryKey: chatAssetCandidatesQueryKey(setting.candidateGroupId) })] : []),
    ...expressionGroups.map((id) => queryClient.invalidateQueries({ queryKey: groupEmoticonsQueryKey(id) })),
  ])
  return setting
}

/**
 * `characters.changed`: refetch only the active views holding those folders or settings. The folder list carries the
 * per-folder counts; a settings page refetches when it lists its folder or one of the settings, and the top-level and
 * search pages whenever any setting changed (a new one may belong there).
 */
export function invalidateCharacterLibrary(queryClient: QueryClient, change: { folderIds: ReadonlySet<number>; settingIds: ReadonlySet<number> }) {
  for (const settingId of change.settingIds) {
    const setting = queryClient.getQueryData<CharacterSetting>(characterSettingQueryKey(settingId))
    if (setting?.expressionGroupId) void queryClient.invalidateQueries({ queryKey: groupEmoticonsQueryKey(setting.expressionGroupId), refetchType: 'active' })
    if (setting?.candidateGroupId) void queryClient.invalidateQueries({ queryKey: chatAssetCandidatesQueryKey(setting.candidateGroupId), refetchType: 'active' })
  }
  return queryClient.invalidateQueries({
    queryKey: [CHARACTER_LIBRARY_QUERY_KEY],
    refetchType: 'active',
    predicate: ({ queryKey, state }) => {
      if (queryKey[1] === 'folders') return change.folderIds.size > 0
      if (queryKey[1] === 'setting') return change.settingIds.has(Number(queryKey[2]))
      if (queryKey[1] !== 'settings') return false
      const folder = queryKey[2]
      if (typeof folder === 'number' && change.folderIds.has(folder)) return true
      if ((state.data as CharacterSettingPage | undefined)?.items.some((item) => change.settingIds.has(item.id))) return true
      return change.settingIds.size > 0 && (folder === 'root' || folder === 'all')
    },
  })
}
