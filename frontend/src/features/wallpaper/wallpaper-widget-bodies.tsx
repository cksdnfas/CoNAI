import { useMemo } from 'react'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { WallpaperFloatingCollageBody } from './wallpaper-floating-collage-widget-body'
import { WallpaperClockWidgetBody } from './wallpaper-clock-widget-body'
import {
  WallpaperGroupImageViewBody,
  WallpaperImageShowcaseBody,
  WallpaperRecentResultsBody,
} from './wallpaper-image-widget-bodies'
import type { WallpaperWidgetInstance } from './wallpaper-types'
import type { WallpaperWidgetPreviewImage } from './wallpaper-widget-preview-surface'

export type { WallpaperWidgetPreviewImage } from './wallpaper-widget-preview-surface'
import { getWallpaperQueueAgeLabelFromAnchor, getWallpaperQueueExecutionSummary } from './wallpaper-queue-status-utils'
import { useWallpaperBrowseContentQuery } from './wallpaper-widget-data'
import {
  getWallpaperMotionStrengthMultiplier,
  useWallpaperClockText,
} from './wallpaper-widget-utils'
import {
  WallpaperGenerationProgressBody,
  WallpaperGenerationStatsBody,
  WallpaperLibraryStatsBody,
  WallpaperLlmUsageBody,
} from './wallpaper-monitor-widget-bodies'
import {
  WallpaperAudioPlayerBody,
  WallpaperCharacterCardBody,
  WallpaperChatRecentBody,
  WallpaperPostTickerBody,
  WallpaperPromptOfDayBody,
} from './wallpaper-chat-media-widget-bodies'
import {
  WallpaperAudioVisualizerBody,
  WallpaperNowPlayingBody,
  WallpaperQuickRunBody,
  WallpaperSystemMonitorBody,
} from './wallpaper-host-widget-bodies'

/** Render one graph execution status widget using existing browse-content APIs. */
function WallpaperQueueStatusBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'queue-status' }> }) {
  const refreshInterval = Math.max(2, widget.settings.refreshIntervalSec) * 1000
  const visualMode = widget.settings.visualMode ?? 'tiles'
  const { t, formatNumber } = useI18n()

  const queueQuery = useWallpaperBrowseContentQuery('queue-status', refreshInterval)

  const queueSummary = useMemo(() => {
    const executions = queueQuery.data?.executions ?? []
    return {
      ...getWallpaperQueueExecutionSummary(executions),
      workflows: queueQuery.data?.scope.workflow_count ?? 0,
    }
  }, [queueQuery.data])

  if (queueQuery.isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('wallpaper.wallpaper.widget.bodies.loading.workflow.status')}</div>
  }

  if (queueQuery.isError) {
    return <div className="flex h-full items-center justify-center text-center text-sm text-destructive">{t('wallpaper.wallpaper.widget.bodies.workflow.status.failed.to.load')}</div>
  }

  const nowMs = Date.now()
  const queueItems = [
    { id: 'queued', label: t('wallpaper.wallpaper.widget.bodies.queued'), value: queueSummary.queued, tone: 'var(--secondary)', short: 'Q', ageLabel: getWallpaperQueueAgeLabelFromAnchor('queued', queueSummary.oldestQueuedAnchorMs, t, formatNumber, nowMs) },
    { id: 'running', label: t('wallpaper.wallpaper.widget.bodies.running'), value: queueSummary.running, tone: 'var(--success)', short: 'R', ageLabel: getWallpaperQueueAgeLabelFromAnchor('running', queueSummary.oldestRunningAnchorMs, t, formatNumber, nowMs) },
    { id: 'failed', label: t('wallpaper.wallpaper.widget.bodies.failed'), value: queueSummary.failed, tone: 'var(--destructive)', short: 'F', ageLabel: null },
    { id: 'workflow', label: t('wallpaper.wallpaper.widget.bodies.workflow'), value: queueSummary.workflows, tone: 'var(--primary)', short: 'W', ageLabel: null },
  ]
  const maxValue = Math.max(...queueItems.map((item) => item.value), 1)
  const totalActive = queueSummary.queued + queueSummary.running

  if (visualMode === 'bars') {
    return (
      <div className="flex h-full flex-col justify-center gap-[4cqh] text-xs sm:text-sm">
        <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-[3cqh]">
          <div>
            <div className="text-2xs uppercase tracking-overline text-muted-foreground">{t('wallpaper.wallpaper.widget.bodies.running')}</div>
            <div className="text-sm font-semibold text-foreground">{t('wallpaper.wallpaper.widget.bodies.totalactive.tolocalestring.en.us.active', { totalActive: formatNumber(totalActive) })}</div>
          </div>
          <div className="text-2xs uppercase tracking-overline text-muted-foreground">
            {queueSummary.failed > 0 ? t('wallpaper.wallpaper.widget.bodies.needs.attention') : t('wallpaper.wallpaper.widget.bodies.stable')}
          </div>
        </div>

        {queueItems.map((item) => {
          const ratio = Math.max(0.08, item.value / maxValue)
          return (
            <div key={item.label} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full text-2xs font-semibold text-background" style={{ backgroundColor: item.tone }}>
                    {item.short}
                  </span>
                  <div>
                    <div className="text-2xs uppercase tracking-overline text-muted-foreground">{item.label}</div>
                    {item.ageLabel ? <div className="mt-0.5 text-2xs text-muted-foreground/85">{item.ageLabel}</div> : null}
                  </div>
                </div>
                <div className={cn('text-sm font-semibold text-foreground', item.id === 'running' && item.value > 0 ? 'animate-pulse' : undefined)}>
                  {formatNumber(item.value)}
                </div>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-surface-lowest/90">
                <div
                  className={cn('h-full rounded-full transition-[width] duration-700 ease-out', item.id === 'running' && item.value > 0 ? 'animate-pulse' : undefined)}
                  style={{
                    width: `${ratio * 100}%`,
                    background: `linear-gradient(90deg, ${item.tone}, color-mix(in srgb, ${item.tone} 68%, white))`,
                    boxShadow: `0 0 18px color-mix(in srgb, ${item.tone} 26%, transparent)`,
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  if (visualMode === 'rings') {
    return (
      <div className="grid h-full grid-cols-2 gap-2 text-center text-xs sm:text-sm">
        {queueItems.map((item) => {
          const ratio = item.value / maxValue
          const degrees = Math.max(12, Math.round(ratio * 360))
          return (
            <div key={item.label} className="relative flex flex-col items-center justify-center px-2 py-3">
              <div
                className={cn('absolute inset-0 opacity-60', item.id === 'running' && item.value > 0 ? 'animate-pulse' : undefined)}
                style={{ background: `radial-gradient(circle at center, color-mix(in srgb, ${item.tone} 18%, transparent), transparent 62%)` }}
              />
              <div
                className={cn('relative flex h-14 w-14 items-center justify-center rounded-full border border-border/60 text-sm font-semibold text-foreground transition-transform', item.id === 'running' && item.value > 0 ? 'animate-pulse' : undefined)}
                style={{ background: `conic-gradient(${item.tone} 0deg ${degrees}deg, color-mix(in srgb, var(--surface-lowest) 92%, transparent) ${degrees}deg 360deg)` }}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-background/92 shadow-[0_0_20px_rgba(0,0,0,0.18)] backdrop-blur-sm">
                  {formatNumber(item.value)}
                </div>
              </div>
              <div className="relative mt-2 text-2xs uppercase tracking-overline text-muted-foreground">{item.label}</div>
              {item.ageLabel ? <div className="relative mt-1 text-2xs text-muted-foreground/85">{item.ageLabel}</div> : null}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="grid h-full grid-cols-2 gap-x-[6cqw] gap-y-[6cqh] text-center text-xs sm:text-sm">
      {queueItems.map((item) => (
        <div key={item.label} className="flex min-h-0 flex-col justify-center border-t-2 pt-[2cqh]" style={{ borderColor: item.tone }}>
          <div className="text-2xs uppercase tracking-overline text-muted-foreground">{item.label}</div>
          <div className={cn('mt-1 text-[clamp(1.125rem,13cqh,4rem)] font-semibold leading-none tabular-nums text-foreground', item.id === 'running' && item.value > 0 ? 'animate-pulse' : undefined)}>
            {formatNumber(item.value)}
          </div>
          {item.ageLabel ? <div className="mt-1 text-2xs text-muted-foreground/85">{item.ageLabel}</div> : null}
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-lowest/90">
            <div
              className="h-full rounded-full transition-[width] duration-700 ease-out"
              style={{
                width: `${Math.max(0.12, item.value / maxValue) * 100}%`,
                background: `linear-gradient(90deg, ${item.tone}, color-mix(in srgb, ${item.tone} 70%, white))`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Render one subtle graph execution pulse widget from execution and result activity. */
function WallpaperActivityPulseBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'activity-pulse' }> }) {
  const refreshInterval = Math.max(2, widget.settings.refreshIntervalSec) * 1000
  const motionStrength = getWallpaperMotionStrengthMultiplier(widget.settings.motionStrength ?? 1)
  const emphasis = widget.settings.emphasis ?? 'mixed'
  const { t, formatNumber, formatDateTime } = useI18n()
  const activityQuery = useWallpaperBrowseContentQuery('activity-pulse', refreshInterval)

  const summary = useMemo(() => {
    const browseContent = activityQuery.data
    if (!browseContent) {
      return {
        queued: 0,
        running: 0,
        failed: 0,
        completed: 0,
        recentResults: 0,
        lastUpdated: null as string | null,
      }
    }

    const executionSummary = getWallpaperQueueExecutionSummary(browseContent.executions)
    const recentResults = browseContent.final_results.length

    return {
      ...executionSummary,
      recentResults,
      lastUpdated: executionSummary.latestUpdatedAt,
    }
  }, [activityQuery.data])

  if (activityQuery.isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('wallpaper.wallpaper.widget.bodies.loading.activity.flow')}</div>
  }

  if (activityQuery.isError) {
    return <div className="flex h-full items-center justify-center text-center text-sm text-destructive">{t('wallpaper.wallpaper.widget.bodies.failed.to.load.activity.flow')}</div>
  }

  const emphasisWeight = emphasis === 'queue'
    ? summary.running * 1.35 + summary.queued * 1.1 + summary.failed * 0.5
    : emphasis === 'results'
      ? summary.completed * 0.8 + summary.recentResults * 1.35
      : summary.running * 1.15 + summary.queued * 0.9 + summary.recentResults * 0.95 + summary.failed * 0.6
  const intensity = Math.min(1, emphasisWeight / 10)
  // Each bar breathes between its low and high height in CSS; only the data changes them.
  const pulseBars = Array.from({ length: 16 }, (_, index) => {
    const emphasisBoost = emphasis === 'queue'
      ? (index % 4 === 0 ? 0.18 : 0)
      : emphasis === 'results'
        ? (index % 5 === 2 ? 0.22 : 0)
        : (index % 3 === 1 ? 0.1 : 0)
    const base = 0.22 + intensity * 0.5 + emphasisBoost
    const low = Math.max(0.16, Math.min(1, base - 0.22 * motionStrength))
    const high = Math.max(0.16, Math.min(1, base + 0.22 * motionStrength))
    return { base: Math.max(0.16, Math.min(1, base)), low, high, index }
  })
  const statusTone = summary.failed > 0 ? 'var(--destructive)' : summary.running > 0 ? 'var(--success)' : 'var(--secondary)'
  const activityBadge = summary.running > 0
    ? t('wallpaper.wallpaper.widget.bodies.running.25981e1a')
    : summary.queued > 0
      ? t('wallpaper.wallpaper.widget.bodies.queued.388f731f')
      : summary.recentResults > 0
        ? t('wallpaper.wallpaper.widget.bodies.recent.results')
        : t('wallpaper.wallpaper.widget.bodies.idle')

  return (
    <div className="flex h-full flex-col justify-between gap-3 rounded-sm bg-[radial-gradient(circle_at_top,color-mix(in_srgb,var(--secondary)_18%,transparent),transparent_46%),linear-gradient(180deg,color-mix(in_srgb,var(--primary)_8%,transparent),transparent_60%)] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-2xs uppercase tracking-overline text-muted-foreground">{t('wallpaper.wallpaper.widget.bodies.activity')}</div>
          <div className="mt-1 flex items-end gap-2">
            <span className="text-2xl font-semibold tracking-[-0.08em] text-foreground sm:text-3xl">{summary.running + summary.queued}</span>
            <span className="pb-1 text-xs text-muted-foreground">{t('wallpaper.wallpaper.widget.bodies.active.load')}</span>
          </div>
        </div>
        <div className="rounded-full border border-border/70 bg-background/50 px-2 py-1 text-2xs font-medium uppercase tracking-overline text-foreground/92 backdrop-blur-sm">
          {activityBadge}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-end gap-1 rounded-sm border border-border/60 bg-background/35 px-2 py-2 backdrop-blur-sm">
        {pulseBars.map(({ base, low, high, index }) => (
          <div
            key={index}
            className="wallpaper-pulse-bar flex-1 rounded-full transition-[height,opacity] duration-200 ease-out"
            style={{
              height: `${Math.round(22 + high * 78)}%`,
              opacity: 0.48 + base * 0.48,
              ['--wp-low' as string]: String((22 + low * 78) / (22 + high * 78)),
              ['--wp-duration' as string]: `${(1.8 + (index % 5) * 0.35).toFixed(2)}s`,
              ['--wp-delay' as string]: `${(-index * 0.37).toFixed(2)}s`,
              background: `linear-gradient(180deg, color-mix(in srgb, ${statusTone} 92%, white), color-mix(in srgb, ${statusTone} 58%, transparent))`,
              boxShadow: `0 0 18px color-mix(in srgb, ${statusTone} 20%, transparent)`,
            }}
          />
        ))}
      </div>

      <div className="grid grid-cols-4 gap-2 text-center text-2xs sm:text-xs">
        {[
          { id: 'running', label: t('wallpaper.wallpaper.widget.bodies.running'), value: summary.running },
          { id: 'queued', label: t('wallpaper.wallpaper.widget.bodies.queued'), value: summary.queued },
          { id: 'results', label: t('wallpaper.wallpaper.widget.bodies.results'), value: summary.recentResults },
          { id: 'failed', label: t('wallpaper.wallpaper.widget.bodies.failed'), value: summary.failed },
        ].map((item) => (
          <div key={item.label} className="rounded-sm border border-border/60 bg-background/35 px-2 py-1.5 backdrop-blur-sm">
            <div className="text-2xs uppercase tracking-overline text-muted-foreground">{item.label}</div>
            <div className={cn('mt-1 font-semibold text-foreground', item.id === 'running' && item.value > 0 ? 'animate-pulse' : undefined)}>
              {formatNumber(item.value)}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 text-2xs uppercase tracking-overline text-muted-foreground">
        <span>{emphasis === 'queue' ? t('wallpaper.wallpaper.widget.bodies.queue.focus') : emphasis === 'results' ? t('wallpaper.wallpaper.widget.bodies.results.focus') : t('wallpaper.wallpaper.widget.bodies.mixed')}</span>
        <span>{summary.lastUpdated ? formatDateTime(summary.lastUpdated) : t('wallpaper.wallpaper.widget.bodies.not.updated.yet')}</span>
      </div>
    </div>
  )
}

/** This month, with today marked. */
function WallpaperCalendarBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'calendar' }> }) {
  const { formatDateTime } = useI18n()
  const now = useWallpaperClockText()
  const todayKey = now.toDateString()
  const { weekStart, showOutsideDays } = widget.settings
  const cells = useMemo(() => {
    const first = new Date(now.getFullYear(), now.getMonth(), 1)
    const lead = (first.getDay() - (weekStart === 'mon' ? 1 : 0) + 7) % 7
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - lead)
    return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index))
    // The grid only changes with the day.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayKey, weekStart])
  const weeks = cells[35].getMonth() === now.getMonth() ? 6 : 5
  const weekdays = cells.slice(0, 7).map((day) => formatDateTime(day, { weekday: 'narrow' }))

  return (
    <div className="flex h-full flex-col" style={{ fontSize: 'max(11px, min(6.5cqh, 5cqw))' }}>
      <div className="mb-[0.6em] font-semibold">{formatDateTime(now, { year: 'numeric', month: 'long' })}</div>
      <div className="grid flex-1 grid-cols-7 text-center" style={{ gridTemplateRows: `auto repeat(${weeks}, minmax(0, 1fr))` }}>
        {weekdays.map((label, index) => (
          <div key={`w-${index}`} className="pb-[0.4em] text-[0.8em] opacity-50">{label}</div>
        ))}
        {cells.slice(0, weeks * 7).map((day) => {
          const inMonth = day.getMonth() === now.getMonth()
          const isToday = day.toDateString() === todayKey
          return (
            <div key={day.toISOString()} className="flex items-center justify-center">
              {inMonth || showOutsideDays ? (
                <span
                  className={cn(
                    'flex aspect-square h-[1.9em] items-center justify-center rounded-full tabular-nums',
                    isToday ? 'bg-primary font-semibold text-primary-foreground' : null,
                    !inMonth ? 'opacity-30' : day.getDay() === 0 ? 'text-destructive' : null,
                  )}
                >
                  {day.getDate()}
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WallpaperTextNoteBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'text-note' }> }) {
  return (
    <div className="flex h-full items-center overflow-hidden">
      <p className="w-full whitespace-pre-wrap leading-snug" style={{ fontSize: Math.max(8, widget.settings.fontSize || 40) }}>
        {widget.settings.text}
      </p>
    </div>
  )
}

/** Render one widget body based on the widget type. */
export function WallpaperWidgetBody({ widget, mode, onOpenImage }: { widget: WallpaperWidgetInstance; mode: 'editor' | 'runtime'; onOpenImage?: (image: WallpaperWidgetPreviewImage) => void }) {
  switch (widget.type) {
    case 'clock':
      return <WallpaperClockWidgetBody widget={widget} />
    case 'calendar':
      return <WallpaperCalendarBody widget={widget} />
    case 'text-note':
      return <WallpaperTextNoteBody widget={widget} />
    case 'queue-status':
      return <WallpaperQueueStatusBody widget={widget} />
    case 'activity-pulse':
      return <WallpaperActivityPulseBody widget={widget} />
    case 'recent-results':
      return <WallpaperRecentResultsBody widget={widget} mode={mode} onOpenImage={onOpenImage} />
    case 'group-image-view':
      return <WallpaperGroupImageViewBody widget={widget} mode={mode} onOpenImage={onOpenImage} />
    case 'image-showcase':
      return <WallpaperImageShowcaseBody widget={widget} mode={mode} onOpenImage={onOpenImage} />
    case 'floating-collage':
      return <WallpaperFloatingCollageBody widget={widget} mode={mode} onOpenImage={onOpenImage} />
    case 'generation-progress':
      return <WallpaperGenerationProgressBody widget={widget} />
    case 'generation-stats':
      return <WallpaperGenerationStatsBody widget={widget} />
    case 'llm-usage':
      return <WallpaperLlmUsageBody widget={widget} />
    case 'library-stats':
      return <WallpaperLibraryStatsBody widget={widget} />
    case 'character-card':
      return <WallpaperCharacterCardBody widget={widget} />
    case 'chat-recent':
      return <WallpaperChatRecentBody widget={widget} />
    case 'audio-player':
      return <WallpaperAudioPlayerBody widget={widget} />
    case 'post-ticker':
      return <WallpaperPostTickerBody widget={widget} />
    case 'prompt-of-day':
      return <WallpaperPromptOfDayBody widget={widget} />
    case 'audio-visualizer':
      return <WallpaperAudioVisualizerBody widget={widget} />
    case 'now-playing':
      return <WallpaperNowPlayingBody widget={widget} />
    case 'system-monitor':
      return <WallpaperSystemMonitorBody widget={widget} />
    case 'quick-run':
      return <WallpaperQuickRunBody widget={widget} />
    default:
      return null
  }
}
