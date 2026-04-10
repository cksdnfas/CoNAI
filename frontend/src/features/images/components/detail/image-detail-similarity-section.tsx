import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { updateSimilaritySettings } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import type { SimilarImage } from '@/types/similarity'
import type { RelatedImageCardAspectRatio, SimilaritySettings } from '@/types/settings'
import {
  getValidImageRecords,
  type PromptSimilaritySettingsDraft,
  type SimilaritySettingsDraft,
} from './image-detail-utils'
import { PromptSimilaritySettingsPanel } from './prompt-similarity-settings-panel'
import { RelatedImageGallerySection } from './related-image-gallery-section'
import { SimilaritySettingsPanel } from './similarity-settings-panel'

interface ImageDetailSimilaritySectionProps {
  presentation: 'page' | 'modal'
  currentSimilaritySettings?: SimilaritySettings
  similarImageItems: SimilarImage[]
  similarImagesLoading: boolean
  similarImagesError: unknown
  promptSimilarImages: ImageRecord[]
  promptSimilarImagesLoading: boolean
  promptSimilarImagesError: unknown
  mobileCardColumns?: number
  desktopCardColumns?: number
  cardAspectRatio?: RelatedImageCardAspectRatio
}

type SimilarImageTab = 'image' | 'text'

type SimilarityComponentScore = NonNullable<SimilarImage['componentScores']>[keyof NonNullable<SimilarImage['componentScores']>]

interface SimilarityComponentRow {
  key: string
  label: string
  score: SimilarityComponentScore
}

const SIMILAR_IMAGE_TABS: SimilarImageTab[] = ['image', 'text']

const SIMILAR_IMAGE_SECTION_TITLE_LABELS: Record<SimilarImageTab, string> = {
  image: '유사 이미지 [이미지]',
  text: '유사 이미지 [텍스트]',
}

const SIMILAR_IMAGE_TAB_BUTTON_LABELS: Record<SimilarImageTab, string> = {
  image: '이미지',
  text: '텍스트',
}

const SIMILARITY_COMPONENT_LABELS = {
  perceptualHash: 'pHash',
  dHash: 'dHash',
  aHash: 'aHash',
  color: '색상',
} as const

/** Format a similarity score for compact badge and detail-row display. */
function formatSimilarityValue(value?: number) {
  return typeof value === 'number' ? value.toFixed(1) : '—'
}

/** Map overall similarity scores to the existing badge color scale. */
function getSimilarityBadgeClassName(similarity: number) {
  if (similarity >= 92) return 'border border-emerald-300/45 bg-emerald-500/88 text-white'
  if (similarity >= 82) return 'border border-sky-300/45 bg-sky-500/88 text-white'
  if (similarity >= 68) return 'border border-violet-300/45 bg-violet-500/88 text-white'
  if (similarity >= 52) return 'border border-amber-200/50 bg-amber-500/88 text-black'
  return 'border border-rose-300/45 bg-rose-500/88 text-white'
}

/** Build the image-similarity draft from the current app settings when the flyout opens. */
function buildSimilaritySettingsDraft(similarity?: SimilaritySettings | null): SimilaritySettingsDraft | null {
  if (!similarity) {
    return null
  }

  return {
    detailSimilarThreshold: similarity.detailSimilarThreshold,
    detailSimilarLimit: similarity.detailSimilarLimit,
    detailSimilarIncludeColorSimilarity: similarity.detailSimilarIncludeColorSimilarity,
    detailSimilarWeights: similarity.detailSimilarWeights,
    detailSimilarThresholds: similarity.detailSimilarThresholds,
    detailSimilarUseMetadataFilter: similarity.detailSimilarUseMetadataFilter,
    detailSimilarSortBy: 'similarity',
    detailSimilarSortOrder: 'DESC',
  }
}

/** Build the prompt-similarity draft from the current app settings when the flyout opens. */
function buildPromptSimilaritySettingsDraft(
  promptSimilarity?: SimilaritySettings['promptSimilarity'] | null,
): PromptSimilaritySettingsDraft | null {
  if (!promptSimilarity) {
    return null
  }

  return {
    resultLimit: promptSimilarity.resultLimit,
    combinedThreshold: promptSimilarity.combinedThreshold,
    weights: {
      positive: promptSimilarity.weights.positive,
      negative: promptSimilarity.weights.negative,
      auto: promptSimilarity.weights.auto,
    },
    fieldThresholds: {
      positive: promptSimilarity.fieldThresholds.positive,
      negative: promptSimilarity.fieldThresholds.negative,
      auto: promptSimilarity.fieldThresholds.auto,
    },
  }
}

/** Clamp and normalize the image-similarity draft before saving it back to settings. */
function sanitizeSimilaritySettingsDraft(draft: SimilaritySettingsDraft): SimilaritySettingsDraft {
  const nextThresholds = {
    perceptualHash: Math.max(0, Math.min(64, Math.round(draft.detailSimilarThresholds.perceptualHash))),
    dHash: Math.max(0, Math.min(64, Math.round(draft.detailSimilarThresholds.dHash))),
    aHash: Math.max(0, Math.min(64, Math.round(draft.detailSimilarThresholds.aHash))),
    color: Math.max(0, Math.min(100, Math.round(draft.detailSimilarThresholds.color))),
  }

  const nextWeights = {
    perceptualHash: Math.max(0, Math.min(100, Math.round(draft.detailSimilarWeights.perceptualHash))),
    dHash: Math.max(0, Math.min(100, Math.round(draft.detailSimilarWeights.dHash))),
    aHash: Math.max(0, Math.min(100, Math.round(draft.detailSimilarWeights.aHash))),
    color: Math.max(0, Math.min(100, Math.round(draft.detailSimilarWeights.color))),
  }

  return {
    detailSimilarThreshold: nextThresholds.perceptualHash,
    detailSimilarLimit: Math.max(1, Math.min(100, Math.round(draft.detailSimilarLimit))),
    detailSimilarIncludeColorSimilarity: nextWeights.color > 0,
    detailSimilarWeights: nextWeights,
    detailSimilarThresholds: nextThresholds,
    detailSimilarUseMetadataFilter: draft.detailSimilarUseMetadataFilter,
    detailSimilarSortBy: 'similarity',
    detailSimilarSortOrder: 'DESC',
  }
}

/** Clamp and normalize the prompt-similarity draft before saving it back to settings. */
function sanitizePromptSimilaritySettingsDraft(
  draft: PromptSimilaritySettingsDraft,
): PromptSimilaritySettingsDraft {
  return {
    resultLimit: Math.max(1, Math.min(100, Math.round(draft.resultLimit))),
    combinedThreshold: Math.max(0, Math.min(100, Math.round(draft.combinedThreshold))),
    weights: {
      positive: Math.max(0, Math.min(100, Number(draft.weights.positive))),
      negative: Math.max(0, Math.min(100, Number(draft.weights.negative))),
      auto: Math.max(0, Math.min(100, Number(draft.weights.auto))),
    },
    fieldThresholds: {
      positive: Math.max(0, Math.min(100, Math.round(draft.fieldThresholds.positive))),
      negative: Math.max(0, Math.min(100, Math.round(draft.fieldThresholds.negative))),
      auto: Math.max(0, Math.min(100, Math.round(draft.fieldThresholds.auto))),
    },
  }
}

/** Read an API error into the localized fallback message already used in the detail page. */
function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

/** Build score rows for the hover popup from the component-level similarity result. */
function getSimilarityComponentRows(item: SimilarImage): SimilarityComponentRow[] {
  const rows: SimilarityComponentRow[] = []

  if (item.componentScores?.perceptualHash) {
    rows.push({ key: 'perceptualHash', label: SIMILARITY_COMPONENT_LABELS.perceptualHash, score: item.componentScores.perceptualHash })
  }

  if (item.componentScores?.dHash) {
    rows.push({ key: 'dHash', label: SIMILARITY_COMPONENT_LABELS.dHash, score: item.componentScores.dHash })
  }

  if (item.componentScores?.aHash) {
    rows.push({ key: 'aHash', label: SIMILARITY_COMPONENT_LABELS.aHash, score: item.componentScores.aHash })
  }

  if (item.componentScores?.color) {
    rows.push({ key: 'color', label: SIMILARITY_COMPONENT_LABELS.color, score: item.componentScores.color })
  }

  return rows
}

/** Render the persistent similarity badge and popup for each related-image card. */
function SimilarImageScoreOverlay({ item }: { item: SimilarImage }) {
  const [isHovering, setIsHovering] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)
  const componentRows = getSimilarityComponentRows(item)
  const isOpen = isHovering && !isDismissed

  const handleBadgeHover = () => {
    setIsHovering(true)
    setIsDismissed(false)
  }

  return (
    <div className="flex justify-start">
      <div
        className="relative max-w-full"
        onMouseEnter={handleBadgeHover}
        onMouseLeave={() => {
          setIsHovering(false)
          setIsDismissed(false)
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <Badge
          variant="secondary"
          className={cn(
            'max-w-full shadow-sm backdrop-blur-sm tracking-normal normal-case',
            getSimilarityBadgeClassName(item.similarity),
          )}
          onMouseEnter={handleBadgeHover}
          onMouseMove={() => {
            if (isDismissed) {
              setIsDismissed(false)
            }
          }}
          onClick={(event) => event.stopPropagation()}
        >
          {formatSimilarityValue(item.similarity)}
        </Badge>

        {isOpen ? (
          <div
            className="absolute bottom-full left-0 z-40 mb-2 w-60 rounded-sm border border-border bg-background/96 p-3 text-[11px] shadow-[0_8px_24px_rgba(0,0,0,0.28)] backdrop-blur-sm"
            onClick={(event) => {
              event.stopPropagation()
              setIsDismissed(true)
            }}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-semibold text-foreground">세부 점수</span>
              <Badge variant="outline" className="px-2 py-0.5 tracking-normal normal-case">{item.matchType}</Badge>
            </div>

            <div className="grid gap-1.5">
              {componentRows.map(({ key, label, score }) => (
                <div key={key} className="flex items-start justify-between gap-2 leading-4">
                  <span className="text-muted-foreground">{label}</span>
                  <span className={cn('text-right', score.used && !score.passed ? 'text-destructive' : 'text-foreground')}>
                    {!score.available
                      ? '데이터 없음'
                      : 'distance' in score
                        ? `유사 ${formatSimilarityValue(score.similarity)} · 거리 ${score.distance ?? '—'}/${score.threshold} · 비중 ${score.weight}`
                        : `유사 ${formatSimilarityValue(score.similarity)} · 기준 ${score.threshold} · 비중 ${score.weight}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Render the similarity gallery area, including tabs, flyouts, and score overlays. */
export function ImageDetailSimilaritySection({
  presentation,
  currentSimilaritySettings,
  similarImageItems,
  similarImagesLoading,
  similarImagesError,
  promptSimilarImages,
  promptSimilarImagesLoading,
  promptSimilarImagesError,
  mobileCardColumns = 1,
  desktopCardColumns = 3,
  cardAspectRatio = 'square',
}: ImageDetailSimilaritySectionProps) {
  const queryClient = useQueryClient()
  const [activeSimilarImageTab, setActiveSimilarImageTab] = useState<SimilarImageTab>('image')
  const [isSimilaritySettingsOpen, setIsSimilaritySettingsOpen] = useState(false)
  const [isPromptSimilaritySettingsOpen, setIsPromptSimilaritySettingsOpen] = useState(false)
  const [similarityDraft, setSimilarityDraft] = useState<SimilaritySettingsDraft | null>(null)
  const [promptSimilarityDraft, setPromptSimilarityDraft] = useState<PromptSimilaritySettingsDraft | null>(null)

  const saveSimilaritySettingsMutation = useMutation({
    mutationFn: (settings: SimilaritySettingsDraft) => updateSimilaritySettings(settings),
    onSuccess: (settings) => {
      queryClient.setQueryData(['app-settings'], settings)
      setIsSimilaritySettingsOpen(false)
    },
  })

  const savePromptSimilaritySettingsMutation = useMutation({
    mutationFn: (settings: PromptSimilaritySettingsDraft) =>
      updateSimilaritySettings({
        promptSimilarity: {
          resultLimit: settings.resultLimit,
          combinedThreshold: settings.combinedThreshold,
          weights: settings.weights,
          fieldThresholds: settings.fieldThresholds,
        },
      }),
    onSuccess: (settings) => {
      queryClient.setQueryData(['app-settings'], settings)
      setIsPromptSimilaritySettingsOpen(false)
    },
  })

  const similarImages = useMemo(
    () => getValidImageRecords(similarImageItems.map((item) => item.image)),
    [similarImageItems],
  )

  const similarImageItemByHash = useMemo(
    () => new Map(similarImageItems.map((item) => [String(item.image.composite_hash), item])),
    [similarImageItems],
  )

  const similarSectionTitle = SIMILAR_IMAGE_SECTION_TITLE_LABELS[activeSimilarImageTab]
  const similarSectionItems = activeSimilarImageTab === 'image' ? similarImages : promptSimilarImages
  const similarSectionIsLoading = activeSimilarImageTab === 'image'
    ? similarImagesLoading
    : promptSimilarImagesLoading
  const similarSectionErrorMessage = activeSimilarImageTab === 'image'
    ? (similarImagesError ? getErrorMessage(similarImagesError, '알 수 없는 오류가 발생했어.') : null)
    : (promptSimilarImagesError ? getErrorMessage(promptSimilarImagesError, '알 수 없는 오류가 발생했어.') : null)
  const similarSectionEmptyMessage = activeSimilarImageTab === 'image'
    ? '현재 설정에서는 표시할 유사 이미지가 없어.'
    : '현재 텍스트 기준에서는 표시할 유사 이미지가 없어.'

  /** Keep tab changes responsible for closing the other flyout so only one popup stays active. */
  const handleSelectSimilarImageTab = (tab: SimilarImageTab) => {
    setActiveSimilarImageTab(tab)

    if (tab !== 'image') {
      setIsSimilaritySettingsOpen(false)
    }

    if (tab !== 'text') {
      setIsPromptSimilaritySettingsOpen(false)
    }
  }

  /** Open or close the image-similarity flyout with a fresh draft from current settings. */
  const handleToggleSimilaritySettings = () => {
    if (isSimilaritySettingsOpen) {
      setIsSimilaritySettingsOpen(false)
      return
    }

    const nextDraft = buildSimilaritySettingsDraft(currentSimilaritySettings)
    if (!nextDraft) {
      return
    }

    setSimilarityDraft(nextDraft)
    setIsPromptSimilaritySettingsOpen(false)
    setIsSimilaritySettingsOpen(true)
  }

  /** Open or close the prompt-similarity flyout with a fresh draft from current settings. */
  const handleTogglePromptSimilaritySettings = () => {
    if (isPromptSimilaritySettingsOpen) {
      setIsPromptSimilaritySettingsOpen(false)
      return
    }

    const nextDraft = buildPromptSimilaritySettingsDraft(currentSimilaritySettings?.promptSimilarity)
    if (!nextDraft) {
      return
    }

    setPromptSimilarityDraft(nextDraft)
    setIsSimilaritySettingsOpen(false)
    setIsPromptSimilaritySettingsOpen(true)
  }

  /** Save the current image-similarity draft after clamping it to the supported ranges. */
  const handleApplySimilaritySettings = () => {
    if (!similarityDraft || saveSimilaritySettingsMutation.isPending) {
      return
    }

    saveSimilaritySettingsMutation.mutate(sanitizeSimilaritySettingsDraft(similarityDraft))
  }

  /** Merge a partial image-similarity draft update from the flyout controls. */
  const handlePatchSimilarityDraft = (patch: Partial<SimilaritySettingsDraft>) => {
    setSimilarityDraft((current) => (current ? { ...current, ...patch } : current))
  }

  /** Save the current prompt-similarity draft after clamping it to the supported ranges. */
  const handleApplyPromptSimilaritySettings = () => {
    if (!promptSimilarityDraft || savePromptSimilaritySettingsMutation.isPending) {
      return
    }

    savePromptSimilaritySettingsMutation.mutate(sanitizePromptSimilaritySettingsDraft(promptSimilarityDraft))
  }

  /** Merge a partial prompt-similarity draft update from the flyout controls. */
  const handlePatchPromptSimilarityDraft = (patch: Partial<PromptSimilaritySettingsDraft>) => {
    setPromptSimilarityDraft((current) => (current ? { ...current, ...patch } : current))
  }

  /** Render a persistent score badge only for cards that have a matching similarity result. */
  const renderSimilarImageOverlay = (image: ImageRecord): ReactNode => {
    const compositeHash = image.composite_hash
    if (typeof compositeHash !== 'string' || compositeHash.length === 0) {
      return null
    }

    const item = similarImageItemByHash.get(compositeHash)
    return item ? <SimilarImageScoreOverlay item={item} /> : null
  }

  const similarSectionActions = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <div className="inline-flex items-center rounded-sm border border-border bg-surface-container p-1">
        {SIMILAR_IMAGE_TABS.map((tab) => (
          <Button
            key={tab}
            size="sm"
            variant="ghost"
            onClick={() => handleSelectSimilarImageTab(tab)}
            className={cn(
              'h-8 px-3 text-xs font-semibold',
              activeSimilarImageTab === tab ? 'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {SIMILAR_IMAGE_TAB_BUTTON_LABELS[tab]}
          </Button>
        ))}
      </div>

      {activeSimilarImageTab === 'image' ? (
        <SimilaritySettingsPanel
          isOpen={isSimilaritySettingsOpen}
          draft={similarityDraft}
          isSaving={saveSimilaritySettingsMutation.isPending}
          errorMessage={
            saveSimilaritySettingsMutation.isError
              ? getErrorMessage(saveSimilaritySettingsMutation.error, '설정 저장 중 오류가 발생했어.')
              : null
          }
          onToggle={handleToggleSimilaritySettings}
          onPatchDraft={handlePatchSimilarityDraft}
          onApply={handleApplySimilaritySettings}
        />
      ) : null}

      {activeSimilarImageTab === 'text' ? (
        <PromptSimilaritySettingsPanel
          isOpen={isPromptSimilaritySettingsOpen}
          draft={promptSimilarityDraft}
          isSaving={savePromptSimilaritySettingsMutation.isPending}
          errorMessage={
            savePromptSimilaritySettingsMutation.isError
              ? getErrorMessage(savePromptSimilaritySettingsMutation.error, '설정 저장 중 오류가 발생했어.')
              : null
          }
          onToggle={handleTogglePromptSimilaritySettings}
          onPatchDraft={handlePatchPromptSimilarityDraft}
          onApply={handleApplyPromptSimilaritySettings}
        />
      ) : null}
    </div>
  )

  return (
    <RelatedImageGallerySection
      title={similarSectionTitle}
      items={similarSectionItems}
      isLoading={similarSectionIsLoading}
      errorMessage={similarSectionErrorMessage}
      emptyMessage={similarSectionEmptyMessage}
      actions={similarSectionActions}
      activationMode={presentation === 'modal' ? 'modal' : 'modal-single'}
      mobileCardColumns={mobileCardColumns}
      desktopCardColumns={desktopCardColumns}
      cardAspectRatio={cardAspectRatio}
      renderItemPersistentOverlay={activeSimilarImageTab === 'image' ? renderSimilarImageOverlay : undefined}
    />
  )
}
