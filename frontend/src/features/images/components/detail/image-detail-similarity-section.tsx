import { useMemo, useState, type ReactNode } from 'react'
import { Image as ImageIcon, Type, type LucideIcon } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { updateSimilaritySettings } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import type { PromptSimilarImage, SimilarImage } from '@/types/similarity'
import type { RelatedImageCardAspectRatio, SimilaritySettings } from '@/types/settings'
import {
  getValidImageRecords,
  normalizeSimilarityResultRows,
  type PromptSimilaritySettingsDraft,
  type SimilaritySettingsDraft,
} from './image-detail-utils'
import { PromptSimilaritySettingsPanel } from './prompt-similarity-settings-panel'
import { RelatedImageGallerySection } from './related-image-gallery-section'
import { PromptSimilarImageScoreOverlay, SimilarImageScoreOverlay } from './similarity-score-overlay'
import { SimilaritySettingsPanel } from './similarity-settings-panel'

interface ImageDetailSimilaritySectionProps {
  presentation: 'page' | 'modal'
  currentSimilaritySettings?: SimilaritySettings
  canEditSettings?: boolean
  similarImageItems: SimilarImage[]
  similarImagesLoading: boolean
  similarImagesError: unknown
  promptSimilarImageItems: PromptSimilarImage[]
  promptSimilarImages: ImageRecord[]
  promptSimilarImagesLoading: boolean
  promptSimilarImagesError: unknown
  mobileCardColumns?: number
  desktopCardColumns?: number
  cardAspectRatio?: RelatedImageCardAspectRatio
}

type SimilarImageTab = 'image' | 'text'


const SIMILAR_IMAGE_TABS: SimilarImageTab[] = ['image', 'text']

const SIMILAR_IMAGE_SECTION_TITLE_LABELS: Record<SimilarImageTab, string> = {
  image: '유사 이미지 [이미지]',
  text: '유사 이미지 [텍스트]',
}

const SIMILAR_IMAGE_TAB_ICONS: Record<SimilarImageTab, LucideIcon> = {
  image: ImageIcon,
  text: Type,
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
function clampPromptSimilarityWeight(value: number | undefined, fallback = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return Math.max(0, Math.min(1, Math.round(value * 100) / 100))
}

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
      positive: clampPromptSimilarityWeight(promptSimilarity.weights.positive),
      negative: clampPromptSimilarityWeight(promptSimilarity.weights.negative),
      auto: clampPromptSimilarityWeight(promptSimilarity.weights.auto),
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
      positive: clampPromptSimilarityWeight(Number(draft.weights.positive)),
      negative: clampPromptSimilarityWeight(Number(draft.weights.negative)),
      auto: clampPromptSimilarityWeight(Number(draft.weights.auto)),
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


/** Render the similarity gallery area, including tabs, flyouts, and score overlays. */
export function ImageDetailSimilaritySection({
  presentation,
  currentSimilaritySettings,
  canEditSettings = false,
  similarImageItems,
  similarImagesLoading,
  similarImagesError,
  promptSimilarImageItems,
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
      queryClient.setQueryData(['runtime-similarity-settings'], settings.similarity)
      queryClient.invalidateQueries({ queryKey: ['runtime-similarity-settings'] })
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
      queryClient.setQueryData(['runtime-similarity-settings'], settings.similarity)
      queryClient.invalidateQueries({ queryKey: ['runtime-similarity-settings'] })
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

  const promptSimilarImageItemByHash = useMemo(
    () => new Map(promptSimilarImageItems.map((item) => [String(item.image.composite_hash), item])),
    [promptSimilarImageItems],
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

  /** Render a prompt-similarity badge using the same shared overlay shell as image similarity. */
  const renderPromptSimilarImageOverlay = (image: ImageRecord): ReactNode => {
    const compositeHash = image.composite_hash
    if (typeof compositeHash !== 'string' || compositeHash.length === 0) {
      return null
    }

    const item = promptSimilarImageItemByHash.get(compositeHash)
    return item ? <PromptSimilarImageScoreOverlay item={item} /> : null
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

      {canEditSettings && activeSimilarImageTab === 'image' ? (
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

      {canEditSettings && activeSimilarImageTab === 'text' ? (
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
      renderItemPersistentOverlay={activeSimilarImageTab === 'image' ? renderSimilarImageOverlay : renderPromptSimilarImageOverlay}
    />
  )
}
