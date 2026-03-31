import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { getAppSettings, getImage, getImageDuplicates, getPromptSimilarImages, getSimilarImages, updateSimilaritySettings } from '@/lib/api'
import { useMinWidth } from '@/lib/use-min-width'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import { ImageDetailMedia } from './components/detail/image-detail-media'
import { ImageDetailMetaCard } from './components/detail/image-detail-meta-card'
import {
  getDownloadName,
  getImageDetailDownloadUrl,
  getImageDetailRenderUrl,
  getValidImageRecords,
  type PromptSimilaritySettingsDraft,
  type SimilaritySettingsDraft,
} from './components/detail/image-detail-utils'
import { PromptSimilaritySettingsPanel } from './components/detail/prompt-similarity-settings-panel'
import { RelatedImageGallerySection } from './components/detail/related-image-gallery-section'
import { SimilaritySettingsPanel } from './components/detail/similarity-settings-panel'

export interface ImageDetailViewHeaderControls {
  downloadName: string
  downloadUrl: string | null
  image: ImageRecord | undefined
  isRefreshing: boolean
  refresh: () => void
}

interface ImageDetailViewProps {
  compositeHash: string
  presentation?: 'page' | 'modal'
  renderHeader?: (controls: ImageDetailViewHeaderControls) => ReactNode
}

type SimilarImageTab = 'image' | 'text'

const SIMILAR_IMAGE_SECTION_TITLE_LABELS: Record<SimilarImageTab, string> = {
  image: '유사 이미지 [이미지]',
  text: '유사 이미지 [텍스트]',
}

const SIMILAR_IMAGE_TAB_BUTTON_LABELS: Record<SimilarImageTab, string> = {
  image: '이미지',
  text: '텍스트',
}

/** Render the shared image detail body so page and modal presentations stay aligned. */
export function ImageDetailView({ compositeHash, presentation = 'page', renderHeader }: ImageDetailViewProps) {
  const queryClient = useQueryClient()
  const [activeSimilarImageTab, setActiveSimilarImageTab] = useState<SimilarImageTab>('image')
  const [isSimilaritySettingsOpen, setIsSimilaritySettingsOpen] = useState(false)
  const [isPromptSimilaritySettingsOpen, setIsPromptSimilaritySettingsOpen] = useState(false)
  const [similarityDraft, setSimilarityDraft] = useState<SimilaritySettingsDraft | null>(null)
  const [promptSimilarityDraft, setPromptSimilarityDraft] = useState<PromptSimilaritySettingsDraft | null>(null)
  const useSplitPaneScroll = presentation === 'modal' && useMinWidth(1280)

  useEffect(() => {
    if (presentation === 'page') {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
    }
  }, [compositeHash, presentation])

  const settingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
  })

  const effectiveSimilaritySettings = settingsQuery.data?.similarity
  const effectiveAppearanceSettings = settingsQuery.data?.appearance

  const imageQuery = useQuery({
    queryKey: ['image-detail', compositeHash],
    queryFn: () => getImage(compositeHash),
    enabled: Boolean(compositeHash),
  })

  const duplicatesQuery = useQuery({
    queryKey: ['image-duplicates', compositeHash],
    queryFn: () => getImageDuplicates(compositeHash, 5),
    enabled: Boolean(compositeHash),
  })

  const similarQuery = useQuery({
    queryKey: [
      'image-similar',
      compositeHash,
      effectiveSimilaritySettings?.detailSimilarThreshold ?? 15,
      effectiveSimilaritySettings?.detailSimilarLimit ?? 24,
      effectiveSimilaritySettings?.detailSimilarIncludeColorSimilarity ?? false,
      effectiveSimilaritySettings?.detailSimilarSortBy ?? 'similarity',
      effectiveSimilaritySettings?.detailSimilarSortOrder ?? 'DESC',
    ],
    queryFn: () =>
      getSimilarImages(compositeHash, {
        threshold: effectiveSimilaritySettings?.detailSimilarThreshold ?? 15,
        limit: effectiveSimilaritySettings?.detailSimilarLimit ?? 24,
        includeColorSimilarity: effectiveSimilaritySettings?.detailSimilarIncludeColorSimilarity ?? false,
        sortBy: effectiveSimilaritySettings?.detailSimilarSortBy ?? 'similarity',
        sortOrder: effectiveSimilaritySettings?.detailSimilarSortOrder ?? 'DESC',
      }),
    enabled: Boolean(compositeHash) && Boolean(effectiveSimilaritySettings),
  })

  const promptSimilarQuery = useQuery({
    queryKey: [
      'image-prompt-similar',
      compositeHash,
      effectiveSimilaritySettings?.promptSimilarity?.enabled ?? true,
      effectiveSimilaritySettings?.promptSimilarity?.algorithm ?? 'simhash',
      effectiveSimilaritySettings?.promptSimilarity?.combinedThreshold ?? 50,
      effectiveSimilaritySettings?.promptSimilarity?.resultLimit ?? 60,
      effectiveSimilaritySettings?.promptSimilarity?.weights?.positive ?? 1,
      effectiveSimilaritySettings?.promptSimilarity?.weights?.negative ?? 0,
      effectiveSimilaritySettings?.promptSimilarity?.weights?.auto ?? 0,
      effectiveSimilaritySettings?.promptSimilarity?.fieldThresholds?.positive ?? 50,
      effectiveSimilaritySettings?.promptSimilarity?.fieldThresholds?.negative ?? 50,
      effectiveSimilaritySettings?.promptSimilarity?.fieldThresholds?.auto ?? 50,
    ],
    queryFn: () => getPromptSimilarImages(compositeHash),
    enabled: Boolean(compositeHash) && Boolean(effectiveSimilaritySettings),
  })

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

  const image = imageQuery.data
  const renderUrl = getImageDetailRenderUrl(image)
  const downloadUrl = getImageDetailDownloadUrl(image)
  const downloadName = getDownloadName(image?.original_file_path, image?.composite_hash)

  const duplicateImages = useMemo(
    () => getValidImageRecords((duplicatesQuery.data?.similar ?? []).map((item) => item.image)),
    [duplicatesQuery.data?.similar],
  )

  const duplicateHashSet = useMemo(() => new Set(duplicateImages.map((item) => item.composite_hash as string)), [duplicateImages])

  const similarImages = useMemo(
    () =>
      getValidImageRecords((similarQuery.data?.similar ?? []).map((item) => item.image)).filter(
        (item) => !duplicateHashSet.has(item.composite_hash as string),
      ),
    [duplicateHashSet, similarQuery.data?.similar],
  )

  const promptSimilarImages = useMemo(
    () =>
      getValidImageRecords((promptSimilarQuery.data?.items ?? []).map((item) => item.image)).filter(
        (item) => !duplicateHashSet.has(item.composite_hash as string),
      ),
    [duplicateHashSet, promptSimilarQuery.data?.items],
  )

  const handleToggleSimilaritySettings = () => {
    if (isSimilaritySettingsOpen) {
      setIsSimilaritySettingsOpen(false)
      return
    }

    const similarity = settingsQuery.data?.similarity
    if (!similarity) {
      return
    }

    setSimilarityDraft({
      detailSimilarThreshold: similarity.detailSimilarThreshold,
      detailSimilarLimit: similarity.detailSimilarLimit,
      detailSimilarIncludeColorSimilarity: similarity.detailSimilarIncludeColorSimilarity,
      detailSimilarSortBy: similarity.detailSimilarSortBy,
      detailSimilarSortOrder: similarity.detailSimilarSortOrder,
    })
    setIsPromptSimilaritySettingsOpen(false)
    setIsSimilaritySettingsOpen(true)
  }

  const handleTogglePromptSimilaritySettings = () => {
    if (isPromptSimilaritySettingsOpen) {
      setIsPromptSimilaritySettingsOpen(false)
      return
    }

    const promptSimilarity = settingsQuery.data?.similarity?.promptSimilarity
    if (!promptSimilarity) {
      return
    }

    setPromptSimilarityDraft({
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
    })
    setIsSimilaritySettingsOpen(false)
    setIsPromptSimilaritySettingsOpen(true)
  }

  const handleApplySimilaritySettings = () => {
    if (!similarityDraft || saveSimilaritySettingsMutation.isPending) {
      return
    }

    saveSimilaritySettingsMutation.mutate({
      detailSimilarThreshold: Math.max(1, Math.min(64, Math.round(similarityDraft.detailSimilarThreshold))),
      detailSimilarLimit: Math.max(1, Math.min(100, Math.round(similarityDraft.detailSimilarLimit))),
      detailSimilarIncludeColorSimilarity: similarityDraft.detailSimilarIncludeColorSimilarity,
      detailSimilarSortBy: similarityDraft.detailSimilarSortBy,
      detailSimilarSortOrder: similarityDraft.detailSimilarSortOrder,
    })
  }

  const handlePatchSimilarityDraft = (patch: Partial<SimilaritySettingsDraft>) => {
    setSimilarityDraft((current) => (current ? { ...current, ...patch } : current))
  }

  const handleApplyPromptSimilaritySettings = () => {
    if (!promptSimilarityDraft || savePromptSimilaritySettingsMutation.isPending) {
      return
    }

    savePromptSimilaritySettingsMutation.mutate({
      resultLimit: Math.max(1, Math.min(100, Math.round(promptSimilarityDraft.resultLimit))),
      combinedThreshold: Math.max(0, Math.min(100, Math.round(promptSimilarityDraft.combinedThreshold))),
      weights: {
        positive: Math.max(0, Math.min(100, Number(promptSimilarityDraft.weights.positive))),
        negative: Math.max(0, Math.min(100, Number(promptSimilarityDraft.weights.negative))),
        auto: Math.max(0, Math.min(100, Number(promptSimilarityDraft.weights.auto))),
      },
      fieldThresholds: {
        positive: Math.max(0, Math.min(100, Math.round(promptSimilarityDraft.fieldThresholds.positive))),
        negative: Math.max(0, Math.min(100, Math.round(promptSimilarityDraft.fieldThresholds.negative))),
        auto: Math.max(0, Math.min(100, Math.round(promptSimilarityDraft.fieldThresholds.auto))),
      },
    })
  }

  const handlePatchPromptSimilarityDraft = (patch: Partial<PromptSimilaritySettingsDraft>) => {
    setPromptSimilarityDraft((current) => (current ? { ...current, ...patch } : current))
  }

  const getErrorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

  const relatedImageMobileColumns = effectiveAppearanceSettings?.detailRelatedImageMobileColumns ?? 1
  const relatedImageDesktopColumns = effectiveAppearanceSettings?.detailRelatedImageColumns ?? 3
  const relatedImageAspectRatio = effectiveAppearanceSettings?.detailRelatedImageAspectRatio ?? 'square'

  const similarSectionTitle = SIMILAR_IMAGE_SECTION_TITLE_LABELS[activeSimilarImageTab]
  const similarSectionItems = activeSimilarImageTab === 'image' ? similarImages : promptSimilarImages
  const similarSectionIsLoading = activeSimilarImageTab === 'image'
    ? similarQuery.isLoading || settingsQuery.isLoading
    : promptSimilarQuery.isLoading || settingsQuery.isLoading
  const similarSectionErrorMessage = activeSimilarImageTab === 'image'
    ? (similarQuery.isError ? getErrorMessage(similarQuery.error, '알 수 없는 오류가 발생했어.') : null)
    : (promptSimilarQuery.isError ? getErrorMessage(promptSimilarQuery.error, '알 수 없는 오류가 발생했어.') : null)
  const similarSectionEmptyMessage = activeSimilarImageTab === 'image'
    ? '현재 설정에서는 표시할 유사 이미지가 없어.'
    : '현재 텍스트 기준에서는 표시할 유사 이미지가 없어.'

  const headerControls: ImageDetailViewHeaderControls = {
    downloadName,
    downloadUrl,
    image,
    isRefreshing: imageQuery.isFetching,
    refresh: () => {
      void imageQuery.refetch()
    },
  }

  const similarSectionActions = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <div className="inline-flex items-center rounded-sm border border-border bg-surface-container p-1">
        {(['image', 'text'] as SimilarImageTab[]).map((tab) => (
          <Button
            key={tab}
            size="sm"
            variant="ghost"
            onClick={() => {
              setActiveSimilarImageTab(tab)
              if (tab !== 'image') {
                setIsSimilaritySettingsOpen(false)
              }
              if (tab !== 'text') {
                setIsPromptSimilaritySettingsOpen(false)
              }
            }}
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

  const detailShellClassName = presentation === 'modal'
    ? 'xl:h-full'
    : 'xl:h-[calc(100vh-var(--theme-shell-header-height)-1.5rem-var(--theme-shell-main-padding-bottom))]'

  const detailGridClassName = cn(
    'grid gap-8 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]',
    presentation === 'page' ? 'bg-background xl:items-start' : 'xl:h-full xl:items-stretch',
  )

  return (
    <div className={cn('space-y-8 xl:flex xl:min-h-0 xl:flex-col xl:space-y-0', detailShellClassName)}>
      {renderHeader ? <div className="xl:pb-6">{renderHeader(headerControls)}</div> : null}

      {imageQuery.isLoading ? (
        <div className={detailGridClassName}>
          <div className="space-y-8">
            <Skeleton className="min-h-[540px] w-full rounded-sm" />
            <div className="grid gap-4 md:grid-cols-2">
              <Skeleton className="h-[220px] w-full rounded-sm" />
              <Skeleton className="h-[220px] w-full rounded-sm" />
            </div>
          </div>
          <div className="space-y-3">
            <Skeleton className="h-16 w-full rounded-sm" />
            <Skeleton className="h-16 w-full rounded-sm" />
            <Skeleton className="h-16 w-full rounded-sm" />
          </div>
        </div>
      ) : null}

      {imageQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>이미지 상세를 불러오지 못했어</AlertTitle>
          <AlertDescription>{getErrorMessage(imageQuery.error, '알 수 없는 오류가 발생했어.')}</AlertDescription>
        </Alert>
      ) : null}

      {!imageQuery.isLoading && !imageQuery.isError && image ? (
        <div className={detailGridClassName}>
          <div
            className={cn(
              'space-y-8',
              useSplitPaneScroll && 'xl:min-h-0 xl:overflow-y-auto xl:pr-2 image-detail-scroll-pane',
            )}
          >
            <div className="overflow-hidden rounded-sm bg-surface-container shadow-[0_0_40px_rgba(14,14,14,0.22)]">
              <div className="flex min-h-[540px] items-center justify-center bg-surface-lowest">
                <ImageDetailMedia image={image as ImageRecord} renderUrl={renderUrl} />
              </div>
            </div>

            {duplicateImages.length > 0 ? (
              <RelatedImageGallerySection
                title="중복 이미지"
                items={duplicateImages}
                isLoading={false}
                errorMessage={null}
                emptyMessage="현재 중복 이미지가 없어."
                activationMode={presentation === 'modal' ? 'modal' : 'navigate'}
                mobileCardColumns={relatedImageMobileColumns}
                desktopCardColumns={relatedImageDesktopColumns}
                cardAspectRatio={relatedImageAspectRatio}
              />
            ) : null}

            <RelatedImageGallerySection
              title={similarSectionTitle}
              items={similarSectionItems}
              isLoading={similarSectionIsLoading}
              errorMessage={similarSectionErrorMessage}
              emptyMessage={similarSectionEmptyMessage}
              actions={similarSectionActions}
              activationMode={presentation === 'modal' ? 'modal' : 'modal-single'}
              mobileCardColumns={relatedImageMobileColumns}
              desktopCardColumns={relatedImageDesktopColumns}
              cardAspectRatio={relatedImageAspectRatio}
            />
          </div>

          <div
            className={cn(
              useSplitPaneScroll && 'xl:min-h-0 xl:overflow-y-auto xl:pr-2 image-detail-scroll-pane',
            )}
          >
            <ImageDetailMetaCard image={image as ImageRecord} />
          </div>
        </div>
      ) : null}
    </div>
  )
}
