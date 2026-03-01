import { useState, type MouseEvent } from 'react'
import { Check, ChevronDown, Copy, Info, Loader2, RefreshCw } from 'lucide-react'
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

  const handleGenerateTag = async (event?: MouseEvent<HTMLButtonElement>) => {
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
      <div className="p-2 text-center">
        {error ? <div role="alert" className="mb-2 rounded-md border border-red-300 bg-red-50 px-2 py-1 text-sm text-red-700">{error}</div> : null}
        <p className="mb-2 text-sm text-muted-foreground">{t('autoTagDisplay.noTags')}</p>
        <button
          type="button"
          onClick={() => void handleGenerateTag()}
          disabled={isGenerating}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {isGenerating ? t('autoTagDisplay.generating') : t('autoTagDisplay.generateButton')}
        </button>
      </div>
    )
  }

  const taggerData = autoTags.tagger && typeof autoTags.tagger === 'object' ? autoTags.tagger : null
  const resolved = {
    rating: autoTags.rating || taggerData?.rating,
    character: autoTags.character || taggerData?.character,
    taglist: autoTags.taglist || taggerData?.taglist,
    general: autoTags.general || taggerData?.general,
    model: autoTags.model || taggerData?.model,
    thresholds: autoTags.thresholds || taggerData?.thresholds,
    tagged_at: autoTags.tagged_at || taggerData?.tagged_at,
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

  const renderScoreFill = (score: number) => (
    <div
      className="h-full rounded"
      style={{
        width: `${Math.max(0, Math.min(100, score * 100))}%`,
        backgroundColor: getGeneralTagColor(score),
      }}
    />
  )

  const renderRatingGauge = () => {
    if (!resolved.rating) return null

    const ratings = Object.entries(resolved.rating)
      .map(([key, value]) => ({
        key,
        value: Math.round(value * 100) / 100,
        color: getRatingColor(key),
      }))
      .filter((entry) => entry.value > 0)

    if (ratings.length === 0) return null

    const total = ratings.reduce((sum, entry) => sum + entry.value, 0)
    const modelInfo = [
      `${t('autoTagDisplay.modelInfo.model')}: ${resolved.model ?? '-'}`,
      `${t('autoTagDisplay.modelInfo.generalThreshold')}: ${resolved.thresholds?.general ?? '-'}`,
      `${t('autoTagDisplay.modelInfo.characterThreshold')}: ${resolved.thresholds?.character ?? '-'}`,
      resolved.tagged_at
        ? `${t('autoTagDisplay.modelInfo.taggedAt')}: ${new Date(resolved.tagged_at).toLocaleString('ko-KR')}`
        : null,
    ].filter(Boolean).join('\n')

    return (
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-sm font-semibold">{t('autoTagDisplay.sections.rating')}</p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted/50"
              title={modelInfo}
              aria-label={t('autoTagDisplay.modelInfo.model')}
            >
              <Info className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={(event) => void handleGenerateTag(event)}
              disabled={isGenerating}
              title={t('autoTagDisplay.regenerate', 'Regenerate Tags')}
              aria-label={t('autoTagDisplay.regenerate', 'Regenerate Tags')}
            >
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </div>
        <div className="flex h-8 overflow-hidden rounded border border-border">
          {ratings.map((rating) => (
            <div
              key={rating.key}
              className="relative flex items-center justify-center"
              style={{
                flex: rating.value / total,
                backgroundColor: rating.color,
                borderRight: '1px solid rgba(0,0,0,0.1)',
              }}
            >
              {rating.value >= 0.33 ? (
                <span
                  className="text-[0.7rem] font-semibold"
                  style={{
                    color: rating.key === 'sensitive' ? 'rgba(0,0,0,0.7)' : 'white',
                    textShadow: rating.key === 'sensitive' ? 'none' : '0 1px 2px rgba(0,0,0,0.3)',
                  }}
                >
                  {rating.key.substring(0, 3).toUpperCase()} {(rating.value * 100).toFixed(0)}%
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    )
  }

  const renderCharacters = () => {
    if (!resolved.character) return null

    const characters = Object.entries(resolved.character).sort((a, b) => b[1] - a[1])
    if (characters.length === 0) return null

    return (
      <div className="mb-2">
        <p className="mb-1 text-sm font-semibold">{t('autoTagDisplay.sections.characters')}</p>
        <div className="flex flex-col gap-1">
          {characters.map(([name, score]) => (
            <div key={name}>
              <div className="mb-0.5 flex justify-between">
                <p className="text-[0.85rem]">{name}</p>
                <span className="text-xs text-muted-foreground">{(score * 100).toFixed(1)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded bg-black/10 dark:bg-white/10">
                {renderScoreFill(score)}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const handleCopyTaglist = async () => {
    if (!resolved.taglist) return
    try {
      await navigator.clipboard.writeText(resolved.taglist)
      setTaglistCopied(true)
      setTimeout(() => setTaglistCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy taglist:', err)
    }
  }

  const renderTaglist = () => {
    if (!resolved.taglist) return null

    return (
      <div className="mb-2">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-sm font-semibold">{t('autoTagDisplay.sections.tagList')}</p>
          <button
            type="button"
            onClick={() => void handleCopyTaglist()}
            className={`inline-flex h-7 w-7 items-center justify-center rounded ${taglistCopied ? 'text-emerald-600' : 'text-muted-foreground hover:bg-muted/50'}`}
            title={taglistCopied ? t('autoTagDisplay.taglistCopied', 'Copied!') : t('autoTagDisplay.copyTaglist', 'Copy Tags')}
            aria-label={taglistCopied ? t('autoTagDisplay.taglistCopied', 'Copied!') : t('autoTagDisplay.copyTaglist', 'Copy Tags')}
          >
            {taglistCopied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
        <p className="text-sm leading-relaxed" style={{ wordBreak: 'break-word' }}>
          {resolved.taglist}
        </p>
      </div>
    )
  }

  const renderGeneralTags = () => {
    if (!resolved.general) return null

    const generalTags = Object.entries(resolved.general).sort((a, b) => b[1] - a[1])
    if (generalTags.length === 0) return null

    return (
      <details>
        <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-sm font-semibold">
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
          {t('autoTagDisplay.sections.generalTags', { count: generalTags.length })}
        </summary>
        <div className="mt-1 flex flex-col gap-1">
          {generalTags.map(([tag, score]) => (
            <div key={tag}>
              <div className="mb-0.5 flex justify-between">
                <p className="text-[0.85rem]">{tag}</p>
                <span className="text-xs text-muted-foreground">{(score * 100).toFixed(1)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded bg-black/10 dark:bg-white/10">
                {renderScoreFill(score)}
              </div>
            </div>
          ))}
        </div>
      </details>
    )
  }

  return (
    <div className="overflow-y-auto">
      {error ? <div role="alert" className="mb-2 rounded-md border border-red-300 bg-red-50 px-2 py-1 text-sm text-red-700">{error}</div> : null}
      {renderRatingGauge()}
      {renderCharacters()}
      {renderTaglist()}
      {renderGeneralTags()}
    </div>
  )
}
