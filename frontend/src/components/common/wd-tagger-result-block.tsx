import { Badge } from '@/components/ui/badge'
import type { AutoTestTaggerResult } from '@/lib/api'
import { CharacterPromptSection, GeneralPromptSection, RatingPromptSection } from './prompt-result-sections'
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

      {ratingEntries.length > 0 ? (
        <div className="mt-4 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Rating overview</div>
          <RatingPromptSection entries={ratingEntries} />
        </div>
      ) : null}

      {characterEntries.length > 0 || generalEntries.length > 0 ? (
        <div className="mt-4 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Detailed scores</div>
          <div className="grid gap-3 grid-cols-1">
            <CharacterPromptSection entries={characterEntries} />
            <GeneralPromptSection tags={generalEntries.map(([tag]) => tag)} entries={generalEntries} collapsibleScores />
          </div>
        </div>
      ) : null}
    </div>
  )
}
