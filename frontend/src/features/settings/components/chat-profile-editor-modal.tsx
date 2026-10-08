import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, Trash2 } from 'lucide-react'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { IconButton } from '@/components/ui/icon-button'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
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
  listChatConnectionModels,
  listChatLorebooks,
  listChatUserProfiles,
  listOwnLorebooks,
  listModelSlots,
  updateChatProfile,
  type ChatProfile,
  type ChatAssetApplyResult,
  type ChatAssetBatch,
  type ChatProfileDefaults,
  type ChatProfileInput,
  type ChatStyle,
} from '@/lib/api-codex-chat'
import { getExternalApiProviders } from '@/lib/api-external-api'
import { getCodexGenerationModels } from '@/lib/api-image-generation-queue'
import { getErrorMessage } from '@/lib/error-message'
import { roleChoice, roleDirect } from './chat-model-role-select'
import { ChatProfileAppearancePanel } from './chat-profile-editor-appearance'
import { draftProfileAssetUrl } from './chat-profile-images'
import { ChatProfileCharacterPanel } from './chat-profile-editor-character'
import type { Draft } from './chat-profile-editor-fields'
import { ChatProfileLookPanel } from './chat-profile-editor-look'
import { ChatProfileModelPanel } from './chat-profile-editor-model'
import { ChatProfileToolsPanel } from './chat-profile-editor-tools'
import { ChatProfilePreviewModal } from './chat-profile-preview-modal'

type EditorTab = 'character' | 'appearance' | 'model' | 'look' | 'tools'

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
    providerName: profile?.providerName ?? '',
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
    summaryProviderName: profile?.summaryProviderName ?? null,
    summaryModel: profile?.summaryModel ?? '',
    translationProviderName: profile?.translationProviderName ?? null,
    translationModel: profile?.translationModel ?? '',
    translationInstructions: profile?.translationInstructions ?? '',
    suggestEnabled: profile?.suggestEnabled ?? false,
    suggestProviderName: profile?.suggestProviderName ?? null,
    suggestModel: profile?.suggestModel ?? '',
    modelSlotId: profile?.modelSlotId ?? null,
    summarySlotId: profile?.summarySlotId ?? null,
    translationSlotId: profile?.translationSlotId ?? null,
    suggestSlotId: profile?.suggestSlotId ?? null,
    suggestProfileId: profile?.suggestProfileId ?? null,
    suggestUserProfileId: profile?.suggestUserProfileId ?? null,
    maxToolRounds: profile?.maxToolRounds ?? defaults?.maxToolRounds ?? 8,
    visionEnabled: profile?.visionEnabled ?? false,
    allowLoreProposals: profile?.allowLoreProposals ?? true,
    style: { ...FALLBACK_STYLE, ...(profile?.style ?? defaults?.style) },
    isEnabled: profile?.isEnabled ?? true,
    sortOrder: profile?.sortOrder ?? 0,
  }
}

/** A tab label; the dot marks a tab holding a field that must be filled before saving. */
function TabLabel({ children, incomplete, incompleteLabel }: { children: ReactNode; incomplete: boolean; incompleteLabel: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {children}
      {incomplete ? (
        <>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
          <span className="sr-only">{incompleteLabel}</span>
        </>
      ) : null}
    </span>
  )
}

/**
 * Create or edit one chat profile: character, appearance, model, look and tools.
 * One draft spans the tabs, so switching loses nothing.
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
  const [assetBatchId, setAssetBatchId] = useState<number | null>(null)
  const [tab, setTab] = useState<EditorTab>('character')
  const [assetImports, setAssetImports] = useState(0)
  const assetBusy = assetImports > 0
  const onAssetBusyChange = (busy: boolean) => setAssetImports((count) => Math.max(0, count + (busy ? 1 : -1)))
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    if (open && (!editorSession.current.open || editorSession.current.id !== (initialProfile?.id ?? null))) {
      setProfile(initialProfile)
      setDraft(buildDraft(initialProfile ?? initialDraft ?? null, defaults))
      setTab('character')
      let batchId: number | null = null
      try { const value = Number(sessionStorage.getItem(`conai:chat-asset-batch:${initialProfile?.id ?? 0}`)); if (Number.isSafeInteger(value) && value > 0) batchId = value } catch { /* Storage can be unavailable. */ }
      setAssetBatchId(batchId)
    }
    editorSession.current = { open, id: initialProfile?.id ?? null }
  }, [defaults, initialDraft, open, initialProfile])

  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }))
  const rememberBatch = (id: number) => {
    setAssetBatchId(id)
    try { sessionStorage.setItem(`conai:chat-asset-batch:${profile?.id ?? 0}`, String(id)) } catch { /* Storage can be unavailable. */ }
  }
  const prepareAssets = async () => {
    const updated = profile ? await updateChatProfile(profile.id, { name: draft.name, appearance: draft.appearance, referenceHash: draft.referenceHash }) : await createChatProfile(draft)
    setProfile(updated)
    if (!profile) setDraft(buildDraft(updated, defaults))
    showSnackbar({ message: profile ? t({ ko: '외형을 저장했어.', en: 'Appearance saved.' }) : t({ ko: '프로필을 저장했어.', en: 'Profile saved.' }), tone: 'info' })
    await Promise.all([queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY }), queryClient.invalidateQueries({ queryKey: CHAT_PROFILES_QUERY_KEY })])
    return updated
  }
  const assetsApplied = (result: ChatAssetApplyResult, batch: ChatAssetBatch, updated?: ChatProfile) => {
    if (updated) setProfile(updated)
    setDraft((current) => {
      const next = { ...current }
      for (const slot of batch.slots.filter((slot) => slot.chosenHash)) {
        if (slot.kind === 'reference') next.referenceHash = slot.chosenHash
        if (slot.kind === 'avatar') { if (next.avatarHash !== slot.chosenHash) next.avatar = null; next.avatarHash = slot.chosenHash; next.avatarCrop = null }
        if (slot.kind === 'background') { if (next.backgroundHash !== slot.chosenHash) next.background = null; next.backgroundHash = slot.chosenHash }
      }
      const groupId = result.applied.expressionGroupId
      if (groupId) next.style = { ...next.style, emoticonGroupIds: [groupId, ...next.style.emoticonGroupIds.filter((id) => id !== groupId)] }
      if (updated) {
        if (result.applied.profileFields.includes('referenceHash')) next.referenceHash = updated.referenceHash
        if (result.applied.profileFields.includes('avatarHash')) { next.avatarHash = updated.avatarHash; next.avatarCrop = updated.avatarCrop; next.avatar = updated.avatar }
        if (result.applied.profileFields.includes('backgroundHash')) { next.backgroundHash = updated.backgroundHash; next.background = undefined }
      }
      return next
    })
  }
  const isLlm = draft.engine === 'llm'

  const providersQuery = useQuery({ queryKey: ['external-api-providers', 'chat-profiles'], queryFn: getExternalApiProviders, enabled: open })
  const llmProviders = (providersQuery.data ?? []).filter((provider) => provider.provider_type === 'llm_openai_compatible' || provider.provider_type === 'llm_ollama')
  const slotsQuery = useQuery({ queryKey: MODEL_SLOTS_QUERY_KEY, queryFn: listModelSlots, enabled: open })
  const slots = slotsQuery.data ?? []
  const slotsSettled = slotsQuery.isSuccess || slotsQuery.isError
  // A role lists connection models only while it is "direct" with a connection of its own.
  const chatDirect = roleDirect(draft, 'chat')
  const summaryDirect = roleDirect(draft, 'summary')
  const translationDirect = roleDirect(draft, 'translation')
  const suggestDirect = roleDirect(draft, 'suggest')
  const modelsQuery = useQuery({
    queryKey: ['codex-chat-connection-models', chatDirect.provider],
    queryFn: () => listChatConnectionModels(chatDirect.provider),
    enabled: open && isLlm && roleChoice(draft, 'chat', slots, true, slotsSettled) === 'direct' && Boolean(chatDirect.provider),
    retry: false,
    staleTime: 60_000,
  })
  const summaryModelsQuery = useQuery({
    queryKey: ['codex-chat-connection-models', summaryDirect.provider],
    queryFn: () => listChatConnectionModels(summaryDirect.provider),
    enabled: open && draft.engine !== 'codex' && roleChoice(draft, 'summary', slots, true, slotsSettled) === 'direct' && Boolean(summaryDirect.provider),
    retry: false,
    staleTime: 60_000,
  })
  const translationModelsQuery = useQuery({
    queryKey: ['codex-chat-connection-models', translationDirect.provider],
    queryFn: () => listChatConnectionModels(translationDirect.provider),
    enabled: open && roleChoice(draft, 'translation', slots, isLlm, slotsSettled) === 'direct' && Boolean(translationDirect.provider),
    retry: false,
    staleTime: 60_000,
  })
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
  const suggestModelsQuery = useQuery({
    queryKey: ['codex-chat-connection-models', suggestDirect.provider],
    queryFn: () => listChatConnectionModels(suggestDirect.provider),
    enabled: open && roleChoice(draft, 'suggest', slots, isLlm, slotsSettled) === 'direct' && Boolean(suggestDirect.provider),
    retry: false,
    staleTime: 60_000,
  })
  const lorebooksQuery = useQuery({ queryKey: CHAT_LOREBOOKS_QUERY_KEY, queryFn: listChatLorebooks, enabled: open })
  // The editor's own account books can be linked too (another account's book on the profile stays as it is).
  const ownLorebooksQuery = useQuery({ queryKey: OWN_LOREBOOKS_QUERY_KEY, queryFn: listOwnLorebooks, enabled: open })
  const linkableLorebooks = useMemo(() => lorebooksQuery.data ? [...lorebooksQuery.data, ...(ownLorebooksQuery.data ?? []).filter((book) => book.kind === 'account')] : undefined, [lorebooksQuery.data, ownLorebooksQuery.data])
  const blocksQuery = useQuery({ queryKey: CHAT_BLOCKS_QUERY_KEY, queryFn: listChatBlocks, enabled: open })
  const codexModelsQuery = useQuery({ queryKey: ['codex-generation-models'], queryFn: getCodexGenerationModels, staleTime: 5 * 60 * 1000, enabled: open && draft.engine === 'codex' })

  // Fields start on real values, not on a "choose" or "connection default" entry: the first connection, then the
  // connection's default model (or its first listed one). Declared after the draft reset so they apply on top of it.
  // They stay here, not in the model panel, so switching tabs never re-runs them over edited values.
  // A new profile starts on the default model slot when there is one. Waits for the slot list so the first connection
  // is not picked in the meantime. Existing profiles never get a slot; they only get the first connection if empty.
  const firstProviderName = llmProviders[0]?.provider_name ?? ''
  const defaultSlotId = slots.find((slot) => slot.isDefault)?.id ?? null
  useEffect(() => {
    if (!open || !slotsSettled) return
    setDraft((current) => {
      if (current.engine !== 'llm' || current.providerName || current.modelSlotId) return current
      if (!profile && defaultSlotId !== null) return { ...current, modelSlotId: defaultSlotId }
      return firstProviderName ? { ...current, providerName: firstProviderName } : current
    })
  }, [open, slotsSettled, defaultSlotId, firstProviderName, draft.engine, profile])
  useEffect(() => {
    const data = modelsQuery.data
    const fill = data?.defaultModel || data?.models[0]
    if (!open || !fill) return
    setDraft((current) => (current.engine !== 'llm' || current.model || current.modelSlotId || !current.providerName ? current : { ...current, model: fill }))
  }, [open, modelsQuery.data, draft.engine])
  useEffect(() => {
    const data = summaryModelsQuery.data
    const fill = data?.defaultModel || data?.models[0]
    if (!open || !fill) return
    setDraft((current) => (!current.summaryProviderName || current.summarySlotId || current.summaryModel ? current : { ...current, summaryModel: fill }))
  }, [open, summaryModelsQuery.data])
  useEffect(() => {
    const data = translationModelsQuery.data
    const fill = data?.defaultModel || data?.models[0]
    if (!open || !fill) return
    setDraft((current) => (!current.translationProviderName || current.translationSlotId || current.translationModel ? current : { ...current, translationModel: fill }))
  }, [open, translationModelsQuery.data])
  useEffect(() => {
    const data = suggestModelsQuery.data
    const fill = data?.defaultModel || data?.models[0]
    if (!open || !fill) return
    setDraft((current) => (!current.suggestProviderName || current.suggestSlotId || current.suggestModel ? current : { ...current, suggestModel: fill }))
  }, [open, suggestModelsQuery.data])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: CHAT_PROFILES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: CHAT_LOREBOOKS_QUERY_KEY }),
    ])
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
  const connectionMissing = isLlm && !draft.modelSlotId && !draft.providerName
  const canSave = !nameMissing && !connectionMissing && !assetBusy && !saveMutation.isPending
  const incompleteLabel = t({ ko: '입력 필요', en: 'Needs input' })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={profile ? t({ ko: '프로필 편집', en: 'Edit profile' }) : t({ ko: '프로필 추가', en: 'Add profile' })}
      widthClassName="max-w-3xl"
      headerContent={(
        <SegmentedTabBar
          size="sm"
          fullWidth
          value={tab}
          onChange={(value) => { if (!assetBusy) setTab(value as EditorTab) }}
          ariaLabel={t({ ko: '프로필 편집 탭', en: 'Profile editor tabs' })}
          items={[
            { value: 'character', label: <TabLabel incomplete={nameMissing} incompleteLabel={incompleteLabel}>{t({ ko: '캐릭터', en: 'Character' })}</TabLabel> },
            { value: 'appearance', label: t({ ko: '외형', en: 'Appearance' }) },
            { value: 'model', label: <TabLabel incomplete={connectionMissing} incompleteLabel={incompleteLabel}>{t({ ko: '모델', en: 'Model' })}</TabLabel> },
            { value: 'look', label: t({ ko: '꾸미기', en: 'Look' }) },
            { value: 'tools', label: t({ ko: '도구', en: 'Tools' }) },
          ]}
        />
      )}
    >
      <ModalBody>
        {tab === 'character' ? (
          <ChatProfileCharacterPanel
            open={open}
            draft={draft}
            patch={patch}
            lorebooks={linkableLorebooks}
            onPreview={() => setPreviewOpen(true)}
            profile={profile}
            onBusyChange={onAssetBusyChange}
            busy={assetBusy}
          />
        ) : null}
        {tab === 'appearance' ? <ChatProfileAppearancePanel draft={draft} patch={patch} profile={profile} onBusyChange={onAssetBusyChange} busy={assetBusy} batchId={assetBatchId} onBatchChange={rememberBatch} onPrepareAssets={prepareAssets} onAssetsApplied={assetsApplied} /> : null}
        {tab === 'model' ? (
          <ChatProfileModelPanel
            draft={draft}
            patch={patch}
            defaults={defaults}
            llmProviders={llmProviders}
            providersLoaded={providersQuery.isSuccess}
            slots={slots}
            slotsReady={slotsSettled}
            suggestWriters={suggestWriters}
            connectionModels={modelsQuery.data}
            summaryModels={summaryModelsQuery.data}
            translationModels={translationModelsQuery.data}
            suggestModels={suggestModelsQuery.data}
            codexModels={codexModelsQuery.data?.data.models}
          />
        ) : null}
        {tab === 'look' ? <ChatProfileLookPanel profile={profile} draft={draft} patch={patch} defaults={defaults?.style} backgroundUrl={backgroundUrl} blocks={blocksQuery.data} onBusyChange={onAssetBusyChange} busy={assetBusy} /> : null}
        {tab === 'tools' ? <ChatProfileToolsPanel open={open} draft={draft} patch={patch} defaults={defaults} /> : null}
      </ModalBody>
      <ModalFooter>
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
