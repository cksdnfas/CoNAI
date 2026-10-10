import { useMemo, useState } from 'react'
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
import { ChatBlockEditorModal } from '@/features/settings/components/chat-block-editor-modal'
import { ChatProfileEditorModal } from '@/features/settings/components/chat-profile-editor-modal'
import { useI18n } from '@/i18n'
import {
  CHAT_ADMIN_PROFILES_QUERY_KEY,
  CHAT_BLOCKS_QUERY_KEY,
  CHAT_PROFILES_QUERY_KEY,
  MODEL_SLOTS_QUERY_KEY,
  applyChatProposal,
  undoChatLoreProposal,
  createChatBlock,
  dismissChatProposal,
  threadLorebooksQueryKey,
  createChatProfile,
  getChatProfileDefaults,
  listChatAdminProfiles,
  listChatBlocks,
  listModelSlots,
  markChatProposalSaved,
  updateChatProfile,
  type ChatDisplayBlock,
  type ChatProfile,
  type ChatProfileDefaults,
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

type Proposal = NonNullable<CodexChatToolCall['proposal']>
type BlockProposal = Extract<Proposal, { kind: 'display_block' }>
type ProfileProposal = Extract<Proposal, { kind: 'profile' }>
type UpdateProposal = Extract<Proposal, { kind: 'profile_update' }>
type LoreProposal = Extract<Proposal, { kind: 'lore' }>

import { TaskPlanCard } from './chat-task-ui'

const CARD_CLASS = 'space-y-2.5 rounded-md border border-line px-3 py-2.5'
const DEFAULTS_QUERY_KEY = ['codex-chat-profile-defaults'] as const
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
        ? <div key={item.key} className="flex items-center gap-2 rounded-md border border-dashed border-line px-3 py-1.5 text-xs text-muted-foreground"><Spinner className="size-3" />{t({ ko: '제안 만드는 중…', en: 'Writing a proposal…' })}</div>
        : <ProposalCard key={item.key} proposal={item.proposal} threadId={threadId} />)}
    </div>
  )
}

function ProposalCard({ proposal, threadId }: { proposal: Proposal; threadId?: number }) {
  if (proposal.kind === 'page_fields') return <ChatPageProposalCard proposal={proposal} />
  if (proposal.kind === 'workflow_graph') return <ChatWorkflowProposalCard proposal={proposal} />
  if (proposal.kind === 'page_action') return <ChatPageActionCard proposal={proposal} />
  if (proposal.kind === 'profile_assets') return <ChatAssetProposalCard proposal={proposal} threadId={threadId} />
  if (proposal.kind === 'display_block') return <BlockProposalCard proposal={proposal} threadId={threadId} />
  if (proposal.kind === 'profile') return <ProfileProposalCard proposal={proposal} threadId={threadId} />
  if (proposal.kind === 'lore') return <LoreProposalCard proposal={proposal} threadId={threadId} />
  if (proposal.kind === 'profile_update') return <ProfileUpdateCard proposal={proposal} threadId={threadId} />
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
      <div className="flex items-center gap-2 border-t border-line pt-2 text-xs text-muted-foreground">
        <span>{t({ ko: '저장됨', en: 'Saved' })}</span>
        {admin ? <Link to={savedLink} className="text-primary hover:underline">{t({ ko: '설정에서 열기', en: 'Open in settings' })}</Link> : null}
      </div>
    )
  }
  if (!admin) return null
  return <div className="flex items-center gap-2 border-t border-line pt-2">{children}</div>
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
    <div className={CARD_CLASS}>
      <Header label={t({ ko: '표시 블록 제안', en: 'Display block proposal' })} name={block.key} />
      <div className="rounded-md border border-dashed border-line px-3 py-1"><ChatDisplayBlockView block={block} data={data} /></div>
      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {chips.map((chip) => <span key={chip} className="rounded-sm bg-fill px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">{chip}</span>)}
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
      {admin ? <ChatBlockEditorModal open={editorOpen} shared={null} initialName={proposal.name} initialBlock={initialBlock} onClose={() => setEditorOpen(false)} onSaved={handleEditorSaved} /> : null}
    </div>
  )
}

/** The profile fields a proposal does not set come from the server's defaults, as the editor does for a new profile. */
function fullProfileInput(defaults: ChatProfileDefaults, input: Record<string, unknown>, defaultSlotId: number | null): ChatProfileInput {
  const proposed = input as ChatProfileInput
  return {
    loreScanDepth: defaults.loreScanDepth,
    loreTokenBudget: defaults.loreTokenBudget,
    loreDepth: defaults.loreDepth,
    contextTurns: defaults.contextTurns,
    summaryTriggerTurns: defaults.summaryTriggerTurns,
    maxToolRounds: defaults.maxToolRounds,
    toolOutputLimit: defaults.toolOutputLimit,
    ...(defaultSlotId !== null ? { modelSlotId: defaultSlotId } : {}),
    ...proposed,
    style: { ...defaults.style, ...(proposed.style ?? {}) },
    engine: 'llm',
    mcpEnabled: false,
    isEnabled: true,
  }
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
      const defaults = defaultsQuery.data ?? await getChatProfileDefaults()
      const defaultSlotId = (slots ?? await listModelSlots()).find((slot) => slot.isDefault)?.id ?? null
      const created = await createChatProfile(fullProfileInput(defaults, proposal.input, defaultSlotId))
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
    <div className={CARD_CLASS}>
      <Header label={t({ ko: '프로필 제안', en: 'Profile proposal' })} name={input.name} />
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full border border-dashed border-line text-sm text-muted-foreground">?</span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{input.name}</div>
          {input.tagline ? <div className="truncate text-xs text-muted-foreground">{input.tagline}</div> : null}
          <div className="truncate text-xs text-muted-foreground">{meta}</div>
        </div>
      </div>
      <Footer saved={saved} savedLink="/settings?section=chat" admin={admin}>
        <span className="flex-1" />
        <OpenEditorButton onClick={() => setEditorOpen(true)} disabled={saveMutation.isPending} />
        <SaveButton pending={saveMutation.isPending} onClick={() => saveMutation.mutate()} />
      </Footer>
      {admin ? <ChatProfileEditorModal open={editorOpen} profile={null} initialDraft={initialDraft} defaults={defaultsQuery.data} onClose={() => setEditorOpen(false)} /> : null}
    </div>
  )
}

const UPDATE_LABELS: Record<string, { ko: string; en: string }> = {
  name: { ko: '이름', en: 'Name' },
  tagline: { ko: '짧은 소개', en: 'Tagline' },
  systemPrompt: { ko: '시스템 프롬프트', en: 'System prompt' },
  promptSections: { ko: '섹션', en: 'Sections' },
  greeting: { ko: '첫 인사말', en: 'Greeting' },
  alternateGreetings: { ko: '추가 인사말', en: 'Alternate greetings' },
  authorNote: { ko: '작가 노트', en: 'Author note' },
  appearance: { ko: '외형', en: 'Appearance' },
  modelSlotId: { ko: '대화 모델', en: 'Chat model' },
  summarySlotId: { ko: '요약 모델', en: 'Summary model' },
  translationSlotId: { ko: '번역 모델', en: 'Translation model' },
  suggestSlotId: { ko: '추천 모델', en: 'Suggestion model' },
  lorebookIds: { ko: '로어북', en: 'Lorebooks' },
  blockIds: { ko: '표시 블록', en: 'Display blocks' },
}

/** One side of a before/after row: arrays as counts, slot ids as slot names, long text cut (the row expands it). */
function formatValue(key: string, value: unknown, slotNames: Map<number, string>, t: ReturnType<typeof useI18n>['t']) {
  if (value === undefined) return '—'
  if (key.endsWith('SlotId')) return value === null ? t({ ko: '기본', en: 'Default' }) : (slotNames.get(Number(value)) ?? `#${String(value)}`)
  if (Array.isArray(value)) return t({ ko: '{count}개', en: '{count}' }, { count: value.length })
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
        {long ? <Button variant="ghost" size="xs" className="-ml-2 h-5 text-primary" onClick={() => setExpanded((current) => !current)}>{expanded ? t({ ko: '접기', en: 'Collapse' }) : t({ ko: '펼치기', en: 'Expand' })}</Button> : null}
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
  const editorProfile = useMemo(() => current ? ({ ...current, ...proposal.patch } as ChatProfile) : null, [current, proposal.patch])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const updated = await updateChatProfile(proposal.profileId, proposal.patch as ChatProfileInput)
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
      if (!profile || !keys.every((key) => JSON.stringify(profile[key]) === JSON.stringify(proposal.patch[key]))) return
      setSavedNow(true)
      await markChatProposalSaved(proposal.id, proposal.profileId)
      await refresh()
    }).catch(() => undefined)
  }

  return (
    <div className={CARD_CLASS}>
      <Header label={t({ ko: '프로필 수정 제안', en: 'Profile update proposal' })} name={proposal.profileName} />
      <div className="space-y-1.5">
        {keys.map((key) => (
          <UpdateRow
            key={key}
            label={UPDATE_LABELS[key] ? t(UPDATE_LABELS[key]) : key}
            before={formatValue(key, proposal.before[key], slotNames, t)}
            after={formatValue(key, proposal.patch[key], slotNames, t)}
          />
        ))}
      </div>
      <Footer saved={saved} savedLink="/settings?section=chat" admin={admin}>
        <span className="flex-1" />
        <OpenEditorButton onClick={() => setEditorOpen(true)} disabled={saveMutation.isPending} />
        <SaveButton pending={saveMutation.isPending} onClick={() => saveMutation.mutate()} />
      </Footer>
      {admin && editorOpen && editorProfile ? <ChatProfileEditorModal open profile={editorProfile} defaults={defaultsQuery.data} onClose={handleEditorClose} /> : null}
    </div>
  )
}

/**
 * E: a save_lore proposal — an entry for this chat's own lorebook; anyone in the chat can save or set it aside. With
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
  const keys = (list: string[]) => (list.length > 0 ? list.join(', ') : '—')
  const constantLabel = (value: boolean) => (value ? t({ ko: '상시', en: 'Always' }) : '—')
  // Replacing an entry of the same title: what changes, before and after.
  const changes = before ? [
    { label: t({ ko: '제목', en: 'Title' }), before: before.title, after: proposal.title },
    { label: t({ ko: '키워드', en: 'Keywords' }), before: keys(before.keys), after: keys(proposal.keys) },
    { label: t({ ko: '본문', en: 'Content' }), before: before.content, after: proposal.content },
    { label: t({ ko: '상시', en: 'Always' }), before: constantLabel(before.constant), after: constantLabel(proposal.constant) },
    ...(proposal.file ? [{ label: t({ ko: '자료', en: 'File' }), before: before.file ?? '—', after: `자료/${proposal.file.name}` }] : []),
  ].filter((change) => change.before !== change.after) : []

  return (
    <div className={CARD_CLASS}>
      <Header label={saved && !undone && !proposal.undone ? t({ ko: '로어북에 남겼어', en: 'Kept in the lorebook' }) : t({ ko: '로어북에 남길까?', en: 'Keep this in the lorebook?' })} name={`save_lore · ${t({ ko: '이 채팅', en: 'this chat' })}`} />
      <div className="space-y-2 text-sm">
        <div className="font-semibold">{proposal.title}</div>
        {changes.length > 0 ? (
          <div className="space-y-1.5">
            {changes.map((change) => <UpdateRow key={change.label} label={change.label} before={change.before} after={change.after} />)}
          </div>
        ) : <div className="whitespace-pre-wrap break-words text-muted-foreground">{proposal.content}</div>}
      </div>
      {proposal.keys.length > 0 || proposal.constant || proposal.file ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {proposal.keys.map((key) => <Chip key={key} size="sm" tone="muted">{key}</Chip>)}
          {proposal.constant ? <Chip size="sm" tone="primary">{t({ ko: '상시', en: 'Always' })}</Chip> : null}
          {proposal.file ? <span className="inline-flex items-center gap-1 font-mono text-2xs text-muted-foreground"><FileText className="size-3" aria-hidden />{proposal.file.name}</span> : null}
        </div>
      ) : null}
      {saved || dismissed ? (
        <div className="flex items-center justify-between border-t border-line pt-2 text-xs text-muted-foreground">
          <span>{undone || proposal.undone ? t({ ko: '되돌렸어', en: 'Undone' }) : saved ? t({ ko: '저장됨', en: 'Saved' }) : t({ ko: '무시함', en: 'Dismissed' })}</span>
          {saved && (proposal.replaces || proposal.undoAfter) && !undone && !proposal.undone ? <IconButton size="icon-xs" variant="ghost" disabled={busy} label={t({ ko: '저장 되돌리기', en: 'Undo save' })} onClick={() => undoMutation.mutate()}><Undo2 /></IconButton> : null}
        </div>
      ) : (
        <div className="flex items-center gap-2 border-t border-line pt-2">
          <span className="flex-1" />
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => dismissMutation.mutate()}>{t({ ko: '무시', en: 'Dismiss' })}</Button>
          <SaveButton pending={saveMutation.isPending} disabled={busy} onClick={() => saveMutation.mutate()} />
        </div>
      )}
    </div>
  )
}
