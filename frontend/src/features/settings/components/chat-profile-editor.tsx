import { useEffect, useImperativeHandle, useRef, useState, type Dispatch, type Ref, type SetStateAction } from 'react'
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
  chatProfileSaveInput,
  emoticonGroupsAfterServerChange,
  sameCharacterLink,
  createChatProfile,
  deleteChatProfile,
  getChatProfileDefaults,
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
import { CHAT_PROFILE_DEFAULTS, CHAT_PROFILE_TEXT_LIMITS, CHAT_TRANSLATION_DEFAULTS, type ChatProfileCharacterLinkInput } from '@conai/shared'
import { useUnsavedSettingsGuard } from '../use-unsaved-settings-guard'
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
export type ChatProfileEditorPageState = { draft?: ChatProfileInput; copyOf?: number }

function buildDraft(profile: ChatProfileInput | null, defaults: ChatProfileDefaults | undefined): Draft {
  return {
    name: profile?.name ?? '',
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
  /** The profile a new one copies (initialDraft holds its settings). */
  copyOf?: number
  /** A library link the draft starts with over the stored profile's (a proposal's, not stored yet). */
  draftLink?: ChatProfileCharacterLinkInput
  defaults: ChatProfileDefaults | undefined
  onClose: () => void
}

/** One editor's profile and draft, kept while the server defaults load, fail or retry. */
function useProfileEditorDraft({ open, profile: initialProfile, initialDraft, draftLink, defaults }: Pick<ProfileEditorProps, 'open' | 'profile' | 'initialDraft' | 'draftLink' | 'defaults'>) {
  const defaultsQuery = useQuery({ queryKey: CHAT_PROFILE_DEFAULTS_QUERY_KEY, queryFn: getChatProfileDefaults, enabled: open && !defaults, staleTime: Infinity })
  const currentDefaults = defaults ?? defaultsQuery.data
  const [profile, setProfile] = useState(initialProfile)
  const editorSession = useRef({ open: false, id: initialProfile?.id ?? null })
  const [draft, setDraft] = useState<Draft | null>(() => {
    const built = profile || currentDefaults ? buildDraft(profile ?? initialDraft ?? null, currentDefaults) : null
    return built && profile && draftLink !== undefined ? { ...built, characterLink: draftLink } : built
  })
  const [draftDefaults, setDraftDefaults] = useState(currentDefaults)
  if (currentDefaults !== draftDefaults) {
    setDraftDefaults(currentDefaults)
    if (!profile && currentDefaults && (!draft || (draftDefaults && JSON.stringify(draft) === JSON.stringify(buildDraft(initialDraft ?? null, draftDefaults))))) {
      setDraft(buildDraft(initialDraft ?? null, currentDefaults))
    }
  }
  useEffect(() => {
    if (open && (!editorSession.current.open || editorSession.current.id !== (initialProfile?.id ?? null))) {
      setProfile(initialProfile)
      const built = initialProfile || currentDefaults ? buildDraft(initialProfile ?? initialDraft ?? null, currentDefaults) : null
      setDraft(built && initialProfile && draftLink !== undefined ? { ...built, characterLink: draftLink } : built)
    }
    editorSession.current = { open, id: initialProfile?.id ?? null }
  }, [currentDefaults, initialDraft, open, initialProfile, draftLink])

  const dirty = open && ((!profile && Boolean(initialDraft)) || (draft !== null && JSON.stringify(draft) !== JSON.stringify(buildDraft(profile ?? initialDraft ?? null, currentDefaults))))
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

/** Leaving the open profile (its address changes); a new one moving to its own id after its first save stays. */
function leavesProfile(current: Location, next: Location) {
  if (current.pathname !== next.pathname) return true
  const before = new URLSearchParams(current.search).get('profile')
  const after = new URLSearchParams(next.search).get('profile')
  if (before === 'new' && after !== null && /^\d+$/.test(after)) return false
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
  const id = raw && /^\d+$/.test(raw) ? Number(raw) : null
  const pageState = (location.state ?? null) as ChatProfileEditorPageState | null
  const profilesQuery = useQuery({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY, queryFn: listChatAdminProfiles })
  const found = id === null ? null : profilesQuery.data?.find((entry) => entry.id === id) ?? null
  const back = () => navigate(CHAT_PROFILES_PATH)
  if (id !== null && !found) {
    return (
      <EditorPage crumbs={profileCrumbs(t, navigate)} title={t({ ko: '채팅 프로필', en: 'Chat profile' })}>
        {profilesQuery.isPending ? <LoadingState variant="inline" /> : profilesQuery.isError
          ? <ErrorState title={t({ ko: '프로필을 불러오지 못했어', en: 'Could not load the profile' })} error={profilesQuery.error} onRetry={() => void profilesQuery.refetch()} />
          : <EmptyState icon={UserRound} title={t({ ko: '프로필을 찾지 못했어', en: 'Profile not found' })} action={<Button variant="secondary" size="sm" onClick={back}>{t({ ko: '프로필 목록', en: 'Profile list' })}</Button>} />}
      </EditorPage>
    )
  }
  return <ProfileEditorPageBody profile={found} initialDraft={id === null ? pageState?.draft : undefined} copyOf={id === null ? pageState?.copyOf : undefined} onClose={back} />
}

const profileCrumbs = (t: ReturnType<typeof useI18n>['t'], navigate: ReturnType<typeof useNavigate>): PathCrumb[] => [
  { key: 'characters', label: t({ ko: '캐릭터', en: 'Characters' }), onClick: () => navigate('/characters') },
  { key: 'profiles', label: t({ ko: '채팅 프로필', en: 'Chat profiles' }), onClick: () => navigate(CHAT_PROFILES_PATH) },
]

function ProfileEditorPageBody({ profile, initialDraft, copyOf, onClose }: { profile: ChatProfile | null; initialDraft?: ChatProfileInput; copyOf?: number; onClose: () => void }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const state = useProfileEditorDraft({ open: true, profile, initialDraft, defaults: undefined })
  if (!state.draft) {
    return <EditorPage crumbs={profileCrumbs(t, navigate)} title={t({ ko: '새 프로필', en: 'New profile' })}><DefaultsState query={state.defaultsQuery} /></EditorPage>
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
      copyOf={copyOf}
      defaults={state.currentDefaults}
      onClose={onClose}
      // A new profile's page moves to its id (the same editor stays, so nothing in progress is lost).
      onSaved={(saved) => { if (!profile) navigate(chatProfileEditorPath(saved.id), { replace: true }) }}
    />
  )
}

function ProfileEditor({ layout, open, profile, setProfile, draft, setDraft, dirty: profileDirty, onSettingDirtyChange, initialDraft, copyOf, defaults, onClose, onSaved, ref }: ProfileEditorProps & {
  layout: 'modal' | 'page'
  draft: Draft
  setDraft: Dispatch<SetStateAction<Draft>>
  setProfile: Dispatch<SetStateAction<ChatProfile | null>>
  dirty: boolean
  onSettingDirtyChange: (dirty: boolean) => void
  /** The page stays open after a save; the dialog closes instead. */
  onSaved?: (profile: ChatProfile) => void
  ref?: Ref<{ save: () => void }>
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const page = layout === 'page'
  const [section, setSection] = useState<ProfileEditorSection>(profile ? 'character' : 'basic')
  const [showingList, setShowingList] = useState(true)
  const [assetImports, setAssetImports] = useState(0)
  const assetBusy = assetImports > 0
  const onAssetBusyChange = (busy: boolean) => setAssetImports((count) => Math.max(0, count + (busy ? 1 : -1)))
  const [previewDraft, setPreviewDraft] = useState<(ChatProfileInput & { id?: number }) | null>(null)
  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }))
  const audience = useAudience(draft)
  const refreshProfiles = (lorebooksChanged = false) => Promise.all([
    queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: CHAT_PROFILES_QUERY_KEY }),
    ...(lorebooksChanged ? [queryClient.invalidateQueries({ queryKey: CHAT_LOREBOOKS_QUERY_KEY })] : []),
  ])
  /**
   * Saves what generation reads (name, appearance, reference); a new profile is created whole first. A changed library
   * link is stored too (with the look a detached profile keeps), so the server has detached it and copied the
   * expressions before any library store or profile-owned batch runs.
   */
  const ensureProfile = async () => {
    const linkChanged = profile !== null && !sameCharacterLink(draft.characterLink, profile.characterLink ?? null)
    const syncedAfter = Boolean((linkChanged ? draft.characterLink : profile?.characterLink)?.synced)
    const look = { appearance: draft.appearance, referenceHash: draft.referenceHash }
    const updated = profile
      // A synced profile's look is its setting's: only the name (and the link) is sent then.
      ? await updateChatProfile(profile.id, linkChanged
        ? chatProfileSaveInput({ name: draft.name, characterLink: draft.characterLink, ...(syncedAfter ? {} : { ...look, avatarHash: draft.avatarHash, avatarCrop: draft.avatarCrop }) })
        : syncedAfter ? { name: draft.name } : { name: draft.name, ...look })
      : await createChatProfile(chatProfileSaveInput(draft), copyOf)
    setProfile(updated)
    if (profile && linkChanged) {
      // The server swapped the expression groups the link brings; the draft's list takes just that change.
      // Synced now: the stored look is the setting's, so the draft takes it (the profile reads as unchanged there).
      const storedLook = syncedAfter ? Object.fromEntries(CHAT_PROFILE_SYNCED_KEYS.map((key) => [key, updated[key]])) as Partial<Draft> : {}
      setDraft((current) => ({ ...current, ...storedLook, style: { ...current.style, emoticonGroupIds: emoticonGroupsAfterServerChange(profile.style.emoticonGroupIds, updated.style.emoticonGroupIds, current.style.emoticonGroupIds) } }))
    }
    if (!profile) {
      setDraft(buildDraft(updated, defaults))
      showSnackbar({ message: t({ ko: '프로필을 저장했어.', en: 'Profile saved.' }), tone: 'info' })
    }
    await refreshProfiles(!profile && updated.lorebookIds.length > 0)
    return updated
  }
  /** An applied asset changes the saved profile; the draft takes over just those fields. */
  const assetApplied = (result: ChatAssetApplyResult, slot: { kind: ChatAssetKind; hash: string }, updated?: ChatProfile) => {
    if (updated) setProfile(updated)
    setDraft((current) => {
      const next = { ...current }
      if (slot.kind === 'reference') next.referenceHash = slot.hash
      if (slot.kind === 'avatar') { if (next.avatarHash !== slot.hash) next.avatar = null; next.avatarHash = slot.hash; next.avatarCrop = null }
      if (slot.kind === 'background') { next.backgroundHash = slot.hash; next.background = undefined }
      const groupId = result.applied.expressionGroupId
      if (groupId) next.style = { ...next.style, emoticonGroupIds: [groupId, ...next.style.emoticonGroupIds.filter((id) => id !== groupId)] }
      if (updated && result.applied.profileFields.includes('avatarHash')) { next.avatarHash = updated.avatarHash; next.avatarCrop = updated.avatarCrop; next.avatar = updated.avatar }
      return next
    })
  }
  const runs = useProfileAssetRuns({ open, profileId: profile?.id ?? null, ensureProfile, onApplied: assetApplied })
  const link = useProfileCharacterLink({ open, profile, draft, setDraft, setProfile, ensureProfile })
  const dirty = profileDirty || link.dirty
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
      ? { id: entry.id, name: t({ ko: '{name} (이 프로필)', en: '{name} (this profile)' }, { name: entry.name }), ready: entry.suggestWriterReady !== false }
      : { id: entry.id, name: entry.name, ready: entry.isEnabled && entry.suggestWriterReady !== false }),
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
      await link.beforeSave()
      const input = chatProfileSaveInput(draft, profile?.characterLink ?? null)
      return profile ? updateChatProfile(profile.id, input) : createChatProfile(input, copyOf)
    },
    onSuccess: async (savedProfile) => {
      const previous = profile?.lorebookIds ?? []
      // Lorebooks list their profiles by name: a link change or a rename of a linked profile refreshes them.
      await refreshProfiles(savedProfile.lorebookIds.length !== previous.length || savedProfile.lorebookIds.some((id) => !previous.includes(id))
        || (previous.length > 0 && savedProfile.name !== profile?.name))
      if (!page) { onClose(); return }
      setProfile(savedProfile)
      setDraft(buildDraft(savedProfile, defaults))
      showSnackbar({ message: t({ ko: '저장했어.', en: 'Saved.' }), tone: 'info' })
      onSaved?.(savedProfile)
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' }),
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteChatProfile(profile?.id ?? 0),
    onSuccess: async () => {
      await refreshProfiles(Boolean(profile?.lorebookIds.length))
      onClose()
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '삭제하지 못했어.', en: 'Could not delete.' })), tone: 'error' }),
  })
  // The page asks before leaving with unsaved edits; a running save or delete leaves on its own.
  useUnsavedSettingsGuard(page && dirty && !saveMutation.isPending && !deleteMutation.isPending, t({ ko: '프로필에 저장하지 않은 변경이 있어. 나가면 사라져.', en: 'This profile has unsaved changes that will be lost.' }), leavesProfile)

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
    setDraft(buildDraft(profile ?? initialDraft ?? null, defaults))
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
      <ChatProfileAppearancePanel draft={draft} patch={patch} profile={profile} dirty={dirty} onBusyChange={onAssetBusyChange} busy={assetBusy} runs={runs} ensureProfile={ensureProfile} onProfileChange={setProfile} link={link} />
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
          crumbs={profileCrumbs(t, navigate)}
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
