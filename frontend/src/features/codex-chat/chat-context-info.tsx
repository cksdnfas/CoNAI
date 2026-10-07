import { useState, type ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ChevronRight, FolderDown, LockKeyhole, ScanText } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Chip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { exportChatDiagnostics, getChatDiagnostics, type ChatContextKind, type ChatContextLore, type ChatContextMeta, type ChatDiagnosticText, type ChatSummarySegment } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'

type T = ReturnType<typeof useI18n>['t']
const GROUPS = [
  { id: 'instructions', label: { ko: '지침', en: 'Instructions' }, kinds: ['system-prompt', 'prompt-section', 'persona', 'guidance', 'user-persona', 'group-header'] },
  { id: 'lore', label: { ko: '로어 목차·상시', en: 'Lore index · constant' }, kinds: ['lore-index', 'constant-lore'] },
  { id: 'examples', label: { ko: '예시', en: 'Examples' }, kinds: ['example'] },
  { id: 'window', label: { ko: '원문 창', en: 'Message window' }, kinds: ['window', 'continuation'] },
  { id: 'reference', label: { ko: '참고 설정', en: 'Reference' }, kinds: ['reference', 'lore', 'author-note', 'state', 'recall', 'summary'] },
  { id: 'directives', label: { ko: '지시·페이지', en: 'Directives · page' }, kinds: ['last-instruction', 'page', 'flags', 'tool-definition', 'tool-result', 'summary-instruction', 'translation-instruction'] },
]
const KIND_LABELS: Record<ChatContextKind, { ko: string; en: string }> = {
  'system-prompt': { ko: '시스템 프롬프트', en: 'System prompt' },
  'prompt-section': { ko: '프롬프트 섹션', en: 'Prompt sections' },
  persona: { ko: '캐릭터', en: 'Character' },
  guidance: { ko: '지침', en: 'Guidance' },
  'user-persona': { ko: '사용자 프로필', en: 'User persona' },
  'group-header': { ko: '그룹 지침', en: 'Group instructions' },
  'lore-index': { ko: '로어 목차', en: 'Lore index' },
  'constant-lore': { ko: '상시 로어', en: 'Constant lore' },
  example: { ko: '예시', en: 'Examples' },
  window: { ko: '원문 창', en: 'Message window' },
  continuation: { ko: '이어쓰기', en: 'Continuation' },
  reference: { ko: '참고 설정', en: 'Reference' },
  lore: { ko: '로어', en: 'Lore' },
  'author-note': { ko: '작가 노트', en: "Author's note" },
  state: { ko: '상태창', en: 'State' },
  recall: { ko: '회상', en: 'Recall' },
  summary: { ko: '요약', en: 'Summary' },
  'last-instruction': { ko: '마지막 지시', en: 'Last instruction' },
  page: { ko: '페이지', en: 'Page' },
  flags: { ko: '플래그', en: 'Flags' },
  'tool-definition': { ko: '도구 정의', en: 'Tool definitions' },
  'tool-result': { ko: '도구 결과', en: 'Tool results' },
  'summary-instruction': { ko: '요약 지시', en: 'Summary instructions' },
  'translation-instruction': { ko: '번역 지시', en: 'Translation instructions' },
}
const ADMIN_KINDS = new Set<ChatContextKind>(['system-prompt', 'prompt-section', 'persona', 'guidance', 'group-header', 'example', 'last-instruction', 'tool-definition', 'summary-instruction', 'translation-instruction'])
const loreKey = (entry: Pick<ChatContextLore, 'bookId' | 'entryId'>) => `${entry.bookId}:${entry.entryId}`

/** Divide merged sections by their parts without counting the parent again. */
function tokenGroups(meta: ChatContextMeta) {
  const totals = GROUPS.map(() => 0)
  for (const section of meta.sections ?? []) {
    const parts = section.parts?.length ? section.parts : [section]
    const partTokens = parts.reduce((sum, part) => sum + part.estTokens, 0)
    let cumulative = 0
    let allocated = 0
    parts.forEach((part, index) => {
      cumulative += part.estTokens
      const boundary = index === parts.length - 1 ? section.estTokens : partTokens > 0 ? Math.round(section.estTokens * cumulative / partTokens) : 0
      const tokens = boundary - allocated
      allocated = boundary
      const group = GROUPS.findIndex((item) => item.kinds.includes(part.kind))
      if (group >= 0) totals[group] += tokens
    })
  }
  return totals
}

function sectionHashes(meta: ChatContextMeta) {
  const hashes = new Map<ChatContextKind, string[]>()
  for (const section of meta.sections ?? []) for (const part of section.parts?.length ? section.parts : [section]) {
    const values = hashes.get(part.kind) ?? []
    values.push(part.hash)
    hashes.set(part.kind, values)
  }
  return hashes
}

function contextChanges(meta: ChatContextMeta, previous: ChatContextMeta, t: T) {
  const current = meta.loreEntries ?? []
  if (previous.version !== 2) return [
    ...current.filter((entry) => !previous.lore.includes(entry.title)).map((entry) => ({ added: true, title: entry.title })),
    ...previous.lore.filter((title) => !current.some((entry) => entry.title === title)).map((title) => ({ added: false, title })),
  ]
  const before = previous.loreEntries ?? []
  const changes = [
    ...current.filter((entry) => !before.some((item) => loreKey(item) === loreKey(entry))).map((entry) => ({ added: true, title: entry.title })),
    ...before.filter((entry) => !current.some((item) => loreKey(item) === loreKey(entry))).map((entry) => ({ added: false, title: entry.title })),
  ]
  const nowHashes = sectionHashes(meta)
  const beforeHashes = sectionHashes(previous)
  for (const kind of new Set([...nowHashes.keys(), ...beforeHashes.keys()])) {
    if (JSON.stringify(nowHashes.get(kind)) === JSON.stringify(beforeHashes.get(kind))) continue
    if (beforeHashes.has(kind)) changes.push({ added: false, title: t(KIND_LABELS[kind]) })
    if (nowHashes.has(kind)) changes.push({ added: true, title: t(KIND_LABELS[kind]) })
  }
  return changes
}

function loreReason(reason: string, matched: string[], t: T, remaining?: number) {
  if (reason === 'constant') return t({ ko: '상시', en: 'Constant' })
  if (reason === 'regex') return t({ ko: '정규식', en: 'Regex' })
  if (reason === 'sticky') return `${t({ ko: '유지', en: 'Sticky' })} · ${remaining ?? 0}`
  const labels: Record<string, { ko: string; en: string }> = {
    cooldown: { ko: '쿨다운', en: 'Cooldown' }, delay: { ko: '지연', en: 'Delay' }, group: { ko: '그룹', en: 'Group' },
    budget: { ko: '예산 초과', en: 'Over budget' }, 'secondary-failed': { ko: '보조 키 불충족', en: 'Secondary key unmet' }, 'codex-sent': { ko: '이미 보냄', en: 'Already sent' },
  }
  if (labels[reason]) return t(labels[reason])
  if (reason.startsWith('key:')) return `${t({ ko: '키워드', en: 'Keyword' })} · ${matched.join(', ') || reason.slice(4)}`
  return reason
}

function recallLabel(segmentId: number, segments: ChatSummarySegment[], t: T) {
  const segment = segments.find((item) => item.id === segmentId)
  return segment ? t({ ko: '(메시지 {from}–{until})', en: '(messages {from}–{until})' }, { from: segment.from_message_id, until: segment.until_message_id }) : t({ ko: '회상 #{id}', en: 'Recall #{id}' }, { id: segmentId })
}

export function parseContextMeta(value: string | null | undefined): ChatContextMeta | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as ChatContextMeta
    return parsed && typeof parsed.sentMessages === 'number' && Array.isArray(parsed.lore) ? parsed : null
  } catch {
    return null
  }
}

/** An icon on a reply that opens what its request carried: why it remembered (or forgot) what it did. */
export function ChatContextInfo({ meta, previous, threadId, messageId, alternative, segments }: {
  meta: ChatContextMeta; previous: ChatContextMeta | null; threadId: number; messageId: number; alternative: number; segments: ChatSummarySegment[]
}) {
  const { t, formatNumber } = useI18n()
  const { showSnackbar } = useSnackbar()
  const auth = useAuthStatusQuery()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('composition')
  const changeOpen = (value: boolean) => { setOpen(value); if (!value) setTab('composition') }
  const version2 = meta.version === 2 && meta.scope !== 'none'
  const scope = version2 ? meta.scope ?? 'view' : 'none'
  const contentAllowed = scope === 'content' || scope === 'prompts'
  const requestedTab = (tab === 'raw' && scope !== 'prompts') || (tab === 'content' && !contentAllowed) ? 'composition' : tab
  const diagnosticsQuery = useQuery({
    queryKey: ['codex-chat-diagnostics', auth.data?.accountId, auth.data?.permissionKeys, threadId, messageId, alternative, scope, meta],
    queryFn: ({ signal }) => getChatDiagnostics(threadId, messageId, alternative, signal),
    enabled: open && version2 && requestedTab !== 'composition' && contentAllowed,
    retry: false,
    gcTime: 0,
  })
  const responseScope = diagnosticsQuery.isSuccess ? diagnosticsQuery.data.scope : scope
  const displayScope = scope === 'none' || scope === 'view' || responseScope === 'prompts' ? scope : responseScope
  const displayContent = displayScope === 'content' || displayScope === 'prompts'
  const selectedTab = (requestedTab === 'raw' && displayScope !== 'prompts') || (requestedTab === 'content' && !displayContent) ? 'composition' : requestedTab
  const exportMutation = useMutation({
    mutationFn: () => exportChatDiagnostics(threadId, messageId, alternative),
    onSuccess: ({ path }) => showSnackbar({ message: t({ ko: '{path}에 저장했어', en: 'Saved to {path}' }, { path }) }),
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '진단을 저장하지 못했어.', en: 'Could not save diagnostics.' })), tone: 'error' }),
  })
  const actualTokens = meta.promptTokens ?? meta.tokenUsage?.inputTokens
  const tokens = actualTokens == null ? `${t({ ko: '추정', en: 'est.' })} ${formatNumber(meta.estimatedTokens)}` : formatNumber(actualTokens)
  const totals = tokenGroups(meta)
  const changes = previous ? contextChanges(meta, previous, t) : []
  const isNewLore = (entry: ChatContextLore) => previous && (previous.version === 2 ? !previous.loreEntries?.some((item) => loreKey(item) === loreKey(entry)) : !previous.lore.includes(entry.title))
  const texts = diagnosticsQuery.data?.texts ?? []
  const visibleTexts = texts.filter((source) => selectedTab === 'raw' ? ADMIN_KINDS.has(source.kind) || source.promptText !== undefined : !ADMIN_KINDS.has(source.kind))
  const textTitle = (source: ChatDiagnosticText) => {
    if (source.kind === 'lore') return meta.loreEntries?.find((entry) => entry.bookId === source.bookId && entry.entryId === source.entryId)?.title
    if (source.kind === 'recall' && typeof source.id === 'number') return recallLabel(source.id, segments, t)
    return source.id === undefined ? null : String(source.id)
  }
  const textBody = (source: ChatDiagnosticText) => <div className="space-y-1.5">
    <div className="flex flex-wrap items-center gap-1">
      {textTitle(source) ? <Chip size="sm" tone="muted">{textTitle(source)}</Chip> : null}
      {source.kind === 'lore' ? (() => {
        const entry = meta.loreEntries?.find((item) => item.bookId === source.bookId && item.entryId === source.entryId)
        return entry ? <Chip size="sm" tone="muted">{loreReason(entry.reason, entry.matched, t)}</Chip> : null
      })() : null}
      {source.changedSince ? <Chip size="sm" tone="warning">{t({ ko: '그 뒤 고침', en: 'Edited since' })}</Chip> : null}
    </div>
    {source.unavailable ? <p className="text-muted-foreground">{t({ ko: '지금은 없음', en: 'Unavailable now' })}</p> : <p className="whitespace-pre-wrap break-words leading-[1.55]">{selectedTab === 'raw' ? source.promptText ?? source.text : source.text}</p>}
  </div>
  const rows: Array<[string, string]> = [
    [t({ ko: '모델', en: 'Model' }), meta.model ?? '—'],
    [t({ ko: '원문으로 보낸 메시지', en: 'Messages sent verbatim' }), formatNumber(meta.sentMessages)],
    [t({ ko: '요약', en: 'Summary' }), meta.summaryUntilMessageId !== null ? t({ ko: '있음', en: 'yes' }) : t({ ko: '없음', en: 'none' })],
    [t({ ko: '회상한 지난 일', en: 'Recalled' }), formatNumber(meta.recalledSegments)],
    [t({ ko: '상시 항목', en: 'Always-on entries' }), formatNumber(meta.memories)],
    [t({ ko: '로어', en: 'Lore' }), meta.lore.length ? meta.lore.join(', ') : t({ ko: '없음', en: 'none' })],
    [t({ ko: '토큰', en: 'Tokens' }), meta.promptTokens ? `${formatNumber(meta.promptTokens)} (${t({ ko: '추정', en: 'est.' })} ${formatNumber(meta.estimatedTokens)})` : `${t({ ko: '추정', en: 'est.' })} ${formatNumber(meta.estimatedTokens)}`],
  ]
  const details: Array<[string, ReactNode]> = [
    [t({ ko: '원문 창', en: 'Message window' }), t({ ko: '메시지 {n}개 · 앞 {dropped}턴 빠짐', en: '{n} messages · {dropped} earlier turns omitted' }, { n: formatNumber(meta.window?.sent ?? meta.sentMessages), dropped: formatNumber(meta.window?.droppedTurns ?? 0) })],
    [t({ ko: '요약', en: 'Summary' }), meta.summaryUntilMessageId !== null ? t({ ko: '메시지 {id}까지', en: 'Through message {id}' }, { id: meta.summaryUntilMessageId }) : t({ ko: '없음', en: 'None' })],
  ]
  if (meta.toolRounds) details.push([t({ ko: '도구', en: 'Tools' }), t({ ko: '{n}라운드', en: '{n} rounds' }, { n: meta.toolRounds })])
  if (previous) details.push([t({ ko: '직전 답변 대비', en: 'Since previous reply' }), changes.length ? <div className="flex flex-wrap gap-x-2 gap-y-1">{changes.map((change, index) => <span key={index} className={change.added ? 'text-success' : 'text-warning'}>{change.added ? '+' : '−'} {change.title}</span>)}</div> : t({ ko: '같음', en: 'Unchanged' })])
  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverAnchor asChild>
        <span className="inline-flex">
          <IconButton size="icon-xs" variant="ghost" aria-expanded={open} label={t({ ko: '이 답변에 들어간 문맥', en: 'What this reply was given' })} onClick={() => changeOpen(!open)}><ScanText /></IconButton>
        </span>
      </PopoverAnchor>
      <PopoverContent align="start" side="top" className={version2 ? 'w-[420px] max-w-[calc(100vw-32px)] p-3' : 'w-72 p-3'}>
        {version2 ? <>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <SegmentedControl size="xs" semantics="tabs" value={selectedTab} onChange={setTab} ariaLabel={t({ ko: '답변 진단', en: 'Answer diagnostics' })}
              items={[
                { value: 'composition', label: t({ ko: '구성', en: 'Composition' }) },
                ...(displayContent ? [{ value: 'content', label: t({ ko: '본문', en: 'Content' }) }] : []),
                ...(displayScope === 'prompts' ? [{ value: 'raw', label: t({ ko: '원문', en: 'Prompts' }) }] : []),
              ]} />
            <div className="ml-auto flex min-w-0 items-center gap-1">
              <span className="flex min-w-0 items-center gap-1 text-2xs tabular-nums text-muted-foreground"><span className="max-w-20 truncate" title={meta.model ?? undefined}>{meta.model ?? '—'}</span><span className="shrink-0">· {tokens} {t({ ko: '토큰', en: 'tokens' })}</span></span>
              <IconButton size="icon-xs" variant="ghost" disabled={exportMutation.isPending} label={t({ ko: '파일 보관함에 저장', en: 'Save to file store' })} onClick={() => exportMutation.mutate()}><FolderDown /></IconButton>
            </div>
          </div>
          <div role="tabpanel" className="mt-3 max-h-[min(60vh,480px)] space-y-3 overflow-y-auto text-xs">
            {selectedTab === 'composition' ? <>
              {meta.engine === 'codex' ? <div className="space-y-2">
                <div className="flex justify-between"><span>{t({ ko: '보낸 입력', en: 'Sent input' })}</span><span className="tabular-nums">{t({ ko: '키 {n}개', en: '{n} keys' }, { n: meta.codexKeys?.length ?? 0 })}</span></div>
                <Tip content={t({ ko: 'Codex가 압축하고 보관한 내부 문맥은 볼 수 없어', en: 'Codex’s compacted and stored internal context is unavailable' })}><span tabIndex={0} className="flex items-center gap-1.5 text-muted-foreground"><LockKeyhole className="size-3" />{t({ ko: 'Codex 내부 문맥', en: 'Codex internal context' })}</span></Tip>
              </div> : <div className="space-y-2">
                <div className="flex h-2.5 gap-px overflow-hidden rounded-sm" aria-hidden="true">
                  {GROUPS.map((group, index) => totals[index] > 0 ? <span key={group.id} style={{ flex: `${totals[index]} 1 0%`, backgroundColor: `var(--chat-diagnostics-${group.id})` }} /> : null)}
                </div>
                <div className="grid grid-cols-3 gap-x-2 gap-y-1.5">
                  {GROUPS.map((group, index) => <div key={group.id} className="flex min-w-0 items-center gap-1 text-2xs"><span className="size-2 shrink-0 rounded-xs" style={{ backgroundColor: `var(--chat-diagnostics-${group.id})` }} /><span className="min-w-0">{t(group.label)} <span className="tabular-nums">{formatNumber(totals[index])}</span></span></div>)}
                </div>
              </div>}
              {(meta.loreEntries?.length ?? 0) > 0 || (meta.loreSkipped?.length ?? 0) > 0 || (meta.loreUnmatched ?? 0) > 0 ? <div className="space-y-2 border-t border-line pt-3">
                <div className="flex justify-between"><strong>{t({ ko: '로어 {n}', en: 'Lore {n}' }, { n: meta.loreEntries?.length ?? 0 })}</strong><span className="text-muted-foreground">{t({ ko: '안 걸림 {n}', en: 'Unmatched {n}' }, { n: meta.loreUnmatched ?? 0 })}</span></div>
                {(meta.loreEntries ?? []).map((entry) => <div key={loreKey(entry)} className="flex flex-wrap items-center gap-1.5"><span className="break-words">{entry.title}</span><Chip size="sm" tone="muted" className="whitespace-normal">{loreReason(entry.reason, entry.matched, t, entry.remaining)}</Chip>{isNewLore(entry) ? <Chip size="sm" tone="success">{t({ ko: '새로', en: 'New' })}</Chip> : null}</div>)}
                {(meta.loreSkipped ?? []).map((entry) => <div key={loreKey(entry)} className="flex flex-wrap items-center gap-1.5"><span className="break-words text-muted-foreground line-through">{entry.title}</span><Chip size="sm" tone="warning">{loreReason(entry.reason, [], t)}</Chip></div>)}
              </div> : null}
              {(meta.recall?.length ?? 0) > 0 ? <div className="space-y-2 border-t border-line pt-3">
                <strong>{t({ ko: '회상 {n}', en: 'Recall {n}' }, { n: meta.recall?.length ?? 0 })}</strong>
                {(meta.recall ?? []).map((recall) => <div key={recall.segmentId} className="flex flex-wrap items-center gap-1.5"><span>{recallLabel(recall.segmentId, segments, t)}</span><span className="tabular-nums text-muted-foreground">{formatNumber(recall.score, { maximumFractionDigits: 2 })}</span>{recall.terms.map((term) => <Chip key={term} size="sm" tone="muted">{term}</Chip>)}</div>)}
              </div> : null}
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 border-t border-line pt-3">
                {details.map(([label, value]) => <div key={label} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 break-words tabular-nums">{value}</dd></div>)}
              </dl>
            </> : diagnosticsQuery.isFetching ? <p className="text-muted-foreground" role="status">{t({ ko: '불러오는 중…', en: 'Loading…' })}</p> : diagnosticsQuery.isError ? <p role="alert" className="text-destructive">{getErrorMessage(diagnosticsQuery.error, t({ ko: '진단을 불러오지 못했어.', en: 'Could not load diagnostics.' }))}</p> : diagnosticsQuery.data ? <>
              {[...new Set(visibleTexts.map((source) => source.kind))].map((kind) => {
                const entries = visibleTexts.filter((source) => source.kind === kind)
                return selectedTab === 'raw' ? <details key={kind} className="group border-t border-line pt-2 first:border-t-0 first:pt-0"><summary className="flex cursor-pointer items-center gap-1 font-semibold"><ChevronRight className="size-3 transition-transform group-open:rotate-90" />{t(KIND_LABELS[kind])}</summary><div className="space-y-3 pt-2 font-mono">{entries.map((source, index) => <div key={index}>{textBody(source)}</div>)}</div></details> : <section key={kind} className="space-y-2 border-t border-line pt-3 first:border-t-0 first:pt-0"><h4 className="font-semibold">{t(KIND_LABELS[kind])}</h4>{entries.map((source, index) => <div key={index}>{textBody(source)}</div>)}</section>
              })}
              {selectedTab === 'content' && diagnosticsQuery.data.scope === 'content' ? <div className="flex items-center gap-1.5 border-t border-line pt-3 text-muted-foreground"><LockKeyhole className="size-3" />{t({ ko: '시스템 프롬프트·도구 정의', en: 'System prompt · tool definitions' })}</div> : null}
              {selectedTab === 'raw' && diagnosticsQuery.data.scope === 'prompts' && diagnosticsQuery.data.raw != null ? <details className="group border-t border-line pt-2"><summary className="flex cursor-pointer items-center gap-1 font-semibold"><ChevronRight className="size-3 transition-transform group-open:rotate-90" />{t({ ko: '요청 원문', en: 'Raw request' })}</summary><pre className="whitespace-pre-wrap break-words pt-2 font-mono leading-[1.55]">{JSON.stringify(diagnosticsQuery.data.raw, null, 2)}</pre></details> : null}
            </> : null}
          </div>
        </> : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        )}
      </PopoverContent>
    </Popover>
  )
}
