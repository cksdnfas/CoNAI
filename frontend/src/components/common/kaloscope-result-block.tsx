import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/i18n'
import type { AutoTestKaloscopeResult } from '@/lib/api'
import { ArtistPromptSection } from './prompt-result-sections'
import { getSortedEntries } from './tag-result-utils'

interface KaloscopeResultBlockProps {
  result: AutoTestKaloscopeResult
  title?: string
}

export function KaloscopeResultBlock({ result, title }: KaloscopeResultBlockProps) {
  const { t } = useI18n()
  const artistEntries = getSortedEntries(result.artists)

  if (artistEntries.length === 0) return null

  return (
    <div className="rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-medium">{title ?? t('kaloscopeResultBlock.kaloscopeResults')}</div>
        {result.model ? <Badge variant="outline">{result.model}</Badge> : null}
      </div>

      <div className="mt-3">
        <ArtistPromptSection tags={artistEntries.map(([tag]) => tag)} entries={artistEntries} collapsibleScores={false} />
      </div>
    </div>
  )
}
