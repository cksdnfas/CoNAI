import { useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { ChatJudgeItemStats, ChatJudgeLogRun, ChatPageData } from '@conai/shared'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { CodeBlock } from '@/components/ui/code-block'
import { IconButton } from '@/components/ui/icon-button'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { DataTable, DataTd, DataTh, DataTr } from '@/components/ui/data-table'
import { useI18n } from '@/i18n'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageChoice, pageNumber, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import {
  CHAT_JUDGE_LOGS_QUERY_KEY,
  CHAT_JUDGE_PRESETS_QUERY_KEY,
  CHAT_JUDGE_STATS_QUERY_KEY,
  getChatJudgeStats,
  listChatJudgeLogs,
  listChatJudgePresets,
  type ChatJudgeLogFilter,
} from '@/lib/api-chat-judge'
import { CHAT_ADMIN_PROFILES_QUERY_KEY, listChatAdminProfiles } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { formatProbability, judgeActionLabel, judgeDecidedByLabel, judgeOutcomeLabel, judgeStageLabel, JudgeVerdictChip } from './chat-judge-parts'
import { SettingsEmptyRow, SettingsRowsSkeleton } from './settings-rows'
import { useChatOptionsPageParts } from './chat-options-page'
import { parseServerDate } from '@/lib/server-time'

const PAGE_SIZE = 50
/** An uncertain share above this marks the item's thresholds as worth a look. */
const UNSURE_WARN = 0.3

function percent(value: number | null) {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

/** The result column: what came of the item's answers (lore saved, tools used, follow-ups answered). */
function StatsOutcome({ stats }: { stats: ChatJudgeItemStats }) {
  const { t } = useI18n()
  if (stats.loreSaveRate !== null) return <span>{t({ ko: '로어 저장 {value}', en: 'Lore saved {value}' }, { value: percent(stats.loreSaveRate) })}</span>
  if (stats.followUpAnswerRate !== null) return <span>{t({ ko: '후속 뒤 응답 {value}', en: 'Answered {value}' }, { value: percent(stats.followUpAnswerRate) })}</span>
  if (stats.toolUseRate !== null) return <span>{t({ ko: '도구 사용 {value}', en: 'Tool used {value}' }, { value: percent(stats.toolUseRate) })}</span>
  return <span className="text-muted-foreground">—</span>
}

function StatsTable({ stats, presetNames }: { stats: ChatJudgeItemStats[]; presetNames: Map<number, string> }) {
  const { t, formatNumber } = useI18n()
  const multiplePresets = new Set(stats.map((entry) => entry.presetId)).size > 1
  return (
    <DataTable
      minWidthClassName="min-w-[48rem]"
      head={<>
        <DataTh>{t({ ko: '항목', en: 'Item' })}</DataTh>
        <DataTh numeric>{t({ ko: '판단', en: 'Runs' })}</DataTh>
        <DataTh numeric>{t({ ko: '예', en: 'Yes' })}</DataTh>
        <DataTh numeric>{t({ ko: '평균 확률', en: 'Avg. p' })}</DataTh>
        <DataTh numeric>{t({ ko: '애매', en: 'Unsure' })}</DataTh>
        <DataTh numeric>{t({ ko: '실패', en: 'Failed' })}</DataTh>
        <DataTh>{t({ ko: '결과', en: 'Outcome' })}</DataTh>
        <DataTh numeric>{t({ ko: '평균 토큰', en: 'Avg. tokens' })}</DataTh>
        <DataTh numeric>{t({ ko: '평균 지연', en: 'Avg. latency' })}</DataTh>
      </>}
    >
      {stats.map((entry) => {
        const unsure = entry.runs > 0 ? entry.uncertain / entry.runs : 0
        return (
          <DataTr key={`${entry.presetId}:${entry.stage}:${entry.itemId}`}>
            <DataTd>
              <span className="font-medium">{entry.name}</span>
              {/* A turn item says when it is asked; the other kinds are named by what they judge already. */}
              <span className="ml-1.5 text-xs text-muted-foreground">{[entry.stage === 'before' || entry.stage === 'after' ? judgeStageLabel(entry.stage, t) : '', multiplePresets ? presetNames.get(entry.presetId) ?? `#${entry.presetId}` : ''].filter(Boolean).join(' · ')}</span>
            </DataTd>
            <DataTd numeric>{formatNumber(entry.runs)}</DataTd>
            <DataTd numeric>{percent(entry.runs > 0 ? entry.yes / entry.runs : null)}</DataTd>
            <DataTd numeric>{formatProbability(entry.averageProbability)}</DataTd>
            <DataTd numeric className={cn(unsure > UNSURE_WARN && 'text-warning')}>{percent(entry.runs > 0 ? unsure : null)}</DataTd>
            <DataTd numeric className={cn(entry.failed > 0 && 'text-destructive')}>{formatNumber(entry.failed)}</DataTd>
            <DataTd className="tabular-nums"><StatsOutcome stats={entry} /></DataTd>
            <DataTd numeric>{entry.averageTokens === null ? '—' : formatNumber(Math.round(entry.averageTokens))}</DataTd>
            <DataTd numeric>{entry.averageLatencyMs === null ? '—' : `${formatNumber(entry.averageLatencyMs / 1000, { maximumFractionDigits: 2 })}s`}</DataTd>
          </DataTr>
        )
      })}
    </DataTable>
  )
}

function LogRow({ run }: { run: ChatJudgeLogRun }) {
  const { t, formatDateTime, formatNumber } = useI18n()
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-line first:border-t-0">
      {/* eslint-disable-next-line no-restricted-syntax -- a full-width disclosure row; Button would pad and centre it */}
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="grid w-full cursor-pointer grid-cols-[1rem_7.5rem_minmax(8rem,12rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-sm py-2.5 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
        <ChevronRight className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className="tabular-nums text-xs text-muted-foreground">{formatDateTime(parseServerDate(run.createdAt), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{run.profileName || (run.profileId === null ? t({ ko: '그룹 방', en: 'Group room' }) : `#${run.profileId}`)}</span>
          <span className="block truncate text-xs text-muted-foreground">{run.threadTitle || (run.threadId === null ? t({ ko: '자산 묶음', en: 'Asset batch' }) : `#${run.threadId}`)} · {judgeStageLabel(run.stage, t)}</span>
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {run.items.map((item) => (
            <span key={item.itemId} className="inline-flex items-center gap-1">
              <span className="text-xs">{item.name}</span>
              <JudgeVerdictChip result={item} />
              <span className="text-xs tabular-nums text-muted-foreground">{formatProbability(item.probability)}</span>
            </span>
          ))}
          {run.error && run.items.every((item) => item.decidedBy === 'fallback') ? <span className="truncate text-xs text-destructive">{run.error}</span> : null}
        </span>
        <span className="tabular-nums text-xs text-muted-foreground">{formatNumber(run.latencyMs / 1000, { maximumFractionDigits: 2 })}s</span>
      </button>
      {open ? (
        <div className="grid gap-4 pb-4 pl-7 md:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <div className="text-xs font-medium">{t({ ko: '보낸 요청', en: 'Request sent' })} <span className="text-muted-foreground">{t({ ko: '원문', en: 'original text' })}</span></div>
            <CodeBlock size="2xs" maxHeight="lg">{JSON.stringify(run.request, null, 2)}</CodeBlock>
          </div>
          <div className="min-w-0 space-y-3 text-sm">
            <div className="divide-y divide-line">
              {run.items.map((item) => {
                const outcome = judgeOutcomeLabel(item.outcome, t)
                const decided = judgeDecidedByLabel(item, t)
                return (
                  <div key={item.itemId} className="flex flex-wrap items-center gap-2 py-1.5">
                    <span className="min-w-24 font-medium">{item.name}</span>
                    <span className="font-mono text-xs tabular-nums">{item.choice ? `${item.choice} · ` : ''}{formatProbability(item.probability)}</span>
                    <JudgeVerdictChip result={item} />
                    <span className="text-xs text-muted-foreground">{judgeActionLabel(item, t)}{decided ? ` · ${decided}` : ''}</span>
                    {outcome ? <Chip size="sm" tone={outcome.tone}>{outcome.label}</Chip> : null}
                  </div>
                )
              })}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">{t({ ko: '연결', en: 'Connection' })}</dt>
              <dd className="font-mono">{run.providerName} · {run.model}</dd>
              <dt className="text-muted-foreground">{t({ ko: '프리셋', en: 'Preset' })}</dt>
              <dd>{run.presetName || `#${run.presetId}`}</dd>
              {run.error ? <><dt className="text-muted-foreground">{t({ ko: '오류', en: 'Error' })}</dt><dd className="break-words text-destructive">{run.error}</dd></> : null}
            </dl>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Settings › LLM › 판단: whether the judge decides well and where its thresholds need moving. Per-item stats for the
 * period first, then the runs, each unfolding to the request it sent (the original conversation) and what came of it.
 */
export function ChatSettingsJudge() {
  const { t, formatNumber } = useI18n()
  const [filter, setFilter] = useState<ChatJudgeLogFilter>({ days: 7 })
  const presetsQuery = useQuery({ queryKey: CHAT_JUDGE_PRESETS_QUERY_KEY, queryFn: listChatJudgePresets })
  const profilesQuery = useQuery({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY, queryFn: listChatAdminProfiles })
  const presets = presetsQuery.data ?? []
  const profiles = profilesQuery.data ?? []
  const statsQuery = useQuery({ queryKey: [...CHAT_JUDGE_STATS_QUERY_KEY, filter.profileId, filter.presetId, filter.days], queryFn: () => getChatJudgeStats({ profileId: filter.profileId, presetId: filter.presetId, days: filter.days }) })
  const logsQuery = useInfiniteQuery({
    queryKey: [...CHAT_JUDGE_LOGS_QUERY_KEY, filter],
    queryFn: ({ pageParam }) => listChatJudgeLogs({ ...filter, days: undefined, limit: PAGE_SIZE, beforeId: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.length < PAGE_SIZE ? undefined : last[last.length - 1].id),
  })
  const runs = logsQuery.data?.pages.flat() ?? []
  const stats = statsQuery.data ?? []
  const itemChoices = [...new Map(stats.filter((entry) => !filter.presetId || entry.presetId === filter.presetId).map((entry) => [entry.itemId, entry.name])).entries()]
  const totalRuns = stats.reduce((sum, entry) => sum + entry.runs, 0)
  const totalFailed = stats.reduce((sum, entry) => sum + entry.failed, 0)
  const patch = (next: Partial<ChatJudgeLogFilter>) => setFilter((current) => ({ ...current, ...next }))
  const number = (value: string) => (value ? Number(value) : undefined)

  // A connected chat reads the same stats and the latest runs (lists at the top of data: a long one shows as a count
  // until read_page_data reads it), and narrows them with the same filters.
  const chatData: Record<string, ChatPageData> = {
    filter: { profileId: filter.profileId ?? 0, presetId: filter.presetId ?? 0, itemId: filter.itemId ?? '', verdict: filter.verdict ?? '', days: filter.days ?? 7 },
    bots: profiles.map((profile) => ({ id: profile.id, name: profile.name })),
    presets: presets.map((preset) => ({ id: preset.id, name: preset.name })),
    stats: stats.map((entry) => ({ presetId: entry.presetId, itemId: entry.itemId, name: entry.name, runs: entry.runs, yes: entry.yes, no: entry.no, uncertain: entry.uncertain, failed: entry.failed })),
    recentRuns: runs.slice(0, 20).map((run) => ({
      at: run.createdAt, bot: run.profileName, preset: run.presetName, ...(run.error ? { error: run.error.slice(0, 120) } : {}),
      verdicts: run.items.map((item) => `${item.name}: ${item.verdict}`).join(', '),
    })),
  }
  // The answer diagnostics shown above the log on the same view.
  const diagnosticsParts = useChatOptionsPageParts('diagnostics')
  useChatPageRegistration({
    kind: 'settings', title: t({ ko: '설정 · LLM 기록', en: 'Settings · LLM log' }), resourceId: 'llm', priority: 5, fields: [], data: { ...chatData, ...diagnosticsParts.data },
    actions: [...diagnosticsParts.actions, pageAction('settings.judge_filter', t({ ko: '판단 기록 거르기', en: 'Filter the judge log' }), t({
      ko: 'data.filter를 바꿔(넘긴 것만, 0이나 빈 값 = 전체).',
      en: 'Change data.filter (only what you pass; 0 or empty = all).',
    }), pageObject({ profileId: pageNumber(0, undefined, true), presetId: pageNumber(0, undefined, true), itemId: pageText(120), verdict: pageChoice(['', 'yes', 'no', 'uncertain', 'failed']), days: pageChoice([1, 7, 30]) }))],
    apply: () => {},
    applyAction: (id, args, assertCurrent) => {
      assertCurrent()
      const saved = diagnosticsParts.apply(id, args)
      if (saved) return saved
      if (id !== 'settings.judge_filter') throw new Error('이 화면에 없는 작업이야.')
      const next: Partial<ChatJudgeLogFilter> = {}
      if (typeof args.profileId === 'number') next.profileId = args.profileId || undefined
      if (typeof args.presetId === 'number') { next.presetId = args.presetId || undefined; next.itemId = undefined }
      if (typeof args.itemId === 'string') next.itemId = args.itemId || undefined
      if (typeof args.verdict === 'string') next.verdict = args.verdict || undefined
      if (typeof args.days === 'number') next.days = args.days
      patch(next)
    },
  }, { preserveOnSearchChange: true })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Select variant="settings" className="w-40" aria-label={t({ ko: '봇', en: 'Bot' })} value={filter.profileId ?? ''} onChange={(event) => patch({ profileId: number(event.target.value) })}>
          <option value="">{t({ ko: '봇 · 전체', en: 'All bots' })}</option>
          {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </Select>
        <Select variant="settings" className="w-40" aria-label={t({ ko: '프리셋', en: 'Preset' })} value={filter.presetId ?? ''} onChange={(event) => patch({ presetId: number(event.target.value), itemId: undefined })}>
          <option value="">{t({ ko: '프리셋 · 전체', en: 'All presets' })}</option>
          {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
        </Select>
        <Select variant="settings" className="w-36" aria-label={t({ ko: '항목', en: 'Item' })} value={filter.itemId ?? ''} onChange={(event) => patch({ itemId: event.target.value || undefined })}>
          <option value="">{t({ ko: '항목 · 전체', en: 'All items' })}</option>
          {itemChoices.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </Select>
        <Select variant="settings" className="w-32" aria-label={t({ ko: '판정', en: 'Verdict' })} value={filter.verdict ?? ''} onChange={(event) => patch({ verdict: event.target.value || undefined })}>
          <option value="">{t({ ko: '판정 · 전체', en: 'All verdicts' })}</option>
          <option value="yes">{t({ ko: '예', en: 'Yes' })}</option>
          <option value="no">{t({ ko: '아니오', en: 'No' })}</option>
          <option value="uncertain">{t({ ko: '애매', en: 'Unsure' })}</option>
          <option value="failed">{t({ ko: '실패', en: 'Failed' })}</option>
        </Select>
        <Select variant="settings" className="w-28" aria-label={t({ ko: '기간', en: 'Period' })} value={filter.days ?? 7} onChange={(event) => patch({ days: Number(event.target.value) })}>
          <option value={1}>{t({ ko: '최근 1일', en: 'Last day' })}</option>
          <option value={7}>{t({ ko: '최근 7일', en: 'Last 7 days' })}</option>
          <option value={30}>{t({ ko: '최근 30일', en: 'Last 30 days' })}</option>
        </Select>
        <span className="flex-1" />
        <span className="text-xs tabular-nums text-muted-foreground">{t({ ko: '판단 {runs}회 · 실패 {failed}', en: '{runs} judgments · {failed} failed' }, { runs: formatNumber(totalRuns), failed: formatNumber(totalFailed) })}</span>
        <IconButton size="icon-sm" variant="ghost" onClick={() => { void statsQuery.refetch(); void logsQuery.refetch() }} label={t({ ko: '새로 고침', en: 'Refresh' })}><RefreshCw /></IconButton>
      </div>

      <section className="space-y-2">
        {statsQuery.isLoading ? <SettingsRowsSkeleton rows={2} /> : null}
        {statsQuery.isError ? <p className="text-sm text-destructive">{getErrorMessage(statsQuery.error, t({ ko: '통계를 불러오지 못했어.', en: 'Could not load the stats.' }))}</p> : null}
        {statsQuery.isSuccess && stats.length === 0 ? <SettingsEmptyRow>{t({ ko: '이 기간에 판단한 기록이 없어.', en: 'No judgments in this period.' })}</SettingsEmptyRow> : null}
        {stats.length > 0 ? <StatsTable stats={stats} presetNames={new Map(presets.map((preset) => [preset.id, preset.name]))} /> : null}
      </section>

      <section>
        {logsQuery.isLoading ? <SettingsRowsSkeleton rows={3} /> : null}
        {logsQuery.isError ? <p className="text-sm text-destructive">{getErrorMessage(logsQuery.error, t({ ko: '기록을 불러오지 못했어.', en: 'Could not load the log.' }))}</p> : null}
        {logsQuery.isSuccess && runs.length === 0 ? <SettingsEmptyRow>{t({ ko: '기록이 없어.', en: 'Nothing logged.' })}</SettingsEmptyRow> : null}
        {runs.map((run) => <LogRow key={run.id} run={run} />)}
        {logsQuery.hasNextPage ? (
          <div className="flex justify-center pt-3">
            <Button variant="ghost" size="sm" disabled={logsQuery.isFetchingNextPage} onClick={() => void logsQuery.fetchNextPage()}>{t({ ko: '더 보기', en: 'More' })}</Button>
          </div>
        ) : null}
      </section>
    </div>
  )
}
