import { useState } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  LinearProgress,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  Check as CheckIcon,
  ContentCopy as ContentCopyIcon,
  ExpandMore as ExpandMoreIcon,
  InfoOutlined as InfoOutlinedIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import type { AutoTagsData } from '@/types/image'
import { taggerBatchApi } from '@/services/tagger-batch-api'

interface AutoTagDisplayProps {
  imageId: string
  autoTags: AutoTagsData | null
  onTagGenerated?: () => void
}

export default function AutoTagDisplay({ imageId, autoTags, onTagGenerated }: AutoTagDisplayProps) {
  const { t } = useTranslation('promptManagement')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [taglistCopied, setTaglistCopied] = useState(false)

  const handleGenerateTag = async (event?: React.MouseEvent) => {
    if (event) event.stopPropagation()
    setIsGenerating(true)
    setError(null)
    try {
      await taggerBatchApi.testImage(imageId)
      onTagGenerated?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : t('autoTagDisplay.generationError')
      setError(message)
    } finally {
      setIsGenerating(false)
    }
  }

  if (!autoTags) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('autoTagDisplay.noTags')}
        </Typography>
        <Button
          variant="contained"
          onClick={() => void handleGenerateTag()}
          disabled={isGenerating}
          startIcon={isGenerating ? <CircularProgress size={20} /> : undefined}
        >
          {isGenerating ? t('autoTagDisplay.generating') : t('autoTagDisplay.generateButton')}
        </Button>
      </Box>
    )
  }

  const getRatingColor = (key: string): string => {
    const colorMap: Record<string, string> = {
      general: '#4caf50',
      sensitive: '#ffeb3b',
      questionable: '#ff9800',
      explicit: '#d32f2f',
    }
    return colorMap[key] || '#9e9e9e'
  }

  const getGeneralTagColor = (value: number): string => {
    if (value < 0.33) return '#9e9e9e'
    if (value < 0.66) return '#2196f3'
    return '#4caf50'
  }

  const renderRatingGauge = () => {
    if (!autoTags.rating) return null

    const ratings = Object.entries(autoTags.rating)
      .map(([key, value]) => ({
        key,
        value: Math.round(value * 100) / 100,
        color: getRatingColor(key),
      }))
      .filter((entry) => entry.value > 0)

    if (ratings.length === 0) return null

    const total = ratings.reduce((sum, entry) => sum + entry.value, 0)

    return (
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {t('autoTagDisplay.sections.rating')}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
            <Tooltip
              title={
                <Box sx={{ p: 0.5 }}>
                  <Typography variant="caption" display="block">{t('autoTagDisplay.modelInfo.model')}: {autoTags.model}</Typography>
                  <Typography variant="caption" display="block">{t('autoTagDisplay.modelInfo.generalThreshold')}: {autoTags.thresholds.general}</Typography>
                  <Typography variant="caption" display="block">{t('autoTagDisplay.modelInfo.characterThreshold')}: {autoTags.thresholds.character}</Typography>
                  {autoTags.tagged_at ? (
                    <Typography variant="caption" display="block">{t('autoTagDisplay.modelInfo.taggedAt')}: {new Date(autoTags.tagged_at).toLocaleString('ko-KR')}</Typography>
                  ) : null}
                </Box>
              }
              arrow
              placement="left"
            >
              <IconButton size="small" sx={{ color: 'text.secondary' }}>
                <InfoOutlinedIcon sx={{ fontSize: '1rem' }} />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('autoTagDisplay.regenerate', 'Regenerate Tags')}>
              <span>
                <IconButton size="small" onClick={(event) => void handleGenerateTag(event)} disabled={isGenerating}>
                  {isGenerating ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </Box>
        <Box
          sx={{
            display: 'flex',
            height: 32,
            borderRadius: 1,
            overflow: 'hidden',
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          {ratings.map((rating) => (
            <Box
              key={rating.key}
              sx={{
                flex: rating.value / total,
                backgroundColor: rating.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                '&:not(:last-child)': {
                  borderRight: '1px solid rgba(0,0,0,0.1)',
                },
              }}
            >
              {rating.value >= 0.33 ? (
                <Typography
                  variant="caption"
                  sx={{
                    color: rating.key === 'sensitive' ? 'rgba(0,0,0,0.7)' : 'white',
                    fontWeight: 600,
                    fontSize: '0.7rem',
                    textShadow: rating.key === 'sensitive' ? 'none' : '0 1px 2px rgba(0,0,0,0.3)',
                  }}
                >
                  {rating.key.substring(0, 3).toUpperCase()} {(rating.value * 100).toFixed(0)}%
                </Typography>
              ) : null}
            </Box>
          ))}
        </Box>
      </Box>
    )
  }

  const renderCharacters = () => {
    if (!autoTags.character) return null

    const characters = Object.entries(autoTags.character).sort((a, b) => b[1] - a[1])
    if (characters.length === 0) return null

    return (
      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
          {t('autoTagDisplay.sections.characters')}
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {characters.map(([name, score]) => (
            <Box key={name}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>{name}</Typography>
                <Typography variant="caption" color="text.secondary">{(score * 100).toFixed(1)}%</Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={score * 100}
                sx={{
                  height: 6,
                  borderRadius: 1,
                  backgroundColor: 'rgba(0,0,0,0.1)',
                  '& .MuiLinearProgress-bar': {
                    backgroundColor: getGeneralTagColor(score),
                    borderRadius: 1,
                  },
                }}
              />
            </Box>
          ))}
        </Box>
      </Box>
    )
  }

  const handleCopyTaglist = async () => {
    if (!autoTags.taglist) return
    try {
      await navigator.clipboard.writeText(autoTags.taglist)
      setTaglistCopied(true)
      setTimeout(() => setTaglistCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy taglist:', err)
    }
  }

  const renderTaglist = () => {
    if (!autoTags.taglist) return null

    return (
      <Box sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{t('autoTagDisplay.sections.tagList')}</Typography>
          <Tooltip title={taglistCopied ? t('autoTagDisplay.taglistCopied', 'Copied!') : t('autoTagDisplay.copyTaglist', 'Copy Tags')}>
            <IconButton size="small" onClick={() => void handleCopyTaglist()} sx={{ color: taglistCopied ? 'success.main' : 'text.secondary' }}>
              {taglistCopied ? <CheckIcon sx={{ fontSize: '1rem' }} /> : <ContentCopyIcon sx={{ fontSize: '1rem' }} />}
            </IconButton>
          </Tooltip>
        </Box>
        <Typography variant="body2" sx={{ lineHeight: 1.6, wordBreak: 'break-word' }}>
          {autoTags.taglist}
        </Typography>
      </Box>
    )
  }

  const renderGeneralTags = () => {
    if (!autoTags.general) return null

    const generalTags = Object.entries(autoTags.general).sort((a, b) => b[1] - a[1])
    if (generalTags.length === 0) return null

    return (
      <Accordion defaultExpanded={false}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {t('autoTagDisplay.sections.generalTags', { count: generalTags.length })}
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {generalTags.map(([tag, score]) => (
              <Box key={tag}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>{tag}</Typography>
                  <Typography variant="caption" color="text.secondary">{(score * 100).toFixed(1)}%</Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={score * 100}
                  sx={{
                    height: 6,
                    borderRadius: 1,
                    backgroundColor: 'rgba(0,0,0,0.1)',
                    '& .MuiLinearProgress-bar': {
                      backgroundColor: getGeneralTagColor(score),
                      borderRadius: 1,
                    },
                  }}
                />
              </Box>
            ))}
          </Box>
        </AccordionDetails>
      </Accordion>
    )
  }

  return (
    <Box sx={{ height: '100%', overflowY: 'auto' }}>
      {renderRatingGauge()}
      {renderCharacters()}
      {renderTaglist()}
      {renderGeneralTags()}
    </Box>
  )
}
