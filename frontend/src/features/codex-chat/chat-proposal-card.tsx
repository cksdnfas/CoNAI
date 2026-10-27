import { lazy, Suspense, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { FileText, SquarePen, Undo2 } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Chip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { Spinner } from '@/components/ui/loading-state'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import {
  CHAT_ADMIN_PROFILES_QUERY_KEY,
  CHAT_BLOCKS_QUERY_KEY,
  CHAT_PROFILES_QUERY_KEY,
  CHAT_PROFILE_DEFAULTS_QUERY_KEY as DEFAULTS_QUERY_KEY,
  CHAT_PROFILE_SYNCED_KEYS,
  MODEL_SLOTS_QUERY_KEY,
  applyChatProposal,
  undoChatLoreProposal,
  createChatBlock,
  dismissChatProposal,
  threadLorebooksQueryKey,
  chatProfileSaveInput,
  createChatProfile,
  getChatProfileDefaults,
  listChatAdminProfiles,
  listChatBlocks,
  listModelSlots,
  markChatProposalSaved,
  updateChatProfile,
  type ChatDisplayBlock,
  type ChatProfile,
  type ChatProfileInput,
  type ChatSharedBlock,
  type CodexChatToolCall,
} from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { ChatDisplayBlockView, parseBlockPayload } from './chat-display-block'
import { codexChatThreadQueryKey } from './codex-chat-context'
import { ChatPageProposalCard } from './chat-page-proposal-card'
import { ChatWorkflowProposalCard } from './chat-workflow-proposal-card'
import { ChatPageActionCard } from './chat-page-action-card'
import { ChatAssetProposalCard } from './chat-asset-proposal-card'
import { ChatCharacterLibraryProposalCard } from './chat-character-library-proposal-card'
import { ChatProfileLinkChange } from './chat-profile-link-change'
import { ProposalFooter, ProposalFrame } from './chat-proposal-parts'

type Proposal = NonNullable<CodexChatToolCall['proposal']>
type BlockProposal = Extract<Proposal, { kind: 'display_block' }>
type ProfileProposal = Extract<Proposal, { kind: 'profile' }>
type UpdateProposal = Extract<Proposal, { kind: 'profile_update' }>
type LoreProposal = Extract<Proposal, { kind: 'lore' }>
type ChatSettingsProposal = Extract<Proposal, { kind: 'chat_settings' }>

import { TaskPlanCard } from './chat-task-ui'

// The settings editors are large and only open on demand, so they stay out of the chat bundle until then.
const ChatBlockEditorModal = lazy(() => import('@/features/settings/components/chat-block-editor-modal').then((module) => ({ default: module.ChatBlockEditorModal })))
const ChatProfileEditorModal = lazy(() => import('@/features/settings/components/chat-profile-editor-modal').then((module) => ({ default: module.ChatProfileEditorModal })))

const LONG_TEXT = 160

/** Cards for the settings a reply proposed (and a slim row for one still being written). */
export function ChatProposalCards({ calls, threadId }: { calls: CodexChatToolCall[]; threadId?: number }) {
  const { t } = useI18n()
  const items = calls.flatMap((call): Array<{ key: string; proposal: Proposal | null }> => {
    // A question card waits above the composer and leaves its own line (ChatChoiceLines).
    if (call.proposal) return call.proposal.kind === 'choice' ? [] : [{ key: call.id, proposal: call.proposal }]
    if (call.tool.startsWith('propose_') && call.status === 'running') return [{ key: call.id, proposal: null }]
    return []
  })
  if (items.length === 0) return null
  return (
    <div className="space-y-2">
      {items.map((item) => item.proposal === null
        ? <div key={item.key} className="flex items-center gap-2 py-1.5 text-xs text-muted-foreground"><Spinner className="size-3" />{t({ ko: '제안 만드는 중…', en: 'Writing a proposal…' })}</div>
        : <ProposalCard key={item.key} proposal={item.proposal} threadId={threadId} />)}
    </div>
  )
}

function ProposalCard({ proposal, threadId }: { proposal: Proposal; threadId?: number }) {
  if (proposal.kind === 'page_fields') return <ChatPageProposalCard proposal={proposal} />
  if (proposal.kind === 'workflow_graph') return <ChatWorkflowProposalCard proposal={proposal} />
  if (proposal.kind === 'page_action') return <ChatPageActionCard proposal={proposal} />
  if (proposal.kind === 'profile_assets' || proposal.kind === 'character_assets') return <ChatAssetProposalCard proposal={proposal} threadId={threadId} />
  if (proposal.kind === 'character_library') return <ChatCharacterLibraryProposalCard proposal={proposal} threadId={threadId} />
  if (proposal.kind === 'display_block') return <BlockProposalCard proposal={proposal} threadId={threadId} />
  if (proposal.kind === 'profile') return <ProfileProposalCard proposal={proposal} threadId={threadId} />
  if (proposal.kind === 'lore') return <LoreProposalCard proposal={proposal} threadId={threadId} />
  if (proposal.kind === 'profile_update') return <ProfileUpdateCard proposal={proposal} threadId={threadId} />
  if (proposal.kind === 'chat_settings') return <ChatSettingsCard proposal={proposal} threadId={threadId} />
  if (proposal.kind === 'task_plan') return <TaskPlanCard proposal={proposal} threadId={threadId} />
  return null
}

/** Refreshes what a save touched, plus the thread so the card reloads as saved. */
function useProposalRefresh(threadId?: number) {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: CHAT_BLOCKS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: CHAT_PROFILES_QUERY_KEY }),
      ...(threadId !== undefined ? [queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(threadId) })] : []),
    ])
  }
}

function useIsAdmin() {
  return useAuthStatusQuery().data?.isAdmin === true
}

function Header({ label, name }: { label: string; name?: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="shrink-0 text-xs font-semibold text-muted-foreground">{label}</span>
      {name ? <span className="min-w-0 truncate font-mono text-xs">{name}</span> : null}
    </div>
  )
}

function Footer({ saved, savedLink, admin, children }: { saved: boolean; savedLink: string; admin: boolean; children?: React.ReactNode }) {
  const { t } = useI18n()
  if (saved) {
    return (
      <ProposalFooter status>
        <span>{t({ ko: '저장됨', en: 'Saved' })}</span>
        {admin ? <Link to={savedLink} className="text-primary hover:underline">{t({ ko: '설정에서 열기', en: 'Open in settings' })}</Link> : null}
      </ProposalFooter>
    )
  }
  if (!admin) return null
  return <ProposalFooter>{children}</ProposalFooter>
}

function OpenEditorButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  const { t } = useI18n()
  return <IconButton size="icon-xs" variant="ghost" label={t({ ko: '편집기에서 열기', en: 'Open in editor' })} disabled={disabled} onClick={onClick}><SquarePen /></IconButton>
}

function SaveButton({ pending, disabled, onClick }: { pending: boolean; disabled?: boolean; onClick: () => void }) {
  const { t } = useI18n()
  return <Button size="xs" disabled={pending || disabled} onClick={onClick}>{pending ? <Spinner className="size-3" /> : null}{t({ ko: '저장', en: 'Save' })}</Button>
}

function ruleChips(block: ChatDisplayBlock, t: ReturnType<typeof useI18n>['t']) {
  return (block.fields ?? []).flatMap((field) => {
    const parts: string[] = []
    if (field.min !== null && field.max !== null) parts.push(`${field.min}~${field.max}`)
    else if (field.min !== null) parts.push(`${field.min}~`)
    else if (field.max !== null) parts.push(`~${field.max}`)
    if (field.step !== null) parts.push(t({ ko: '±{step}/턴', en: '±{step}/turn' }, { step: field.step }))
    if (field.values?.length) parts.push(t({ ko: '{count}개 값', en: '{count} values' }, { count: field.values.length }))
    if (field.readonly) parts.push(t({ ko: '고정', en: 'fixed' }))
    return parts.length > 0 ? [`${field.name} ${parts.join(' · ')}`] : []
  })
}

function BlockProposalCard({ proposal, threadId }: { proposal: BlockProposal; threadId?: number }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const admin = useIsAdmin()
  const refresh = useProposalRefresh(threadId)
  const block = proposal.block as unknown as ChatDisplayBlock
  const data = useMemo(() => parseBlockPayload(String(block.example ?? '').trim() || '{}') ?? {}, [block.example])
  const chips = ruleChips(block, t)
  const [link, setLink] = useState(true)
  const [editorOpen, setEditorOpen] = useState(false)
  const [savedNow, setSavedNow] = useState(false)
  const saved = savedNow || (proposal.savedId !== undefined && proposal.savedId !== null)
  const canLink = proposal.linkProfileId !== null
  const initialBlock = useMemo(() => proposal.block as unknown as ChatDisplayBlock, [proposal.block])

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Read first: the editor forbids two linked blocks with one key, so a clash skips the link.
      let linkTo: { profile: ChatProfile; keys: Set<string> } | null = null
      if (canLink && link) {
        const [profiles, blocks] = await Promise.all([listChatAdminProfiles(), listChatBlocks()])
        const profile = profiles.find((entry) => entry.id === proposal.linkProfileId)
        if (profile) linkTo = { profile, keys: new Set(profile.blockIds.map((id) => blocks.find((entry) => entry.id === id)?.block.key).filter((key): key is string => Boolean(key))) }
      }
      const created = await createChatBlock({ name: proposal.name || block.key, block })
      if (linkTo && !linkTo.keys.has(block.key)) await updateChatProfile(linkTo.profile.id, { blockIds: [...linkTo.profile.blockIds, created.id] })
      await markChatProposalSaved(proposal.id, created.id)
      return created
    },
    onSuccess: async () => {
      setSavedNow(true)
      await refresh()
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' }),
  })

  // The editor created the block itself; only the proposal's mark is left.
  const handleEditorSaved = (created: ChatSharedBlock) => {
    setSavedNow(true)
    markChatProposalSaved(proposal.id, created.id)
      .then(refresh)
      .catch((error: unknown) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장 표시를 남기지 못했어.', en: 'Could not mark it saved.' })), tone: 'error' }))
  }

  return (
    <ProposalFrame>
      <Header label={t({ ko: '표시 블록 제안', en: 'Display block proposal' })} name={block.key} />
      <div className="py-1"><ChatDisplayBlockView block={block} data={data} /></div>
      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {chips.map((chip) => <Chip key={chip} size="sm" tone="muted" mono>{chip}</Chip>)}
        </div>
      ) : null}
      <Footer saved={saved} savedLink="/settings?section=chat&view=resources" admin={admin}>
        {canLink ? (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox checked={link} onCheckedChange={(checked) => setLink(checked === true)} />
            {t({ ko: '이 프로필에 연결', en: 'Link to this profile' })}
          </label>
        ) : null}
        <span className="flex-1" />
        <OpenEditorButton onClick={() => setEditorOpen(true)} disabled={saveMutation.isPending} />
        <SaveButton pending={saveMutation.isPending} onClick={() => saveMutation.mutate()} />
      </Footer>
      {admin && editorOpen ? <Suspense fallback={null}><ChatBlockEditorModal open shared={null} initialName={proposal.name} initialBlock={initialBlock} onClose={() => setEditorOpen(false)} onSaved={handleEditorSaved} /></Suspense> : null}
    </ProposalFrame>
  )
}

function ProfileProposalCard({ proposal, threadId }: { proposal: ProfileProposal; threadId?: number }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const admin = useIsAdmin()
  const refresh = useProposalRefresh(threadId)
  const input = proposal.input as ChatProfileInput
  const [editorOpen, setEditorOpen] = useState(false)
  const [savedNow, setSavedNow] = useState(false)
  const saved = savedNow || (proposal.savedId !== undefined && proposal.savedId !== null)
  const defaultsQuery = useQuery({ queryKey: DEFAULTS_QUERY_KEY, queryFn: getChatProfileDefaults, staleTime: Infinity, enabled: admin })
  const slotsQuery = useQuery({ queryKey: MODEL_SLOTS_QUERY_KEY, queryFn: listModelSlots, enabled: admin })
  const slots = slotsQuery.data
  const slotName = input.modelSlotId != null ? slots?.find((slot) => slot.id === input.modelSlotId)?.label : t({ ko: '기본 모델', en: 'Default model' })
  const initialDraft = useMemo<ChatProfileInput>(() => ({ ...(proposal.input as ChatProfileInput), engine: 'llm', mcpEnabled: false }), [proposal.input])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const created = await createChatProfile(chatProfileSaveInput({ ...input, engine: 'llm', mcpEnabled: false, isEnabled: true }))
      await markChatProposalSaved(proposal.id, created.id)
      return created
    },
    onSuccess: async () => {
      setSavedNow(true)
      await refresh()
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' }),
  })

  const meta = [
    t({ ko: '시스템 프롬프트 {count}자', en: 'System prompt {count} chars' }, { count: (input.systemPrompt ?? '').length }),
    ...(slotName ? [slotName] : []),
    t({ ko: '블록 {count}', en: '{count} blocks' }, { count: input.blockIds?.length ?? 0 }),
  ].join(' · ')

  return (
    <ProposalFrame>
      <Header label={t({ ko: '프로필 제안', en: 'Profile proposal' })} name={input.name} />
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full border border-dashed border-line text-sm text-muted-foreground">?</span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{input.name}</div>
          {input.tagline ? <div className="truncate text-xs text-muted-foreground">{input.tagline}</div> : null}
          <div className="truncate text-xs text-muted-foreground">{meta}</div>
        </div>
      </div>
      {input.characterLink !== undefined ? <ChatProfileLinkChange after={input.characterLink} profileId={null} showBefore={false} /> : null}
      <Footer saved={saved} savedLink="/settings?section=chat" admin={admin}>
        <span className="flex-1" />
        <OpenEditorButton onClick={() => setEditorOpen(true)} disabled={saveMutation.isPending} />
        <SaveButton pending={saveMutation.isPending} onClick={() => saveMutation.mutate()} />
      </Footer>
      {admin && editorOpen ? <Suspense fallback={null}><ChatProfileEditorModal open profile={null} initialDraft={initialDraft} defaults={defaultsQuery.data} onClose={() => setEditorOpen(false)} /></Suspense> : null}
    </ProposalFrame>
  )
}

const UPDATE_LABELS: Record<string, { ko: string; en: string }> = {
  name: { ko: '이름', en: 'Name' },
  tagline: { ko: '짧은 소개', en: 'Tagline' },
  systemPrompt: { ko: '시스템 프롬프트', en: 'System prompt' },
  promptSections: { ko: '섹션', en: 'Sections' },
  greeting: { ko: '첫 인사말', en: 'Greeting' },
  alternateGreetings: { ko: '추가 인사말', en: 'Alternate greetings' },
  openingHistory: { ko: '시작 대화', en: 'Opening messages' },
  greetingPosition: { ko: '인사말 위치', en: 'Greeting position' },
  authorNote: { ko: '작가 노트', en: 'Author note' },
  appearance: { ko: '외형', en: 'Appearance' },
  modelSlotId: { ko: '대화 모델', en: 'Chat model' },
  summarySlotId: { ko: '요약 모델', en: 'Summary model' },
  translationSlotId: { ko: '번역 모델', en: 'Translation model' },
  suggestSlotId: { ko: '추천 모델', en: 'Suggestion model' },
  judgeSlotId: { ko: '판단 모델', en: 'Judge model' },
  judgePresetId: { ko: '판단 프리셋', en: 'Judge preset' },
  lorebookIds: { ko: '로어북', en: 'Lorebooks' },
  blockIds: { ko: '표시 블록', en: 'Display blocks' },
  temperature: { ko: '온도', en: 'Temperature' },
  maxTokens: { ko: '최대 출력 토큰', en: 'Max output tokens' },
  contextTurns: { ko: '컨텍스트 턴', en: 'Context turns' },
  contextTokens: { ko: '컨텍스트 토큰', en: 'Context tokens' },
  toolOutputLimit: { ko: '도구 결과 길이', en: 'Tool output limit' },
  summaryEnabled: { ko: '요약', en: 'Summary' },
  summaryTriggerTurns: { ko: '요약 턴 수', en: 'Turns per summary' },
  summaryPrompt: { ko: '요약 프롬프트', en: 'Summary prompt' },
  translationModelLanguage: { ko: '모델 언어', en: 'Model language' },
  translationDisplayLanguage: { ko: '표시 언어', en: 'Display language' },
  translationInstructions: { ko: '번역 지시', en: 'Translation notes' },
  suggestEnabled: { ko: '답장 추천', en: 'Reply suggestions' },
  suggestProfileId: { ko: '추천 쓰는 프로필', en: 'Suggesting profile' },
  visionEnabled: { ko: '이미지 보기', en: 'Sees images' },
  contentRatingMode: { ko: '허용 등급 기준', en: 'Rating ceiling from' },
  contentRatingTierId: { ko: '허용 등급', en: 'Rating ceiling' },
  loreRecursionDepth: { ko: '로어 재귀 깊이', en: 'Lore recursion depth' },
  allowLoreProposals: { ko: '로어 제안', en: 'Lore proposals' },
  agentEnabled: { ko: '에이전트로 사용', en: 'Use as an agent' },
  agentDescription: { ko: '에이전트 설명', en: 'Agent description' },
  linkedFiles: { ko: '연결 파일', en: 'Linked files' },
  loreRecordBookId: { ko: '기록할 곳', en: 'Record book' },
  minutesFolderId: { ko: '회의록', en: 'Minutes' },
}

const LANGUAGE_LABELS: Record<string, string> = { ko: '한국어', en: 'English', ja: '日本語', zh: '简体中文' }

/** One side of a before/after row: arrays as counts, slot ids as slot names, long text cut (the row expands it). */
function formatValue(key: string, value: unknown, slotNames: Map<number, string>, t: ReturnType<typeof useI18n>['t']) {
  if (value === undefined) return '—'
  if (key.endsWith('SlotId')) return value === null ? t({ ko: '기본', en: 'Default' }) : (slotNames.get(Number(value)) ?? `#${String(value)}`)
  if (Array.isArray(value)) return t({ ko: '{count}개', en: '{count}' }, { count: value.length })
  if (typeof value === 'boolean') return value ? t({ ko: '켬', en: 'On' }) : t({ ko: '끔', en: 'Off' })
  if (key === 'translationModelLanguage' || key === 'translationDisplayLanguage') return LANGUAGE_LABELS[String(value)] ?? String(value)
  if (key === 'contentRatingMode') return value === 'model' ? t({ ko: '모델 설정 따름', en: 'Model’s' }) : t({ ko: '직접 지정', en: 'Custom' })
  if (value === null || value === '') return '—'
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function UpdateRow({ label, before, after }: { label: string; before: string; after: string }) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const long = before.length > LONG_TEXT || after.length > LONG_TEXT
  const cut = (text: string) => expanded || text.length <= LONG_TEXT ? text : `${text.slice(0, LONG_TEXT)}…`
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 text-xs">
      <span className="pt-px text-muted-foreground">{label}</span>
      <div className="min-w-0 space-y-0.5 break-words whitespace-pre-wrap">
        <div className="text-muted-foreground line-through">{cut(before)}</div>
        <div>{cut(after)}</div>
        {long ? <Button variant="link" size="xs" className="-ml-2" onClick={() => setExpanded((current) => !current)}>{expanded ? t({ ko: '접기', en: 'Collapse' }) : t({ ko: '펼치기', en: 'Expand' })}</Button> : null}
      </div>
    </div>
  )
}

function ProfileUpdateCard({ proposal, threadId }: { proposal: UpdateProposal; threadId?: number }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const admin = useIsAdmin()
  const refresh = useProposalRefresh(threadId)
  const queryClient = useQueryClient()
  const [editorOpen, setEditorOpen] = useState(false)
  const [savedNow, setSavedNow] = useState(false)
  const saved = savedNow || proposal.saved === true
  const slotsQuery = useQuery({ queryKey: MODEL_SLOTS_QUERY_KEY, queryFn: listModelSlots, enabled: admin })
  const defaultsQuery = useQuery({ queryKey: DEFAULTS_QUERY_KEY, queryFn: getChatProfileDefaults, staleTime: Infinity, enabled: admin })
  const profilesQuery = useQuery({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY, queryFn: listChatAdminProfiles, enabled: admin && editorOpen })
  const slotNames = useMemo(() => new Map((slotsQuery.data ?? []).map((slot) => [slot.id, slot.label])), [slotsQuery.data])
  const current = profilesQuery.data?.find((profile) => profile.id === proposal.profileId) ?? null
  const keys = Object.keys(proposal.patch)
  // The proposed link rides the editor's draft; the profile keeps its stored link (with its name and path).
  const rawLink = proposal.patch.characterLink as { settingId?: number; synced?: boolean } | null | undefined
  const proposedLink = rawLink === undefined ? undefined : rawLink && Number(rawLink.settingId) > 0 ? { settingId: Number(rawLink.settingId), synced: rawLink.synced !== false } : null
  const editorProfile = useMemo(() => current ? ({ ...current, ...proposal.patch, characterLink: current.characterLink } as ChatProfile) : null, [current, proposal.patch])
  const confirm = useConfirm()
  const [checking, setChecking] = useState(false)

  // A profile synced to a library setting (now, or by this proposal) takes no look fields: the server drops them.
  const handleSave = async () => {
    const lookKeys = keys.filter((key) => (CHAT_PROFILE_SYNCED_KEYS as readonly string[]).includes(key))
    if (!lookKeys.length) { saveMutation.mutate(); return }
    setChecking(true)
    let stored: ChatProfile | undefined
    try {
      const profiles = await listChatAdminProfiles()
      queryClient.setQueryData(CHAT_ADMIN_PROFILES_QUERY_KEY, profiles)
      stored = profiles.find((entry) => entry.id === proposal.profileId)
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '프로필을 다시 읽지 못했어.', en: 'Could not re-read the profile.' })), tone: 'error' })
      return
    } finally {
      setChecking(false)
    }
    const storedLink = stored?.characterLink ?? null
    const linkAfter = proposedLink !== undefined ? proposedLink : storedLink
    if (!linkAfter?.synced) { saveMutation.mutate(); return }
    const setting = storedLink && storedLink.settingId === linkAfter.settingId ? [...(storedLink.path ?? []), storedLink.settingName ?? `#${storedLink.settingId}`].join(' / ') : `#${linkAfter.settingId}`
    const fields = lookKeys.map((key) => UPDATE_LABELS[key] ? t(UPDATE_LABELS[key]) : key).join(', ')
    if (lookKeys.length === keys.length) {
      showSnackbar({ message: t({ ko: '이 프로필은 ‘{setting}’ 설정과 동기화 중이라 외형 항목({fields})은 그 설정 것이야. 라이브러리에서 그 설정을 고쳐줘.', en: 'This profile is synced with ‘{setting}’, so its look ({fields}) is that setting’s. Edit the setting in the library.' }, { setting, fields }), tone: 'error' })
      return
    }
    const ok = await confirm({
      title: t({ ko: '외형 항목은 저장 안 돼', en: 'The look is not saved' }),
      description: t({ ko: '이 프로필은 ‘{setting}’ 설정과 동기화 중이라 외형 항목({fields})은 그 설정 것이야. 나머지만 저장할까? 외형은 라이브러리에서 그 설정을 고쳐줘.', en: 'This profile is synced with ‘{setting}’, so its look ({fields}) is that setting’s. Save the rest only? Edit the look in the library.' }, { setting, fields }),
      confirmLabel: t({ ko: '나머지 저장', en: 'Save the rest' }),
    })
    if (ok) saveMutation.mutate()
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const updated = await updateChatProfile(proposal.profileId, chatProfileSaveInput(proposal.patch as ChatProfileInput))
      await markChatProposalSaved(proposal.id, proposal.profileId)
      return updated
    },
    onSuccess: async () => {
      setSavedNow(true)
      await refresh()
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' }),
  })

  // The editor saves the profile itself; once it closes, a profile that now holds every proposed value counts as saved.
  const handleEditorClose = () => {
    setEditorOpen(false)
    void listChatAdminProfiles().then(async (profiles) => {
      queryClient.setQueryData(CHAT_ADMIN_PROFILES_QUERY_KEY, profiles)
      const profile = profiles.find((entry) => entry.id === proposal.profileId) as unknown as Record<string, unknown> | undefined
      // A stored link carries its name and path besides the proposed setting and sync.
      const stored = (key: string) => {
        const value = profile?.[key] as { settingId?: number; synced?: boolean } | null | undefined
        return key === 'characterLink' && value ? { settingId: value.settingId, synced: value.synced } : value
      }
      if (!profile || !keys.every((key) => JSON.stringify(stored(key)) === JSON.stringify(proposal.patch[key]))) return
      setSavedNow(true)
      await markChatProposalSaved(proposal.id, proposal.profileId)
      await refresh()
    }).catch(() => undefined)
  }

  return (
    <ProposalFrame>
      <Header label={t({ ko: '프로필 수정 제안', en: 'Profile update proposal' })} name={proposal.profileName} />
      <div className="space-y-1.5">
        {keys.map((key) => key === 'characterLink' ? (
          <ChatProfileLinkChange key={key} after={proposal.patch[key]} before={proposal.before[key]} profileId={proposal.profileId} showBefore />
        ) : (
          <UpdateRow
            key={key}
            label={UPDATE_LABELS[key] ? t(UPDATE_LABELS[key]) : key}
            before={proposal.display?.[key]?.before ?? formatValue(key, proposal.before[key], slotNames, t)}
            after={proposal.display?.[key]?.after ?? formatValue(key, proposal.patch[key], slotNames, t)}
          />
        ))}
      </div>
      <Footer saved={saved} savedLink="/settings?section=chat" admin={admin}>
        <span className="flex-1" />
        <OpenEditorButton onClick={() => setEditorOpen(true)} disabled={saveMutation.isPending || checking} />
        <SaveButton pending={saveMutation.isPending || checking} onClick={() => void handleSave()} />
      </Footer>
      {admin && editorOpen && editorProfile ? <Suspense fallback={null}><ChatProfileEditorModal open profile={editorProfile} draftLink={proposedLink} defaults={defaultsQuery.data} onClose={handleEditorClose} /></Suspense> : null}
    </ProposalFrame>
  )
}

/** This chat's own settings (lorebook links, record book, linked files, minutes): the chat's owner saves it here. */
function ChatSettingsCard({ proposal, threadId }: { proposal: ChatSettingsProposal; threadId?: number }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [savedNow, setSavedNow] = useState(false)
  const saved = savedNow || proposal.saved === true
  const saveMutation = useMutation({
    mutationFn: () => applyChatProposal(proposal.id),
    onSuccess: async () => {
      setSavedNow(true)
      if (threadId === undefined) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(threadId) }),
        queryClient.invalidateQueries({ queryKey: threadLorebooksQueryKey(threadId) }),
      ])
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' }),
  })
  return (
    <ProposalFrame>
      <Header label={t({ ko: '채팅 설정 제안', en: 'Chat settings proposal' })} />
      <div className="space-y-1.5">
        {Object.keys(proposal.patch).map((key) => (
          <UpdateRow key={key} label={UPDATE_LABELS[key] ? t(UPDATE_LABELS[key]) : key} before={proposal.display[key]?.before ?? '—'} after={proposal.display[key]?.after ?? '—'} />
        ))}
      </div>
      {saved ? (
        <ProposalFooter status>{t({ ko: '저장됨', en: 'Saved' })}</ProposalFooter>
      ) : proposal.dismissed ? null : (
        <ProposalFooter>
          <span className="flex-1" />
          <SaveButton pending={saveMutation.isPending} onClick={() => saveMutation.mutate()} />
        </ProposalFooter>
      )}
    </ProposalFrame>
  )
}

/**
 * E: a save_lore proposal — an entry for the chat's record book (a linked account book, else its own book); anyone in the chat can save or set it aside. With
 * auto-save it arrives saved, and undo takes the entry out again (a replacement gets the old entry back).
 */
function LoreProposalCard({ proposal, threadId }: { proposal: LoreProposal; threadId?: number }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [undone, setUndone] = useState(false)
  const [state, setState] = useState<'saved' | 'dismissed' | null>(null)
  const saved = state === 'saved' || (proposal.savedId !== undefined && !proposal.dismissed)
  const dismissed = !saved && (state === 'dismissed' || proposal.dismissed === true)
  const refresh = async () => {
    if (threadId === undefined) return
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(threadId) }),
      queryClient.invalidateQueries({ queryKey: threadLorebooksQueryKey(threadId) }),
    ])
  }
  const onError = (error: unknown) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' })
  const saveMutation = useMutation({ mutationFn: () => applyChatProposal(proposal.id), onSuccess: async () => { setState('saved'); await refresh() }, onError })
  const dismissMutation = useMutation({ mutationFn: () => dismissChatProposal(proposal.id), onSuccess: async () => { setState('dismissed'); await refresh() }, onError })
  const undoMutation = useMutation({
    mutationFn: async () => {
      const result = await undoChatLoreProposal(proposal.id)
      if (!result.changed) return result
      const description = proposal.replaces
        ? t({ ko: '저장한 뒤 항목이 바뀌었어. 이전 내용으로 되돌릴까?', en: 'The entry changed after saving. Restore the previous entry?' })
        : t({ ko: '저장한 뒤 항목이 바뀌었어. 그래도 로어북에서 뺄까?', en: 'The entry changed after saving. Remove it from the lorebook anyway?' })
      if (!await confirm({ title: t({ ko: '저장 되돌리기', en: 'Undo save' }), description, confirmLabel: t({ ko: '되돌리기', en: 'Undo' }), tone: 'destructive' })) return null
      const restored = await undoChatLoreProposal(proposal.id, true, result.currentHash)
      if (restored.changed) throw new Error(t({ ko: '확인하는 동안 항목이 다시 바뀌었어. 다시 되돌려줘.', en: 'The entry changed again during confirmation. Try undo again.' }))
      return restored
    },
    onSuccess: async (result) => { if (result) { setUndone(true); await refresh() } },
    onError,
  })
  const busy = saveMutation.isPending || dismissMutation.isPending || undoMutation.isPending
  const before = proposal.replaces ? proposal.before : undefined
  const beforeText = before?.translation ?? before
  const afterText = proposal.translation ?? proposal
  const keys = (list: string[]) => (list.length > 0 ? list.join(', ') : '—')
  const constantLabel = (value: boolean) => (value ? t({ ko: '상시', en: 'Always' }) : '—')
  // Replacing an entry of the same title: what changes, before and after.
  const changes = before ? [
    { label: t({ ko: '제목', en: 'Title' }), before: beforeText!.title, after: afterText.title },
    { label: t({ ko: '키워드', en: 'Keywords' }), before: keys(beforeText!.keys), after: keys(afterText.keys) },
    { label: t({ ko: '본문', en: 'Content' }), before: beforeText!.content, after: afterText.content },
    { label: t({ ko: '상시', en: 'Always' }), before: constantLabel(before.constant), after: constantLabel(proposal.constant) },
    ...(proposal.file ? [{ label: t({ ko: '자료', en: 'File' }), before: before.file ?? '—', after: `자료/${proposal.file.name}` }] : []),
  ].filter((change) => change.before !== change.after) : []

  return (
    <ProposalFrame>
      <Header label={saved && !undone && !proposal.undone ? t({ ko: '로어북에 남겼어', en: 'Kept in the lorebook' }) : t({ ko: '로어북에 남길까?', en: 'Keep this in the lorebook?' })} name={`save_lore · ${proposal.bookName ?? t({ ko: '이 채팅', en: 'this chat' })}`} />
      <div className="space-y-2 text-sm">
        <div className="font-semibold">{proposal.translation?.title ?? proposal.title}</div>
        {changes.length > 0 ? (
          <div className="space-y-1.5">
            {changes.map((change) => <UpdateRow key={change.label} label={change.label} before={change.before} after={change.after} />)}
          </div>
        ) : <div className="whitespace-pre-wrap break-words text-muted-foreground">{proposal.translation?.content ?? proposal.content}</div>}
        {proposal.translation ? <details><summary className="cursor-pointer text-xs text-muted-foreground">{t({ ko: '원문 보기', en: 'Show original' })}</summary><div className="whitespace-pre-wrap">{proposal.title}{'\n'}{proposal.content}</div></details> : null}
      </div>
      {proposal.keys.length > 0 || proposal.constant || proposal.file ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {(proposal.translation?.keys ?? proposal.keys).map((key) => <Chip key={key} size="sm" tone="muted">{key}</Chip>)}
          {proposal.constant ? <Chip size="sm" tone="primary">{t({ ko: '상시', en: 'Always' })}</Chip> : null}
          {proposal.file ? <span className="inline-flex items-center gap-1 font-mono text-2xs text-muted-foreground"><FileText className="size-3" aria-hidden />{proposal.file.name}</span> : null}
        </div>
      ) : null}
      {saved || dismissed ? (
        <ProposalFooter status className="justify-between">
          <span>{undone || proposal.undone ? t({ ko: '되돌렸어', en: 'Undone' }) : saved ? t({ ko: '저장됨', en: 'Saved' }) : t({ ko: '무시함', en: 'Dismissed' })}</span>
          {saved && (proposal.replaces || proposal.undoAfter) && !undone && !proposal.undone ? <IconButton size="icon-xs" variant="ghost" disabled={busy} label={t({ ko: '저장 되돌리기', en: 'Undo save' })} onClick={() => undoMutation.mutate()}><Undo2 /></IconButton> : null}
        </ProposalFooter>
      ) : (
        <ProposalFooter>
          <span className="flex-1" />
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => dismissMutation.mutate()}>{t({ ko: '무시', en: 'Dismiss' })}</Button>
          <SaveButton pending={saveMutation.isPending} disabled={busy} onClick={() => saveMutation.mutate()} />
        </ProposalFooter>
      )}
    </ProposalFrame>
  )
}
