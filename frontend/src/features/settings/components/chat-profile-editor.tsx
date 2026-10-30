import { useEffect, useImperativeHandle, useRef, useState, type Dispatch, type Ref, type SetStateAction } from 'react'
import { chatDraftEqual } from '@/features/codex-chat/chat-draft-equal'
import { useLocation, useNavigate, useSearchParams, type Location } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, Eye, FileText, Image as ImageIcon, Palette, Sparkles, Trash2, UserRound, Wrench } from 'lucide-react'
import { EditorPage, EditorSectionNav, type EditorSectionEntry } from '@/components/common/editor-page'
import type { PathCrumb } from '@/components/common/path-breadcrumbs'
import { ActionMenuButton } from '@/components/ui/action-menu'
import { AvatarButton } from '@/components/ui/avatar-button'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { EditorFooter } from '@/components/ui/editor-footer'
import { EditorGroup } from '@/components/ui/editor-group'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { FloatingSaveBar } from '@/components/ui/floating-save-bar'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal, ModalBody } from '@/components/ui/modal'
import { SidebarItem } from '@/components/ui/sidebar'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { SwitchLine } from '@/components/ui/switch-line'
import { Tip } from '@/components/ui/tooltip'
import { ChatProfileAvatar } from '@/features/codex-chat/chat-profile-avatar'
import { settingDraftOf } from '@/features/characters/character-library-shared'
import { folderPath } from '@/features/characters/character-library-shared'
import { CharacterFolderPickerModal } from '@/features/characters/components/character-folder-nav'
import { CHAT_PROFILE_FOLDERS_QUERY_KEY, CHAT_PROFILE_LIBRARY_QUERY_KEY, listChatProfileFolders } from '@/lib/api-codex-chat'
import { useI18n } from '@/i18n'
import { listAuthPermissionGroups } from '@/lib/api-auth'
import {
  CHAT_ADMIN_PROFILES_QUERY_KEY,
  CHAT_BLOCKS_QUERY_KEY,
  CHAT_LOREBOOKS_QUERY_KEY,
  CHAT_LOREBOOK_SUMMARIES_QUERY_KEY,
  CHAT_PROFILE_DEFAULTS_QUERY_KEY,
  CHAT_PROFILES_QUERY_KEY,
  CHAT_USER_PROFILES_QUERY_KEY,
  MODEL_SLOTS_QUERY_KEY,
  CHAT_PROFILE_SYNCED_KEYS,
  ChatEditorResolution,
  chatProfileSaveInput,
  emoticonGroupsAfterServerChange,
  sameCharacterLink,
  createChatProfile,
  deleteChatProfile,
  getChatAdminProfile,
  getChatProfileDefaults,
  isChatRevisionConflict,
  listChatAdminProfiles,
  listChatBlocks,
  listChatLorebookSummaries,
  listChatUserProfiles,
  listModelSlots,
  updateChatProfile,
  type ChatProfile,
  type ChatAssetApplyResult,
  type ChatAssetKind,
  type ChatProfileDefaults,
  type ChatProfileInput,
} from '@/lib/api-codex-chat'
import { getCodexGenerationModels } from '@/lib/api-image-generation-queue'
import { getClaudeModels } from '@/lib/api-agent-cli'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { CHAT_MAX_EMOTICON_GROUPS, CHAT_PROFILE_DEFAULTS, CHAT_PROFILE_TEXT_LIMITS, CHAT_TRANSLATION_DEFAULTS, type CharacterSetting, type ChatProfileCharacterLinkInput } from '@conai/shared'
import { useEditorPageGuard } from '../use-unsaved-settings-guard'
import { useProfileAssetRuns } from './chat-profile-asset-runs'
import { ChatProfileAppearancePanel } from './chat-profile-editor-appearance'
import { draftProfileAssetUrl } from './chat-profile-images'
import { ChatProfileCharacterPanel } from './chat-profile-editor-character'
import type { Draft, PatchDraft } from './chat-profile-editor-fields'
import { ChatProfileLookPanel } from './chat-profile-editor-look'
import { ChatProfileMemoryPanel } from './chat-profile-editor-memory'
import { ChatProfileModelPanel } from './chat-profile-editor-model'
import { ChatProfileToolsPanel } from './chat-profile-editor-tools'
import { ChatProfilePreviewModal } from './chat-profile-preview-modal'
import { ProfileAssistContext, useProfileAssist, useProfileEditorChatPage, type ProfileEditorSection } from './use-profile-editor-chat-page'
import { useProfileCharacterLink } from './use-profile-character-link'
import { CHAT_DOCK_INSET } from './use-settings-editor-chat-page'

/** The profile list, where the editor page returns to. */
export const CHAT_PROFILES_PATH = '/characters?view=profiles'
/** The editor page of a saved profile, or of a new one (`new`). */
export const chatProfileEditorPath = (id: number | 'new') => `${CHAT_PROFILES_PATH}&profile=${id}`
/** What a new profile's page starts from: a copy, a card import or a proposal (kept in the history entry). */
export type ChatProfileEditorPageState = { draft?: ChatProfileInput; copyOf?: number; initialFolderId?: number | null }

export function buildDraft(profile: ChatProfileInput | null, defaults: ChatProfileDefaults | undefined, initialFolderId: number | null = null): Draft {
  return {
    name: profile?.name ?? '',
    folderId: profile?.folderId === undefined ? initialFolderId : profile.folderId,
    tagline: profile?.tagline ?? '',
    lorebookIds: profile?.lorebookIds ?? [],
    blockIds: profile?.blockIds ?? [],
    loreScanDepth: profile?.loreScanDepth ?? defaults?.loreScanDepth ?? CHAT_PROFILE_DEFAULTS.loreScanDepth,
    loreTokenBudget: profile?.loreTokenBudget ?? defaults?.loreTokenBudget ?? CHAT_PROFILE_DEFAULTS.loreTokenBudget,
    loreDepth: profile?.loreDepth ?? defaults?.loreDepth ?? CHAT_PROFILE_DEFAULTS.loreDepth,
    loreRecursionDepth: profile?.loreRecursionDepth ?? defaults?.loreRecursionDepth ?? CHAT_PROFILE_DEFAULTS.loreRecursionDepth,
    authorNote: profile?.authorNote ?? '',
    avatar: profile?.avatar ?? null,
    characterLink: profile?.characterLink ? { settingId: profile.characterLink.settingId, synced: profile.characterLink.synced } : null,
    appearance: profile?.appearance,
    referenceHash: profile?.referenceHash,
    avatarHash: profile?.avatarHash,
    avatarCrop: profile?.avatarCrop,
    backgroundHash: profile?.backgroundHash,
    engine: profile?.engine ?? 'llm',
    model: profile?.model ?? '',
    llmRuntime: profile?.llmRuntime ?? 'direct',
    reasoningEffort: profile?.reasoningEffort ?? '',
    reasoningBudgetTokens: profile?.reasoningBudgetTokens ?? null,
    extraParams: profile?.extraParams ?? '',
    systemPrompt: profile?.systemPrompt ?? defaults?.systemPrompt ?? '',
    promptSections: profile?.promptSections ?? [],
    greeting: profile?.greeting ?? '',
    alternateGreetings: profile?.alternateGreetings ?? [],
    openingHistory: profile?.openingHistory ?? [],
    greetingPosition: profile?.greetingPosition ?? 0,
    temperature: profile?.temperature ?? null,
    maxTokens: profile?.maxTokens ?? null,
    mcpEnabled: profile?.mcpEnabled ?? false,
    allowedGroupKeys: profile?.allowedGroupKeys ?? [],
    generationPresetIds: profile?.generationPresetIds ?? [],
    mcpScopes: profile?.mcpScopes ?? ['read'],
    toolAllowlist: profile?.toolAllowlist ?? null,
    toolOutputLimit: profile?.toolOutputLimit ?? defaults?.toolOutputLimit ?? CHAT_PROFILE_DEFAULTS.toolOutputLimit,
    contextTurns: profile?.contextTurns ?? defaults?.contextTurns ?? CHAT_PROFILE_DEFAULTS.contextTurns,
    contextTokens: profile?.contextTokens ?? null,
    summaryEnabled: profile?.summaryEnabled ?? false,
    summaryTriggerTurns: profile?.summaryTriggerTurns ?? defaults?.summaryTriggerTurns ?? CHAT_PROFILE_DEFAULTS.summaryTriggerTurns,
    summaryPrompt: profile?.summaryPrompt ?? '',
    translationInstructions: profile?.translationInstructions ?? '',
    translationModelLanguage: profile?.translationModelLanguage ?? CHAT_TRANSLATION_DEFAULTS.modelLanguage,
    translationDisplayLanguage: profile?.translationDisplayLanguage ?? CHAT_TRANSLATION_DEFAULTS.displayLanguage,
    suggestEnabled: profile?.suggestEnabled ?? false,
    modelSlotId: profile?.modelSlotId ?? null,
    summarySlotId: profile?.summarySlotId ?? null,
    translationSlotId: profile?.translationSlotId ?? null,
    suggestSlotId: profile?.suggestSlotId ?? null,
    suggestProfileId: profile?.suggestProfileId ?? null,
    suggestUserProfileId: profile?.suggestUserProfileId ?? null,
    visionEnabled: profile?.visionEnabled ?? false,
    contentRatingMode: profile?.contentRatingMode ?? 'model',
    contentRatingTierId: profile?.contentRatingTierId ?? null,
    pageAssist: profile?.pageAssist ?? false,
    allowLoreProposals: profile?.allowLoreProposals ?? true,
    agentEnabled: profile?.agentEnabled ?? false,
    agentDescription: profile?.agentDescription ?? '',
    linkedFiles: profile?.linkedFiles ?? [],
    judgePresetId: profile?.judgePresetId ?? null,
    judgeSlotId: profile?.judgeSlotId ?? null,
    style: profile?.style ?? defaults!.style,
    isEnabled: profile?.isEnabled ?? true,
    sortOrder: profile?.sortOrder ?? 0,
  }
}

/** Keep edits made after a save started over the returned stored profile. */
export function rebaseProfileDraft(saved: ChatProfile, submitted: Draft, current: Draft, defaults: ChatProfileDefaults | undefined) {
  const next = buildDraft(saved, defaults)
  for (const key of Object.keys(current) as Array<keyof Draft>) {
    if (JSON.stringify(current[key]) === JSON.stringify(submitted[key])) continue
    if (key === 'style') {
      next.style = { ...current.style, emoticonGroupIds: emoticonGroupsAfterServerChange(submitted.style.emoticonGroupIds, saved.style.emoticonGroupIds, current.style.emoticonGroupIds) }
    } else (next as unknown as Record<string, unknown>)[key] = current[key]
  }
  return next
}

/** Three-way merge at the editor's top-level fields; nested values such as style stay together. */
export function mergeProfileDraft(previous: ChatProfile, latest: ChatProfile, draft: Draft, defaults: ChatProfileDefaults | undefined, before = buildDraft(previous, defaults)) {
  const latestDraft = buildDraft(latest, defaults)
  const next = { ...latestDraft }
  const conflicts: Array<keyof Draft> = []
  for (const key of Object.keys(draft) as Array<keyof Draft>) {
    if (JSON.stringify(draft[key]) === JSON.stringify(before[key])) continue
    ;(next as unknown as Record<string, unknown>)[key] = draft[key]
    if (key === 'background') {
      // Admin reads omit the legacy image itself, but carry its own revision.
      if (previous.backgroundRevision !== latest.backgroundRevision) conflicts.push(key)
    } else if (JSON.stringify(draft[key]) !== JSON.stringify(latestDraft[key])
      && JSON.stringify(before[key]) !== JSON.stringify(latestDraft[key])) conflicts.push(key)
  }
  return { draft: next, conflicts }
}

type ExpectedProfileDraft = { id: number; revision: string; draft: Draft }

const expectedProfileDraft = (base: ChatProfile, expected: ExpectedProfileDraft | null) =>
  expected?.id === base.id && expected.revision === base.revision ? expected.draft : undefined

/** A save may have started before the editor adopted a newer base or applied its own server changes. */
export function mergeProfileConflict(base: ChatProfile, currentBase: ChatProfile | null, latest: ChatProfile, draft: Draft, defaults: ChatProfileDefaults | undefined, expected: ExpectedProfileDraft | null) {
  const previous = currentBase?.id === base.id ? currentBase : base
  return mergeProfileDraft(previous, latest, draft, defaults, expectedProfileDraft(previous, expected))
}

/** Loading latest discards only the fields that actually conflicted. */
export function latestProfileConflicts(latest: ChatProfile, draft: Draft, conflicts: Array<keyof Draft>, defaults: ChatProfileDefaults | undefined) {
  const stored = buildDraft(latest, defaults)
  const next = { ...draft }
  for (const key of conflicts) {
    if (key === 'background') delete next.background
    else (next as unknown as Record<string, unknown>)[key] = stored[key]
  }
  return next
}

/** The fields this editor's own asset application just wrote. */
export function profileAssetDraft(current: Draft, result: ChatAssetApplyResult, slot: { kind: ChatAssetKind; hash: string }, updated?: ChatProfile) {
  const next = { ...current }
  if (slot.kind === 'reference') next.referenceHash = slot.hash
  if (slot.kind === 'avatar') { if (next.avatarHash !== slot.hash) next.avatar = null; next.avatarHash = slot.hash; next.avatarCrop = null }
  if (slot.kind === 'background') { next.backgroundHash = slot.hash; next.background = undefined }
  const groupId = result.applied.expressionGroupId
  if (groupId) next.style = { ...next.style, emoticonGroupIds: [groupId, ...next.style.emoticonGroupIds.filter((id) => id !== groupId)] }
  if (updated && result.applied.profileFields.includes('avatarHash')) { next.avatarHash = updated.avatarHash; next.avatarCrop = updated.avatarCrop; next.avatar = updated.avatar }
  return next
}

/** The exact effect of this editor's own server operation, not unrelated changes in its response. */
export type ProfileOwnEffect =
  | { kind: 'asset'; result: ChatAssetApplyResult; slot: { kind: ChatAssetKind; hash: string } }
  | { kind: 'expression'; groupId: number }
  | { kind: 'setting'; setting: CharacterSetting; submitted: Draft; previousGroupId: number | null }
  | { kind: 'save'; submitted: Draft; keys: Array<keyof Draft>; linkChanged: boolean }

const sameProfileValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

/** Merge a server result against the base plus only the effect this editor actually caused. */
export function mergeOwnProfileDraft(base: ChatProfile, updated: ChatProfile | null, current: Draft, defaults: ChatProfileDefaults | undefined, effect: ProfileOwnEffect, before = buildDraft(base, defaults)) {
  let expected: Draft
  let next: Draft
  if (effect.kind === 'asset') {
    expected = profileAssetDraft(before, effect.result, effect.slot, updated ?? undefined)
    next = profileAssetDraft(current, effect.result, effect.slot, updated ?? undefined)
  } else if (effect.kind === 'expression') {
    const addGroup = (value: Draft) => ({ ...value, style: { ...value.style, emoticonGroupIds: [effect.groupId, ...value.style.emoticonGroupIds.filter((id) => id !== effect.groupId)] } })
    expected = addGroup(before)
    next = addGroup(current)
  } else if (effect.kind === 'setting') {
    const { setting, submitted, previousGroupId } = effect
    const groups = [...(setting.expressionGroupId ? [setting.expressionGroupId] : []), ...before.style.emoticonGroupIds.filter((id) => id !== previousGroupId && id !== setting.expressionGroupId)].slice(0, CHAT_MAX_EMOTICON_GROUPS)
    expected = { ...before, characterLink: { settingId: setting.id, synced: true }, appearance: setting.appearance, referenceHash: setting.referenceHash, avatarHash: setting.avatarHash, avatarCrop: setting.avatarCrop, avatar: null, style: { ...before.style, emoticonGroupIds: groups } }
    next = { ...current }
    const linkUnchanged = sameCharacterLink(current.characterLink, submitted.characterLink)
    if (linkUnchanged) {
      next.characterLink = expected.characterLink
      next.style = { ...current.style, emoticonGroupIds: emoticonGroupsAfterServerChange(before.style.emoticonGroupIds, groups, current.style.emoticonGroupIds) }
    }
    for (const key of CHAT_PROFILE_SYNCED_KEYS) {
      if (sameProfileValue(current[key], submitted[key])) (next as unknown as Record<string, unknown>)[key] = expected[key]
    }
  } else {
    const stored = buildDraft(updated!, defaults)
    expected = { ...before }
    next = { ...current }
    for (const key of effect.keys) {
      ;(expected as unknown as Record<string, unknown>)[key] = stored[key]
      if (key === 'style' && !sameProfileValue(current.style, effect.submitted.style)) {
        next.style = { ...current.style, emoticonGroupIds: emoticonGroupsAfterServerChange(effect.submitted.style.emoticonGroupIds, stored.style.emoticonGroupIds, current.style.emoticonGroupIds) }
      } else if (sameProfileValue(current[key], effect.submitted[key])) (next as unknown as Record<string, unknown>)[key] = stored[key]
    }
    if (effect.linkChanged) {
      if (!effect.keys.includes('style')) {
        expected.style = { ...before.style, emoticonGroupIds: stored.style.emoticonGroupIds }
        next.style = { ...current.style, emoticonGroupIds: emoticonGroupsAfterServerChange(before.style.emoticonGroupIds, stored.style.emoticonGroupIds, current.style.emoticonGroupIds) }
      }
      if (updated!.characterLink?.synced) for (const key of CHAT_PROFILE_SYNCED_KEYS) {
        ;(expected as unknown as Record<string, unknown>)[key] = stored[key]
        if (sameProfileValue(current[key], effect.submitted[key])) (next as unknown as Record<string, unknown>)[key] = stored[key]
      }
    }
  }
  if (!updated) return { draft: next, pending: next, expected, conflicts: [] as Array<keyof Draft> }
  const compared = effect.kind === 'save' && (effect.keys.includes('background') || effect.keys.includes('backgroundHash'))
    ? { ...base, backgroundRevision: updated.backgroundRevision } : base
  return { ...mergeProfileDraft(compared, updated, next, defaults, expected), pending: next, expected }
}

export function profileSettingNeedsRefresh(base: ChatProfile, setting: CharacterSetting | null) {
  return Boolean(base.characterLink?.synced && setting?.id === base.characterLink.settingId && base.characterLink.revision !== setting.revision)
}

/** Apply an appearance panel patch over edits or server changes that arrived since its render. */
export function rebaseAppearancePatch(base: Draft, current: Draft, patch: Partial<Draft>): Draft {
  if (!patch.style) return { ...current, ...patch }
  const style = { ...current.style }
  for (const key of Object.keys(patch.style) as Array<keyof Draft['style']>) {
    if (JSON.stringify(patch.style[key]) === JSON.stringify(base.style[key])) continue
    if (key === 'emoticonGroupIds') style.emoticonGroupIds = emoticonGroupsAfterServerChange(base.style.emoticonGroupIds, patch.style.emoticonGroupIds, current.style.emoticonGroupIds)
    else (style as unknown as Record<string, unknown>)[key] = patch.style[key]
  }
  return { ...current, ...patch, style }
}

/**
 * Who may chat with this profile, as one line: everyone with the engine's permission, or members of the picked groups.
 * Administrators always may, so picking only Administrators keeps the profile to them.
 */
function useAudience(draft: Draft) {
  const { t } = useI18n()
  const groupsQuery = useQuery({ queryKey: ['auth-permission-groups', 'all'], queryFn: listAuthPermissionGroups, staleTime: 60_000, retry: false })
  const groups = (groupsQuery.data ?? []).filter((group) => group.groupKey === 'admin' || !group.systemGroup)
  const picked = draft.allowedGroupKeys
  const nameOf = (key: string) => (key === 'admin' ? t({ ko: '관리자', en: 'Administrators' }) : groups.find((group) => group.groupKey === key)?.name ?? key)
  const summary = picked.length === 0 ? t({ ko: '모두', en: 'Everyone' }) : picked.length === 1 ? nameOf(picked[0]) : t({ ko: '그룹 {count}개', en: '{count} groups' }, { count: picked.length })
  return { groups, picked, nameOf, summary }
}
type Audience = ReturnType<typeof useAudience>

/** The value of 사용할 수 있는 사람: a field-like key opening the groups to pick (none picked: everyone). */
function AudienceMenu({ patch, audience }: { patch: PatchDraft; audience: Audience }) {
  const { t } = useI18n()
  const { groups, picked, nameOf, summary } = audience
  const toggle = (key: string) => patch({ allowedGroupKeys: picked.includes(key) ? picked.filter((item) => item !== key) : [...picked, key] })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="field" size="field" className="min-w-36" aria-label={t({ ko: '사용할 수 있는 사람: {who}', en: 'Who can use it: {who}' }, { who: summary })}>
          <span className="truncate">{summary}</span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuCheckboxItem checked={picked.length === 0} onSelect={(event) => event.preventDefault()} onCheckedChange={() => patch({ allowedGroupKeys: [] })}>{t({ ko: '모두', en: 'Everyone' })}</DropdownMenuCheckboxItem>
        {groups.length ? <DropdownMenuSeparator /> : null}
        {groups.map((group) => (
          <DropdownMenuCheckboxItem key={group.groupKey} checked={picked.includes(group.groupKey)} onSelect={(event) => event.preventDefault()} onCheckedChange={() => toggle(group.groupKey)}>
            {nameOf(group.groupKey)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 기본 정보: the name and tagline (the avatar changes under 외형), whether chats may use it and who may. */
function ChatProfileBasicPanel({ draft, patch, profile, audience, onOpenAppearance }: {
  draft: Draft
  patch: PatchDraft
  profile: ChatProfile | null
  audience: Audience
  onOpenAppearance: () => void
}) {
  const { t } = useI18n()
  const { filled } = useProfileAssist()
  const [choosingFolder, setChoosingFolder] = useState(false)
  const foldersQuery = useQuery({ queryKey: CHAT_PROFILE_FOLDERS_QUERY_KEY, queryFn: listChatProfileFolders })
  const folders = foldersQuery.data ?? []
  const path = folderPath(new Map(folders.map((folder) => [folder.id, folder])), draft.folderId)
  return (
    <div className="space-y-4">
      <EditorGroup label={t({ ko: '프로필', en: 'Profile' })}>
        <div className="flex items-center gap-4">
          <Tip content={t({ ko: '외형에서 바꾸기', en: 'Change under Appearance' })}>
            <AvatarButton onClick={onOpenAppearance} aria-label={t({ ko: '외형에서 바꾸기', en: 'Change under Appearance' })}>
              <ChatProfileAvatar name={draft.name || '?'} avatar={draft.avatar} imageUrl={draftProfileAssetUrl(draft, profile, 'avatar')} avatarCrop={draft.avatarHash ? draft.avatarCrop : null} engine={draft.engine} size="xl" />
            </AvatarButton>
          </Tip>
          <div className="min-w-0 flex-1 space-y-2">
            <Input variant="settings" assisted={filled('name')} value={draft.name} maxLength={CHAT_PROFILE_TEXT_LIMITS.name} placeholder={t({ ko: '이름', en: 'Name' })} aria-label={t({ ko: '이름', en: 'Name' })} onChange={(event) => patch({ name: event.target.value })} />
            <Input variant="settings" assisted={filled('tagline')} value={draft.tagline} maxLength={CHAT_PROFILE_TEXT_LIMITS.tagline} placeholder={t({ ko: '짧은 소개', en: 'Tagline' })} aria-label={t({ ko: '짧은 소개', en: 'Tagline' })} onChange={(event) => patch({ tagline: event.target.value })} />
          </div>
        </div>
      </EditorGroup>
      <EditorGroup label={t({ ko: '프로필 폴더', en: 'Profile folder' })}>
        <Button variant="field" size="field" onClick={() => setChoosingFolder(true)}>{path.map((folder) => folder.name).join(' / ') || t({ ko: '최상위', en: 'Top level' })}</Button>
        {choosingFolder ? <CharacterFolderPickerModal title={t({ ko: '프로필 폴더', en: 'Profile folder' })} folders={folders} value={draft.folderId} onPick={(folderId) => { patch({ folderId }); setChoosingFolder(false) }} onClose={() => setChoosingFolder(false)} /> : null}
      </EditorGroup>
      <EditorGroup label={t({ ko: '사용', en: 'Use' })}>
        <SwitchLine label={t({ ko: '채팅에서 사용', en: 'Use in chat' })} checked={draft.isEnabled} onCheckedChange={(isEnabled) => patch({ isEnabled })} />
        <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span className="min-w-0 flex-1 basis-56">{t({ ko: '사용할 수 있는 사람', en: 'Who can use it' })}</span>
          <AudienceMenu patch={patch} audience={audience} />
        </div>
      </EditorGroup>
    </div>
  )
}

type ProfileEditorProps = {
  open: boolean
  profile: ChatProfile | null
  initialDraft?: ChatProfileInput
  initialFolderId?: number | null
  /** The profile a new one copies (initialDraft holds its settings). */
  copyOf?: number
  /** A library link the draft starts with over the stored profile's (a proposal's, not stored yet). */
  draftLink?: ChatProfileCharacterLinkInput
  defaults: ChatProfileDefaults | undefined
  onClose: () => void
}

/** One editor's profile and draft, kept while the server defaults load, fail or retry. */
export function useProfileEditorDraft({ open, profile: initialProfile, initialDraft, initialFolderId = null, draftLink, defaults }: Pick<ProfileEditorProps, 'open' | 'profile' | 'initialDraft' | 'initialFolderId' | 'draftLink' | 'defaults'>) {
  const queryClient = useQueryClient()
  const cached = initialProfile && queryClient.getQueryData<ChatProfile[]>(CHAT_ADMIN_PROFILES_QUERY_KEY)?.find((entry) => entry.id === initialProfile.id && entry.revision === initialProfile.revision)
  // Proposal modals can pass a profile with proposed fields overlaid; its cached record is the actual base.
  const initialBase = cached || initialProfile
  const defaultsQuery = useQuery({ queryKey: CHAT_PROFILE_DEFAULTS_QUERY_KEY, queryFn: getChatProfileDefaults, enabled: open && !defaults, staleTime: Infinity })
  const currentDefaults = defaults ?? defaultsQuery.data
  const [profile, setProfile] = useState(initialBase)
  const editorSession = useRef({ open: false, id: initialProfile?.id ?? null })
  const [draft, setDraft] = useState<Draft | null>(() => {
    const built = initialProfile || currentDefaults ? buildDraft(initialProfile ?? initialDraft ?? null, currentDefaults, initialFolderId) : null
    return built && profile && draftLink !== undefined ? { ...built, characterLink: draftLink } : built
  })
  const draftDefaults = useRef(currentDefaults)
  useEffect(() => {
    // Hydration and session resets must share one writer: a reset must not clear a draft after hydration consumed its trigger.
    const previousDefaults = draftDefaults.current
    let reset = false
    if (open && (!editorSession.current.open || editorSession.current.id !== (initialProfile?.id ?? null))) {
      // A new page moving to the id it just created is still the same editor and draft.
      if (!editorSession.current.open || initialProfile?.id !== profile?.id) {
        reset = true
        setProfile(initialBase)
        const built = initialProfile || currentDefaults ? buildDraft(initialProfile ?? initialDraft ?? null, currentDefaults, initialFolderId) : null
        setDraft(built && initialProfile && draftLink !== undefined ? { ...built, characterLink: draftLink } : built)
      }
    }
    if (!reset && open && !profile && currentDefaults) {
      setDraft((current) => {
        if (current && (previousDefaults === currentDefaults || !previousDefaults || !chatDraftEqual(current, buildDraft(initialDraft ?? null, previousDefaults, initialFolderId)))) return current
        return buildDraft(initialDraft ?? null, currentDefaults, initialFolderId)
      })
    }
    draftDefaults.current = currentDefaults
    editorSession.current = { open, id: initialProfile?.id ?? null }
  }, [currentDefaults, initialDraft, initialFolderId, open, initialProfile, initialBase, draftLink, profile])

  // A new profile has no baseline until the server defaults load (buildDraft needs one of the two).
  const baseline = profile || currentDefaults ? buildDraft(profile ?? initialDraft ?? null, currentDefaults, initialFolderId) : null
  const dirty = open && ((!profile && Boolean(initialDraft)) || (draft !== null && baseline !== null && !chatDraftEqual(draft, baseline)))
  // Unsaved edits of a synced library setting's look (held by the editor below).
  const [settingDirty, setSettingDirty] = useState(false)
  return {
    defaultsQuery,
    currentDefaults,
    profile,
    setProfile,
    draft,
    setDraft: (update: SetStateAction<Draft>) => setDraft((current) => typeof update === 'function' ? (current ? update(current) : current) : update),
    dirty,
    settingDirty,
    setSettingDirty,
  }
}

/** Retry for the server defaults a new profile starts from. */
function DefaultsState({ query }: { query: ReturnType<typeof useProfileEditorDraft>['defaultsQuery'] }) {
  const { t } = useI18n()
  return query.isError ? <>
    <p role="alert" className="text-sm text-destructive">{getErrorMessage(query.error, t({ ko: '기본 설정을 불러오지 못했어.', en: 'Could not load profile defaults.' }))}</p>
    <Button variant="secondary" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>{t({ ko: '다시 시도', en: 'Retry' })}</Button>
  </> : <LoadingState variant="inline" />
}

/**
 * Create or edit one chat profile in a dialog: a chat's proposal card opens it over the conversation. The profile list
 * opens the same editor as a page (ChatProfileEditorPage). Keeps one dialog (and its focus trap) while the server
 * defaults load, fail or retry.
 */
export function ChatProfileEditorModal(props: ProfileEditorProps) {
  const { t } = useI18n()
  const state = useProfileEditorDraft(props)
  const editor = useRef<{ save: () => void }>(null)
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      dirty={state.dirty || (props.open && state.settingDirty)}
      onSave={state.draft ? () => editor.current?.save() : undefined}
      title={state.profile ? t({ ko: '프로필 편집', en: 'Edit profile' }) : t({ ko: '프로필 추가', en: 'Add profile' })}
      size="xl"
      height="tall"
      sidePanelInset={CHAT_DOCK_INSET}
    >
      {state.draft ? <ProfileEditor
        key={props.profile?.id ?? 'new'}
        ref={editor}
        layout="modal"
        {...props}
        profile={state.profile}
        setProfile={state.setProfile}
        draft={state.draft}
        setDraft={state.setDraft}
        dirty={state.dirty}
        onSettingDirtyChange={state.setSettingDirty}
        defaults={state.currentDefaults}
      /> : <ModalBody><DefaultsState query={state.defaultsQuery} /></ModalBody>}
    </Modal>
  )
}

/** Leaving the open profile (its address changes). */
function leavesProfile(current: Location, next: Location) {
  if (current.pathname !== next.pathname) return true
  const before = new URLSearchParams(current.search).get('profile')
  const after = new URLSearchParams(next.search).get('profile')
  return before !== after || new URLSearchParams(current.search).get('view') !== new URLSearchParams(next.search).get('view')
}

/**
 * One chat profile as a page (/characters?view=profiles&profile=<id|new>): the way back to the list, the name with its
 * state, the sections with what each holds on the left, and the save bar while something is unsaved. A new profile's
 * page may start from a copy or an import (the history entry's state) and moves to its own id once saved.
 */
export function ChatProfileEditorPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const raw = params.get('profile')
  const invalid = raw !== 'new' && (!raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1)
  const id = invalid || raw === 'new' ? null : Number(raw)
  const pageState = (location.state ?? null) as ChatProfileEditorPageState | null
  const profilesQuery = useQuery({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY, queryFn: listChatAdminProfiles })
  const found = id === null ? null : profilesQuery.data?.find((entry) => entry.id === id) ?? null
  const back = () => { const next = new URLSearchParams(params); next.delete('profile'); navigate(`/characters?${next}`) }
  if (invalid || (id !== null && !found)) {
    return (
      <EditorPage crumbs={profileCrumbs(t, navigate, location.search)} title={t({ ko: '채팅 프로필', en: 'Chat profile' })}>
        {!invalid && profilesQuery.isPending ? <LoadingState variant="inline" /> : !invalid && profilesQuery.isError
          ? <ErrorState title={t({ ko: '프로필을 불러오지 못했어', en: 'Could not load the profile' })} error={profilesQuery.error} onRetry={() => void profilesQuery.refetch()} />
          : <EmptyState icon={UserRound} title={t({ ko: '프로필을 찾지 못했어', en: 'Profile not found' })} action={<Button variant="secondary" size="sm" onClick={back}>{t({ ko: '프로필 목록', en: 'Profile list' })}</Button>} />}
      </EditorPage>
    )
  }
  const initialFolderId = pageState?.initialFolderId !== undefined ? pageState.initialFolderId : !params.get('q')?.trim() && Number(params.get('folder')) > 0 ? Number(params.get('folder')) : null
  return <ProfileEditorPageBody profile={found} initialFolderId={initialFolderId} initialDraft={id === null ? pageState?.draft : undefined} copyOf={id === null ? pageState?.copyOf : undefined} onClose={back} />
}

const profileCrumbs = (t: ReturnType<typeof useI18n>['t'], navigate: ReturnType<typeof useNavigate>, search = ''): PathCrumb[] => [
  { key: 'characters', label: t({ ko: '캐릭터', en: 'Characters' }), onClick: () => navigate('/characters') },
  { key: 'profiles', label: t({ ko: '채팅 프로필', en: 'Chat profiles' }), onClick: () => { const params = new URLSearchParams(search); params.set('view', 'profiles'); params.delete('profile'); navigate(`/characters?${params}`) } },
]

function ProfileEditorPageBody({ profile, initialDraft, initialFolderId, copyOf, onClose }: { profile: ChatProfile | null; initialDraft?: ChatProfileInput; initialFolderId?: number | null; copyOf?: number; onClose: () => void }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const state = useProfileEditorDraft({ open: true, profile, initialDraft, initialFolderId, defaults: undefined })
  if (!state.draft) {
    return <EditorPage crumbs={profileCrumbs(t, navigate, location.search)} title={t({ ko: '새 프로필', en: 'New profile' })}><DefaultsState query={state.defaultsQuery} /></EditorPage>
  }
  return (
    <ProfileEditor
      layout="page"
      open
      profile={state.profile}
      setProfile={state.setProfile}
      draft={state.draft}
      setDraft={state.setDraft}
      dirty={state.dirty}
      onSettingDirtyChange={state.setSettingDirty}
      initialDraft={initialDraft}
      initialFolderId={initialFolderId}
      copyOf={copyOf}
      defaults={state.currentDefaults}
      onClose={onClose}
      pageLocation={location}
      // A new profile's page moves to its id (the same editor stays, so nothing in progress is lost).
      onSaved={(saved, allowNavigation) => {
        if (!profile) {
          const params = new URLSearchParams(location.search)
          params.set('profile', String(saved.id))
          const path = `/characters?${params}`
          allowNavigation(path, () => navigate(path, { replace: true }))
        }
      }}
    />
  )
}

function ProfileEditor({ layout, open, profile, setProfile, draft, setDraft, dirty: profileDirty, onSettingDirtyChange, initialDraft, initialFolderId, copyOf, defaults, onClose, onSaved, pageLocation, ref }: ProfileEditorProps & {
  layout: 'modal' | 'page'
  draft: Draft
  setDraft: Dispatch<SetStateAction<Draft>>
  setProfile: Dispatch<SetStateAction<ChatProfile | null>>
  dirty: boolean
  onSettingDirtyChange: (dirty: boolean) => void
  /** The page stays open after a save; the dialog closes instead. */
  onSaved?: (profile: ChatProfile, allowNavigation: (path: string, navigate: () => void) => void) => void
  pageLocation?: Location
  ref?: Ref<{ save: () => void }>
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const page = layout === 'page'
  const locationRef = useRef(pageLocation)
  locationRef.current = pageLocation
  const draftRef = useRef(draft)
  draftRef.current = draft
  const profileRef = useRef(profile)
  profileRef.current = profile
  const expectedRef = useRef<ExpectedProfileDraft | null>(null)
  useEffect(() => {
    if (!open) expectedRef.current = null
  }, [open])
  const isCurrentPage = (source: Location | undefined, savedId?: number) => {
    const current = locationRef.current
    if (!source || !current || !leavesProfile(source, current)) return true
    const before = new URLSearchParams(source.search)
    const after = new URLSearchParams(current.search)
    return savedId !== undefined && source.pathname === current.pathname && before.get('profile') === 'new'
      && after.get('view') === 'profiles' && Number(after.get('profile')) === savedId
  }
  const [section, setSection] = useState<ProfileEditorSection>(profile ? 'character' : 'basic')
  const [showingList, setShowingList] = useState(true)
  const [assetImports, setAssetImports] = useState(0)
  const assetBusy = assetImports > 0
  const onAssetBusyChange = (busy: boolean) => setAssetImports((count) => Math.max(0, count + (busy ? 1 : -1)))
  const [previewDraft, setPreviewDraft] = useState<(ChatProfileInput & { id?: number }) | null>(null)
  const creatingRef = useRef<{ submitted: Draft; promise: Promise<ChatProfile>; saveRequested: boolean } | null>(null)
  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }))
  const audience = useAudience(draft)
  const refreshProfiles = (lorebooksChanged = false) => Promise.all([
    queryClient.invalidateQueries({ queryKey: CHAT_PROFILE_FOLDERS_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: CHAT_PROFILE_LIBRARY_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: CHAT_PROFILES_QUERY_KEY }),
    ...(lorebooksChanged ? [queryClient.invalidateQueries({ queryKey: CHAT_LOREBOOKS_QUERY_KEY })] : []),
  ])
  const cacheProfile = (saved: ChatProfile) => {
    const profiles = queryClient.getQueryData<ChatProfile[]>(CHAT_ADMIN_PROFILES_QUERY_KEY)
    queryClient.setQueryData<ChatProfile[]>(CHAT_ADMIN_PROFILES_QUERY_KEY, profiles?.some((entry) => entry.id === saved.id)
      ? profiles.map((entry) => entry.id === saved.id ? saved : entry)
      : [...(profiles ?? []), saved])
    if (!profiles) void queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY, refetchType: 'none' })
  }
  const adoptProfile = (base: ChatProfile, next: Draft) => {
    expectedRef.current = null
    profileRef.current = base
    draftRef.current = next
    setProfile(base)
    setDraft(next)
  }
  /** Every editor-owned write is compared with its own expected effects, never with a fresh record as the base. */
  const adoptOwnProfile = (updated: ChatProfile | null, effect: ProfileOwnEffect, source = profileRef.current) => {
    const currentBase = profileRef.current
    if (!source) {
      if (!updated || effect.kind !== 'save' || (currentBase && (currentBase.id !== updated.id || currentBase.revision !== updated.revision))) return false
      adoptProfile(updated, rebaseProfileDraft(updated, effect.submitted, draftRef.current, defaults))
      return true
    }
    if (currentBase && currentBase.id !== source.id) return false
    const newerBase = currentBase && currentBase.revision !== source.revision
    // A successful revision-checked save from an older base precedes the already-adopted base.
    if (newerBase && effect.kind === 'save') return false
    const mergeBase = currentBase ?? source
    const merged = mergeOwnProfileDraft(mergeBase, updated, draftRef.current, defaults, effect, expectedProfileDraft(mergeBase, expectedRef.current))
    if (newerBase || !updated || merged.conflicts.length) {
      expectedRef.current = { id: mergeBase.id, revision: mergeBase.revision, draft: merged.expected }
      draftRef.current = merged.pending
      setDraft(merged.pending)
      return false
    }
    adoptProfile(updated, merged.draft)
    return true
  }
  /** A stale write rebases once; overlapping edits require an explicit choice. */
  const writeProfile = async (base: ChatProfile, submitted: Draft, keys?: Array<keyof Draft>) => {
    const input = (value: Draft, stored: ChatProfile) => {
      const selected = keys ? Object.fromEntries(keys.map((key) => [key, value[key]])) as ChatProfileInput : value
      return chatProfileSaveInput(selected, stored.characterLink ?? null)
    }
    try {
      return { savedProfile: await updateChatProfile(base.id, input(submitted, base), base.revision), submitted, base }
    } catch (error) {
      if (!isChatRevisionConflict(error)) throw error
      const latest = error.current as ChatProfile
      if (!mounted.current || !isCurrentPage(pageLocation, latest.id)) throw error
      const conflictDraft = draftRef.current
      const merged = mergeProfileConflict(base, profileRef.current, latest, conflictDraft, defaults, expectedRef.current)
      if (merged.conflicts.length) {
        const load = await confirm({
          title: t({ ko: '프로필이 다른 곳에서 바뀌었어', en: 'The profile changed elsewhere' }),
          confirmLabel: t({ ko: '최신 불러오기', en: 'Load latest' }),
          cancelLabel: t({ ko: '덮어쓰기', en: 'Overwrite' }),
        })
        if (JSON.stringify(draftRef.current) !== JSON.stringify(conflictDraft)) throw new ChatEditorResolution(t({ ko: '편집이 바뀌었어. 다시 저장해.', en: 'The draft changed. Save again.' }), error)
        if (load) {
          adoptProfile(latest, latestProfileConflicts(latest, merged.draft, merged.conflicts, defaults))
          throw new ChatEditorResolution(t({ ko: '최신 프로필을 불러왔어.', en: 'Loaded the latest profile.' }), error)
        }
        const overwrite = await confirm({
          title: t({ ko: '변경한 항목을 덮어쓸까?', en: 'Overwrite the changed fields?' }),
          confirmLabel: t({ ko: '덮어쓰기', en: 'Overwrite' }),
          cancelLabel: t({ ko: '계속 편집', en: 'Keep editing' }),
          tone: 'destructive',
        })
        if (JSON.stringify(draftRef.current) !== JSON.stringify(conflictDraft)) throw new ChatEditorResolution(t({ ko: '편집이 바뀌었어. 다시 저장해.', en: 'The draft changed. Save again.' }), error)
        if (!overwrite) throw new ChatEditorResolution(t({ ko: '저장을 멈췄어.', en: 'Save stopped.' }), error)
      }
      if (!mounted.current || !isCurrentPage(pageLocation, latest.id)) throw error
      adoptProfile(latest, merged.draft)
      return { savedProfile: await updateChatProfile(latest.id, input(merged.draft, latest), latest.revision), submitted: merged.draft, base: latest }
    }
  }
  /** A save and an asset operation can both need the same new profile before either request returns. */
  const createProfileOnce = (submitted: Draft) => {
    if (creatingRef.current) return creatingRef.current
    const promise = createChatProfile(chatProfileSaveInput(submitted), copyOf)
    const request = { submitted, promise, saveRequested: false }
    creatingRef.current = request
    const clear = () => { if (creatingRef.current === request) creatingRef.current = null }
    void promise.then(clear, clear)
    return request
  }
  /**
   * Saves what generation reads (name, appearance, reference); a new profile is created whole first. A changed library
   * link is stored too (with the look a detached profile keeps), so the server has detached it and copied the
   * expressions before any library store or profile-owned batch runs.
   */
  const ensureProfile = async () => {
    const linkChanged = profile !== null && !sameCharacterLink(draft.characterLink, profile.characterLink ?? null)
    const syncedAfter = Boolean((linkChanged ? draft.characterLink : profile?.characterLink)?.synced)
    const creation = profile ? null : createProfileOnce(draft)
    const keys: Array<keyof Draft> = linkChanged
      ? ['name', 'characterLink', ...(syncedAfter ? [] : ['appearance', 'referenceHash', 'avatarHash', 'avatarCrop'] as Array<keyof Draft>)]
      : syncedAfter ? ['name'] : ['name', 'appearance', 'referenceHash']
    let submitted = draft
    let source = profile
    let savedKeys = keys
    let updated: ChatProfile
    if (profile) {
      const saved = await writeProfile(profile, submitted, keys)
      updated = saved.savedProfile
      submitted = saved.submitted
      source = saved.base
    } else {
      updated = await creation!.promise
      submitted = creation!.submitted
      savedKeys = Object.keys(submitted) as Array<keyof Draft>
    }
    if (creation && mounted.current && isCurrentPage(pageLocation, updated.id)) {
      const current = draftRef.current
      if (creation.submitted.name.trim() !== current.name.trim()
        || (creation.submitted.appearance ?? '') !== (current.appearance ?? '')
        || (creation.submitted.referenceHash ?? null) !== (current.referenceHash ?? null)
        || !sameCharacterLink(creation.submitted.characterLink, current.characterLink)) {
        const changedLink = !sameCharacterLink(current.characterLink, updated.characterLink ?? null)
        const synced = Boolean((changedLink ? current.characterLink : updated.characterLink)?.synced)
        const followupKeys: Array<keyof Draft> = changedLink
          ? ['name', 'characterLink', ...(synced ? [] : ['appearance', 'referenceHash', 'avatarHash', 'avatarCrop'] as Array<keyof Draft>)]
          : synced ? ['name'] : ['name', 'appearance', 'referenceHash']
        const saved = await writeProfile(updated, current, followupKeys)
        updated = saved.savedProfile
        submitted = saved.submitted
        source = saved.base
        savedKeys = followupKeys
      }
    }
    if (!mounted.current || !isCurrentPage(pageLocation, updated.id)) {
      await refreshProfiles(!profile && updated.lorebookIds.length > 0)
      return updated
    }
    // Another caller sharing this creation already adopted it (and maybe saved a follow-up): its base is the latest.
    const adopted = profileRef.current
    if (!source && adopted?.id === updated.id) return adopted
    const changedLink = Boolean(source && savedKeys.includes('characterLink') && !sameCharacterLink(submitted.characterLink, source.characterLink ?? null))
    if (!adoptOwnProfile(updated, { kind: 'save', submitted, keys: savedKeys, linkChanged: changedLink }, source)) {
      throw new ChatEditorResolution(t({ ko: '프로필이 바뀌었어. 다시 시도해.', en: 'The profile changed. Try again.' }), undefined)
    }
    if (!profile) {
      if (!creation!.saveRequested) showSnackbar({ message: t({ ko: '프로필을 저장했어.', en: 'Profile saved.' }), tone: 'info' })
    }
    await refreshProfiles(!profile && updated.lorebookIds.length > 0)
    if (!profile && page && mounted.current && isCurrentPage(pageLocation, updated.id)) {
      cacheProfile(updated)
      onSaved?.(updated, allowNavigation)
    }
    return updated
  }
  /** An applied asset changes the saved profile; the draft takes over just those fields. */
  const assetApplied = (result: ChatAssetApplyResult, slot: { kind: ChatAssetKind; hash: string }, updated?: ChatProfile, source?: ChatProfile | null) => {
    adoptOwnProfile(updated ?? null, { kind: 'asset', result, slot }, source)
  }
  const runs = useProfileAssetRuns({ open, profileId: profile?.id ?? null, ensureProfile, currentProfile: () => profileRef.current, onApplied: assetApplied })
  const link = useProfileCharacterLink({ open, profile, draft, setDraft, adoptOwnProfile, ensureProfile })
  const dirty = profileDirty || link.dirty
  const settingDirtyRef = useRef(link.dirty)
  settingDirtyRef.current = link.dirty
  const { mounted, allowNavigation } = useEditorPageGuard(page && dirty, t({ ko: '프로필에 저장하지 않은 변경이 있어. 나가면 사라져.', en: 'This profile has unsaved changes that will be lost.' }), leavesProfile)
  useEffect(() => {
    onSettingDirtyChange(link.dirty)
    return () => onSettingDirtyChange(false)
  }, [link.dirty, onSettingDirtyChange])
  const isLlm = draft.engine === 'llm'

  const slotsQuery = useQuery({ queryKey: MODEL_SLOTS_QUERY_KEY, queryFn: listModelSlots, enabled: open })
  const slots = slotsQuery.data ?? []
  const slotsSettled = slotsQuery.isSuccess || slotsQuery.isError
  // Reply suggestions can be written by a chat profile (this one too, once saved) or one of the editor's user profiles;
  // one that is off or has no working model is listed greyed out.
  const profilesQuery = useQuery({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY, queryFn: listChatAdminProfiles, enabled: open })
  const userProfilesQuery = useQuery({ queryKey: CHAT_USER_PROFILES_QUERY_KEY, queryFn: listChatUserProfiles, enabled: open })
  const suggestWriters = {
    profiles: profilesQuery.data?.map((entry) => entry.id === profile?.id
      ? { id: entry.id, folderPath: entry.folderPath, sortOrder: entry.sortOrder, name: t({ ko: '{name} (이 프로필)', en: '{name} (this profile)' }, { name: entry.name }), ready: entry.suggestWriterReady !== false }
      : { id: entry.id, folderPath: entry.folderPath, sortOrder: entry.sortOrder, name: entry.name, ready: entry.isEnabled && entry.suggestWriterReady !== false }),
    users: userProfilesQuery.data?.map((entry) => ({ id: entry.id, name: entry.name, ready: entry.modelReady === true })),
  }
  const lorebooksQuery = useQuery({ queryKey: CHAT_LOREBOOK_SUMMARIES_QUERY_KEY, queryFn: listChatLorebookSummaries, enabled: open })
  const linkableLorebooks = lorebooksQuery.data?.filter((book) => book.kind !== 'chat')
  const blocksQuery = useQuery({ queryKey: CHAT_BLOCKS_QUERY_KEY, queryFn: listChatBlocks, enabled: open })
  const codexModelsQuery = useQuery({ queryKey: ['codex-generation-models'], queryFn: getCodexGenerationModels, staleTime: 5 * 60 * 1000, enabled: open && draft.engine === 'codex' })
  const claudeModelsQuery = useQuery({ queryKey: ['claude-models'], queryFn: getClaudeModels, staleTime: 5 * 60 * 1000, enabled: open && draft.engine === 'claude' })

  // An unset chat model follows the representative model; keep the draft unset until the person picks one.
  const defaultSlot = slots.find((slot) => slot.isDefault) ?? null
  const saveMutation = useMutation({
    // Synced: the setting's changed look is stored first (a conflict stops here with both drafts kept), then the
    // profile without the look's fields.
    mutationFn: async () => {
      let submitted = draft
      const sourceLocation = pageLocation
      const pendingCreation = profile ? null : creatingRef.current
      if (pendingCreation) pendingCreation.saveRequested = true
      await link.beforeSave()
      let base = profile
      const setting = link.setting.baseRef.current
      if (base && profileSettingNeedsRefresh(base, setting)) {
        const latest = await getChatAdminProfile(base.id)
        if (!mounted.current || !isCurrentPage(sourceLocation, latest.id)) throw new Error(t({ ko: '편집 중인 프로필이 바뀌어서 저장을 중단했어.', en: 'The open profile changed, so the save was stopped.' }))
        const effect: ProfileOwnEffect = { kind: 'setting', setting: setting!, submitted, previousGroupId: base.expressionGroupId ?? null }
        const merged = mergeOwnProfileDraft(base, latest, submitted, defaults, effect, expectedProfileDraft(base, expectedRef.current))
        if (!merged.conflicts.length && adoptOwnProfile(latest, effect, base)) {
          base = latest
          submitted = merged.draft
        }
      }
      let savedProfile: ChatProfile
      let sourceBase = base
      if (base) {
        const saved = await writeProfile(base, submitted)
        savedProfile = saved.savedProfile
        submitted = saved.submitted
        sourceBase = saved.base
      }
      else {
        const request = pendingCreation ?? createProfileOnce(submitted)
        request.saveRequested = true
        savedProfile = await request.promise
        if (JSON.stringify(submitted) !== JSON.stringify(request.submitted)) {
          if (!mounted.current || !isCurrentPage(sourceLocation, savedProfile.id)) throw new Error(t({ ko: '편집 중인 프로필이 바뀌어서 저장을 중단했어.', en: 'The open profile changed, so the save was stopped.' }))
          const saved = await writeProfile(savedProfile, submitted)
          savedProfile = saved.savedProfile
          submitted = saved.submitted
          sourceBase = saved.base
        } else submitted = request.submitted
      }
      return { savedProfile, submitted, sourceLocation, sourceBase }
    },
    onSuccess: async ({ savedProfile, submitted, sourceLocation, sourceBase }) => {
      const previous = profile?.lorebookIds ?? []
      // Lorebooks list their profiles by name: a link change or a rename of a linked profile refreshes them.
      await refreshProfiles(savedProfile.lorebookIds.length !== previous.length || savedProfile.lorebookIds.some((id) => !previous.includes(id))
        || (previous.length > 0 && savedProfile.name !== profile?.name))
      if (!mounted.current || !isCurrentPage(sourceLocation, savedProfile.id)) return
      showSnackbar({ message: t({ ko: '저장했어.', en: 'Saved.' }), tone: 'info' })
      if (!page && JSON.stringify(draftRef.current) === JSON.stringify(submitted) && !settingDirtyRef.current) { onClose(); return }
      const changedLink = Boolean(sourceBase && !sameCharacterLink(submitted.characterLink, sourceBase.characterLink ?? null))
      if (!adoptOwnProfile(savedProfile, { kind: 'save', submitted, keys: Object.keys(submitted) as Array<keyof Draft>, linkChanged: changedLink }, sourceBase)) return
      if (page) cacheProfile(savedProfile)
      onSaved?.(savedProfile, allowNavigation)
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: error instanceof ChatEditorResolution ? 'info' : 'error' }),
  })
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const sourceLocation = pageLocation
      await deleteChatProfile(profile?.id ?? 0)
      return sourceLocation
    },
    onSuccess: async (sourceLocation) => {
      await refreshProfiles(Boolean(profile?.lorebookIds.length))
      if (!mounted.current || !isCurrentPage(sourceLocation)) return
      if (page) allowNavigation(CHAT_PROFILES_PATH, onClose)
      else onClose()
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '삭제하지 못했어.', en: 'Could not delete.' })), tone: 'error' }),
  })
  const handleDelete = async () => {
    const confirmed = await confirm({
      title: t({ ko: '프로필 삭제', en: 'Delete profile' }),
      description: t({ ko: '이 프로필을 지울까? 이 프로필로 한 채팅은 남지만 더 보낼 수는 없어.', en: 'Delete this profile? Its chats stay but can no longer send.' }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (confirmed) deleteMutation.mutate()
  }
  const handleRevert = async () => {
    const confirmed = await confirm({
      title: t({ ko: '변경 되돌리기', en: 'Revert changes' }),
      description: t({ ko: '저장하지 않은 변경을 모두 되돌릴까?', en: 'Revert every unsaved change?' }),
      confirmLabel: t({ ko: '되돌리기', en: 'Revert' }),
      cancelLabel: t({ ko: '계속 편집', en: 'Keep editing' }),
      tone: 'destructive',
    })
    if (!confirmed) return
    expectedRef.current = null
    setDraft(buildDraft(profile ?? initialDraft ?? null, defaults, initialFolderId))
    const settingBase = link.setting.baseRef.current
    if (link.dirty && settingBase) link.setting.patch(settingDraftOf(settingBase))
  }

  const backgroundUrl = draftProfileAssetUrl(draft, profile, 'background')
  const nameMissing = draft.name.trim().length === 0
  const connectionMissing = isLlm && !draft.modelSlotId && defaultSlot === null
  const canSave = !nameMissing && !connectionMissing && !assetBusy && !saveMutation.isPending && !deleteMutation.isPending
  useImperativeHandle(ref, () => ({ save: () => { if (canSave) saveMutation.mutate() } }))
  const incompleteLabel = t({ ko: '입력 필요', en: 'Needs input' })

  // What each section holds, one line under its name in the section list.
  const modelLine = draft.engine === 'codex' ? `Codex · ${draft.model || t({ ko: '기본 모델', en: 'default model' })}`
    : draft.engine === 'claude' ? `Claude Code · ${draft.model || 'sonnet'}`
      : draft.modelSlotId !== null ? slots.find((slot) => slot.id === draft.modelSlotId)?.label ?? t({ ko: '모델 없음', en: 'No model' })
        : defaultSlot ? t({ ko: '대표 모델 · {label}', en: 'Default · {label}' }, { label: defaultSlot.label }) : t({ ko: '모델 없음', en: 'No model' })
  const sections: Array<{ value: ProfileEditorSection; label: string; icon: typeof UserRound; incomplete?: boolean }> = [
    { value: 'basic', label: t({ ko: '기본 정보', en: 'Basics' }), icon: UserRound, incomplete: nameMissing },
    { value: 'character', label: t({ ko: '캐릭터', en: 'Character' }), icon: FileText },
    { value: 'appearance', label: t({ ko: '외형', en: 'Appearance' }), icon: ImageIcon },
    { value: 'model', label: t({ ko: '모델', en: 'Model' }), icon: Sparkles, incomplete: connectionMissing },
    { value: 'memory', label: t({ ko: '기억', en: 'Memory' }), icon: BookOpen },
    { value: 'tools', label: t({ ko: '도구', en: 'Tools' }), icon: Wrench },
    { value: 'look', label: t({ ko: '꾸미기', en: 'Look' }), icon: Palette },
  ]
  const current = sections.find((entry) => entry.value === section)!
  const go = (next: ProfileEditorSection) => { if (!assetBusy) { setSection(next); setShowingList(false) } }
  // A connected chat reads and fills this draft, opens sections, and asks (by card) to save or generate images.
  const assist = useProfileEditorChatPage({
    open, profile, draft, setDraft, dirty, section, go, slots,
    lorebooks: linkableLorebooks, blocks: blocksQuery.data, runs, link, save: () => saveMutation.mutateAsync(),
  })
  const mark = (entry: (typeof sections)[number]) => entry.incomplete
    ? <><span aria-hidden="true" className="size-1.5 rounded-full bg-primary" /><span className="sr-only">{incompleteLabel}</span></>
    : assist.sectionFilled(entry.value)
      ? <Tip content={t({ ko: '어시스턴트가 채움', en: 'Filled by the assistant' })}><span role="img" aria-label={t({ ko: '어시스턴트가 채움', en: 'Filled by the assistant' })} className="size-1.5 rounded-full bg-primary" /></Tip>
      : null

  const panel = <>
    {section === 'basic' ? <ChatProfileBasicPanel draft={draft} patch={patch} profile={profile} audience={audience} onOpenAppearance={() => go('appearance')} /> : null}
    {section === 'character' ? (
      <ChatProfileCharacterPanel open={open} draft={draft} patch={patch} onPreview={() => setPreviewDraft({ ...draft, id: profile?.id })} profile={profile} />
    ) : null}
    {section === 'appearance' ? (
      <ChatProfileAppearancePanel draft={draft} patch={(next) => setDraft((current) => rebaseAppearancePatch(draft, current, next))} profile={profile} dirty={!page && dirty} onBusyChange={onAssetBusyChange} busy={assetBusy} runs={runs} ensureProfile={ensureProfile} onProfileChange={adoptOwnProfile} link={link} />
    ) : null}
    {section === 'model' ? (
      <ChatProfileModelPanel
        draft={draft}
        patch={patch}
        defaults={defaults}
        slots={slots}
        slotsReady={slotsSettled}
        suggestWriters={suggestWriters}
        codexModels={codexModelsQuery.data?.data.models}
        claudeModels={claudeModelsQuery.data?.models}
      />
    ) : null}
    {section === 'memory' ? <ChatProfileMemoryPanel draft={draft} patch={patch} lorebooks={linkableLorebooks} /> : null}
    {section === 'tools' ? <ChatProfileToolsPanel open={open} draft={draft} patch={patch} defaults={defaults} /> : null}
    {section === 'look' ? <ChatProfileLookPanel profile={profile} draft={draft} patch={patch} defaults={defaults?.style} backgroundUrl={backgroundUrl} blocks={blocksQuery.data} onBusyChange={onAssetBusyChange} busy={assetBusy} runs={runs} /> : null}
  </>
  const preview = previewDraft ? <ChatProfilePreviewModal open draft={previewDraft} onClose={() => setPreviewDraft(null)} /> : null

  if (page) {
    const navSections: Array<EditorSectionEntry<ProfileEditorSection>> = sections.map((entry) => ({ value: entry.value, label: entry.label, icon: entry.icon, mark: mark(entry), disabled: assetBusy && entry.value !== section }))
    return (
      <ProfileAssistContext.Provider value={assist}>
        <EditorPage
          crumbs={profileCrumbs(t, navigate, pageLocation?.search)}
          title={draft.name.trim() || profile?.name || t({ ko: '새 프로필', en: 'New profile' })}
          status={<>
            {profile ? null : <Chip tone="muted" size="sm">{t({ ko: '아직 저장 안 한 새 프로필', en: 'New, not saved yet' })}</Chip>}
            <Chip tone={draft.isEnabled ? 'success' : 'muted'} size="sm">{draft.isEnabled ? t({ ko: '채팅에서 사용 중', en: 'In use' }) : t({ ko: '꺼짐', en: 'Off' })}</Chip>
            <Chip tone="muted" size="sm">{audience.picked.length ? t({ ko: '{who}만 사용', en: 'Only {who}' }, { who: audience.summary }) : t({ ko: '모두 사용 가능', en: 'Everyone' })}</Chip>
          </>}
          actions={(
            <ActionMenuButton
              label={t({ ko: '프로필 작업', en: 'Profile actions' })}
              entries={[
                { key: 'preview', label: t({ ko: '프롬프트 미리보기', en: 'Prompt preview' }), icon: Eye, onSelect: () => setPreviewDraft({ ...draft, id: profile?.id }) },
                profile ? '-' : null,
                profile ? { key: 'delete', label: t({ ko: '삭제', en: 'Delete' }), icon: Trash2, destructive: true, disabled: assetBusy || deleteMutation.isPending, onSelect: () => void handleDelete() } : null,
              ]}
            />
          )}
          nav={(
            <EditorSectionNav
              sections={navSections}
              value={section}
              onChange={go}
              label={t({ ko: '프로필 편집 항목', en: 'Profile sections' })}
              header={(
                <div className="flex min-w-0 items-center gap-2.5 px-2.5 pt-1">
                  <ChatProfileAvatar name={draft.name || '?'} avatar={draft.avatar} imageUrl={draftProfileAssetUrl(draft, profile, 'avatar')} avatarCrop={draft.avatarHash ? draft.avatarCrop : null} engine={draft.engine} size="sm" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-semibold">{draft.name.trim() || t({ ko: '새 프로필', en: 'New profile' })}</span>
                    <span className="truncate text-xs text-muted-foreground">{modelLine}</span>
                  </span>
                </div>
              )}
            />
          )}
          navLabel={t({ ko: '프로필 편집 항목', en: 'Profile sections' })}
          storageKey="chat-profile-editor"
          onSave={() => { if (canSave) saveMutation.mutate() }}
          saveBar={dirty || saveMutation.isPending ? (
            <FloatingSaveBar
              label={profile ? t({ ko: '저장 안 한 변경', en: 'Unsaved changes' }) : t({ ko: '새 프로필', en: 'New profile' })}
              saving={saveMutation.isPending}
              canSave={canSave}
              onSave={() => saveMutation.mutate()}
              onDiscard={() => void handleRevert()}
            >
              {nameMissing ? <span className="text-xs text-muted-foreground">{t({ ko: '이름을 적어야 저장할 수 있어', en: 'Needs a name to save' })}</span>
                : connectionMissing ? <span className="text-xs text-muted-foreground">{t({ ko: '모델을 골라야 저장할 수 있어', en: 'Needs a model to save' })}</span> : null}
            </FloatingSaveBar>
          ) : null}
        >
          <h2 className="text-base font-semibold text-foreground">{current.label}</h2>
          <div className="min-w-0 space-y-4">{panel}</div>
          {preview}
        </EditorPage>
      </ProfileAssistContext.Provider>
    )
  }

  return (
    <>
      <ProfileAssistContext.Provider value={assist}>
      <div className="grid gap-x-6 md:grid-cols-[10.5rem_minmax(0,1fr)]">
        <nav aria-label={t({ ko: '프로필 편집 항목', en: 'Profile sections' })} className={cn('self-start md:sticky md:top-0 md:block', !showingList && 'max-md:hidden')}>
          <ul className="space-y-0.5 max-md:divide-y max-md:divide-line">
            {sections.map((entry) => (
              <li key={entry.value}>
                <SidebarItem
                  active={entry.value === section}
                  disabled={assetBusy && entry.value !== section}
                  onClick={() => go(entry.value)}
                  className="w-full max-md:min-h-12"
                  icon={entry.icon}
                  label={entry.label}
                  trailing={<>{mark(entry)}<ChevronRight className="text-muted-foreground md:hidden" /></>}
                />
              </li>
            ))}
          </ul>
        </nav>

        <div className={cn('min-w-0 space-y-4', showingList && 'max-md:hidden')}>
          <div className="flex items-center gap-1 md:hidden">
            <IconButton size="icon-sm" variant="ghost" onClick={() => setShowingList(true)} label={t({ ko: '항목 목록', en: 'Sections' })}><ChevronLeft /></IconButton>
            <span className="text-sm font-semibold">{current.label}</span>
          </div>
          {panel}
        </div>
      </div>
      </ProfileAssistContext.Provider>
      <EditorFooter
        onDelete={profile ? () => void handleDelete() : undefined}
        deleteDisabled={assetBusy}
        deleting={deleteMutation.isPending}
        onSave={() => saveMutation.mutate()}
        canSave={canSave}
        saving={saveMutation.isPending}
      />
      {preview}
    </>
  )
}
