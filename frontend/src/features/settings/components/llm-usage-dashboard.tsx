import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AgentCliName } from '@conai/shared'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { RowGroup } from '@/components/ui/row-group'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { getAgentCliStatus, getAgentCliUsage } from '@/lib/api-agent-cli'
import { CHAT_JUDGE_STATS_QUERY_KEY, getChatJudgeStats } from '@/lib/api-chat-judge'
import { getExternalApiProviders } from '@/lib/api-external-api'
import { getLlmUsage, LLM_USAGE_QUERY_KEY, type LlmUsageEngine, type LlmUsagePurpose, type LlmUsageSummary } from '@/lib/api-llm-usage'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { AgentCliUsageBars } from './agent-cli-settings'
import { Sparkline, StackedBars, type StackedSeries } from './llm-usage-charts'
import { SettingsEmptyRow, SettingsRowsSkeleton } from './settings-rows'

type Split = 'purpose' | 'model'
type Metric = 'tokens' | 'requests'
type Translate = ReturnType<typeof useI18n>['t']

const SPLIT_STORAGE_KEY = 'conai.llmDashboard.split'
const SERIES_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']
/** "Other" is a fold, not a series: neutral ink. */
const OTHER_COLOR = 'color-mix(in srgb, var(--muted-foreground) 55%, transparent)'
/** Above this many models, the smaller ones fold into "other" so the colours stay apart. */
const MODEL_SERIES_MAX = 5
/** A judge item whose uncertain share passes this needs its thresholds looked at (as on the judge tab). */
const UNSURE_WARN = 0.3

const PURPOSE_GROUPS: Array<{ id: string; label: { ko: string; en: string }; purposes: LlmUsagePurpose[] }> = [
  { id: 'chat', label: { ko: '채팅 답변', en: 'Chat replies' }, purposes: ['chat'] },
  { id: 'summary', label: { ko: '요약', en: 'Summaries' }, purposes: ['summary'] },
  { id: 'judge', label: { ko: '판단', en: 'Judge' }, purposes: ['judge'] },
  { id: 'assist', label: { ko: '보조 (번역·제안·자산·그림 프롬프트)', en: 'Assist (translation, suggestions, assets, picture prompts)' }, purposes: ['translation', 'suggestion', 'asset_vision', 'appearance', 'image_prompt'] },
  { id: 'workflow', label: { ko: '워크플로', en: 'Workflows' }, purposes: ['workflow'] },
  { id: 'other', label: { ko: '기타', en: 'Other' }, purposes: ['other'] },
]

function readSplit(): Split {
  try {
    return window.localStorage.getItem(SPLIT_STORAGE_KEY) === 'model' ? 'model' : 'purpose'
  } catch {
    return 'purpose'
  }
}

function storeSplit(split: Split) {
  try {
    window.localStorage.setItem(SPLIT_STORAGE_KEY, split)
  } catch {
    // A blocked storage only means the choice is not remembered.
  }
}

const ENGINE_LABELS: Record<LlmUsageEngine, { ko: string; en: string }> = {
  api: { ko: 'API', en: 'API' },
  'claude-code': { ko: '구독', en: 'Subscription' },
  codex: { ko: '구독', en: 'Subscription' },
  typesafe: { ko: '판단', en: 'Judge' },
}

/** The connection's own name; the subscription CLIs have no connection row. */
function connectionName(providerName: string, names: Map<string, string>) {
  if (providerName === 'codex') return 'Codex'
  if (providerName === '__conai_claude_code__') return 'Claude Code'
  return names.get(providerName) ?? providerName
}

type ChartData = { series: StackedSeries[]; values: number[][]; requests: number[][]; totals: number[]; requestTotals: number[] }

function chartData(summary: LlmUsageSummary, split: Split, names: Map<string, string>, t: Translate): ChartData {
  const dayIndex = new Map(summary.daily.map((day, index) => [day.date, index]))
  const empty = (size: number) => summary.daily.map(() => Array<number>(size).fill(0))
  if (split === 'purpose') {
    const groupOf = new Map(PURPOSE_GROUPS.flatMap((group, index) => group.purposes.map((purpose) => [purpose, index] as const)))
    const values = empty(PURPOSE_GROUPS.length)
    const requests = empty(PURPOSE_GROUPS.length)
    for (const entry of summary.byPurpose) {
      const day = dayIndex.get(entry.date)
      const group = groupOf.get(entry.purpose) ?? PURPOSE_GROUPS.length - 1
      if (day === undefined) continue
      values[day][group] += entry.tokens
      requests[day][group] += entry.requests
    }
    // Colour follows the group, so a group keeps its colour whichever others are present.
    const all = PURPOSE_GROUPS.map((group, index) => ({ id: group.id, label: t(group.label), color: group.id === 'other' ? OTHER_COLOR : SERIES_COLORS[index] }))
    return pick(all, values, requests)
  }
  const ranked = summary.models.map((model) => `${model.providerName}\u0000${model.model}`)
  const shown = ranked.slice(0, ranked.length > MODEL_SERIES_MAX ? MODEL_SERIES_MAX - 1 : MODEL_SERIES_MAX)
  const indexOf = new Map(shown.map((key, index) => [key, index]))
  const values = empty(shown.length + 1)
  const requests = empty(shown.length + 1)
  for (const entry of summary.byModel) {
    const day = dayIndex.get(entry.date)
    if (day === undefined) continue
    const series = indexOf.get(`${entry.providerName}\u0000${entry.model}`) ?? shown.length
    values[day][series] += entry.tokens
    requests[day][series] += entry.requests
  }
  const all = [
    ...shown.map((key, index) => {
      const [providerName, model] = key.split('\u0000')
      return { id: key, label: `${connectionName(providerName, names)} · ${model || t({ ko: '기본 모델', en: 'default model' })}`, color: SERIES_COLORS[index] }
    }),
    { id: 'other', label: t({ ko: '기타', en: 'Other' }), color: OTHER_COLOR },
  ]
  return pick(all, values, requests)
}

/** Drops the series with nothing in the period (their colours stay with the others). */
function pick(all: StackedSeries[], values: number[][], requests: number[][]): ChartData {
  const keep = all.map((_, index) => values.some((row) => row[index] > 0) || requests.some((row) => row[index] > 0))
  const filter = <T,>(row: T[]) => row.filter((_, index) => keep[index])
  const keptValues = values.map(filter)
  const keptRequests = requests.map(filter)
  const sum = (rows: number[][]) => filter(all).map((_, index) => rows.reduce((total, row) => total + row[index], 0))
  return { series: filter(all), values: keptValues, requests: keptRequests, totals: sum(keptValues), requestTotals: sum(keptRequests) }
}

function SubscriptionLimits() {
  const { t } = useI18n()
  const agents: AgentCliName[] = ['codex', 'claude']
  const statuses = useQuery({ queryKey: ['agent-cli-status', 'codex'], queryFn: () => getAgentCliStatus('codex'), retry: false, refetchInterval: 30000 })
  const claudeStatus = useQuery({ queryKey: ['agent-cli-status', 'claude'], queryFn: () => getAgentCliStatus('claude'), retry: false, refetchInterval: 30000 })
  const signedIn = { codex: statuses.data?.authenticated === true, claude: claudeStatus.data?.authenticated === true }
  const codexUsage = useQuery({ queryKey: ['agent-cli-usage', 'codex'], queryFn: () => getAgentCliUsage('codex'), enabled: signedIn.codex, retry: false, refetchInterval: 300000 })
  const claudeUsage = useQuery({ queryKey: ['agent-cli-usage', 'claude'], queryFn: () => getAgentCliUsage('claude'), enabled: signedIn.claude, retry: false, refetchInterval: 300000 })
  const windows = { codex: signedIn.codex ? codexUsage.data?.windows ?? [] : [], claude: signedIn.claude ? claudeUsage.data?.windows ?? [] : [] }
  const shown = agents.filter((agent) => windows[agent].length > 0)
  if (shown.length === 0) return null
  return (
    <RowGroup heading={t({ ko: '구독 한도', en: 'Subscription limits' })}>
      <div className="space-y-3 pt-2">
        {shown.map((agent) => (
          <div key={agent}>
            <div className="text-sm font-semibold">{agent === 'codex' ? 'Codex' : 'Claude Code'}</div>
            <AgentCliUsageBars windows={windows[agent]} />
          </div>
        ))}
      </div>
    </RowGroup>
  )
}

/**
 * Settings › LLM › 계기판: a rough look at what the models were asked for — totals with a trend, daily bars by
 * purpose or by model, the models table, a judge line and the subscription limits. The judge tab has the detail.
 */
export function LlmUsageDashboard({ onOpenJudge }: { onOpenJudge: () => void }) {
  const { t, formatNumber } = useI18n()
  const [days, setDays] = useState(7)
  const [split, setSplitState] = useState<Split>(readSplit)
  const [metric, setMetric] = useState<Metric>('tokens')
  const usageQuery = useQuery({ queryKey: [...LLM_USAGE_QUERY_KEY, days], queryFn: () => getLlmUsage(days) })
  const providersQuery = useQuery({ queryKey: ['external-api-providers', 'settings-llm-connections'], queryFn: getExternalApiProviders })
  const judgeQuery = useQuery({ queryKey: [...CHAT_JUDGE_STATS_QUERY_KEY, undefined, undefined, days], queryFn: () => getChatJudgeStats({ days }) })
  const names = useMemo(() => new Map((providersQuery.data ?? []).map((provider) => [provider.provider_name, provider.display_name || provider.provider_name])), [providersQuery.data])
  const summary = usageQuery.data
  const chart = useMemo(() => (summary ? chartData(summary, split, names, t) : null), [summary, split, names, t])

  const setSplit = (next: Split) => {
    setSplitState(next)
    storeSplit(next)
  }
  const compact = (value: number) => formatNumber(value, { notation: 'compact', maximumFractionDigits: value >= 1000 ? 1 : 0 })
  const seconds = (ms: number | null) => (ms === null ? '—' : t({ ko: '{value}초', en: '{value}s' }, { value: formatNumber(ms / 1000, { maximumFractionDigits: 1 }) }))

  const judge = judgeQuery.data ?? []
  const judgeRuns = judge.reduce((sum, entry) => sum + entry.runs, 0)
  const judgeUnsure = judge.reduce((sum, entry) => sum + entry.uncertain, 0)
  const judgeFailed = judge.reduce((sum, entry) => sum + entry.failed, 0)
  const unsureItems = judge.filter((entry) => entry.runs > 0 && entry.uncertain / entry.runs > UNSURE_WARN)

  const totals = summary?.totals
  const kpis = summary && totals ? [
    { label: t({ ko: '요청', en: 'Requests' }), value: formatNumber(totals.requests), trend: summary.daily.map((day) => day.requests) },
    { label: t({ ko: '입력 토큰', en: 'Input tokens' }), value: compact(totals.inputTokens), trend: summary.daily.map((day) => day.inputTokens),
      tip: totals.cachedInputTokens > 0 ? t({ ko: '캐시 {value}', en: '{value} cached' }, { value: compact(totals.cachedInputTokens) }) : undefined },
    { label: t({ ko: '출력 토큰', en: 'Output tokens' }), value: compact(totals.outputTokens), trend: summary.daily.map((day) => day.outputTokens) },
    { label: t({ ko: '실패', en: 'Failed' }), value: formatNumber(totals.failed), extra: totals.requests > 0 ? `${formatNumber(totals.failed / totals.requests * 100, { maximumFractionDigits: 1 })}%` : undefined, trend: summary.daily.map((day) => day.failed), bad: totals.failed > 0 },
    { label: t({ ko: '평균 응답', en: 'Avg. response' }), value: seconds(totals.averageLatencyMs), trend: summary.daily.map((day) => day.averageLatencyMs ?? 0) },
  ] : []
  const modelTokens = (summary?.models ?? []).reduce((sum, model) => sum + model.inputTokens + model.outputTokens, 0)
  const useRequests = metric === 'requests'
  const chartValues = chart ? (useRequests ? chart.requests : chart.values) : []
  const chartTotals = chart ? (useRequests ? chart.requestTotals : chart.totals) : []
  const formatChart = useRequests ? (value: number) => formatNumber(value) : compact

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <SegmentedControl size="xs" value={String(days)} onChange={(value) => setDays(Number(value))} ariaLabel={t({ ko: '기간', en: 'Period' })}
          items={[{ value: '7', label: t({ ko: '최근 7일', en: 'Last 7 days' }) }, { value: '30', label: t({ ko: '최근 30일', en: 'Last 30 days' }) }]} />
        <IconButton size="icon-sm" variant="ghost" onClick={() => { void usageQuery.refetch(); void judgeQuery.refetch() }} label={t({ ko: '새로 고침', en: 'Refresh' })}><RefreshCw /></IconButton>
      </div>

      {usageQuery.isLoading ? <SettingsRowsSkeleton rows={4} /> : null}
      {usageQuery.isError ? <p className="text-sm text-destructive">{getErrorMessage(usageQuery.error, t({ ko: '사용량을 불러오지 못했어.', en: 'Could not load the usage.' }))}</p> : null}
      {summary && totals && totals.requests === 0 ? <SettingsEmptyRow>{t({ ko: '이 기간에 기록된 요청이 없어.', en: 'No requests recorded in this period.' })}</SettingsEmptyRow> : null}

      {summary && totals && totals.requests > 0 && chart ? <>
        <div className="grid grid-cols-2 gap-y-4 sm:grid-cols-5">
          {kpis.map((kpi, index) => (
            <div key={kpi.label} className={cn('min-w-0 space-y-0.5 px-3 sm:px-4', index % 2 === 0 ? 'pl-0 sm:pl-4' : 'border-l border-line', index > 0 && 'sm:border-l sm:border-line', index === 0 && 'sm:pl-0')}>
              <div className="text-xs font-semibold text-muted-foreground">{kpi.label}</div>
              <Tip content={kpi.tip}>
                <div className={cn('text-2xl font-extrabold tracking-tight tabular-nums', kpi.bad && 'text-destructive')}>
                  {kpi.value}{kpi.extra ? <span className="ml-1 text-sm font-semibold text-muted-foreground">{kpi.extra}</span> : null}
                </div>
              </Tip>
              <Sparkline values={kpi.trend} className="mt-1 h-6 w-full" />
            </div>
          ))}
        </div>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h3 className="text-sm font-semibold">{t({ ko: '일간 사용량', en: 'Daily usage' })}</h3>
            <SegmentedControl size="xs" value={split} onChange={(value) => setSplit(value as Split)} ariaLabel={t({ ko: '나누는 기준', en: 'Split by' })}
              items={[{ value: 'purpose', label: t({ ko: '용도별', en: 'By purpose' }) }, { value: 'model', label: t({ ko: '모델별', en: 'By model' }) }]} />
            <SegmentedControl size="xs" value={metric} onChange={(value) => setMetric(value as Metric)} ariaLabel={t({ ko: '단위', en: 'Unit' })}
              items={[{ value: 'tokens', label: t({ ko: '토큰', en: 'Tokens' }) }, { value: 'requests', label: t({ ko: '요청', en: 'Requests' }) }]} />
            <div className="flex min-w-0 flex-wrap gap-x-3.5 gap-y-1 text-xs">
              {chart.series.map((series, index) => (
                <span key={series.id} className="inline-flex min-w-0 items-center gap-1.5">
                  <span className="size-2.5 shrink-0 rounded-xs" style={{ backgroundColor: series.color }} />
                  <span className="truncate">{series.label}</span>
                  <span className="tabular-nums text-muted-foreground">{formatChart(chartTotals[index])}</span>
                </span>
              ))}
            </div>
          </div>
          <StackedBars
            days={summary.daily.map((day) => day.date)}
            series={chart.series}
            values={chartValues}
            formatValue={formatChart}
            label={t({ ko: '일간 사용량', en: 'Daily usage' })}
            tooltip={(index) => {
              const row = chartValues[index]
              return <>
                <div className="mb-1 font-semibold">{summary.daily[index].date.slice(5).replace('-', '/')}</div>
                {chart.series.map((series, seriesIndex) => row[seriesIndex] <= 0 ? null : (
                  <div key={series.id} className="grid grid-cols-[0.5rem_1fr_auto] items-center gap-2 tabular-nums">
                    <span className="size-2 rounded-xs" style={{ backgroundColor: series.color }} />
                    <span className="truncate">{series.label}</span>
                    <span>{formatChart(row[seriesIndex])}</span>
                  </div>
                ))}
                <div className="mt-1.5 flex justify-between border-t border-line pt-1.5 font-semibold tabular-nums">
                  <span>{t({ ko: '합계', en: 'Total' })}</span><span>{formatChart(row.reduce((sum, value) => sum + value, 0))}</span>
                </div>
              </>
            }}
          />
        </section>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <RowGroup heading={t({ ko: '모델별', en: 'By model' })} count={summary.models.length}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-2xs font-semibold tracking-overline text-muted-foreground uppercase">
                    <th className="py-2 pr-3 font-semibold">{t({ ko: '연결 · 모델', en: 'Connection · model' })}</th>
                    <th className="py-2 pr-3 text-right font-semibold">{t({ ko: '요청', en: 'Requests' })}</th>
                    <th className="py-2 pr-3 text-right font-semibold">{t({ ko: '입력', en: 'Input' })}</th>
                    <th className="py-2 pr-3 text-right font-semibold">{t({ ko: '출력', en: 'Output' })}</th>
                    <th className="py-2 pr-3 text-right font-semibold">{t({ ko: '실패', en: 'Failed' })}</th>
                    <th className="py-2 pr-3 text-right font-semibold">{t({ ko: '평균 응답', en: 'Avg. response' })}</th>
                    <th className="py-2 font-semibold">{t({ ko: '비중', en: 'Share' })}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.models.map((model, index) => {
                    const share = modelTokens > 0 ? (model.inputTokens + model.outputTokens) / modelTokens : 0
                    const estimated = model.estimatedRequests > 0
                    const color = split === 'model' ? chart.series.find((series) => series.id === `${model.providerName}\u0000${model.model}`)?.color ?? OTHER_COLOR : 'var(--muted-foreground)'
                    const tokenCell = (value: number) => (
                      <Tip content={estimated ? t({ ko: '요청 {count}개는 서버가 사용량을 안 알려줘서 추정한 값이야', en: '{count} requests are estimates: the server reported no usage' }, { count: formatNumber(model.estimatedRequests) }) : undefined}>
                        <span className={cn(estimated && 'text-muted-foreground')}>{estimated ? '~' : ''}{compact(value)}</span>
                      </Tip>
                    )
                    return (
                      <tr key={`${model.providerName}:${model.model}:${index}`} className="border-b border-line last:border-b-0">
                        <td className="py-2 pr-3">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-medium">{connectionName(model.providerName, names)} · {model.model || t({ ko: '기본 모델', en: 'default model' })}</span>
                            <Chip size="sm" tone="muted">{t(ENGINE_LABELS[model.engine] ?? ENGINE_LABELS.api)}</Chip>
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(model.requests)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{tokenCell(model.inputTokens)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{tokenCell(model.outputTokens)}</td>
                        <td className={cn('py-2 pr-3 text-right tabular-nums', model.failed > 0 && 'text-destructive')}>{formatNumber(model.failed)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{seconds(model.averageLatencyMs)}</td>
                        <td className="py-2">
                          <span className="flex items-center gap-2">
                            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-foreground/10"><span className="block h-full rounded-full" style={{ width: `${share * 100}%`, backgroundColor: color }} /></span>
                            <span className="tabular-nums text-xs text-muted-foreground">{Math.round(share * 100)}%</span>
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </RowGroup>

          <div className="space-y-8">
            <RowGroup heading={t({ ko: '판단', en: 'Judge' })} actions={
              <Button variant="ghost" size="xs" onClick={onOpenJudge}>{t({ ko: '자세히', en: 'Details' })}<ChevronRight /></Button>
            }>
              {judgeRuns > 0 ? (
                <div className="space-y-1 pt-2">
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                    <span><span className="text-lg font-extrabold tabular-nums">{formatNumber(judgeRuns)}</span> {t({ ko: '회', en: 'runs' })}</span>
                    <span>{t({ ko: '애매', en: 'Unsure' })} <span className={cn('text-lg font-extrabold tabular-nums', judgeUnsure / judgeRuns > UNSURE_WARN && 'text-warning')}>{Math.round(judgeUnsure / judgeRuns * 100)}%</span></span>
                    <span>{t({ ko: '실패', en: 'Failed' })} <span className={cn('text-lg font-extrabold tabular-nums', judgeFailed > 0 && 'text-destructive')}>{formatNumber(judgeFailed)}</span></span>
                  </div>
                  {unsureItems.length > 0 ? (
                    <div className="text-xs text-muted-foreground">{t({ ko: '애매 30% 넘는 항목: {items}', en: 'Over 30% unsure: {items}' }, { items: unsureItems.map((entry) => entry.name).join(', ') })}</div>
                  ) : null}
                </div>
              ) : judgeQuery.isSuccess ? <SettingsEmptyRow>{t({ ko: '이 기간에 판단한 기록이 없어.', en: 'No judgments in this period.' })}</SettingsEmptyRow> : <SettingsRowsSkeleton rows={1} />}
            </RowGroup>
            <SubscriptionLimits />
          </div>
        </div>
      </> : null}
    </div>
  )
}
