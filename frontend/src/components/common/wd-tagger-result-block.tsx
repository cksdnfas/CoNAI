import { Badge } from '@/components/ui/badge'
import type { AutoTestTaggerResult } from '@/lib/api'
import { CollapsibleScoreMeterList, ScoreMeterList, StackedRatingBar, TagBundleSection } from './tag-result-ui'
import { getSortedEntries } from './tag-result-utils'

interface WDTaggerResultBlockProps {
  result: AutoTestTaggerResult
  title?: string
}

export function WDTaggerResultBlock({ result, title = 'WD Tagger 결과' }: WDTaggerResultBlockProps) {
  const ratingEntries = getSortedEntries(result.rating)
  const characterEntries = getSortedEntries(result.character)
  const generalEntries = getSortedEntries(result.general)

  if (ratingEntries.length === 0 && characterEntries.length === 0 && generalEntries.length === 0) return null

  return (
    <div className="rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-medium">{title}</div>
        {result.model ? <Badge variant="outline">{result.model}</Badge> : null}
      </div>

      {generalEntries.length > 0 ? (
        <div className="mt-3 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Extracted tags</div>
          <TagBundleSection label="general" tags={generalEntries.map(([tag]) => tag)} />
        </div>
      ) : null}

      {ratingEntries.length > 0 ? (
        <div className="mt-4 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Rating overview</div>
          <StackedRatingBar title="rating" entries={ratingEntries} />
        </div>
      ) : null}

      {characterEntries.length > 0 || generalEntries.length > 0 ? (
        <div className="mt-4 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Detailed scores</div>
          <div className="grid gap-3 xl:grid-cols-2">
            <ScoreMeterList title="character" entries={characterEntries} accentClassName="bg-primary/60" />
            <CollapsibleScoreMeterList title="general" entries={generalEntries} accentClassName="bg-primary/80" />
          </div>
        </div>
      ) : null}
    </div>
  )
}
