import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { WallpaperServiceType } from '@/lib/api-wallpaper-runtime'
import type { WallpaperWidgetInstance } from './wallpaper-types'
import {
  useWallpaperGenerationStats,
  useWallpaperLibraryStats,
  useWallpaperLlmUsage,
  useWallpaperQueueSnapshot,
} from './wallpaper-widget-data'

const SERVICE_LABEL: Record<WallpaperServiceType, string> = { novelai: 'NAI', comfyui: 'ComfyUI', codex: 'Codex' }
const SERVICE_COLOR: Record<WallpaperServiceType, string> = {
  novelai: 'var(--primary)',
  comfyui: 'color-mix(in srgb, var(--primary) 45%, #6f8ab0)',
  codex: 'color-mix(in srgb, var(--foreground) 55%, transparent)',
}

/** Quiet one-line state (loading, empty, no access) centered in the widget. */
export function WallpaperWidgetNote({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'error' }) {
  return (
    <div className={cn('flex h-full items-center justify-center px-2 text-center text-sm', tone === 'error' ? 'text-destructive' : 'opacity-60')}>
      {children}
    </div>
  )
}

function useNow(intervalMs: number, enabled: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [enabled, intervalMs])
  return now
}

function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** 1234 → 1.2K, 3456789 → 3.5M */
function useCompactNumber() {
  const { formatNumber } = useI18n()
  return (value: number) => formatNumber(value, { notation: 'compact', maximumFractionDigits: value >= 1000 ? 1 : 0 })
}

/** The last `days` local dates, oldest first. */
function lastDays(days: number) {
  const result: string[] = []
  const today = new Date()
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset)
    result.push(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`)
  }
  return result
}

function MiniBars({ values, highlight, tone = 'var(--primary)', secondary }: { values: number[]; highlight?: number; tone?: string; secondary?: number[] }) {
  const max = Math.max(1, ...values.map((value, index) => value + (secondary?.[index] ?? 0)))
  return (
    <div className="flex h-full min-h-0 items-end gap-[3%]">
      {values.map((value, index) => {
        const extra = secondary?.[index] ?? 0
        return (
          <div key={index} className="flex h-full min-w-0 flex-1 flex-col justify-end">
            {extra > 0 ? <div className="w-full rounded-t-[2px] bg-destructive/70" style={{ height: `${(extra / max) * 100}%` }} /> : null}
            <div
              className={cn('w-full', extra > 0 ? null : 'rounded-t-[2px]')}
              style={{
                height: `${Math.max(value > 0 ? 3 : 1.5, (value / max) * 100)}%`,
                background: tone,
                opacity: highlight === undefined || highlight === index ? 1 : 0.45,
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

/** Running and waiting generation jobs with live sampler progress. */
export function WallpaperGenerationProgressBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'generation-progress' }> }) {
  const { t, formatNumber } = useI18n()
  const { service, maxJobs, showQueueCounts, showNodeLabel } = widget.settings
  const query = useWallpaperQueueSnapshot(service)
  const active = query.data?.active ?? []
  const hasRunning = active.some((job) => job.status === 'running')
  const now = useNow(1000, hasRunning)

  if (query.isLoading) return <WallpaperWidgetNote>{t({ ko: '불러오는 중…', en: 'Loading…' })}</WallpaperWidgetNote>
  if (query.isError) return <WallpaperWidgetNote>{t({ ko: '생성 대기열을 볼 수 없어.', en: 'Queue unavailable.' })}</WallpaperWidgetNote>

  const counts = query.data?.counts ?? {}
  const running = (counts.running ?? 0) + (counts.dispatching ?? 0)
  const queued = counts.queued ?? 0
  const jobs = active.slice(0, Math.max(1, maxJobs))

  return (
    <div className="flex h-full flex-col gap-3">
      {jobs.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center gap-3 opacity-60">
          <span className="size-2 shrink-0 rounded-full bg-current opacity-50" />
          <span className="text-sm">{t({ ko: '생성 대기 없음', en: 'Nothing generating' })}</span>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col justify-center gap-3 overflow-hidden">
          {jobs.map((job) => {
            const percent = job.progress?.percent ?? (job.progress?.value !== null && job.progress?.value !== undefined && job.progress.max ? (job.progress.value / job.progress.max) * 100 : null)
            const label = [SERVICE_LABEL[job.serviceType] ?? job.serviceType, showNodeLabel ? (job.progress?.node_label ?? job.workflowName) : job.workflowName].filter(Boolean).join(' · ')
            const isRunning = job.status === 'running'
            return (
              <div key={job.id} className="min-w-0">
                <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{label}</span>
                  <span className="shrink-0 font-mono text-xs tabular-nums opacity-75">
                    {isRunning
                      ? percent !== null ? `${Math.round(percent)}%` : job.startedAt ? formatElapsed(now - Date.parse(job.startedAt)) : ''
                      : t({ ko: '대기', en: 'Queued' })}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--foreground)_12%,transparent)]">
                  {isRunning ? (
                    percent !== null
                      ? <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${Math.max(2, percent)}%`, background: SERVICE_COLOR[job.serviceType] }} />
                      : <div className="h-full w-1/3 animate-pulse rounded-full" style={{ background: SERVICE_COLOR[job.serviceType] }} />
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {showQueueCounts ? (
        <div className="flex shrink-0 gap-4 text-xs opacity-70">
          <span>{t({ ko: '실행', en: 'Running' })} <b className="font-semibold tabular-nums">{formatNumber(running)}</b></span>
          <span>{t({ ko: '대기', en: 'Queued' })} <b className="font-semibold tabular-nums">{formatNumber(queued)}</b></span>
        </div>
      ) : null}
    </div>
  )
}

/** Generations per day: one big total over small daily bars. */
export function WallpaperGenerationStatsBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'generation-stats' }> }) {
  const { t, formatNumber } = useI18n()
  const days = Math.max(1, Math.min(90, widget.settings.days))
  const query = useWallpaperGenerationStats(days)
  const series = useMemo(() => {
    const byDate = new Map((query.data?.daily ?? []).map((entry) => [entry.date, entry]))
    return lastDays(days).map((date) => byDate.get(date) ?? { date, total: 0, completed: 0, failed: 0, byService: { novelai: 0, comfyui: 0, codex: 0 } })
  }, [days, query.data])

  if (query.isLoading) return <WallpaperWidgetNote>{t({ ko: '불러오는 중…', en: 'Loading…' })}</WallpaperWidgetNote>
  if (query.isError || !query.data) return <WallpaperWidgetNote>{t({ ko: '생성 통계를 볼 수 없어.', en: 'Stats unavailable.' })}</WallpaperWidgetNote>
  const { totals } = query.data
  const periodLabel = days === 1 ? t({ ko: '오늘', en: 'Today' }) : t({ ko: '{days}일', en: '{days} days' }, { days })

  if (widget.settings.display === 'numbers') {
    const cells = [
      { label: t({ ko: '완료', en: 'Done' }), value: totals.completed },
      { label: t({ ko: '실패', en: 'Failed' }), value: totals.failed },
      ...(['novelai', 'comfyui', 'codex'] as const).map((service) => ({ label: SERVICE_LABEL[service], value: totals.byService[service] ?? 0 })),
    ]
    return (
      <div className="flex h-full flex-col justify-between gap-3">
        <div>
          <div className="text-xs opacity-60">{periodLabel}</div>
          <div className="font-semibold leading-none tracking-[-0.04em] tabular-nums" style={{ fontSize: 'min(34cqh, 22cqw)' }}>{formatNumber(totals.total)}</div>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {cells.map((cell) => (
            <div key={cell.label} className="min-w-0">
              <div className="truncate text-2xs opacity-60">{cell.label}</div>
              <div className="text-base font-semibold tabular-nums">{formatNumber(cell.value)}</div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex shrink-0 items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold leading-none tracking-[-0.04em] tabular-nums" style={{ fontSize: 'min(26cqh, 16cqw)' }}>{formatNumber(totals.total)}</span>
          <span className="text-xs opacity-60">{periodLabel}</span>
        </div>
        {totals.failed > 0 ? <span className="text-xs text-destructive">{t({ ko: '실패 {count}', en: '{count} failed' }, { count: formatNumber(totals.failed) })}</span> : null}
      </div>
      <div className="min-h-0 flex-1">
        <MiniBars values={series.map((entry) => entry.total - entry.failed)} secondary={series.map((entry) => entry.failed)} highlight={series.length - 1} />
      </div>
    </div>
  )
}

/** LLM traffic: tokens or requests over the period, per day and per model. Admin data only. */
export function WallpaperLlmUsageBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'llm-usage' }> }) {
  const { t, formatNumber } = useI18n()
  const compact = useCompactNumber()
  const days = Math.max(1, Math.min(90, widget.settings.days))
  const query = useWallpaperLlmUsage(days)
  const metric = widget.settings.metric
  const series = useMemo(() => {
    const byDate = new Map((query.data?.daily ?? []).map((entry) => [entry.date, entry]))
    return lastDays(days).map((date) => {
      const entry = byDate.get(date)
      return metric === 'requests' ? (entry?.requests ?? 0) : (entry ? entry.inputTokens + entry.outputTokens : 0)
    })
  }, [days, metric, query.data])

  if (query.isLoading) return <WallpaperWidgetNote>{t({ ko: '불러오는 중…', en: 'Loading…' })}</WallpaperWidgetNote>
  if (query.isError || !query.data) return <WallpaperWidgetNote>{t({ ko: 'LLM 사용량은 관리자만 볼 수 있어.', en: 'LLM usage is admin-only.' })}</WallpaperWidgetNote>

  const { totals, models } = query.data
  const total = metric === 'requests' ? totals.requests : totals.inputTokens + totals.outputTokens
  const modelRows = [...models]
    .map((model) => ({ name: model.model || model.providerName, value: metric === 'requests' ? model.requests : model.inputTokens + model.outputTokens }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 3)
  const modelMax = Math.max(1, ...modelRows.map((row) => row.value))

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex shrink-0 items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold leading-none tracking-[-0.04em] tabular-nums" style={{ fontSize: 'min(22cqh, 15cqw)' }}>{compact(total)}</span>
          <span className="text-xs opacity-60">{metric === 'requests' ? t({ ko: '요청', en: 'requests' }) : t({ ko: '토큰', en: 'tokens' })} · {days === 1 ? t({ ko: '오늘', en: 'today' }) : t({ ko: '{days}일', en: '{days} days' }, { days })}</span>
        </div>
        <span className="text-xs tabular-nums opacity-60">
          {metric === 'requests' ? `${compact(totals.inputTokens + totals.outputTokens)} tok` : `${formatNumber(totals.requests)} req`}
        </span>
      </div>
      <div className="min-h-[24px] flex-1">
        <MiniBars values={series} highlight={series.length - 1} />
      </div>
      {widget.settings.showModels && modelRows.length > 0 ? (
        <div className="shrink-0 space-y-1.5">
          {modelRows.map((row) => (
            <div key={row.name} className="flex items-center gap-2 text-xs">
              <span className="w-[38%] min-w-0 truncate opacity-80">{row.name}</span>
              <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--foreground)_12%,transparent)]">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${(row.value / modelMax) * 100}%` }} />
              </span>
              <span className="w-12 shrink-0 text-right tabular-nums opacity-70">{compact(row.value)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const RATING_ORDER = ['general', 'sensitive', 'questionable', 'explicit']
const RATING_TONE: Record<string, string> = {
  general: 'color-mix(in srgb, var(--foreground) 55%, transparent)',
  sensitive: '#8fb7ff',
  questionable: '#ffb59a',
  explicit: 'var(--destructive)',
}

/** Library size, top tags and the rating mix. */
export function WallpaperLibraryStatsBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'library-stats' }> }) {
  const { t, formatNumber } = useI18n()
  const query = useWallpaperLibraryStats()
  if (query.isLoading) return <WallpaperWidgetNote>{t({ ko: '불러오는 중…', en: 'Loading…' })}</WallpaperWidgetNote>
  if (query.isError || !query.data) return <WallpaperWidgetNote>{t({ ko: '라이브러리를 볼 수 없어.', en: 'Library unavailable.' })}</WallpaperWidgetNote>
  const stats = query.data
  const ratings = RATING_ORDER.map((key) => ({ key, value: stats.ratingDistribution[key] ?? 0 })).filter((entry) => entry.value > 0)
  const ratingTotal = ratings.reduce((sum, entry) => sum + entry.value, 0)

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 items-baseline gap-2">
        <span className="font-semibold leading-none tracking-[-0.04em] tabular-nums" style={{ fontSize: 'min(24cqh, 16cqw)' }}>{formatNumber(stats.total)}</span>
        <span className="text-xs opacity-60">{t({ ko: '이미지 · 캐릭터 {count}', en: 'images · {count} characters' }, { count: formatNumber(stats.characterCount) })}</span>
      </div>
      {widget.settings.showRatings && ratingTotal > 0 ? (
        <div className="flex h-1.5 shrink-0 overflow-hidden rounded-full">
          {ratings.map((entry) => <span key={entry.key} style={{ width: `${(entry.value / ratingTotal) * 100}%`, background: RATING_TONE[entry.key] }} />)}
        </div>
      ) : null}
      {widget.settings.showTopTags ? (
        <div className="flex min-h-0 flex-wrap content-start gap-1.5 overflow-hidden">
          {stats.topTags.slice(0, Math.max(1, widget.settings.tagCount)).map((tag) => (
            <span key={tag.tag} className="rounded-full bg-[color-mix(in_srgb,var(--foreground)_9%,transparent)] px-2 py-0.5 text-xs">
              {tag.tag.replace(/_/g, ' ')}
              <span className="ml-1 tabular-nums opacity-55">{formatNumber(tag.count, { notation: 'compact' })}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
