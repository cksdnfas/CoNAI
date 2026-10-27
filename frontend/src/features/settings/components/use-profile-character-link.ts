import { useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ChatProfileCharacterLinkInput } from '@conai/shared'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { refreshCharacterViews } from '@/features/characters/character-library-shared'
import { useCharacterSettingEditor } from '@/features/characters/use-character-setting-editor'
import { useCharacterSettingRuns } from '@/features/characters/use-character-setting-runs'
import {
  characterSettingQueryKey,
  createCharacterSettingFromProfile,
  getCharacterSetting,
  type CharacterSetting,
} from '@/lib/api-character-library'
import { CHAT_ADMIN_PROFILES_QUERY_KEY, CHAT_PROFILE_SYNCED_KEYS, emoticonGroupsAfterServerChange, listChatAdminProfiles, type ChatProfile } from '@/lib/api-codex-chat'
import { settingDraftOf } from '@/features/characters/character-library-shared'
import type { Draft } from './chat-profile-editor-fields'

/** Where a profile's look goes into the library: a new setting, or over the setting it is detached from. */
export type CharacterLibraryStore = { mode: 'create'; folderId: number | null; name: string } | { mode: 'overwrite' }

/**
 * A chat profile's link to a character library setting. No link: the profile keeps its own look. Synced: the
 * appearance tab edits the setting (its draft, generation and expressions), stored before the profile on save, and
 * every synced profile changes with it. Detached: the profile's own copy, remembering its origin.
 */
export function useProfileCharacterLink({ open, profile, draft, setDraft, setProfile, ensureProfile }: {
  open: boolean
  profile: ChatProfile | null
  draft: Draft
  setDraft: (update: (current: Draft) => Draft) => void
  setProfile: (profile: ChatProfile) => void
  /** Saves the profile (a new one is created) before the library stores its look. */
  ensureProfile: () => Promise<ChatProfile>
}) {
  const queryClient = useQueryClient()
  const permissions = useFeaturePermissions()
  const canView = permissions.has('characters.view')
  const canEdit = permissions.has('characters.edit')
  const draftRef = useRef(draft)
  draftRef.current = draft
  const link = draft.characterLink
  const synced = Boolean(link?.synced)
  const setting = useCharacterSettingEditor({
    target: open && canView && link?.synced ? { settingId: link.settingId } : null,
    onCreated: () => {},
    onClose: () => {},
  })
  const generation = permissions.isAdmin && canEdit
  const runs = useCharacterSettingRuns(setting, generation)
  // A detached link's origin (and a synced one before the editor has it), for the banner and an overwrite's revision.
  const originQuery = useQuery({
    queryKey: characterSettingQueryKey(link?.settingId ?? 0),
    queryFn: ({ signal }) => getCharacterSetting(link!.settingId, signal),
    enabled: open && canView && link != null,
  })
  const origin: CharacterSetting | null = (synced ? setting.base : null) ?? (originQuery.data?.id === link?.settingId ? originQuery.data ?? null : null)
  const savedLink = profile?.characterLink?.settingId === link?.settingId ? profile?.characterLink ?? null : null
  // The other synced profiles a change of the setting reaches (this one may still be stored as synced).
  const otherSyncedProfiles = (origin?.linkedProfiles ?? []).filter((entry) => entry.id !== profile?.id)
  // Synced profiles that a change of the setting reaches: this one counts before its link is saved.
  const linkedCount = origin ? origin.linkedProfileCount + (synced && !origin.linkedProfiles.some((entry) => entry.id === profile?.id) ? 1 : 0) : savedLink?.linkedProfileCount ?? null
  // A link not read from the server (a proposal's) may lack its name and path.
  const label = origin ? [...origin.path, origin.name].join(' / ') : savedLink ? [...(savedLink.path ?? []), savedLink.settingName ?? `#${savedLink.settingId}`].join(' / ') : null
  // The profile's own look differs from the stored one (unsaved edits a link to a setting would hide).
  const lookOf = (source: Partial<Pick<Draft, (typeof CHAT_PROFILE_SYNCED_KEYS)[number]>> | null) => JSON.stringify(CHAT_PROFILE_SYNCED_KEYS.map((key) => (key === 'appearance' ? source?.appearance || null : source?.[key] ?? null)))
  const ownLookDirty = !synced && lookOf(draft) !== lookOf(profile)

  /**
   * The draft change that sets the link. Leaving a synced setting copies its current look into the profile's own
   * fields; detaching onto another setting (`target`, read first) copies that setting's stored look, the own copy of
   * it. Reads the latest draft and setting, so it holds after an awaited read.
   */
  const linkPatch = (next: ChatProfileCharacterLinkInput, target?: CharacterSetting | null): Partial<Draft> => {
    const current = draftRef.current.characterLink
    const copyOf = (value: Pick<Draft, 'appearance' | 'referenceHash' | 'avatarHash' | 'avatarCrop'>): Partial<Draft> => ({ appearance: value.appearance, referenceHash: value.referenceHash, avatarHash: value.avatarHash, avatarCrop: value.avatarCrop, avatar: null })
    if (next && !next.synced && next.settingId !== current?.settingId && target?.id === next.settingId) {
      return { ...copyOf(settingDraftOf(target)), characterLink: next }
    }
    const leaving = Boolean(current?.synced) && setting.baseRef.current?.id === current?.settingId && !(next?.synced && next.settingId === current?.settingId)
    return { ...(leaving ? copyOf(setting.draftRef.current) : {}), characterLink: next }
  }
  const setLink = (next: ChatProfileCharacterLinkInput, values?: Partial<Draft>) => {
    const change = { ...linkPatch(next), ...values }
    setDraft((current) => ({ ...current, ...change }))
  }

  /** Store the profile's current look in the library and leave the profile synced to the result. */
  const store = async (target: CharacterLibraryStore) => {
    // Read before a new profile's first save resets the draft to what was stored.
    const values = draftRef.current
    const look = { appearance: values.appearance ?? '', referenceHash: values.referenceHash ?? null, avatarHash: values.avatarHash ?? null, avatarCrop: values.avatarCrop ?? null }
    if (target.mode === 'overwrite' && (!link || !origin)) throw new Error('원본 외형 설정을 아직 불러오지 못했어.')
    const saved = await ensureProfile()
    const result = await createCharacterSettingFromProfile(target.mode === 'create'
      ? { profileId: saved.id, ...look, mode: 'create', folderId: target.folderId, name: target.name.trim() }
      : { profileId: saved.id, ...look, mode: 'overwrite', settingId: link!.settingId, revision: origin!.revision })
    queryClient.setQueryData(characterSettingQueryKey(result.id), result)
    void refreshCharacterViews(queryClient, { folderIds: [result.folderId], settingIds: [result.id] })
    // The server has synced the profile: the draft says so at once, whatever the refresh below does.
    setDraft((current) => ({ ...current, characterLink: { settingId: result.id, synced: true } }))
    try {
      const profiles = await listChatAdminProfiles()
      queryClient.setQueryData(CHAT_ADMIN_PROFILES_QUERY_KEY, profiles)
      const fresh = profiles.find((entry) => entry.id === saved.id)
      if (fresh) {
        setProfile(fresh)
        // The draft follows the stored look, so the stored profile reads as unchanged there.
        setDraft((current) => ({ ...current, appearance: fresh.appearance, referenceHash: fresh.referenceHash, avatarHash: fresh.avatarHash, avatarCrop: fresh.avatarCrop, avatar: fresh.avatar, style: { ...current.style, emoticonGroupIds: emoticonGroupsAfterServerChange(saved.style.emoticonGroupIds, fresh.style.emoticonGroupIds, current.style.emoticonGroupIds) } }))
      }
    } catch {
      // Best effort: the profile list refreshes on its own later; the link above already holds.
    }
    return result
  }

  return {
    canView,
    canEdit,
    generation,
    link,
    synced,
    /** The synced setting's editor (its draft is what the appearance tab shows and a save stores first). */
    setting,
    runs,
    origin,
    originError: originQuery.isError ? originQuery.error : null,
    /** `path / name` of the linked setting, once known. */
    label,
    linkedCount,
    /** Synced profiles of the linked setting other than this one (an overwrite changes them). */
    otherSyncedProfiles,
    /** Not synced, and the profile's own look has unsaved edits. */
    ownLookDirty,
    /** Link to a picked setting, synced (the tab shows it at once). */
    load: (picked: CharacterSetting) => {
      queryClient.setQueryData(characterSettingQueryKey(picked.id), picked)
      setLink({ settingId: picked.id, synced: true })
    },
    /** Keep a copy of the setting's current look as the profile's own. */
    detach: () => { if (link) setLink({ settingId: link.settingId, synced: false }) },
    /** Back to the origin, synced; the profile's own look goes back to what is stored. */
    revert: () => {
      if (!link) return
      setLink({ settingId: link.settingId, synced: true }, profile ? Object.fromEntries(CHAT_PROFILE_SYNCED_KEYS.map((key) => [key, profile[key]])) as Partial<Draft> : undefined)
    },
    linkPatch,
    /** Read a setting about to be linked (it must exist; the tab then shows it at once). */
    prime: (settingId: number) => queryClient.fetchQuery({ queryKey: characterSettingQueryKey(settingId), queryFn: ({ signal }) => getCharacterSetting(settingId, signal), staleTime: 0 }),
    store,
    /** Before a profile save: store the synced setting's changed fields (revision checked; a conflict keeps the drafts). */
    beforeSave: async () => { if (synced && setting.ready && setting.dirty) await setting.commit() },
    dirty: synced && setting.dirty,
  }
}

export type ProfileCharacterLink = ReturnType<typeof useProfileCharacterLink>
