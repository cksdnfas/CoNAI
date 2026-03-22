import { Badge } from '@/components/ui/badge'
import type { AutoTestKaloscopeResult } from '@/lib/api'
import { ScoreMeterList, TagBundleSection } from './tag-result-ui'
import { getSortedEntries } from './tag-result-utils'

interface KaloscopeResultBlockProps {
  result: AutoTestKaloscopeResult
  title?: string
}

export function KaloscopeResultBlock({ result, title = 'Kaloscope 결과' }: KaloscopeResultBlockProps) {
  const artistEntries = getSortedEntries(result.artists)

  if (artistEntries.length === 0) return null

  return (
    <div className="rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-medium">{title}</div>
        {result.model ? <Badge variant="outline">{result.model}</Badge> : null}
      </div>

      <div className="mt-3 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Extracted tags</div>
        <TagBundleSection label="artist" tags={artistEntries.map(([tag]) => tag)} />
      </div>

      <div className="mt-4 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Detailed scores</div>
        <ScoreMeterList title="artist" entries={artistEntries} accentClassName="bg-primary/80" />
      </div>
    </div>
  )
}
