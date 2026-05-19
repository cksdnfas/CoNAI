import { useMemo, useState, type ReactNode } from 'react'
import { ScanSearch } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { updateSimilaritySettings } from '@/lib/api-settings'
import { getErrorMessage } from '@/lib/error-message'
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
  similarImagesRequested?: boolean
  onRequestSimilarImages?: () => void
  promptSimilarImageItems: PromptSimilarImage[]
  promptSimilarImages: ImageRecord[]
  promptSimilarImagesLoading: boolean
  promptSimilarImagesError: unknown
  promptSimilarImagesRequested?: boolean
  onRequestPromptSimilarImages?: () => void
  mobileCardColumns?: number
  desktopCardColumns?: number
  cardAspectRatio?: RelatedImageCardAspectRatio
  hideEmptySections?: boolean
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

/** Render image- and text-similarity sections in the modal's Similar tab. */
export function ImageDetailSimilaritySection({
  presentation,
  currentSimilaritySettings,
  canEditSettings = false,
  similarImageItems,
  similarImagesLoading,
  similarImagesError,
  similarImagesRequested = true,
  onRequestSimilarImages,
  promptSimilarImageItems,
  promptSimilarImages,
  promptSimilarImagesLoading,
  promptSimilarImagesError,
  promptSimilarImagesRequested = true,
  onRequestPromptSimilarImages,
  mobileCardColumns = 1,
  desktopCardColumns = 3,
  cardAspectRatio = 'square',
  hideEmptySections = false,
}: ImageDetailSimilaritySectionProps) {
  const queryClient = useQueryClient()
  const { t } = useI18n()
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

  const imageSimilarityTitle = t('images.components.detail.image.detail.similarity.section.similarity.images.images')
  const promptSimilarityTitle = t('images.components.detail.image.detail.similarity.section.similarity.images.text')
  const imageSimilarityErrorMessage = similarImagesError
    ? getErrorMessage(similarImagesError, t('images.components.detail.image.detail.similarity.section.an.unknown.error.occurred'))
    : null
  const promptSimilarityErrorMessage = promptSimilarImagesError
    ? getErrorMessage(promptSimilarImagesError, t('images.components.detail.image.detail.similarity.section.an.unknown.error.occurred'))
    : null

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

  const imageSimilarityActions = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {!similarImagesRequested && onRequestSimilarImages ? (
        <Button type="button" variant="secondary" size="sm" onClick={onRequestSimilarImages}>
          <ScanSearch className="h-4 w-4" />
          {t({ ko: '유사 이미지 검사', en: 'Check similar images' })}
        </Button>
      ) : null}

      {canEditSettings && currentSimilaritySettings ? (
        <div className="shrink-0">
          <SimilaritySettingsPanel
            isOpen={isSimilaritySettingsOpen}
            draft={similarityDraft}
            isSaving={saveSimilaritySettingsMutation.isPending}
            errorMessage={
              saveSimilaritySettingsMutation.isError
                ? getErrorMessage(saveSimilaritySettingsMutation.error, t('images.components.detail.image.detail.similarity.section.an.error.occurred.while.saving.settings'))
                : null
            }
            onToggle={handleToggleSimilaritySettings}
            onPatchDraft={handlePatchSimilarityDraft}
            onApply={handleApplySimilaritySettings}
          />
        </div>
      ) : null}
    </div>
  )

  const promptSimilarityActions = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {!promptSimilarImagesRequested && onRequestPromptSimilarImages ? (
        <Button type="button" variant="secondary" size="sm" onClick={onRequestPromptSimilarImages}>
          <ScanSearch className="h-4 w-4" />
          {t({ ko: '텍스트 유사 이미지 검사', en: 'Check text-similar images' })}
        </Button>
      ) : null}

      {canEditSettings && currentSimilaritySettings ? (
        <div className="shrink-0">
          <PromptSimilaritySettingsPanel
            isOpen={isPromptSimilaritySettingsOpen}
            draft={promptSimilarityDraft}
            isSaving={savePromptSimilaritySettingsMutation.isPending}
            errorMessage={
              savePromptSimilaritySettingsMutation.isError
                ? getErrorMessage(savePromptSimilaritySettingsMutation.error, t('images.components.detail.image.detail.similarity.section.an.error.occurred.while.saving.settings'))
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

  const shouldShowImageSimilaritySection = similarImagesRequested
    ? similarImagesLoading || Boolean(imageSimilarityErrorMessage) || similarImages.length > 0 || !hideEmptySections
    : Boolean(onRequestSimilarImages)
  const shouldShowPromptSimilaritySection = promptSimilarImagesRequested
    ? promptSimilarImagesLoading || Boolean(promptSimilarityErrorMessage) || promptSimilarImages.length > 0 || !hideEmptySections
    : Boolean(onRequestPromptSimilarImages)
  const sections: ReactNode[] = []

  if (shouldShowImageSimilaritySection) {
    sections.push(
      <RelatedImageGallerySection
        key="image-similarity"
        title={imageSimilarityTitle}
        items={similarImagesRequested ? similarImages : []}
        isLoading={similarImagesRequested ? similarImagesLoading : false}
        errorMessage={similarImagesRequested ? imageSimilarityErrorMessage : null}
        emptyMessage={
          similarImagesRequested
            ? t('images.components.detail.image.detail.similarity.section.no.similar.images.to.show.with.the')
            : t({ ko: '필요할 때만 이미지 기준 유사 검사를 실행해.', en: 'Run image-based similarity only when needed.' })
        }
        actions={imageSimilarityActions}
        activationMode={presentation === 'modal' ? 'modal' : 'modal-single'}
        mobileCardColumns={mobileCardColumns}
        desktopCardColumns={desktopCardColumns}
        cardAspectRatio={cardAspectRatio}
        renderItemPersistentOverlay={renderSimilarImageOverlay}
      />,
    )
  }

  if (shouldShowPromptSimilaritySection) {
    sections.push(
      <RelatedImageGallerySection
        key="prompt-similarity"
        title={promptSimilarityTitle}
        items={promptSimilarImagesRequested ? promptSimilarImages : []}
        isLoading={promptSimilarImagesRequested ? promptSimilarImagesLoading : false}
        errorMessage={promptSimilarImagesRequested ? promptSimilarityErrorMessage : null}
        emptyMessage={
          promptSimilarImagesRequested
            ? t('images.components.detail.image.detail.similarity.section.no.similar.images.to.show.for.the')
            : t({ ko: '필요할 때만 텍스트 기준 유사 검사를 실행해.', en: 'Run text-based similarity only when needed.' })
        }
        actions={promptSimilarityActions}
        activationMode={presentation === 'modal' ? 'modal' : 'modal-single'}
        mobileCardColumns={mobileCardColumns}
        desktopCardColumns={desktopCardColumns}
        cardAspectRatio={cardAspectRatio}
        renderItemPersistentOverlay={renderPromptSimilarImageOverlay}
      />,
    )
  }

  if (sections.length === 0) {
    return null
  }

  return <div className="space-y-6">{sections}</div>
}
