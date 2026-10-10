import { useI18n } from '@/i18n'
import type { WallpaperClockVisualStyle, WallpaperWidgetInstance } from './wallpaper-types'
import { useWallpaperClockText } from './wallpaper-widget-utils'

type ClockWidget = Extract<WallpaperWidgetInstance, { type: 'clock' }>
type ClockStyle = 'clean' | 'serif' | 'glow' | 'split' | 'analog' | 'mono'

/** Map the version-1 style names onto the six current looks. */
export function normalizeWallpaperClockStyle(style: WallpaperClockVisualStyle | undefined): ClockStyle {
  switch (style) {
    case 'serif':
    case 'editorial':
      return 'serif'
    case 'glow':
    case 'glass':
      return 'glow'
    case 'split':
    case 'analog':
    case 'mono':
      return style
    default:
      return 'clean'
  }
}

const pad = (value: number) => String(value).padStart(2, '0')
const FLEX_ALIGN = { left: 'flex-start', center: 'center', right: 'flex-end' } as const

function AnalogFace({ now, showSeconds }: { now: Date; showSeconds: boolean }) {
  const seconds = now.getSeconds()
  const minutes = now.getMinutes() + seconds / 60
  const hours = (now.getHours() % 12) + minutes / 60
  const hand = (angle: number, length: number, width: number, opacity = 1) => (
    <line
      x1="50"
      y1="50"
      x2={50 + length * Math.sin((angle * Math.PI) / 180)}
      y2={50 - length * Math.cos((angle * Math.PI) / 180)}
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      opacity={opacity}
    />
  )
  return (
    <svg viewBox="0 0 100 100" className="h-full max-h-full w-auto max-w-full" role="img" aria-label={`${pad(now.getHours())}:${pad(now.getMinutes())}`}>
      <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.35" />
      {Array.from({ length: 12 }, (_, index) => {
        const angle = (index * 30 * Math.PI) / 180
        const inner = index % 3 === 0 ? 38 : 41
        return (
          <line
            key={index}
            x1={50 + inner * Math.sin(angle)}
            y1={50 - inner * Math.cos(angle)}
            x2={50 + 44 * Math.sin(angle)}
            y2={50 - 44 * Math.cos(angle)}
            stroke="currentColor"
            strokeWidth={index % 3 === 0 ? 1.6 : 0.8}
            opacity={0.7}
          />
        )
      })}
      {hand(hours * 30, 24, 3)}
      {hand(minutes * 6, 35, 2)}
      {showSeconds ? <g className="text-primary">{hand(seconds * 6, 39, 0.8)}</g> : null}
      <circle cx="50" cy="50" r="2" fill="currentColor" />
    </svg>
  )
}

/** Live clock in one of six looks; sizes follow the widget box (container units). */
export function WallpaperClockWidgetBody({ widget }: { widget: ClockWidget }) {
  const { formatDateTime, language } = useI18n()
  const now = useWallpaperClockText()
  const style = normalizeWallpaperClockStyle(widget.settings.visualStyle)
  const { showSeconds, timeFormat } = widget.settings
  const showDate = widget.settings.showDate !== false

  const rawHours = now.getHours()
  const hours = timeFormat === '12h' ? (rawHours % 12) || 12 : rawHours
  const period = timeFormat === '12h' ? (language === 'ko' ? (rawHours < 12 ? '오전' : '오후') : (rawHours < 12 ? 'AM' : 'PM')) : null
  const hh = timeFormat === '12h' ? String(hours) : pad(hours)
  const mm = pad(now.getMinutes())
  const ss = pad(now.getSeconds())
  const dateLabel = formatDateTime(now, { month: 'long', day: 'numeric', weekday: 'long' })
  // Leave room for the date line and for seconds.
  const timeSize = `min(${showDate ? 62 : 82}cqh, ${showSeconds ? 19 : 27}cqw)`
  const dateSize = `max(12px, min(13cqh, 6cqw))`

  if (style === 'analog') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-[4cqh]">
        <div className="flex min-h-0 w-full flex-1 items-center justify-center">
          <AnalogFace now={now} showSeconds={showSeconds} />
        </div>
        {showDate ? <div className="shrink-0 opacity-75" style={{ fontSize: `max(12px, min(9cqh, 7cqw))` }}>{dateLabel}</div> : null}
      </div>
    )
  }

  if (style === 'split') {
    const tile = (value: string) => (
      <span className="flex items-center justify-center rounded-[0.12em] bg-[color-mix(in_srgb,var(--foreground)_9%,transparent)] px-[0.12em] tabular-nums">
        {value}
      </span>
    )
    return (
      <div className="flex h-full flex-col justify-center gap-[3cqh]" style={{ alignItems: FLEX_ALIGN[widget.style.textAlign] }}>
        <div className="flex items-stretch gap-[0.08em] font-semibold leading-none tracking-[-0.03em]" style={{ fontSize: `min(${showDate ? 56 : 72}cqh, ${showSeconds ? 16 : 23}cqw)` }}>
          {tile(pad(hours))}
          {tile(mm)}
          {showSeconds ? tile(ss) : null}
          {period ? <span className="self-end pb-[0.1em] text-[0.24em] font-medium opacity-70">{period}</span> : null}
        </div>
        {showDate ? <div className="opacity-70" style={{ fontSize: dateSize }}>{dateLabel}</div> : null}
      </div>
    )
  }

  const timeClass = {
    clean: 'font-extralight tracking-[-0.05em]',
    serif: "font-normal tracking-[-0.02em] [font-family:'Noto_Serif_KR',ui-serif,Georgia,serif]",
    glow: 'font-light tracking-[-0.04em]',
    mono: 'font-mono font-medium tracking-[-0.02em]',
  }[style]
  const glow = style === 'glow'
    ? { textShadow: '0 0 0.18em color-mix(in srgb, var(--primary) 70%, transparent), 0 0 0.55em color-mix(in srgb, var(--primary) 35%, transparent)' }
    : undefined

  return (
    <div className="flex h-full flex-col justify-center">
      <div className={`whitespace-nowrap leading-[0.92] tabular-nums ${timeClass}`} style={{ fontSize: timeSize, ...glow }}>
        {hh}
        <span className={style === 'mono' ? 'animate-pulse' : 'opacity-60'}>:</span>
        {mm}
        {showSeconds ? <span className="opacity-55">{style === 'mono' ? ':' : ' '}{ss}</span> : null}
        {period ? <span className="ml-[0.15em] text-[0.26em] font-medium tracking-normal opacity-70">{period}</span> : null}
      </div>
      {showDate ? (
        <div
          className={style === 'serif' ? 'mt-[0.4em] italic opacity-75' : style === 'mono' ? 'mt-[0.5em] font-mono uppercase tracking-[0.12em] opacity-60' : 'mt-[0.5em] opacity-70'}
          style={{ fontSize: dateSize }}
        >
          {dateLabel}
        </div>
      ) : null}
    </div>
  )
}
