import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, ChevronLeft, ChevronRight, Image as ImageIcon, Palette, Save, Sparkles, Trash2, UserRound, Users, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Switch } from '@/components/ui/switch'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { listAuthPermissionGroups } from '@/lib/api-auth'
import {
  CHAT_ADMIN_PROFILES_QUERY_KEY,
  CHAT_BLOCKS_QUERY_KEY,
  CHAT_LOREBOOKS_QUERY_KEY,
  OWN_LOREBOOKS_QUERY_KEY,
  CHAT_PROFILES_QUERY_KEY,
  CHAT_USER_PROFILES_QUERY_KEY,
  MODEL_SLOTS_QUERY_KEY,
  createChatProfile,
  deleteChatProfile,
  listChatAdminProfiles,
  listChatBlocks,
  listChatLorebooks,
  listChatUserProfiles,
  listOwnLorebooks,
  listModelSlots,
  updateChatProfile,
  type ChatProfile,
  type ChatAssetApplyResult,
  type ChatAssetKind,
  type ChatProfileDefaults,
  type ChatProfileInput,
  type ChatStyle,
} from '@/lib/api-codex-chat'
import { getCodexGenerationModels } from '@/lib/api-image-generation-queue'
import { getClaudeModels } from '@/lib/api-agent-cli'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
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
import { ProfileAssistContext, useProfileEditorChatPage } from './use-profile-editor-chat-page'

type EditorSection = 'character' | 'appearance' | 'model' | 'memory' | 'tools' | 'look'

const ADVANCED_KEY = 'conai:chat-profile-editor:advanced'

/** Shown until the server's defaults load (new profiles only). */
const FALLBACK_STYLE: ChatStyle = { typeface: 'sans', roleplay: false, colors: { dialogue: '', narration: '', thought: '' }, backgroundDim: 55, backgroundBlur: 0, blocks: [], cast: [], emoticonGroupIds: [] }

function buildDraft(profile: ChatProfileInput | null, defaults: ChatProfileDefaults | undefined): Draft {
  return {
    name: profile?.name ?? '',
    tagline: profile?.tagline ?? '',
    lorebookIds: profile?.lorebookIds ?? [],
    blockIds: profile?.blockIds ?? [],
    loreScanDepth: profile?.loreScanDepth ?? defaults?.loreScanDepth ?? 4,
    loreTokenBudget: profile?.loreTokenBudget ?? defaults?.loreTokenBudget ?? 1024,
    loreDepth: profile?.loreDepth ?? defaults?.loreDepth ?? 4,
    authorNote: profile?.authorNote ?? '',
    avatar: profile?.avatar ?? null,
    appearance: profile?.appearance,
    referenceHash: profile?.referenceHash,
    avatarHash: profile?.avatarHash,
    avatarCrop: profile?.avatarCrop,
    backgroundHash: profile?.backgroundHash,
    engine: profile?.engine ?? 'llm',
    model: profile?.model ?? '',
    reasoningEffort: profile?.reasoningEffort ?? '',
    reasoningBudgetTokens: profile?.reasoningBudgetTokens ?? null,
    extraParams: profile?.extraParams ?? '',
    systemPrompt: profile?.systemPrompt ?? '',
    promptSections: profile?.promptSections ?? [],
    greeting: profile?.greeting ?? '',
    alternateGreetings: profile?.alternateGreetings ?? [],
    temperature: profile?.temperature ?? null,
    maxTokens: profile?.maxTokens ?? null,
    mcpEnabled: profile?.mcpEnabled ?? false,
    allowedGroupKeys: profile?.allowedGroupKeys ?? [],
    generationPresetIds: profile?.generationPresetIds ?? [],
    mcpScopes: profile?.mcpScopes ?? ['read'],
    toolAllowlist: profile?.toolAllowlist ?? null,
    toolOutputLimit: profile?.toolOutputLimit ?? defaults?.toolOutputLimit ?? 12000,
    contextTurns: profile?.contextTurns ?? defaults?.contextTurns ?? 20,
    contextTokens: profile?.contextTokens ?? null,
    summaryEnabled: profile?.summaryEnabled ?? false,
    summaryTriggerTurns: profile?.summaryTriggerTurns ?? defaults?.summaryTriggerTurns ?? 6,
    summaryPrompt: profile?.summaryPrompt ?? '',
    translationInstructions: profile?.translationInstructions ?? '',
    suggestEnabled: profile?.suggestEnabled ?? false,
    modelSlotId: profile?.modelSlotId ?? null,
    summarySlotId: profile?.summarySlotId ?? null,
    translationSlotId: profile?.translationSlotId ?? null,
    suggestSlotId: profile?.suggestSlotId ?? null,
    suggestProfileId: profile?.suggestProfileId ?? null,
    suggestUserProfileId: profile?.suggestUserProfileId ?? null,
    maxToolRounds: profile?.maxToolRounds ?? defaults?.maxToolRounds ?? 8,
    visionEnabled: profile?.visionEnabled ?? false,
    contentRatingMode: profile?.contentRatingMode ?? 'model',
    contentRatingTierId: profile?.contentRatingTierId ?? null,
    pageAssist: profile?.pageAssist ?? false,
    allowLoreProposals: profile?.allowLoreProposals ?? true,
    judgePresetId: profile?.judgePresetId ?? null,
    judgeSlotId: profile?.judgeSlotId ?? null,
    style: { ...FALLBACK_STYLE, ...(profile?.style ?? defaults?.style) },
    isEnabled: profile?.isEnabled ?? true,
    sortOrder: profile?.sortOrder ?? 0,
  }
}


/**
 * Who may chat with this profile: everyone with the engine's permission, or members of the picked groups.
 * Administrators always may, so picking only Administrators keeps the profile to them.
 */
function AudienceMenu({ draft, patch }: { draft: Draft; patch: PatchDraft }) {
  const { t } = useI18n()
  const groupsQuery = useQuery({ queryKey: ['auth-permission-groups', 'all'], queryFn: listAuthPermissionGroups, staleTime: 60_000, retry: false })
  const groups = (groupsQuery.data ?? []).filter((group) => group.groupKey === 'admin' || !group.systemGroup)
  const picked = draft.allowedGroupKeys
  const nameOf = (key: string) => (key === 'admin' ? t({ ko: '관리자', en: 'Administrators' }) : groups.find((group) => group.groupKey === key)?.name ?? key)
  const summary = picked.length === 0 ? t({ ko: '모두', en: 'Everyone' }) : picked.length === 1 ? nameOf(picked[0]) : t({ ko: '그룹 {count}', en: '{count} groups' }, { count: picked.length })
  const toggle = (key: string) => patch({ allowedGroupKeys: picked.includes(key) ? picked.filter((item) => item !== key) : [...picked, key] })
  return (
    <DropdownMenu>
      <Tip content={t({ ko: '사용 대상', en: 'Who can use it' })}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="max-w-40 gap-1.5 text-muted-foreground" aria-label={t({ ko: '사용 대상: {who}', en: 'Who can use it: {who}' }, { who: summary })}>
            <Users />
            <span className="truncate max-sm:hidden">{summary}</span>
          </Button>
        </DropdownMenuTrigger>
      </Tip>
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

/**
 * Create or edit one chat profile. A list of sections on the left (on a phone: the list, then one section at a time);
 * one draft spans them, so switching loses nothing. The header holds who may use it, the on switch and the switch that
 * shows the advanced fields in every section.
 */
export function ChatProfileEditorModal({ open, profile: initialProfile, initialDraft, defaults, onClose }: {
  open: boolean
  profile: ChatProfile | null
  initialDraft?: ChatProfileInput
  defaults: ChatProfileDefaults | undefined
  onClose: () => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [profile, setProfile] = useState(initialProfile)
  const editorSession = useRef({ open: false, id: initialProfile?.id ?? null })
  const [draft, setDraft] = useState<Draft>(() => buildDraft(profile ?? initialDraft ?? null, defaults))
  const [section, setSection] = useState<EditorSection>('character')
  /** Phone layout: the section list until one is picked. */
  const [showingList, setShowingList] = useState(true)
  const [advanced, setAdvanced] = useState(() => { try { return localStorage.getItem(ADVANCED_KEY) === '1' } catch { return false } })
  const [assetImports, setAssetImports] = useState(0)
  const assetBusy = assetImports > 0
  const onAssetBusyChange = (busy: boolean) => setAssetImports((count) => Math.max(0, count + (busy ? 1 : -1)))
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    if (open && (!editorSession.current.open || editorSession.current.id !== (initialProfile?.id ?? null))) {
      setProfile(initialProfile)
      setDraft(buildDraft(initialProfile ?? initialDraft ?? null, defaults))
      setSection('character')
      setShowingList(true)
    }
    editorSession.current = { open, id: initialProfile?.id ?? null }
  }, [defaults, initialDraft, open, initialProfile])

  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }))
  const toggleAdvanced = (next: boolean) => {
    setAdvanced(next)
    try { localStorage.setItem(ADVANCED_KEY, next ? '1' : '0') } catch { /* Storage can be unavailable. */ }
  }
  const refreshProfiles = () => Promise.all([queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY }), queryClient.invalidateQueries({ queryKey: CHAT_PROFILES_QUERY_KEY })])
  /** Saves what generation reads (name, appearance, reference); a new profile is created whole first. */
  const ensureProfile = async () => {
    const updated = profile ? await updateChatProfile(profile.id, { name: draft.name, appearance: draft.appearance, referenceHash: draft.referenceHash }) : await createChatProfile(draft)
    setProfile(updated)
    if (!profile) {
      setDraft(buildDraft(updated, defaults))
      showSnackbar({ message: t({ ko: '프로필을 저장했어.', en: 'Profile saved.' }), tone: 'info' })
    }
    await refreshProfiles()
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
  const runs = useProfileAssetRuns({ profileId: profile?.id ?? null, ensureProfile, onApplied: assetApplied })
  const isLlm = draft.engine === 'llm'

  const slotsQuery = useQuery({ queryKey: MODEL_SLOTS_QUERY_KEY, queryFn: listModelSlots, enabled: open })
  const slots = slotsQuery.data ?? []
  const slotsSettled = slotsQuery.isSuccess || slotsQuery.isError
  // Reply suggestions can be written by a chat profile (this one too, once saved) or one of the editor's user profiles;
  // one that is off or has no working model is listed greyed out.
  const profilesQuery = useQuery({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY, queryFn: listChatAdminProfiles, enabled: open })
  const userProfilesQuery = useQuery({ queryKey: CHAT_USER_PROFILES_QUERY_KEY, queryFn: listChatUserProfiles, enabled: open })
  const suggestWriters = useMemo(() => ({
    profiles: profilesQuery.data?.map((entry) => entry.id === profile?.id
      ? { id: entry.id, name: t({ ko: '{name} (이 프로필)', en: '{name} (this profile)' }, { name: entry.name }), ready: entry.suggestWriterReady !== false }
      : { id: entry.id, name: entry.name, ready: entry.isEnabled && entry.suggestWriterReady !== false }),
    users: userProfilesQuery.data?.map((entry) => ({ id: entry.id, name: entry.name, ready: entry.modelReady === true })),
  }), [profilesQuery.data, userProfilesQuery.data, profile?.id, t])
  const lorebooksQuery = useQuery({ queryKey: CHAT_LOREBOOKS_QUERY_KEY, queryFn: listChatLorebooks, enabled: open })
  // The editor's own account books can be linked too (another account's book on the profile stays as it is).
  const ownLorebooksQuery = useQuery({ queryKey: OWN_LOREBOOKS_QUERY_KEY, queryFn: listOwnLorebooks, enabled: open })
  const linkableLorebooks = useMemo(() => lorebooksQuery.data ? [...lorebooksQuery.data, ...(ownLorebooksQuery.data ?? []).filter((book) => book.kind === 'account')] : undefined, [lorebooksQuery.data, ownLorebooksQuery.data])
  const blocksQuery = useQuery({ queryKey: CHAT_BLOCKS_QUERY_KEY, queryFn: listChatBlocks, enabled: open })
  const codexModelsQuery = useQuery({ queryKey: ['codex-generation-models'], queryFn: getCodexGenerationModels, staleTime: 5 * 60 * 1000, enabled: open && draft.engine === 'codex' })
  const claudeModelsQuery = useQuery({ queryKey: ['claude-models'], queryFn: getClaudeModels, staleTime: 5 * 60 * 1000, enabled: open && draft.engine === 'claude' })

  // A new API LLM profile starts on the default model; waits for the model list. Existing profiles keep what they have
  // (no model of their own means the default anyway). Declared after the draft reset so it applies on top of it.
  const defaultSlotId = slots.find((slot) => slot.isDefault)?.id ?? null
  useEffect(() => {
    if (!open || !slotsSettled || profile || defaultSlotId === null) return
    setDraft((current) => (current.engine !== 'llm' || current.modelSlotId ? current : { ...current, modelSlotId: defaultSlotId }))
  }, [open, slotsSettled, defaultSlotId, draft.engine, profile])

  const refresh = async () => {
    await Promise.all([refreshProfiles(), queryClient.invalidateQueries({ queryKey: CHAT_LOREBOOKS_QUERY_KEY })])
  }
  const saveMutation = useMutation({
    mutationFn: () => (profile ? updateChatProfile(profile.id, draft) : createChatProfile(draft)),
    onSuccess: async () => {
      await refresh()
      onClose()
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' }),
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteChatProfile(profile?.id ?? 0),
    onSuccess: async () => {
      await refresh()
      onClose()
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

  const backgroundUrl = draftProfileAssetUrl(draft, profile, 'background')
  const nameMissing = draft.name.trim().length === 0
  const connectionMissing = isLlm && !draft.modelSlotId && defaultSlotId === null
  const canSave = !nameMissing && !connectionMissing && !assetBusy && !saveMutation.isPending
  const incompleteLabel = t({ ko: '입력 필요', en: 'Needs input' })

  const sections: Array<{ value: EditorSection; label: string; icon: ReactNode; incomplete?: boolean }> = [
    { value: 'character', label: t({ ko: '캐릭터', en: 'Character' }), icon: <UserRound />, incomplete: nameMissing },
    { value: 'appearance', label: t({ ko: '외형', en: 'Appearance' }), icon: <ImageIcon /> },
    { value: 'model', label: t({ ko: '모델', en: 'Model' }), icon: <Sparkles />, incomplete: connectionMissing },
    { value: 'memory', label: t({ ko: '기억', en: 'Memory' }), icon: <BookOpen /> },
    { value: 'tools', label: t({ ko: '도구', en: 'Tools' }), icon: <Wrench /> },
    { value: 'look', label: t({ ko: '꾸미기', en: 'Look' }), icon: <Palette /> },
  ]
  const current = sections.find((entry) => entry.value === section)!
  const go = (next: EditorSection) => { if (!assetBusy) { setSection(next); setShowingList(false) } }
  // A connected chat reads and fills this draft, opens sections, and asks (by card) to save or generate images.
  const savedDraft = useMemo(() => JSON.stringify(buildDraft(profile ?? initialDraft ?? null, defaults)), [profile, initialDraft, defaults])
  const assist = useProfileEditorChatPage({
    open, profile, draft, setDraft, dirty: open && JSON.stringify(draft) !== savedDraft, section, go, slots,
    lorebooks: linkableLorebooks, blocks: blocksQuery.data, runs, save: () => saveMutation.mutateAsync(),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={profile ? t({ ko: '프로필 편집', en: 'Edit profile' }) : t({ ko: '프로필 추가', en: 'Add profile' })}
      widthClassName="max-w-5xl"
      height="tall"
      // A docked chat that fills this editor stays usable beside it.
      sidePanelInset="var(--chat-dock-width, 0px)"
      headerActions={(
        <div className="flex shrink-0 items-center gap-1">
          <AudienceMenu draft={draft} patch={patch} />
          <label className="flex h-8 cursor-pointer items-center gap-1.5 px-1.5 text-sm text-muted-foreground">
            {t({ ko: '고급', en: 'Advanced' })}
            <Switch size="sm" checked={advanced} onCheckedChange={toggleAdvanced} />
          </label>
          <Tip content={draft.isEnabled ? t({ ko: '사용 중', en: 'On' }) : t({ ko: '꺼짐', en: 'Off' })}>
            <span className="inline-flex px-1.5"><Switch checked={draft.isEnabled} onCheckedChange={(isEnabled) => patch({ isEnabled })} aria-label={t({ ko: '사용', en: 'On' })} /></span>
          </Tip>
        </div>
      )}
    >
      <ProfileAssistContext.Provider value={assist}>
      <div className="grid gap-x-6 md:grid-cols-[10.5rem_minmax(0,1fr)]">
        <nav aria-label={t({ ko: '프로필 편집 항목', en: 'Profile sections' })} className={cn('self-start md:sticky md:top-0 md:block', !showingList && 'max-md:hidden')}>
          <ul className="space-y-0.5 max-md:divide-y max-md:divide-line">
            {sections.map((entry) => (
              <li key={entry.value}>
                {/* eslint-disable-next-line no-restricted-syntax -- a navigation row; Button styles would fight the list look */}
                <button
                  type="button"
                  aria-current={entry.value === section ? 'page' : undefined}
                  disabled={assetBusy && entry.value !== section}
                  onClick={() => go(entry.value)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-default disabled:opacity-50 max-md:min-h-12 md:min-h-9 [&_svg]:size-4',
                    entry.value === section ? 'md:bg-fill md:font-semibold md:text-foreground' : 'text-muted-foreground hover:bg-fill hover:text-foreground',
                  )}
                >
                  {entry.icon}
                  <span className="flex-1">{entry.label}</span>
                  {entry.incomplete ? <><span aria-hidden="true" className="size-1.5 rounded-full bg-primary" /><span className="sr-only">{incompleteLabel}</span></> : assist.sectionFilled(entry.value)
                    ? <Tip content={t({ ko: '어시스턴트가 채움', en: 'Filled by the assistant' })}><span role="img" aria-label={t({ ko: '어시스턴트가 채움', en: 'Filled by the assistant' })} className="size-1.5 rounded-full bg-primary" /></Tip>
                    : null}
                  <ChevronRight className="text-muted-foreground md:hidden" />
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className={cn('min-w-0 space-y-4', showingList && 'max-md:hidden')}>
          <div className="flex items-center gap-1 md:hidden">
            <IconButton size="icon-sm" variant="ghost" onClick={() => setShowingList(true)} label={t({ ko: '항목 목록', en: 'Sections' })}><ChevronLeft /></IconButton>
            <span className="text-sm font-semibold">{current.label}</span>
          </div>
          {section === 'character' ? (
            <ChatProfileCharacterPanel open={open} draft={draft} patch={patch} onPreview={() => setPreviewOpen(true)} profile={profile} onOpenAppearance={() => go('appearance')} />
          ) : null}
          {section === 'appearance' ? (
            <ChatProfileAppearancePanel draft={draft} patch={patch} profile={profile} onBusyChange={onAssetBusyChange} busy={assetBusy} runs={runs} ensureProfile={ensureProfile} onProfileChange={setProfile} />
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
              advanced={advanced}
            />
          ) : null}
          {section === 'memory' ? <ChatProfileMemoryPanel draft={draft} patch={patch} defaults={defaults} lorebooks={linkableLorebooks} advanced={advanced} /> : null}
          {section === 'tools' ? <ChatProfileToolsPanel open={open} draft={draft} patch={patch} defaults={defaults} advanced={advanced} /> : null}
          {section === 'look' ? <ChatProfileLookPanel profile={profile} draft={draft} patch={patch} defaults={defaults?.style} backgroundUrl={backgroundUrl} blocks={blocksQuery.data} onBusyChange={onAssetBusyChange} busy={assetBusy} runs={runs} /> : null}
        </div>
      </div>
      </ProfileAssistContext.Provider>
      <ModalFooter className="mt-4 border-t border-line pt-3">
        {profile ? (
          <IconButton size="icon-sm" variant="destructive" onClick={() => void handleDelete()} disabled={deleteMutation.isPending} label={t({ ko: '삭제', en: 'Delete' })}>
            <Trash2 />
          </IconButton>
        ) : null}
        <span className="flex-1" />
        <IconButton size="icon-sm" variant="default" onClick={() => saveMutation.mutate()} disabled={!canSave} label={t({ ko: '저장', en: 'Save' })}>
          <Save />
        </IconButton>
      </ModalFooter>
      <ChatProfilePreviewModal open={previewOpen} draft={{ ...draft, id: profile?.id }} onClose={() => setPreviewOpen(false)} />
    </Modal>
  )
}
