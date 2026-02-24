import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Box, Chip, Typography } from '@mui/material'
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
      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 1 }}>
        {t('promptDisplay.loading')}
      </Typography>
    )
  }

  if (!data) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 1 }}>
        {t('promptDisplay.loadFailed')}
      </Typography>
    )
  }

  return (
    <Box>
      {data.groups.map((group) => (
        <Box key={group.id} sx={{ mb: 1 }}>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 600,
              color: isNegative ? 'error.main' : 'primary.main',
              fontSize: '0.75rem',
            }}
          >
            {group.group_name}
          </Typography>
          <Typography
            variant="body2"
            sx={{
              lineHeight: 1.6,
              wordBreak: 'break-word',
              fontSize: '0.8rem',
              color: 'text.primary',
            }}
          >
            {group.terms.join(', ')}
          </Typography>
        </Box>
      ))}

      {data.unclassified_terms.length > 0 ? (
        <Box>
          <Typography
            variant="body2"
            sx={{
              lineHeight: 1.6,
              wordBreak: 'break-word',
              fontSize: '0.8rem',
              color: 'text.secondary',
            }}
          >
            {data.unclassified_terms.join(', ')}
          </Typography>
        </Box>
      ) : null}
    </Box>
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

  const toggleGrouped = (event: React.MouseEvent) => {
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
      <Box sx={{ py: 2, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          {t('promptDisplay.noPrompt')}
        </Typography>
      </Box>
    )
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        pr: 0.5,
        '&::-webkit-scrollbar': {
          width: '4px',
        },
        '&::-webkit-scrollbar-track': {
          background: 'transparent',
        },
        '&::-webkit-scrollbar-thumb': {
          background: 'rgba(128,128,128,0.3)',
          borderRadius: '2px',
          '&:hover': {
            background: 'rgba(128,128,128,0.5)',
          },
        },
      }}
    >
      {hasPrompt ? (
        <PromptCard
          cardId="positive"
          title={t('promptDisplay.cards.positive', 'Positive Prompt')}
          copyText={(typeof effectivePrompt === 'string' ? effectivePrompt : '') || ''}
          color="primary.main"
          headerExtra={
            <>
              {showGrouped && !isRawMode ? (
                <Chip
                  label={t('promptDisplay.showGrouped')}
                  onClick={toggleGrouped}
                  variant={userWantsGrouped ? 'filled' : 'outlined'}
                  size="small"
                  color={userWantsGrouped ? 'primary' : 'default'}
                  sx={{ fontSize: '0.65rem', height: 20 }}
                />
              ) : null}
              {hasRawNai ? (
                <Chip
                  label={isRawMode ? t('promptDisplay.showOriginal') : t('promptDisplay.showProcessed')}
                  onClick={(event) => {
                    event.stopPropagation()
                    setShowRaw(!showRaw)
                  }}
                  variant={isRawMode ? 'filled' : 'outlined'}
                  size="small"
                  color={isRawMode ? 'warning' : 'default'}
                  sx={{ fontSize: '0.65rem', height: 20 }}
                />
              ) : null}
            </>
          }
        >
          {effectiveShowGrouped
            ? renderGroupedContent(positiveGrouped, loading, t, false)
            : (
              <Typography
                variant="body2"
                sx={{
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.6,
                  wordBreak: 'break-word',
                  fontSize: '0.8rem',
                }}
              >
                {effectivePrompt}
              </Typography>
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
              <Typography
                variant="body2"
                sx={{
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.6,
                  wordBreak: 'break-word',
                  fontSize: '0.8rem',
                }}
              >
                {effectiveNegativePrompt}
              </Typography>
            )}
        </PromptCard>
      ) : null}

      {hasCharacterPrompts ? (
        <PromptCard cardId="characters" title={t('promptDisplay.cards.characters', 'Character Prompts')} color="warning.main">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {characterPrompts?.map((cp, index) => (
              <Typography key={`${cp.char_caption}-${index}`} variant="body2" sx={{ fontSize: '0.8rem', lineHeight: 1.5 }}>
                {cp.char_caption}
              </Typography>
            ))}
          </Box>
        </PromptCard>
      ) : null}

      {showAutoSection ? (
        <PromptCard cardId="auto-tags" title={t('autoTagDisplay.title', 'Auto Tags')} color="success.main">
          {imageId ? <AutoTagDisplay imageId={imageId} autoTags={autoTags || null} onTagGenerated={onAutoTagGenerated} /> : null}
        </PromptCard>
      ) : null}
    </Box>
  )
}
