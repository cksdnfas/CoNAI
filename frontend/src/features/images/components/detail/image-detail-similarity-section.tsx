import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Image as ImageIcon, Type, type LucideIcon } from 'lucide-react'
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
  normalizeSimilarityResultRows,
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

const SIMILAR_IMAGE_TAB_ICONS: Record<SimilarImageTab, LucideIcon> = {
  image: ImageIcon,
  text: Type,
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
    detailSimilarLimit: normalizeSimilarityResultRows(similarity.detailSimilarLimit),
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
    resultLimit: normalizeSimilarityResultRows(promptSimilarity.resultLimit),
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
    detailSimilarLimit: normalizeSimilarityResultRows(draft.detailSimilarLimit),
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
    resultLimit: normalizeSimilarityResultRows(draft.resultLimit),
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

  const pushRow = (key: SimilarityComponentRow['key'], label: string, score?: SimilarityComponentScore) => {
    if (!score || (!score.available && !score.used)) {
      return
    }
    rows.push({ key, label, score })
  }

  pushRow('perceptualHash', SIMILARITY_COMPONENT_LABELS.perceptualHash, item.componentScores?.perceptualHash)
  pushRow('dHash', SIMILARITY_COMPONENT_LABELS.dHash, item.componentScores?.dHash)
  pushRow('aHash', SIMILARITY_COMPONENT_LABELS.aHash, item.componentScores?.aHash)
  pushRow('color', SIMILARITY_COMPONENT_LABELS.color, item.componentScores?.color)

  return rows
}

/** Render the persistent similarity badge and popup for each related-image card. */
export function SimilarImageScoreOverlay({ item }: { item: SimilarImage }) {
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const [isAnchorHovered, setIsAnchorHovered] = useState(false)
  const [isPopupHovered, setIsPopupHovered] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)
  const [popupPosition, setPopupPosition] = useState<{ top: number; left: number; placement: 'top' | 'bottom'; width: number } | null>(null)
  const componentRows = getSimilarityComponentRows(item)
  const isOpen = (isAnchorHovered || isPopupHovered) && !isDismissed

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') {
      return
    }

    const updatePosition = () => {
      const anchor = anchorRef.current
      if (!anchor) {
        return
      }

      const rect = anchor.getBoundingClientRect()
      const viewportPadding = 12
      const popupGap = 8
      const popupWidth = Math.min(240, window.innerWidth - viewportPadding * 2)
      const estimatedPopupHeight = componentRows.length > 0 ? 180 : 116
      const shouldOpenAbove = rect.bottom + popupGap + estimatedPopupHeight > window.innerHeight - viewportPadding && rect.top > estimatedPopupHeight + popupGap

      let left = rect.left
      if (left + popupWidth > window.innerWidth - viewportPadding) {
        left = rect.right - popupWidth
      }
      left = Math.max(viewportPadding, left)

      setPopupPosition({
        top: shouldOpenAbove ? rect.top - popupGap : rect.bottom + popupGap,
        left,
        placement: shouldOpenAbove ? 'top' : 'bottom',
        width: popupWidth,
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [componentRows.length, isOpen])

  const handleAnchorEnter = () => {
    setIsAnchorHovered(true)
    setIsDismissed(false)
  }

  const popup = isOpen && popupPosition && typeof document !== 'undefined'
    ? createPortal(
      <div
        className="z-[120] rounded-sm border border-border bg-background/96 p-3 text-[11px] shadow-[0_12px_32px_rgba(0,0,0,0.34)] backdrop-blur-sm"
        style={{
          position: 'fixed',
          top: popupPosition.top,
          left: popupPosition.left,
          width: popupPosition.width,
          transform: popupPosition.placement === 'top' ? 'translateY(-100%)' : undefined,
        }}
        onMouseEnter={() => {
          setIsPopupHovered(true)
          setIsDismissed(false)
        }}
        onMouseLeave={() => setIsPopupHovered(false)}
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
          {componentRows.length > 0 ? componentRows.map(({ key, label, score }) => (
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
          )) : (
            <div className="flex items-start justify-between gap-2 leading-4">
              <span className="text-muted-foreground">pHash</span>
              <span className="text-right text-foreground">유사 {formatSimilarityValue(item.similarity)} · 거리 {item.hammingDistance}</span>
            </div>
          )}
        </div>
      </div>,
      document.body,
    )
    : null

  return (
    <div className="flex justify-start">
      <div
        ref={anchorRef}
        className="relative max-w-full"
        onMouseEnter={handleAnchorEnter}
        onMouseLeave={() => setIsAnchorHovered(false)}
        onClick={(event) => event.stopPropagation()}
      >
        <Badge
          variant="secondary"
          className={cn(
            'max-w-full shadow-sm backdrop-blur-sm tracking-normal normal-case',
            getSimilarityBadgeClassName(item.similarity),
          )}
          onMouseEnter={handleAnchorEnter}
          onMouseMove={() => {
            if (isDismissed) {
              setIsDismissed(false)
            }
          }}
          onClick={(event) => event.stopPropagation()}
        >
          {formatSimilarityValue(item.similarity)}
        </Badge>

        {popup}
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
      <div className="inline-flex items-center gap-0.5 rounded-sm border border-border bg-surface-container p-0.5 shadow-sm">
        {SIMILAR_IMAGE_TABS.map((tab) => {
          const Icon = SIMILAR_IMAGE_TAB_ICONS[tab]

          return (
            <Button
              key={tab}
              size="icon-sm"
              variant="ghost"
              onClick={() => handleSelectSimilarImageTab(tab)}
              className={cn(
                activeSimilarImageTab === tab ? 'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
              aria-label={SIMILAR_IMAGE_SECTION_TITLE_LABELS[tab]}
              title={SIMILAR_IMAGE_SECTION_TITLE_LABELS[tab]}
            >
              <Icon className="h-4 w-4" />
            </Button>
          )
        })}
      </div>

      {activeSimilarImageTab === 'image' ? (
        <div className="shrink-0">
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
        </div>
      ) : null}

      {activeSimilarImageTab === 'text' ? (
        <div className="shrink-0">
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
        </div>
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
