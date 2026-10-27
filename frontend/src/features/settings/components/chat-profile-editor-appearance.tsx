import { useQuery } from '@tanstack/react-query'
import { ChatProfileAvatar } from '@/features/codex-chat/chat-profile-avatar'
import { useI18n } from '@/i18n'
import { CHAT_GENERATION_PRESETS_QUERY_KEY, clearChatProfileExpression, draftChatAppearance, listChatGenerationPresets, sameCharacterLink, setChatProfileExpression, type ChatProfile } from '@/lib/api-codex-chat'
import { ErrorState } from '@/components/ui/error-state'
import { LoadingState } from '@/components/ui/loading-state'
import { CharacterSettingAppearanceEditor } from '@/features/characters/components/character-setting-appearance'
import { characterSettingQueryKey, getCharacterSetting } from '@/lib/api-character-library'
import { CharacterAppearanceEditor } from './character-appearance-editor'
import { type AssetRuns } from './chat-profile-asset-runs'
import type { CharacterGroupSource } from './chat-profile-asset-slots'
import { ChatProfileCharacterLinkBar } from './chat-profile-character-link'
import type { ProfileCharacterLink } from './use-profile-character-link'
import { type Draft, type PatchDraft } from './chat-profile-editor-fields'
import { ChatEmoticonGroupPicker } from './chat-profile-emoticons'
import { draftProfileAssetUrl } from './chat-profile-images'

/**
 * Everything the character looks like: the reference image, the avatar cut from it, the appearance text, and the
 * expression slots generated from them (the character's emoticons), plus other emoticon groups its chats may use.
 */
export function ChatProfileAppearancePanel({ draft, patch, profile, dirty, onBusyChange, busy, runs, ensureProfile, onProfileChange, link }: {
  draft: Draft
  patch: PatchDraft
  profile: ChatProfile | null
  /** Unsaved edits in the editor (the profile's or the synced setting's). */
  dirty: boolean
  onBusyChange: (busy: boolean) => void
  busy: boolean
  runs: AssetRuns
  /** Saves name, appearance and reference (creating a new profile) before anything is generated or linked. */
  ensureProfile: () => Promise<ChatProfile>
  onProfileChange: (profile: ChatProfile) => void
  /** The library link: while synced the look shown and edited here is the setting's. */
  link: ProfileCharacterLink
}) {
  const bar = link.canView ? <ChatProfileCharacterLinkBar link={link} profileName={draft.name} dirty={dirty} busy={busy} onBusyChange={onBusyChange} /> : null
  return (
    <div className="space-y-5">
      {bar}
      {link.synced && link.canView ? <SyncedAppearance link={link} draft={draft} patch={patch} busy={busy} onBusyChange={onBusyChange} /> : (
        <OwnAppearance draft={draft} patch={patch} profile={profile} onBusyChange={onBusyChange} busy={busy} runs={runs} ensureProfile={ensureProfile} onProfileChange={onProfileChange} link={link} />
      )}
    </div>
  )
}

/** An `after` preset's prompt writer sees only the appearance text of the character (not the system prompt or sections). */
function useAppearanceWarning(draft: Draft, appearance: string | undefined) {
  const { t } = useI18n()
  const generationPresetsQuery = useQuery({ queryKey: CHAT_GENERATION_PRESETS_QUERY_KEY, queryFn: listChatGenerationPresets, enabled: draft.mcpEnabled && draft.generationPresetIds.length > 0 })
  const missing = draft.mcpEnabled && !appearance?.trim()
    && (generationPresetsQuery.data ?? []).some((preset) => draft.generationPresetIds.includes(preset.id) && preset.prompting.timing === 'after')
  return missing ? t({ ko: '답변 끝난 뒤 이미지는 여기만 보고 캐릭터를 그려. ✨로 초안을 써줘.', en: 'After-reply pictures draw the character from this text alone. Draft it with ✨.' }) : null
}

/** Other emoticon groups the profile's chats may use (a profile field in every link state). */
function EmoticonGroupsRow({ draft, patch }: { draft: Draft; patch: PatchDraft }) {
  const { t } = useI18n()
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3">
      <span className="shrink-0 text-sm">{t({ ko: '이모티콘 그룹', en: 'Emoticon groups' })}</span>
      <div className="min-w-0 flex-1"><ChatEmoticonGroupPicker selected={draft.style.emoticonGroupIds} onChange={(emoticonGroupIds) => patch({ style: { ...draft.style, emoticonGroupIds } })} /></div>
    </div>
  )
}

/** Synced: the linked setting's look, edited as the setting's draft (stored before the profile on save). */
function SyncedAppearance({ link, draft, patch, busy, onBusyChange }: { link: ProfileCharacterLink; draft: Draft; patch: PatchDraft; busy: boolean; onBusyChange: (busy: boolean) => void }) {
  const { t } = useI18n()
  const { setting } = link
  const appearanceWarning = useAppearanceWarning(draft, setting.draft.appearance)
  if (setting.loading || !setting.ready) return setting.error
    ? <ErrorState title={t({ ko: '외형 설정을 불러오지 못했어', en: 'Could not load the setting' })} error={setting.error} onRetry={setting.retry} />
    : <LoadingState variant="inline" />
  return (
    <CharacterSettingAppearanceEditor editor={setting} runs={link.runs} editable={link.canEdit} generation={link.generation} busy={busy} onBusyChange={onBusyChange} appearanceWarning={appearanceWarning}>
      <EmoticonGroupsRow draft={draft} patch={patch} />
    </CharacterSettingAppearanceEditor>
  )
}

/**
 * No link or detached: the profile's own look, as before the library. Synced but the library hidden: shown read-only.
 * The expression slots show the group the profile has once saved: while the look is (or until saved, was) a library
 * setting's, that setting's expression group, read-only (a note when it cannot be read or has none yet); else the
 * profile's own.
 */
function OwnAppearance({ draft, patch, profile, onBusyChange, busy, runs, ensureProfile, onProfileChange, link }: {
  draft: Draft
  patch: PatchDraft
  profile: ChatProfile | null
  onBusyChange: (busy: boolean) => void
  busy: boolean
  runs: AssetRuns
  ensureProfile: () => Promise<ChatProfile>
  onProfileChange: (profile: ChatProfile) => void
  link: ProfileCharacterLink
}) {
  const { t } = useI18n()
  const readOnly = link.synced
  const referenceUrl = draftProfileAssetUrl(draft, profile, 'reference')
  const avatarUrl = draftProfileAssetUrl(draft, profile, 'avatar')
  const characterName = profile?.name ?? draft.name
  const appearanceWarning = useAppearanceWarning(draft, draft.appearance)
  const storedLink = profile?.characterLink ?? null
  const linkPending = !sameCharacterLink(draft.characterLink, storedLink)
  // The library setting whose expressions the profile has (synced) or gets once saved (detached or unlinked: the
  // server copies them); null: the profile's own group.
  const expressionSettingId = linkPending && draft.characterLink && !draft.characterLink.synced ? draft.characterLink.settingId
    : storedLink?.synced ? storedLink.settingId
      : link.synced ? draft.characterLink?.settingId ?? null : null
  // Shares the link's origin read (same key) when it is that setting.
  const expressionSettingQuery = useQuery({
    queryKey: characterSettingQueryKey(expressionSettingId ?? 0),
    queryFn: ({ signal }) => getCharacterSetting(expressionSettingId!, signal),
    enabled: link.canView && expressionSettingId !== null,
  })
  const expressionSetting = expressionSettingQuery.data?.id === expressionSettingId ? expressionSettingQuery.data : null
  const settingGroupId = expressionSetting?.expressionGroupId ?? null
  const groupSource: CharacterGroupSource = expressionSettingId === null ? { characterName } : { expressionGroupId: settingGroupId, candidateGroupId: null }
  const expressionsNote = expressionSettingId === null || settingGroupId !== null ? null
    : expressionSetting
      ? t({ ko: '표정은 연결된 라이브러리 설정 거야. 그 설정엔 아직 표정이 없어.', en: 'Expressions come from the linked library setting, which has none yet.' })
      : t({ ko: '표정은 연결된 라이브러리 설정 거야.', en: 'Expressions come from the linked library setting.' })

  // Errors surface in the shared editor's snackbar.
  const setExpression = async (name: string, hash: string) => {
    const current = await ensureProfile()
    const result = await setChatProfileExpression({ kind: 'profile', id: current.id }, name, hash)
    onProfileChange(result.profile)
    patch({ style: { ...draft.style, emoticonGroupIds: [result.expressionGroupId, ...draft.style.emoticonGroupIds.filter((id) => id !== result.expressionGroupId)] } })
    await runs.refreshAfterApply({ kind: 'profile', id: current.id }, result.expressionGroupId)
  }
  const clearExpression = async (name: string) => {
    if (!profile) return
    const result = await clearChatProfileExpression({ kind: 'profile', id: profile.id }, name)
    await runs.refreshAfterApply({ kind: 'profile', id: profile.id }, result.expressionGroupId)
  }
  // A picked or cropped library avatar keeps the legacy picture only while it is still the saved avatar.
  const setAvatar = (avatarHash: string | null, avatarCrop: Draft['avatarCrop'] | null) => patch(avatarHash
    ? { avatarHash, avatarCrop, avatar: avatarHash === (profile?.avatarHash ?? draft.avatarHash) ? profile?.avatar ?? draft.avatar : null }
    : { avatar: null, avatarHash: null, avatarCrop: null })

  return (
    <CharacterAppearanceEditor
      value={draft}
      onChange={patch}
      onAvatarChange={setAvatar}
      referenceUrl={referenceUrl}
      avatar={<ChatProfileAvatar name={draft.name || '?'} avatar={draft.avatar} imageUrl={avatarUrl} avatarCrop={draft.avatarHash ? draft.avatarCrop : null} engine={draft.engine} className="size-[72px]" size="xl" />}
      hasAvatar={Boolean(draft.avatarHash || draft.avatar)}
      uploadTarget={{ characterName }}
      groupSource={groupSource}
      runs={runs}
      busy={busy}
      onBusyChange={onBusyChange}
      draftAppearance={(signal) => draftChatAppearance(draft, signal)}
      onSetExpression={setExpression}
      onClearExpression={clearExpression}
      appearanceWarning={appearanceWarning}
      appearanceInvalid={Boolean(appearanceWarning)}
      editable={!readOnly}
      generation={!readOnly}
      expressionsEditable={'characterName' in groupSource}
      expressionsNote={expressionsNote}
    >
      <EmoticonGroupsRow draft={draft} patch={patch} />
    </CharacterAppearanceEditor>
  )
}
