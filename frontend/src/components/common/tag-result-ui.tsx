import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import { getThemeToneFillStyle } from '@/lib/theme-tones'
import { cn } from '@/lib/utils'
import { PromptTagActionMenu } from './prompt-tag-action-menu'
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

export function TagBundleSection({
  label,
  tags,
  getTagHref,
  onTagClick,
  onAddSearchFilter,
  headerAction,
  hideLabel = false,
}: {
  label: string
  tags: string[]
  getTagHref?: (tag: string) => string | null
  onTagClick?: (tag: string, href: string) => void
  onAddSearchFilter?: (tag: string) => void
  headerAction?: ReactNode
  /** Skip the overline when the surrounding section already names it. */
  hideLabel?: boolean
}) {
  if (tags.length === 0) return null

  return (
    <div className="space-y-2 rounded-sm bg-surface-lowest px-3 py-3">
      {hideLabel && !headerAction ? null : (
        <div className={cn('flex items-center gap-3', hideLabel ? 'justify-end' : 'justify-between')}>
          {hideLabel ? null : <Text as="div" variant="overline" className="font-semibold">{label}</Text>}
          {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => {
          const href = getTagHref?.(tag) ?? null

          if (href || onAddSearchFilter) {
            return (
              <PromptTagActionMenu
                key={`${label}:${tag}`}
                tag={tag}
                href={href}
                onAddSearchFilter={onAddSearchFilter}
                onOpenHref={onTagClick}
              >
                {tag}
              </PromptTagActionMenu>
            )
          }

          return (
            <span key={`${label}:${tag}`} className="rounded-sm bg-foreground/5 px-2 py-1 text-xs text-foreground">
              {tag}
            </span>
          )
        })}
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
      {hideTitle ? null : <Text as="div" variant="overline" className="font-semibold">{title}</Text>}
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
  hideTitle = false,
}: {
  title: string
  entries: Array<[string, number]>
  accentClassName?: string
  defaultExpanded?: boolean
  /** Skip the overline when the surrounding section already names it. */
  hideTitle?: boolean
}) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(defaultExpanded)

  if (entries.length === 0) return null

  return (
    <div className="space-y-3 rounded-sm bg-surface-lowest px-3 py-3">
      <div className={cn('flex items-center gap-3', hideTitle ? 'justify-end' : 'justify-between')}>
        {hideTitle ? null : <Text as="div" variant="overline" className="font-semibold">{title}</Text>}
        <IconButton
          variant="ghost"
          size="icon-xs"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          label={expanded ? t({ ko: '점수 접기', en: 'Hide scores' }) : t({ ko: '점수 펼치기 ({count}개)', en: 'Show scores ({count})' }, { count: entries.length })}
        >
          <ChevronDown className={cn('transition-transform', !expanded && '-rotate-90')} />
        </IconButton>
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
      <Text as="div" variant="overline" className="font-semibold">{title}</Text>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-low">
        {normalizedEntries.map(([label, score]) => (
          <div
            key={label}
            className="h-full"
            style={{ width: `${Math.max(0, Math.min(score * 100, 100))}%`, ...getRatingAccentStyle(label) }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {normalizedEntries.map(([label, score]) => (
          <span key={`${label}-legend`} className="inline-flex items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-full" style={getRatingAccentStyle(label)} />
            <span className="text-foreground">{label}</span>
            <span className="font-mono text-muted-foreground">{formatScore(score)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
