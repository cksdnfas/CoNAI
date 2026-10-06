import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { SquarePen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
  createChatBlock,
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

type Proposal = NonNullable<CodexChatToolCall['proposal']>
type BlockProposal = Extract<Proposal, { kind: 'display_block' }>
type ProfileProposal = Extract<Proposal, { kind: 'profile' }>
type UpdateProposal = Extract<Proposal, { kind: 'profile_update' }>

const CARD_CLASS = 'space-y-2.5 rounded-md border border-line px-3 py-2.5'
const DEFAULTS_QUERY_KEY = ['codex-chat-profile-defaults'] as const
const LONG_TEXT = 160

/** Cards for the settings a reply proposed (and a slim row for one still being written). */
export function ChatProposalCards({ calls, threadId }: { calls: CodexChatToolCall[]; threadId?: number }) {
  const { t } = useI18n()
  const items = calls.flatMap((call): Array<{ key: string; proposal: Proposal | null }> => {
    if (call.proposal) return [{ key: call.id, proposal: call.proposal }]
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
  if (proposal.kind === 'display_block') return <BlockProposalCard proposal={proposal} threadId={threadId} />
  if (proposal.kind === 'profile') return <ProfileProposalCard proposal={proposal} threadId={threadId} />
  // TODO(lorebook phase 4): the save_lore card.
  if (proposal.kind === 'lore') return null
  return <ProfileUpdateCard proposal={proposal} threadId={threadId} />
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
  const slotName = input.modelSlotId != null ? slots?.find((slot) => slot.id === input.modelSlotId)?.name : t({ ko: '기본 모델', en: 'Default model' })
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
  const slotNames = useMemo(() => new Map((slotsQuery.data ?? []).map((slot) => [slot.id, slot.name])), [slotsQuery.data])
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
