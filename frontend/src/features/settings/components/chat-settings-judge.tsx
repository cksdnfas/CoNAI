import { useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { ChatJudgeItemStats, ChatJudgeLogRun } from '@conai/shared'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'
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

const PAGE_SIZE = 50
/** An uncertain share above this marks the item's thresholds as worth a look. */
const UNSURE_WARN = 0.3

/** SQLite's UTC `YYYY-MM-DD HH:MM:SS`. */
function parseUtc(value: string) {
  return new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
}

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
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-2xs font-semibold tracking-overline text-muted-foreground uppercase">
            <th className="py-2 pr-3 font-semibold">{t({ ko: '항목', en: 'Item' })}</th>
            <th className="py-2 pr-3 text-right font-semibold">{t({ ko: '판단', en: 'Runs' })}</th>
            <th className="py-2 pr-3 text-right font-semibold">{t({ ko: '예', en: 'Yes' })}</th>
            <th className="py-2 pr-3 text-right font-semibold">{t({ ko: '평균 확률', en: 'Avg. p' })}</th>
            <th className="py-2 pr-3 text-right font-semibold">{t({ ko: '애매', en: 'Unsure' })}</th>
            <th className="py-2 pr-3 text-right font-semibold">{t({ ko: '실패', en: 'Failed' })}</th>
            <th className="py-2 pr-3 font-semibold">{t({ ko: '결과', en: 'Outcome' })}</th>
            <th className="py-2 text-right font-semibold">{t({ ko: '평균 지연', en: 'Avg. latency' })}</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((entry) => {
            const unsure = entry.runs > 0 ? entry.uncertain / entry.runs : 0
            return (
              <tr key={`${entry.presetId}:${entry.stage}:${entry.itemId}`} className="border-b border-line last:border-b-0">
                <td className="py-2 pr-3">
                  <span className="font-medium">{entry.name}</span>
                  {/* A turn item says when it is asked; the other kinds are named by what they judge already. */}
                  <span className="ml-1.5 text-xs text-muted-foreground">{[entry.stage === 'before' || entry.stage === 'after' ? judgeStageLabel(entry.stage, t) : '', multiplePresets ? presetNames.get(entry.presetId) ?? `#${entry.presetId}` : ''].filter(Boolean).join(' · ')}</span>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(entry.runs)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{percent(entry.runs > 0 ? entry.yes / entry.runs : null)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatProbability(entry.averageProbability)}</td>
                <td className={cn('py-2 pr-3 text-right tabular-nums', unsure > UNSURE_WARN && 'text-warning')}>{percent(entry.runs > 0 ? unsure : null)}</td>
                <td className={cn('py-2 pr-3 text-right tabular-nums', entry.failed > 0 && 'text-destructive')}>{formatNumber(entry.failed)}</td>
                <td className="py-2 pr-3 tabular-nums"><StatsOutcome stats={entry} /></td>
                <td className="py-2 text-right tabular-nums">{entry.averageLatencyMs === null ? '—' : `${formatNumber(entry.averageLatencyMs / 1000, { maximumFractionDigits: 2 })}s`}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
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
        <span className="tabular-nums text-xs text-muted-foreground">{formatDateTime(parseUtc(run.createdAt), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
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
            <pre className="max-h-80 overflow-auto rounded-sm bg-foreground/5 p-3 font-mono text-2xs leading-relaxed whitespace-pre-wrap break-words">{JSON.stringify(run.request, null, 2)}</pre>
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
 * Settings › Chat › 판단: whether the judge decides well and where its thresholds need moving. Per-item stats for the
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
