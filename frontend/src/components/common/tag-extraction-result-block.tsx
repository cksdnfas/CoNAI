import { Badge } from '@/components/ui/badge'

export interface TagExtractionResultSection {
  label: string
  scores?: Record<string, number>
  accentClassName?: string
}

interface TagExtractionResultBlockProps {
  title: string
  badgeLabel?: string
  sections: TagExtractionResultSection[]
}

function getSortedEntries(scores: Record<string, number> | undefined) {
  return Object.entries(scores ?? {}).sort(([, left], [, right]) => right - left)
}

function formatScore(score: number) {
  return `${(score * 100).toFixed(score >= 0.995 ? 0 : 1)}%`
}

function TagBundleSection({ label, tags }: { label: string; tags: string[] }) {
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

function ScoreMeterList({
  title,
  entries,
  accentClassName = 'bg-primary',
}: {
  title: string
  entries: Array<[string, number]>
  accentClassName?: string
}) {
  if (entries.length === 0) return null

  return (
    <div className="space-y-3 rounded-sm bg-surface-lowest px-3 py-3">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</div>
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
                <div className={`h-full rounded-full ${accentClassName}`} style={{ width: `${width}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function TagExtractionResultBlock({ title, badgeLabel, sections }: TagExtractionResultBlockProps) {
  const normalizedSections = sections
    .map((section) => ({
      ...section,
      entries: getSortedEntries(section.scores),
    }))
    .filter((section) => section.entries.length > 0)

  if (normalizedSections.length === 0) return null

  return (
    <div className="rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-medium">{title}</div>
        {badgeLabel ? <Badge variant="outline">{badgeLabel}</Badge> : null}
      </div>

      <div className="mt-3 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Extracted tags</div>
        {normalizedSections.map((section) => (
          <TagBundleSection key={section.label} label={section.label} tags={section.entries.map(([tag]) => tag)} />
        ))}
      </div>

      <div className="mt-4 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Detailed scores</div>
        <div className="grid gap-3 xl:grid-cols-2">
          {normalizedSections.map((section) => (
            <ScoreMeterList
              key={`${section.label}-scores`}
              title={section.label}
              entries={section.entries}
              accentClassName={section.accentClassName}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
