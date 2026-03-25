import { useState } from 'react'
import { getThemeToneFillStyle, getThemeToneStyle } from '@/lib/theme-tones'
import { formatScore } from './tag-result-utils'

function getRatingAccentStyle(label: string) {
  switch (label.toLowerCase()) {
    case 'general':
    case 'safe':
      return getThemeToneFillStyle('positive')
    case 'sensitive':
      return { backgroundColor: 'color-mix(in srgb, var(--theme-badge-rating) 72%, #f59e0b)' }
    case 'questionable':
      return getThemeToneFillStyle('rating')
    case 'explicit':
      return getThemeToneFillStyle('negative')
    default:
      return { backgroundColor: 'var(--primary)' }
  }
}

export function TagBundleSection({ label, tags }: { label: string; tags: string[] }) {
  if (tags.length === 0) return null

  return (
    <div className="space-y-2 rounded-sm bg-surface-lowest px-3 py-3">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <span key={`${label}:${tag}`} className="rounded-full bg-surface-low px-2.5 py-1 text-xs text-foreground">
            {tag}
          </span>
        ))}
      </div>
    </div>
  )
}

export function ScoreMeterList({
  title,
  entries,
  accentClassName = 'bg-primary',
  hideTitle = false,
}: {
  title: string
  entries: Array<[string, number]>
  accentClassName?: string
  hideTitle?: boolean
}) {
  if (entries.length === 0) return null

  return (
    <div className="space-y-3 rounded-sm bg-surface-lowest px-3 py-3">
      {hideTitle ? null : <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</div>}
      <div className="space-y-3">
        {entries.map(([label, score]) => {
          const width = Math.max(0, Math.min(score * 100, 100))
          return (
            <div key={label} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate text-foreground">{label}</span>
                <span className="shrink-0 font-mono text-muted-foreground">{formatScore(score)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-low">
                <div className={accentClassName ? `h-full rounded-full ${accentClassName}` : 'h-full rounded-full'} style={{ width: `${width}%`, ...(accentClassName ? undefined : getThemeToneFillStyle('auto')) }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function CollapsibleScoreMeterList({
  title,
  entries,
  accentClassName = 'bg-primary',
  defaultExpanded = false,
}: {
  title: string
  entries: Array<[string, number]>
  accentClassName?: string
  defaultExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  if (entries.length === 0) return null

  return (
    <div className="space-y-3 rounded-sm bg-surface-lowest px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</div>
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="text-xs font-medium text-muted-foreground transition hover:text-foreground"
        >
          {expanded ? '접기' : `펼치기 (${entries.length})`}
        </button>
      </div>
      {expanded ? <ScoreMeterList title={title} entries={entries} accentClassName={accentClassName} hideTitle /> : null}
    </div>
  )
}

export function StackedRatingBar({ title, entries }: { title: string; entries: Array<[string, number]> }) {
  if (entries.length === 0) return null

  const total = entries.reduce((sum, [, score]) => sum + score, 0)
  const normalizedEntries = total > 0 ? entries.map(([label, score]) => [label, score / total] as const) : entries

  return (
    <div className="space-y-3 rounded-sm bg-surface-lowest px-3 py-3">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-low">
        {normalizedEntries.map(([label, score]) => (
          <div
            key={label}
            className="h-full"
            style={{ width: `${Math.max(0, Math.min(score * 100, 100))}%`, ...getRatingAccentStyle(label) }}
            title={`${label} ${formatScore(score)}`}
          />
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {normalizedEntries.map(([label, score]) => (
          <div key={`${label}-legend`} className="flex items-center justify-between gap-3 rounded-sm bg-surface-low px-3 py-2 text-xs" style={getThemeToneStyle('rating')}>
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={getRatingAccentStyle(label)} />
              <span className="truncate text-foreground">{label}</span>
            </div>
            <span className="shrink-0 font-mono text-muted-foreground">{formatScore(score)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
