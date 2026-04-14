import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDateTime } from '@/features/module-graph/module-graph-shared'
import { cn } from '@/lib/utils'
import { WallpaperFloatingCollageBody } from './wallpaper-floating-collage-widget-body'
import {
  WallpaperGroupImageViewBody,
  WallpaperImageShowcaseBody,
  WallpaperRecentResultsBody,
} from './wallpaper-image-widget-bodies'
import type { WallpaperWidgetInstance } from './wallpaper-types'
import type { WallpaperWidgetPreviewImage } from './wallpaper-widget-preview-surface'

export type { WallpaperWidgetPreviewImage } from './wallpaper-widget-preview-surface'
import { useWallpaperBrowseContentQuery } from './wallpaper-widget-data'
import {
  getWallpaperMotionStrengthMultiplier,
  useWallpaperClockText,
  useWallpaperMotionTick,
} from './wallpaper-widget-utils'

function clampWallpaperMetric(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function resolveWallpaperClockMetrics(width: number, height: number, visualStyle: 'minimal' | 'glow' | 'split', showSeconds: boolean) {
  const safeWidth = Math.max(width, 220)
  const safeHeight = Math.max(height, 120)
  const timeDivisor = visualStyle === 'split' ? (showSeconds ? 5.9 : 5.1) : (showSeconds ? 4.7 : 4)
  const timeSize = clampWallpaperMetric(
    Math.min(safeWidth / timeDivisor, safeHeight * (visualStyle === 'split' ? 0.34 : 0.42)),
    26,
    visualStyle === 'split' ? 76 : 96,
  )

  return {
    labelSize: clampWallpaperMetric(Math.min(safeWidth * 0.028, safeHeight * 0.095), 10, 16),
    dateSize: clampWallpaperMetric(Math.min(safeWidth * 0.045, safeHeight * 0.16), 12, 24),
    timeSize,
    secondaryTimeSize: clampWallpaperMetric(timeSize * 0.38, 12, 30),
    sidePanelWidth: clampWallpaperMetric(safeWidth * 0.24, 76, 140),
  }
}

/** Render the live clock body without forcing timers on every widget. */
function WallpaperClockBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'clock' }> }) {
  const currentTime = useWallpaperClockText()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerSize, setContainerSize] = useState({ width: widget.w * 72, height: widget.h * 56 })
  const timeFormat = widget.settings.timeFormat
  const showSeconds = widget.settings.showSeconds
  const visualStyle = widget.settings.visualStyle ?? 'minimal'
  const timeText = currentTime.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: showSeconds ? '2-digit' : undefined,
    hour12: timeFormat === '12h',
  })
  const [hourText, minuteText, secondText] = timeText.split(':')
  const dateText = currentTime.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })
  const metrics = resolveWallpaperClockMetrics(containerSize.width, containerSize.height, visualStyle, showSeconds)
  const labelTracking = `${Math.max(1.5, metrics.labelSize * 0.2)}px`

  useEffect(() => {
    const element = containerRef.current
    if (!element) {
      return
    }

    const updateSize = () => {
      setContainerSize({
        width: Math.max(element.clientWidth, widget.w * 72),
        height: Math.max(element.clientHeight, widget.h * 56),
      })
    }

    updateSize()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize)
      return () => window.removeEventListener('resize', updateSize)
    }

    const observer = new ResizeObserver(() => {
      updateSize()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [widget.h, widget.w])

  if (visualStyle === 'split') {
    return (
      <div ref={containerRef} className="grid h-full grid-cols-[1fr_auto] gap-3">
        <div className="flex min-w-0 flex-col justify-center rounded-sm border border-border/70 bg-surface-low px-3 py-3">
          <div className="uppercase text-secondary" style={{ fontSize: metrics.labelSize, letterSpacing: labelTracking }}>지금</div>
          <div className="mt-1 flex items-end gap-2 font-semibold tracking-[-0.08em] text-foreground" style={{ fontSize: metrics.timeSize, lineHeight: 0.92 }}>
            <span>{hourText}:{minuteText}</span>
            {showSeconds ? <span className="pb-0.5 text-muted-foreground" style={{ fontSize: metrics.secondaryTimeSize, lineHeight: 1 }}>{secondText}</span> : null}
          </div>
        </div>
        <div
          className="flex flex-col justify-between rounded-sm border border-border/70 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--secondary)_16%,transparent),transparent),var(--surface-low)] px-3 py-3 text-right"
          style={{ width: metrics.sidePanelWidth }}
        >
          <div className="uppercase text-muted-foreground" style={{ fontSize: metrics.labelSize, letterSpacing: labelTracking }}>시계</div>
          <div className="text-muted-foreground" style={{ fontSize: metrics.dateSize, lineHeight: 1.2 }}>{dateText}</div>
        </div>
      </div>
    )
  }

  if (visualStyle === 'glow') {
    return (
      <div ref={containerRef} className="flex h-full flex-col justify-center rounded-sm bg-[radial-gradient(circle_at_top,color-mix(in_srgb,var(--secondary)_22%,transparent),transparent_46%),linear-gradient(180deg,color-mix(in_srgb,var(--primary)_10%,transparent),transparent_56%)] px-3">
        <div
          className="font-semibold tracking-[-0.08em] text-foreground drop-shadow-[0_0_18px_color-mix(in_srgb,var(--secondary)_22%,transparent)]"
          style={{ fontSize: metrics.timeSize, lineHeight: 0.92 }}
        >
          {timeText}
        </div>
        <div className="mt-1 text-muted-foreground" style={{ fontSize: metrics.dateSize, lineHeight: 1.2 }}>{dateText}</div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex h-full flex-col justify-center">
      <div className="font-semibold tracking-[-0.06em] text-foreground" style={{ fontSize: metrics.timeSize, lineHeight: 0.92 }}>
        {timeText}
      </div>
      <div className="text-muted-foreground" style={{ fontSize: metrics.dateSize, lineHeight: 1.2 }}>{dateText}</div>
    </div>
  )
}

/** Render one graph execution status widget using existing browse-content APIs. */
function WallpaperQueueStatusBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'queue-status' }> }) {
  const refreshInterval = Math.max(2, widget.settings.refreshIntervalSec) * 1000
  const visualMode = widget.settings.visualMode ?? 'tiles'

  const queueQuery = useWallpaperBrowseContentQuery('queue-status', refreshInterval)

  const queueSummary = useMemo(() => {
    const executions = queueQuery.data?.executions ?? []
    return {
      queued: executions.filter((item) => item.status === 'queued').length,
      running: executions.filter((item) => item.status === 'running').length,
      failed: executions.filter((item) => item.status === 'failed').length,
      workflows: queueQuery.data?.scope.workflow_count ?? 0,
    }
  }, [queueQuery.data])

  if (queueQuery.isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">워크플로 상태 불러오는 중…</div>
  }

  if (queueQuery.isError) {
    return <div className="flex h-full items-center justify-center text-center text-sm text-destructive">워크플로 상태를 불러오지 못했어.</div>
  }

  const queueItems = [
    { label: '대기', value: queueSummary.queued, tone: 'var(--secondary)', short: 'Q' },
    { label: '실행', value: queueSummary.running, tone: '#3ddc97', short: 'R' },
    { label: '실패', value: queueSummary.failed, tone: '#ff6b6b', short: 'F' },
    { label: '워크플로', value: queueSummary.workflows, tone: 'var(--primary)', short: 'W' },
  ]
  const maxValue = Math.max(...queueItems.map((item) => item.value), 1)
  const totalActive = queueSummary.queued + queueSummary.running

  if (visualMode === 'bars') {
    return (
      <div className="flex h-full flex-col justify-center gap-3 rounded-sm bg-[linear-gradient(180deg,color-mix(in_srgb,var(--primary)_10%,transparent),transparent_55%)] px-1 py-1 text-xs sm:text-sm">
        <div className="mb-0.5 flex items-center justify-between gap-2 rounded-sm border border-border/60 bg-background/45 px-3 py-2 backdrop-blur-sm">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">실행</div>
            <div className="text-sm font-semibold text-foreground">{totalActive.toLocaleString('ko-KR')} 진행 중</div>
          </div>
          <div className="rounded-full border border-border/70 bg-surface-low px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {queueSummary.failed > 0 ? '주의' : '안정'}
          </div>
        </div>

        {queueItems.map((item) => {
          const ratio = Math.max(0.08, item.value / maxValue)
          return (
            <div key={item.label} className="space-y-1.5 rounded-sm border border-border/60 bg-background/35 px-3 py-2.5 backdrop-blur-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold text-background" style={{ backgroundColor: item.tone }}>
                    {item.short}
                  </span>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{item.label}</div>
                </div>
                <div className={cn('text-sm font-semibold text-foreground', item.label === '실행' && item.value > 0 ? 'animate-pulse' : undefined)}>
                  {item.value.toLocaleString('ko-KR')}
                </div>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-surface-lowest/90">
                <div
                  className={cn('h-full rounded-full transition-[width] duration-700 ease-out', item.label === '실행' && item.value > 0 ? 'animate-pulse' : undefined)}
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
            <div key={item.label} className="relative flex flex-col items-center justify-center overflow-hidden rounded-sm border border-border/70 bg-[radial-gradient(circle_at_top,color-mix(in_srgb,var(--secondary)_12%,transparent),transparent_54%),var(--surface-low)] px-2 py-3">
              <div
                className={cn('absolute inset-0 opacity-60', item.label === '실행' && item.value > 0 ? 'animate-pulse' : undefined)}
                style={{ background: `radial-gradient(circle at center, color-mix(in srgb, ${item.tone} 18%, transparent), transparent 62%)` }}
              />
              <div
                className={cn('relative flex h-14 w-14 items-center justify-center rounded-full border border-border/60 text-sm font-semibold text-foreground transition-transform', item.label === '실행' && item.value > 0 ? 'animate-pulse' : undefined)}
                style={{ background: `conic-gradient(${item.tone} 0deg ${degrees}deg, color-mix(in srgb, var(--surface-lowest) 92%, transparent) ${degrees}deg 360deg)` }}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-background/92 shadow-[0_0_20px_rgba(0,0,0,0.18)] backdrop-blur-sm">
                  {item.value.toLocaleString('ko-KR')}
                </div>
              </div>
              <div className="relative mt-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{item.label}</div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="grid h-full grid-cols-2 gap-2 text-center text-xs sm:text-sm">
      {queueItems.map((item) => (
        <div key={item.label} className="relative overflow-hidden rounded-sm border border-border/70 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--background)_20%,transparent),transparent),var(--surface-low)] px-2 py-3">
          <div className="absolute inset-x-0 top-0 h-0.5" style={{ background: item.tone }} />
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{item.label}</div>
          <div className={cn('mt-1 text-lg font-semibold text-foreground', item.label === '실행' && item.value > 0 ? 'animate-pulse' : undefined)}>
            {item.value.toLocaleString('ko-KR')}
          </div>
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
  const motionTick = useWallpaperMotionTick(true)
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

    const executions = browseContent.executions
    const queued = executions.filter((item) => item.status === 'queued').length
    const running = executions.filter((item) => item.status === 'running').length
    const failed = executions.filter((item) => item.status === 'failed').length
    const completed = executions.filter((item) => item.status === 'completed').length
    const recentResults = browseContent.final_results.length
    const latestExecution = [...executions].sort((left, right) => new Date(right.updated_date).getTime() - new Date(left.updated_date).getTime())[0]

    return {
      queued,
      running,
      failed,
      completed,
      recentResults,
      lastUpdated: latestExecution?.updated_date ?? null,
    }
  }, [activityQuery.data])

  if (activityQuery.isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">활동 흐름 불러오는 중…</div>
  }

  if (activityQuery.isError) {
    return <div className="flex h-full items-center justify-center text-center text-sm text-destructive">활동 흐름을 불러오지 못했어.</div>
  }

  const emphasisWeight = emphasis === 'queue'
    ? summary.running * 1.35 + summary.queued * 1.1 + summary.failed * 0.5
    : emphasis === 'results'
      ? summary.completed * 0.8 + summary.recentResults * 1.35
      : summary.running * 1.15 + summary.queued * 0.9 + summary.recentResults * 0.95 + summary.failed * 0.6
  const intensity = Math.min(1, emphasisWeight / 10)
  const pulseBars = Array.from({ length: 16 }, (_, index) => {
    const phase = motionTick / 10 + index * 0.72
    const wave = (Math.sin(phase) + Math.cos(phase * 0.65 + intensity * 2.8)) / 2
    const emphasisBoost = emphasis === 'queue'
      ? (index % 4 === 0 ? 0.18 : 0)
      : emphasis === 'results'
        ? (index % 5 === 2 ? 0.22 : 0)
        : (index % 3 === 1 ? 0.1 : 0)
    return Math.max(0.16, Math.min(1, 0.22 + intensity * 0.5 + wave * 0.22 * motionStrength + emphasisBoost))
  })
  const statusTone = summary.failed > 0 ? '#ff6b6b' : summary.running > 0 ? '#3ddc97' : 'var(--secondary)'
  const activityBadge = summary.running > 0 ? '실행 중' : summary.queued > 0 ? '대기 중' : summary.recentResults > 0 ? '최근 결과' : '한가함'

  return (
    <div className="flex h-full flex-col justify-between gap-3 rounded-sm bg-[radial-gradient(circle_at_top,color-mix(in_srgb,var(--secondary)_18%,transparent),transparent_46%),linear-gradient(180deg,color-mix(in_srgb,var(--primary)_8%,transparent),transparent_60%)] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">활동</div>
          <div className="mt-1 flex items-end gap-2">
            <span className="text-2xl font-semibold tracking-[-0.08em] text-foreground sm:text-3xl">{summary.running + summary.queued}</span>
            <span className="pb-1 text-xs text-muted-foreground">진행 부하</span>
          </div>
        </div>
        <div className="rounded-full border border-border/70 bg-background/50 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-foreground/92 backdrop-blur-sm">
          {activityBadge}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-end gap-1 rounded-sm border border-border/60 bg-background/35 px-2 py-2 backdrop-blur-sm">
        {pulseBars.map((heightRatio, index) => (
          <div
            key={index}
            className="flex-1 rounded-full transition-[height,opacity,transform] duration-200 ease-out"
            style={{
              height: `${Math.round(22 + heightRatio * 78)}%`,
              opacity: 0.48 + heightRatio * 0.48,
              transform: `translateY(${Math.round((1 - heightRatio) * 4)}px)`,
              background: `linear-gradient(180deg, color-mix(in srgb, ${statusTone} 92%, white), color-mix(in srgb, ${statusTone} 58%, transparent))`,
              boxShadow: `0 0 18px color-mix(in srgb, ${statusTone} 20%, transparent)`,
            }}
          />
        ))}
      </div>

      <div className="grid grid-cols-4 gap-2 text-center text-[11px] sm:text-xs">
        {[
          { label: '실행', value: summary.running },
          { label: '대기', value: summary.queued },
          { label: '결과', value: summary.recentResults },
          { label: '실패', value: summary.failed },
        ].map((item) => (
          <div key={item.label} className="rounded-sm border border-border/60 bg-background/35 px-2 py-1.5 backdrop-blur-sm">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{item.label}</div>
            <div className={cn('mt-1 font-semibold text-foreground', item.label === '실행' && item.value > 0 ? 'animate-pulse' : undefined)}>
              {item.value.toLocaleString('ko-KR')}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        <span>{emphasis === 'queue' ? '실행 중심' : emphasis === 'results' ? '결과 중심' : '혼합'}</span>
        <span>{summary.lastUpdated ? formatDateTime(summary.lastUpdated) : '업데이트 없음'}</span>
      </div>
    </div>
  )
}

/** Render one widget body based on the widget type. */
export function WallpaperWidgetBody({ widget, mode, onOpenImage }: { widget: WallpaperWidgetInstance; mode: 'editor' | 'runtime'; onOpenImage?: (image: WallpaperWidgetPreviewImage) => void }) {
  if (widget.type === 'clock') {
    return <WallpaperClockBody widget={widget} />
  }

  if (widget.type === 'queue-status') {
    return <WallpaperQueueStatusBody widget={widget} />
  }

  if (widget.type === 'recent-results') {
    return <WallpaperRecentResultsBody widget={widget} mode={mode} onOpenImage={onOpenImage} />
  }

  if (widget.type === 'activity-pulse') {
    return <WallpaperActivityPulseBody widget={widget} />
  }

  if (widget.type === 'group-image-view') {
    return <WallpaperGroupImageViewBody widget={widget} mode={mode} onOpenImage={onOpenImage} />
  }

  if (widget.type === 'image-showcase') {
    return <WallpaperImageShowcaseBody widget={widget} mode={mode} onOpenImage={onOpenImage} />
  }

  if (widget.type === 'floating-collage') {
    return <WallpaperFloatingCollageBody widget={widget} mode={mode} onOpenImage={onOpenImage} />
  }

  return (
    <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-border/80 bg-surface-low px-3 text-center text-sm text-muted-foreground">
      {widget.settings.text}
    </div>
  )
}
