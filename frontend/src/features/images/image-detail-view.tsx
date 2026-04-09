import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { getAppSettings, getImage, getImageDuplicates, getPromptSimilarImages, getSimilarImages, updateSimilaritySettings } from '@/lib/api'
import { useMinWidth } from '@/lib/use-min-width'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import type { SimilarImage } from '@/types/similarity'
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

const SIMILARITY_COMPONENT_LABELS = {
  perceptualHash: 'pHash',
  dHash: 'dHash',
  aHash: 'aHash',
  color: '색상',
} as const

function formatSimilarityValue(value?: number) {
  return typeof value === 'number' ? value.toFixed(1) : '—'
}

function getSimilarityBadgeClassName(similarity: number) {
  if (similarity >= 92) return 'border border-emerald-300/45 bg-emerald-500/88 text-white'
  if (similarity >= 82) return 'border border-sky-300/45 bg-sky-500/88 text-white'
  if (similarity >= 68) return 'border border-violet-300/45 bg-violet-500/88 text-white'
  if (similarity >= 52) return 'border border-amber-200/50 bg-amber-500/88 text-black'
  return 'border border-rose-300/45 bg-rose-500/88 text-white'
}

function SimilarImageScoreOverlay({ item }: { item: SimilarImage }) {
  const [isHovering, setIsHovering] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)
  const componentRows = [
    item.componentScores?.perceptualHash ? { key: 'perceptualHash', label: SIMILARITY_COMPONENT_LABELS.perceptualHash, score: item.componentScores.perceptualHash } : null,
    item.componentScores?.dHash ? { key: 'dHash', label: SIMILARITY_COMPONENT_LABELS.dHash, score: item.componentScores.dHash } : null,
    item.componentScores?.aHash ? { key: 'aHash', label: SIMILARITY_COMPONENT_LABELS.aHash, score: item.componentScores.aHash } : null,
    item.componentScores?.color ? { key: 'color', label: SIMILARITY_COMPONENT_LABELS.color, score: item.componentScores.color } : null,
  ].filter((row): row is NonNullable<typeof row> => Boolean(row))
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
      effectiveSimilaritySettings?.detailSimilarWeights?.perceptualHash ?? 50,
      effectiveSimilaritySettings?.detailSimilarWeights?.dHash ?? 30,
      effectiveSimilaritySettings?.detailSimilarWeights?.aHash ?? 20,
      effectiveSimilaritySettings?.detailSimilarWeights?.color ?? 0,
      effectiveSimilaritySettings?.detailSimilarThresholds?.perceptualHash ?? 15,
      effectiveSimilaritySettings?.detailSimilarThresholds?.dHash ?? 18,
      effectiveSimilaritySettings?.detailSimilarThresholds?.aHash ?? 20,
      effectiveSimilaritySettings?.detailSimilarThresholds?.color ?? 0,
      effectiveSimilaritySettings?.detailSimilarUseMetadataFilter ?? false,
      'similarity',
      'DESC',
    ],
    queryFn: () =>
      getSimilarImages(compositeHash, {
        threshold: effectiveSimilaritySettings?.detailSimilarThreshold ?? 15,
        limit: effectiveSimilaritySettings?.detailSimilarLimit ?? 24,
        includeColorSimilarity: effectiveSimilaritySettings?.detailSimilarIncludeColorSimilarity ?? false,
        perceptualWeight: effectiveSimilaritySettings?.detailSimilarWeights?.perceptualHash ?? 50,
        dHashWeight: effectiveSimilaritySettings?.detailSimilarWeights?.dHash ?? 30,
        aHashWeight: effectiveSimilaritySettings?.detailSimilarWeights?.aHash ?? 20,
        colorWeight: effectiveSimilaritySettings?.detailSimilarWeights?.color ?? 0,
        perceptualThreshold: effectiveSimilaritySettings?.detailSimilarThresholds?.perceptualHash ?? 15,
        dHashThreshold: effectiveSimilaritySettings?.detailSimilarThresholds?.dHash ?? 18,
        aHashThreshold: effectiveSimilaritySettings?.detailSimilarThresholds?.aHash ?? 20,
        colorThreshold: effectiveSimilaritySettings?.detailSimilarThresholds?.color ?? 0,
        useMetadataFilter: effectiveSimilaritySettings?.detailSimilarUseMetadataFilter ?? false,
        sortBy: 'similarity',
        sortOrder: 'DESC',
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

  const similarImageItems = useMemo(
    () =>
      (similarQuery.data?.similar ?? []).filter((item) => {
        const compositeHash = item.image.composite_hash
        return typeof compositeHash === 'string' && compositeHash.length > 0 && !duplicateHashSet.has(compositeHash)
      }),
    [duplicateHashSet, similarQuery.data?.similar],
  )

  const similarImages = useMemo(
    () => getValidImageRecords(similarImageItems.map((item) => item.image)),
    [similarImageItems],
  )

  const similarImageItemByHash = useMemo(
    () => new Map(similarImageItems.map((item) => [String(item.image.composite_hash), item])),
    [similarImageItems],
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
      detailSimilarWeights: similarity.detailSimilarWeights,
      detailSimilarThresholds: similarity.detailSimilarThresholds,
      detailSimilarUseMetadataFilter: similarity.detailSimilarUseMetadataFilter,
      detailSimilarSortBy: 'similarity',
      detailSimilarSortOrder: 'DESC',
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

    const nextThresholds = {
      perceptualHash: Math.max(0, Math.min(64, Math.round(similarityDraft.detailSimilarThresholds.perceptualHash))),
      dHash: Math.max(0, Math.min(64, Math.round(similarityDraft.detailSimilarThresholds.dHash))),
      aHash: Math.max(0, Math.min(64, Math.round(similarityDraft.detailSimilarThresholds.aHash))),
      color: Math.max(0, Math.min(100, Math.round(similarityDraft.detailSimilarThresholds.color))),
    }

    const nextWeights = {
      perceptualHash: Math.max(0, Math.min(100, Math.round(similarityDraft.detailSimilarWeights.perceptualHash))),
      dHash: Math.max(0, Math.min(100, Math.round(similarityDraft.detailSimilarWeights.dHash))),
      aHash: Math.max(0, Math.min(100, Math.round(similarityDraft.detailSimilarWeights.aHash))),
      color: Math.max(0, Math.min(100, Math.round(similarityDraft.detailSimilarWeights.color))),
    }

    saveSimilaritySettingsMutation.mutate({
      detailSimilarThreshold: nextThresholds.perceptualHash,
      detailSimilarLimit: Math.max(1, Math.min(100, Math.round(similarityDraft.detailSimilarLimit))),
      detailSimilarIncludeColorSimilarity: nextWeights.color > 0,
      detailSimilarWeights: nextWeights,
      detailSimilarThresholds: nextThresholds,
      detailSimilarUseMetadataFilter: similarityDraft.detailSimilarUseMetadataFilter,
      detailSimilarSortBy: 'similarity',
      detailSimilarSortOrder: 'DESC',
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

  const renderSimilarImageOverlay = (image: ImageRecord) => {
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
              renderItemPersistentOverlay={activeSimilarImageTab === 'image' ? renderSimilarImageOverlay : undefined}
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
