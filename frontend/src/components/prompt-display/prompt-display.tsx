import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AutoTagsData } from '@/types/image'
import AutoTagDisplay from '@/components/prompt-display/auto-tag-display'
import PromptCard from '@/components/prompt-display/prompt-card'
import { groupPromptTerms, type GroupedPromptResult } from '@/utils/prompt-grouping'

export interface NaiCharacterPrompt {
  char_caption: string
  centers: { x: number; y: number }[]
}

interface PromptDisplayProps {
  prompt?: string | null
  negativePrompt?: string | null
  maxHeight?: number | string
  showLabels?: boolean
  variant?: 'outlined' | 'elevation' | 'none'
  showGrouped?: boolean
  imageId?: string
  autoTags?: AutoTagsData | null
  isTaggerEnabled?: boolean
  onAutoTagGenerated?: () => void
  isHistoryContext?: boolean
  characterPrompts?: NaiCharacterPrompt[]
  rawNaiParameters?: Record<string, unknown> | null
}

function renderGroupedContent(data: GroupedPromptResult | null, loading: boolean, t: (key: string) => string, isNegative = false): ReactNode {
  if (loading) {
    return (
      <p className="py-1 text-center text-sm text-muted-foreground">
        {t('promptDisplay.loading')}
      </p>
    )
  }

  if (!data) {
    return (
      <p className="py-1 text-center text-sm text-muted-foreground">
        {t('promptDisplay.loadFailed')}
      </p>
    )
  }

  return (
    <div>
      {data.groups.map((group) => (
        <div key={group.id} className="mb-2">
          <p className={`text-xs font-semibold ${isNegative ? 'text-red-600 dark:text-red-400' : 'text-primary'}`}>
            {group.group_name}
          </p>
          <p
            className="text-[0.8rem] leading-relaxed text-foreground"
            style={{ wordBreak: 'break-word' }}
          >
            {group.terms.join(', ')}
          </p>
        </div>
      ))}

      {data.unclassified_terms.length > 0 ? (
        <div>
          <p
            className="text-[0.8rem] leading-relaxed text-muted-foreground"
            style={{ wordBreak: 'break-word' }}
          >
            {data.unclassified_terms.join(', ')}
          </p>
        </div>
      ) : null}
    </div>
  )
}

export default function PromptDisplay({
  prompt,
  negativePrompt,
  showGrouped = false,
  imageId,
  autoTags,
  isTaggerEnabled = false,
  onAutoTagGenerated,
  characterPrompts,
  rawNaiParameters,
}: PromptDisplayProps) {
  const { t } = useTranslation('promptManagement')
  const [positiveGrouped, setPositiveGrouped] = useState<GroupedPromptResult | null>(null)
  const [negativeGrouped, setNegativeGrouped] = useState<GroupedPromptResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const [userWantsGrouped, setUserWantsGrouped] = useState(() => {
    try {
      const stored = localStorage.getItem('promptDisplay_grouped')
      return stored === null ? true : stored === 'true'
    } catch {
      return true
    }
  })

  const hasRawNai = Boolean((rawNaiParameters as { prompt?: unknown } | null | undefined)?.prompt)
  const isRawMode = showRaw && hasRawNai

  const effectivePrompt = isRawMode ? ((rawNaiParameters as { prompt?: string | null } | null | undefined)?.prompt || '') : prompt
  const effectiveNegativePrompt = isRawMode ? ((rawNaiParameters as { uc?: string | null } | null | undefined)?.uc || '') : negativePrompt
  const effectiveShowGrouped = isRawMode ? false : showGrouped && userWantsGrouped

  const toggleGrouped = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    setUserWantsGrouped((prev) => {
      const next = !prev
      try {
        localStorage.setItem('promptDisplay_grouped', String(next))
      } catch {
        // ignore
      }
      return next
    })
  }

  const hasPrompt = Boolean(effectivePrompt && effectivePrompt.trim())
  const hasNegativePrompt = Boolean(effectiveNegativePrompt && effectiveNegativePrompt.trim())
  const hasCharacterPrompts = Boolean(characterPrompts && characterPrompts.some((cp) => cp.char_caption.trim()))
  const showAutoSection = (isTaggerEnabled && imageId !== undefined) || (autoTags && Object.keys(autoTags).length > 0)

  const memoizedPrompt = useMemo(() => (typeof effectivePrompt === 'string' ? effectivePrompt.trim() : '') || '', [effectivePrompt])
  const memoizedNegativePrompt = useMemo(
    () => (typeof effectiveNegativePrompt === 'string' ? effectiveNegativePrompt.trim() : '') || '',
    [effectiveNegativePrompt],
  )

  useEffect(() => {
    if (effectiveShowGrouped) {
      const loadGroupedData = async () => {
        setLoading(true)
        try {
          if (hasPrompt) {
            const positiveResult = await groupPromptTerms(memoizedPrompt, 'positive')
            setPositiveGrouped(positiveResult)
          }
          if (hasNegativePrompt) {
            const negativeResult = await groupPromptTerms(memoizedNegativePrompt, 'negative')
            setNegativeGrouped(negativeResult)
          }
        } catch (error) {
          console.error('Error grouping prompts:', error)
        } finally {
          setLoading(false)
        }
      }

      void loadGroupedData()
    } else {
      setPositiveGrouped(null)
      setNegativeGrouped(null)
    }
  }, [effectiveShowGrouped, hasNegativePrompt, hasPrompt, memoizedNegativePrompt, memoizedPrompt])

  if (!hasPrompt && !hasNegativePrompt && !hasCharacterPrompts && !showAutoSection) {
    return (
      <div className="py-2 text-center">
        <p className="text-sm text-muted-foreground">{t('promptDisplay.noPrompt')}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-1.5 overflow-x-hidden overflow-y-auto pr-0.5">
      {hasPrompt ? (
        <PromptCard
          cardId="positive"
          title={t('promptDisplay.cards.positive', 'Positive Prompt')}
          copyText={(typeof effectivePrompt === 'string' ? effectivePrompt : '') || ''}
          color="primary.main"
          headerExtra={
            <>
              {showGrouped && !isRawMode ? (
                <button
                  type="button"
                  onClick={toggleGrouped}
                  className={`h-5 rounded-full px-2 text-[0.65rem] ${userWantsGrouped ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground'}`}
                >
                  {t('promptDisplay.showGrouped')}
                </button>
              ) : null}
              {hasRawNai ? (
                <button
                  type="button"
                  onClick={(event: MouseEvent<HTMLButtonElement>) => {
                    event.stopPropagation()
                    setShowRaw(!showRaw)
                  }}
                  className={`h-5 rounded-full px-2 text-[0.65rem] ${isRawMode ? 'bg-amber-500 text-amber-950' : 'border border-border text-muted-foreground'}`}
                >
                  {isRawMode ? t('promptDisplay.showOriginal') : t('promptDisplay.showProcessed')}
                </button>
              ) : null}
            </>
          }
        >
          {effectiveShowGrouped
            ? renderGroupedContent(positiveGrouped, loading, t, false)
            : (
              <p
                className="text-[0.8rem] leading-relaxed"
                style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              >
                {effectivePrompt}
              </p>
            )}
        </PromptCard>
      ) : null}

      {hasNegativePrompt ? (
        <PromptCard
          cardId="negative"
          title={t('promptDisplay.cards.negative', 'Negative Prompt')}
          copyText={(typeof effectiveNegativePrompt === 'string' ? effectiveNegativePrompt : '') || ''}
          color="error.main"
        >
          {effectiveShowGrouped
            ? renderGroupedContent(negativeGrouped, loading, t, true)
            : (
              <p
                className="text-[0.8rem] leading-relaxed"
                style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              >
                {effectiveNegativePrompt}
              </p>
            )}
        </PromptCard>
      ) : null}

      {hasCharacterPrompts ? (
        <PromptCard cardId="characters" title={t('promptDisplay.cards.characters', 'Character Prompts')} color="warning.main">
          <div className="flex flex-col gap-1">
            {characterPrompts?.map((cp, index) => (
              <p key={`${cp.char_caption}-${index}`} className="text-[0.8rem] leading-6">
                {cp.char_caption}
              </p>
            ))}
          </div>
        </PromptCard>
      ) : null}

      {showAutoSection ? (
        <PromptCard cardId="auto-tags" title={t('autoTagDisplay.title', 'Auto Tags')} color="success.main">
          {imageId ? <AutoTagDisplay imageId={imageId} autoTags={autoTags || null} onTagGenerated={onAutoTagGenerated} /> : null}
        </PromptCard>
      ) : null}
    </div>
  )
}
