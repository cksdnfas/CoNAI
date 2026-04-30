import { Copy } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import type { AutoTestTaggerResult } from '@/lib/api'
import { copyTextToClipboard } from '@/lib/clipboard'
import { CharacterPromptSection, GeneralPromptSection, RatingPromptSection } from './prompt-result-sections'
import { formatPromptTagCopyText, getSortedEntries, parseTaglistTokens } from './tag-result-utils'

interface WDTaggerResultBlockProps {
  result: AutoTestTaggerResult
  title?: string
}

export function WDTaggerResultBlock({ result, title }: WDTaggerResultBlockProps) {
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const ratingEntries = getSortedEntries(result.rating)
  const characterEntries = getSortedEntries(result.character)
  const generalEntries = getSortedEntries(result.general)
  const generalTags = parseTaglistTokens(result.taglist)
  const displayedGeneralTags = generalTags.length > 0 ? generalTags : generalEntries.map(([tag]) => tag)
  const generalCopyText = formatPromptTagCopyText(displayedGeneralTags)

  const handleCopyGeneralTags = async () => {
    if (!generalCopyText) {
      return
    }

    try {
      await copyTextToClipboard(generalCopyText)
      showSnackbar({ message: t({ ko: 'General 태그를 복사했어.', en: 'General tags copied.' }), tone: 'info' })
    } catch {
      showSnackbar({ message: t({ ko: 'General 태그 복사에 실패했어.', en: 'General tag copy failed.' }), tone: 'error' })
    }
  }

  if (ratingEntries.length === 0 && characterEntries.length === 0 && generalEntries.length === 0) return null

  return (
    <div className="rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-medium">{title ?? t('wdTaggerResultBlock.wdTaggerResults')}</div>
        {result.model ? <Badge variant="outline">{result.model}</Badge> : null}
      </div>

      {ratingEntries.length > 0 ? (
        <div className="mt-4 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t({ ko: '등급 요약', en: 'Rating overview' })}</div>
          <RatingPromptSection entries={ratingEntries} />
        </div>
      ) : null}

      {characterEntries.length > 0 || generalEntries.length > 0 ? (
        <div className="mt-4 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t({ ko: '상세 점수', en: 'Detailed scores' })}</div>
          <div className="grid gap-3 grid-cols-1">
            <CharacterPromptSection entries={characterEntries} />
            <GeneralPromptSection
              tags={displayedGeneralTags}
              entries={generalEntries}
              collapsibleScores
              tagsHeaderAction={generalCopyText ? (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => void handleCopyGeneralTags()}
                  aria-label={t({ ko: 'General 태그 복사', en: 'Copy general tags' })}
                  title={t({ ko: 'General 태그 복사', en: 'Copy general tags' })}
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t({ ko: '복사', en: 'Copy' })}
                </Button>
              ) : null}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
