import { useEffect, useRef, useState, type ReactNode } from 'react'

/** A trend line for a stat: faint area, the line in muted ink, the last value marked. No axes. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const width = 120
  const height = 26
  if (values.length < 2) return <svg className={className} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" />
  const max = Math.max(...values)
  const min = Math.min(...values)
  const points = values.map((value, index) => [index / (values.length - 1) * (width - 4) + 2, height - 3 - (max === min ? 0.5 : (value - min) / (max - min)) * (height - 8)])
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const [lastX, lastY] = points[points.length - 1]
  return (
    <svg className={className} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`2,${height} ${line} ${width - 2},${height}`} className="fill-foreground/6" />
      <polyline points={line} fill="none" className="stroke-muted-foreground" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={2.5} className="fill-foreground" />
    </svg>
  )
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

function niceStep(raw: number) {
  const power = 10 ** Math.floor(Math.log10(raw || 1))
  const fraction = raw / power
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * power
}

/** A bar's top segment: square at the base, 4px rounded at the data end. */
function roundTop(x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, height, width / 2)
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`
}

export type StackedSeries = { id: string; label: string; color: string }

/**
 * Daily stacked bars, one stack per day, series in a fixed order with a 2px gap between segments. Hovering a day
 * shows every series' value in a tooltip (`tooltip` renders it).
 */
export function StackedBars({ days, series, values, formatValue, tooltip, label }: {
  days: string[]
  series: StackedSeries[]
  /** values[day][series] */
  values: number[][]
  formatValue: (value: number) => string
  tooltip: (dayIndex: number) => ReactNode
  label: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hovered, setHovered] = useState<{ index: number; x: number; y: number } | null>(null)
  const height = 220
  const padLeft = 48
  const padTop = 8
  const padBottom = 24
  const innerWidth = Math.max(0, width - padLeft)
  const innerHeight = height - padTop - padBottom
  const totals = values.map((row) => row.reduce((sum, value) => sum + value, 0))
  const step = niceStep(Math.max(1, ...totals) / 4)
  const top = Math.max(step, Math.ceil(Math.max(1, ...totals) / step) * step)
  const y = (value: number) => padTop + innerHeight - value / top * innerHeight
  const slot = days.length ? innerWidth / days.length : 0
  const barWidth = Math.max(3, Math.min(32, slot * 0.62))
  const labelEvery = days.length > 14 ? 5 : 1
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step)

  return (
    <div ref={ref} className="relative h-[220px] w-full" onMouseLeave={() => setHovered(null)}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={label} className="block overflow-visible">
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={padLeft} x2={width} y1={y(tick)} y2={y(tick)} className="stroke-line" strokeWidth={1} />
              <text x={padLeft - 8} y={y(tick) + 4} textAnchor="end" className="fill-muted-foreground text-2xs tabular-nums">{formatValue(tick)}</text>
            </g>
          ))}
          {values.map((row, dayIndex) => {
            const center = padLeft + slot * dayIndex + slot / 2
            const x = center - barWidth / 2
            const topIndex = row.reduce((last, value, index) => (value > 0 ? index : last), -1)
            let stacked = 0
            return (
              <g key={days[dayIndex]}>
                {hovered?.index === dayIndex ? <rect x={padLeft + slot * dayIndex} y={padTop} width={slot} height={innerHeight} className="fill-foreground/5" /> : null}
                {row.map((value, seriesIndex) => {
                  if (value <= 0) return null
                  const y0 = y(stacked)
                  const y1 = y(stacked + value)
                  stacked += value
                  const segment = seriesIndex === topIndex ? y0 - y1 : y0 - y1 - 2
                  if (segment <= 0) return null
                  return seriesIndex === topIndex
                    ? <path key={series[seriesIndex].id} d={roundTop(x, y1, barWidth, segment, 4)} fill={series[seriesIndex].color} />
                    : <rect key={series[seriesIndex].id} x={x} y={y1 + 2} width={barWidth} height={segment} fill={series[seriesIndex].color} />
                })}
                {dayIndex % labelEvery === 0 || dayIndex === days.length - 1 ? (
                  <text x={center} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-2xs tabular-nums">{days[dayIndex].slice(5).replace('-', '/')}</text>
                ) : null}
                <rect x={padLeft + slot * dayIndex} y={padTop} width={slot} height={innerHeight} fill="transparent"
                  onMouseMove={(event) => {
                    const box = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
                    if (box) setHovered({ index: dayIndex, x: event.clientX - box.left, y: event.clientY - box.top })
                  }} />
              </g>
            )
          })}
          <line x1={padLeft} x2={width} y1={y(0)} y2={y(0)} className="stroke-muted-foreground/40" strokeWidth={1} />
        </svg>
      ) : null}
      {hovered ? (
        <div className="pointer-events-none absolute z-floating min-w-44 rounded-md bg-surface-high p-2.5 text-xs shadow-elevation-2"
          style={{ left: hovered.x > width / 2 ? undefined : hovered.x + 14, right: hovered.x > width / 2 ? width - hovered.x + 14 : undefined, top: Math.max(0, Math.min(hovered.y - 24, height - 120)) }}>
          {tooltip(hovered.index)}
        </div>
      ) : null}
    </div>
  )
}
