import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { WallpaperClockVisualStyle, WallpaperWidgetInstance } from './wallpaper-types'
import { useWallpaperClockText } from './wallpaper-widget-utils'

type ClockWidget = Extract<WallpaperWidgetInstance, { type: 'clock' }>

function clampMetric(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function normalizeClockStyle(style: WallpaperClockVisualStyle | undefined): 'clean' | 'glass' | 'editorial' {
  if (style === 'glass' || style === 'glow') {
    return 'glass'
  }
  if (style === 'editorial' || style === 'split') {
    return 'editorial'
  }
  return 'clean'
}

function useClockContainerSize(widget: ClockWidget) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: widget.w * 72, height: widget.h * 56 })

  useEffect(() => {
    const element = containerRef.current
    if (!element) {
      return
    }

    const updateSize = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    updateSize()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize)
      return () => window.removeEventListener('resize', updateSize)
    }

    const observer = new ResizeObserver(updateSize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [widget.h, widget.w])

  return { containerRef, size }
}

/** Responsive clock rebuilt for both editor cards and full-screen Lively runtime. */
export function WallpaperClockWidgetBody({ widget }: { widget: ClockWidget }) {
  const currentTime = useWallpaperClockText()
  const { locale, formatDate } = useI18n()
  const { containerRef, size } = useClockContainerSize(widget)
  const showSeconds = widget.settings.showSeconds
  const showDate = widget.settings.showDate !== false
  const style = normalizeClockStyle(widget.settings.visualStyle)
  const isCompact = size.width < 380 || size.height < 170

  const formattedTime = useMemo(() => {
    const parts = new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: showSeconds ? '2-digit' : undefined,
      hour12: widget.settings.timeFormat === '12h',
    }).formatToParts(currentTime)
    const getPart = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''

    return {
      hour: getPart('hour'),
      minute: getPart('minute'),
      second: getPart('second'),
      dayPeriod: getPart('dayPeriod'),
    }
  }, [currentTime, locale, showSeconds, widget.settings.timeFormat])

  const dateText = formatDate(currentTime, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
  const timeSize = clampMetric(Math.min(size.width / (showSeconds ? 4.8 : 3.8), size.height * (showDate ? 0.46 : 0.62)), 30, 150)
  const dateSize = clampMetric(Math.min(size.width * 0.034, size.height * 0.105), 11, 22)
  const secondSize = clampMetric(timeSize * 0.34, 13, 36)
  const time = `${formattedTime.hour}:${formattedTime.minute}`

  if (style === 'editorial') {
    return (
      <div
        ref={containerRef}
        className={cn(
          'flex h-full min-h-0 overflow-hidden rounded-[inherit] text-foreground',
          isCompact ? 'flex-col justify-center gap-1' : 'items-stretch',
        )}
      >
        {!isCompact && showDate ? (
          <div className="flex w-[30%] min-w-[118px] flex-col justify-between border-r border-foreground/15 py-1 pr-4">
            <span className="text-[10px] font-semibold tracking-[0.24em] text-secondary uppercase">CoNAI</span>
            <span className="text-pretty font-medium leading-snug text-foreground/72" style={{ fontSize: dateSize }}>{dateText}</span>
          </div>
        ) : null}
        <div className={cn('flex min-w-0 flex-1 flex-col justify-center', !isCompact && 'pl-5')}>
          <div className="flex min-w-0 items-baseline gap-[0.08em] font-medium tracking-[-0.075em] tabular-nums" style={{ fontSize: timeSize, lineHeight: 0.86 }}>
            <span>{time}</span>
            {showSeconds ? <span className="tracking-[-0.04em] text-secondary" style={{ fontSize: secondSize }}>{formattedTime.second}</span> : null}
            {formattedTime.dayPeriod ? <span className="ml-1 tracking-[0.08em] text-foreground/52 uppercase" style={{ fontSize: dateSize }}>{formattedTime.dayPeriod}</span> : null}
          </div>
          {isCompact && showDate ? <div className="mt-2 truncate font-medium text-foreground/60" style={{ fontSize: dateSize }}>{dateText}</div> : null}
        </div>
      </div>
    )
  }

  if (style === 'glass') {
    return (
      <div ref={containerRef} className="relative flex h-full min-h-0 flex-col justify-center overflow-hidden rounded-[inherit] border border-white/14 bg-black/18 px-[5%] py-[4%] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_20px_70px_rgba(0,0,0,0.16)] backdrop-blur-md">
        <div className="pointer-events-none absolute -top-1/2 right-[-8%] aspect-square h-[150%] rounded-full bg-secondary/13 blur-3xl" />
        <div className="relative flex items-baseline gap-[0.1em] font-semibold tracking-[-0.07em] tabular-nums drop-shadow-[0_3px_18px_rgba(0,0,0,0.3)]" style={{ fontSize: timeSize, lineHeight: 0.9 }}>
          <span>{time}</span>
          {showSeconds ? <span className="text-secondary" style={{ fontSize: secondSize }}>{formattedTime.second}</span> : null}
          {formattedTime.dayPeriod ? <span className="ml-1 tracking-[0.1em] text-white/55 uppercase" style={{ fontSize: dateSize }}>{formattedTime.dayPeriod}</span> : null}
        </div>
        {showDate ? <div className="relative mt-2 truncate font-medium tracking-[0.02em] text-white/66" style={{ fontSize: dateSize }}>{dateText}</div> : null}
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col justify-center overflow-hidden rounded-[inherit] text-foreground">
      <div className="flex items-baseline gap-[0.08em] font-medium tracking-[-0.075em] tabular-nums" style={{ fontSize: timeSize, lineHeight: 0.88 }}>
        <span>{time}</span>
        {showSeconds ? <span className="font-normal text-foreground/42" style={{ fontSize: secondSize }}>{formattedTime.second}</span> : null}
        {formattedTime.dayPeriod ? <span className="ml-1 tracking-[0.08em] text-foreground/45 uppercase" style={{ fontSize: dateSize }}>{formattedTime.dayPeriod}</span> : null}
      </div>
      {showDate ? <div className="mt-2 truncate font-medium text-foreground/55" style={{ fontSize: dateSize }}>{dateText}</div> : null}
    </div>
  )
}
