import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/i18n'
import { getAppSettings, type AutoTestKaloscopeResult } from '@/lib/api-settings'
import { buildArtistPromptTagUrl } from '@/lib/artist-prompt-links'
import { ArtistPromptSection } from './prompt-result-sections'
import { getSortedEntries } from './tag-result-utils'

interface KaloscopeResultBlockProps {
  result: AutoTestKaloscopeResult
  title?: string
  onAddSearchFilter?: (tag: string) => void
}

export function KaloscopeResultBlock({ result, title, onAddSearchFilter }: KaloscopeResultBlockProps) {
  const { t } = useI18n()
  const artistEntries = getSortedEntries(result.artists)
  const settingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
    staleTime: 60_000,
  })
  const artistLinkUrlTemplate = settingsQuery.data?.kaloscope.artistLinkUrlTemplate

  if (artistEntries.length === 0) return null

  return (
    <div className="rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-medium">{title ?? t('kaloscopeResultBlock.kaloscopeResults')}</div>
        {result.model ? <Badge variant="outline">{result.model}</Badge> : null}
      </div>

      <div className="mt-3">
        <ArtistPromptSection
          tags={artistEntries.map(([tag]) => tag)}
          entries={artistEntries}
          collapsibleScores={false}
          getTagHref={(tag) => buildArtistPromptTagUrl(tag, artistLinkUrlTemplate)}
          onAddSearchFilter={onAddSearchFilter}
        />
      </div>
    </div>
  )
}
