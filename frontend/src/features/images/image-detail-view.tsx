import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { getAppSettings, getImage, getImageDuplicates, getPromptSimilarImages, getSimilarImages } from '@/lib/api'
import { useMinWidth } from '@/lib/use-min-width'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import type { SimilarImage } from '@/types/similarity'
import { ImageDetailMedia } from './components/detail/image-detail-media'
import { ImageDetailMetaCard } from './components/detail/image-detail-meta-card'
import { ImageDetailSimilaritySection } from './components/detail/image-detail-similarity-section'
import { SimilarImageScoreOverlay } from './components/detail/similarity-score-overlay'
import {
  getDownloadName,
  getImageDetailDownloadUrl,
  getImageDetailRenderUrl,
  getValidImageRecords,
  normalizeSimilarityResultRows,
  resolveSimilarityResultLimit,
} from './components/detail/image-detail-utils'
import { RelatedImageGallerySection } from './components/detail/related-image-gallery-section'

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

/** Read an API error into the localized fallback message already used in the detail page. */
function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

/** Render the shared image detail body so page and modal presentations stay aligned. */
export function ImageDetailView({ compositeHash, presentation = 'page', renderHeader }: ImageDetailViewProps) {
  const useSplitPaneScroll = presentation === 'modal' && useMinWidth(1280)
  const usesDesktopRelatedImageColumns = useMinWidth(768)
  const [isModalSecondaryContentReady, setIsModalSecondaryContentReady] = useState(presentation !== 'modal')

  useEffect(() => {
    if (presentation === 'page') {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
    }
  }, [compositeHash, presentation])

  useEffect(() => {
    if (presentation !== 'modal') {
      setIsModalSecondaryContentReady(true)
      return
    }

    setIsModalSecondaryContentReady(false)
    const timerId = window.setTimeout(() => {
      setIsModalSecondaryContentReady(true)
    }, 120)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [compositeHash, presentation])

  const settingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
  })

  const effectiveSimilaritySettings = settingsQuery.data?.similarity
  const effectiveAppearanceSettings = settingsQuery.data?.appearance

  const relatedImageMobileColumns = effectiveAppearanceSettings?.detailRelatedImageMobileColumns ?? 1
  const relatedImageDesktopColumns = effectiveAppearanceSettings?.detailRelatedImageColumns ?? 3
  const relatedImageAspectRatio = effectiveAppearanceSettings?.detailRelatedImageAspectRatio ?? 'square'
  const activeRelatedImageColumns = usesDesktopRelatedImageColumns ? relatedImageDesktopColumns : relatedImageMobileColumns
  const detailSimilarRows = normalizeSimilarityResultRows(effectiveSimilaritySettings?.detailSimilarLimit)
  const promptSimilarRows = normalizeSimilarityResultRows(effectiveSimilaritySettings?.promptSimilarity?.resultLimit)
  const detailSimilarLimit = resolveSimilarityResultLimit(detailSimilarRows, activeRelatedImageColumns)
  const promptSimilarLimit = resolveSimilarityResultLimit(promptSimilarRows, activeRelatedImageColumns)

  const imageQuery = useQuery({
    queryKey: ['image-detail', compositeHash],
    queryFn: () => getImage(compositeHash),
    enabled: Boolean(compositeHash),
  })

  const duplicatesQuery = useQuery({
    queryKey: ['image-duplicates', compositeHash],
    queryFn: () => getImageDuplicates(compositeHash, 5),
    enabled: Boolean(compositeHash) && (presentation !== 'modal' || isModalSecondaryContentReady),
  })

  const similarQuery = useQuery({
    queryKey: [
      'image-similar',
      compositeHash,
      effectiveSimilaritySettings?.detailSimilarThreshold ?? 15,
      detailSimilarRows,
      detailSimilarLimit,
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
        limit: detailSimilarLimit,
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
    enabled: Boolean(compositeHash) && Boolean(effectiveSimilaritySettings) && (presentation !== 'modal' || isModalSecondaryContentReady),
  })

  const promptSimilarQuery = useQuery({
    queryKey: [
      'image-prompt-similar',
      compositeHash,
      effectiveSimilaritySettings?.promptSimilarity?.enabled ?? true,
      effectiveSimilaritySettings?.promptSimilarity?.algorithm ?? 'simhash',
      effectiveSimilaritySettings?.promptSimilarity?.combinedThreshold ?? 50,
      promptSimilarRows,
      promptSimilarLimit,
      effectiveSimilaritySettings?.promptSimilarity?.weights?.positive ?? 1,
      effectiveSimilaritySettings?.promptSimilarity?.weights?.negative ?? 0,
      effectiveSimilaritySettings?.promptSimilarity?.weights?.auto ?? 0,
      effectiveSimilaritySettings?.promptSimilarity?.fieldThresholds?.positive ?? 50,
      effectiveSimilaritySettings?.promptSimilarity?.fieldThresholds?.negative ?? 50,
      effectiveSimilaritySettings?.promptSimilarity?.fieldThresholds?.auto ?? 50,
    ],
    queryFn: () => getPromptSimilarImages(compositeHash, promptSimilarLimit),
    enabled: Boolean(compositeHash) && Boolean(effectiveSimilaritySettings) && (presentation !== 'modal' || isModalSecondaryContentReady),
  })

  const image = imageQuery.data
  const renderUrl = getImageDetailRenderUrl(image)
  const downloadUrl = getImageDetailDownloadUrl(image)
  const downloadName = getDownloadName(image?.original_file_path, image?.composite_hash)

  const duplicateImageItems = duplicatesQuery.data?.similar ?? []

  const duplicateImages = useMemo(
    () => getValidImageRecords(duplicateImageItems.map((item) => item.image)),
    [duplicateImageItems],
  )

  const duplicateImageItemByHash = useMemo(
    () => new Map(duplicateImageItems.map((item) => [String(item.image.composite_hash), item] satisfies [string, SimilarImage])),
    [duplicateImageItems],
  )

  const duplicateHashSet = useMemo(() => new Set(duplicateImages.map((item) => item.composite_hash as string)), [duplicateImages])

  const similarImageItems = useMemo(
    () =>
      (similarQuery.data?.similar ?? []).filter((item) => {
        const similarCompositeHash = item.image.composite_hash
        return typeof similarCompositeHash === 'string' && similarCompositeHash.length > 0 && !duplicateHashSet.has(similarCompositeHash)
      }),
    [duplicateHashSet, similarQuery.data?.similar],
  )

  const promptSimilarImageItems = useMemo(
    () =>
      (promptSimilarQuery.data?.items ?? []).filter((item) => {
        const compositeHash = item.image.composite_hash
        return typeof compositeHash === 'string' && compositeHash.length > 0 && !duplicateHashSet.has(compositeHash)
      }),
    [duplicateHashSet, promptSimilarQuery.data?.items],
  )

  const promptSimilarImages = useMemo(
    () => getValidImageRecords(promptSimilarImageItems.map((item) => item.image)),
    [promptSimilarImageItems],
  )

  const renderDuplicateImageOverlay = (duplicateImage: ImageRecord): ReactNode => {
    const compositeHash = duplicateImage.composite_hash
    if (typeof compositeHash !== 'string' || compositeHash.length === 0) {
      return null
    }

    const item = duplicateImageItemByHash.get(compositeHash)
    return item ? <SimilarImageScoreOverlay item={item} /> : null
  }

  const headerControls: ImageDetailViewHeaderControls = {
    downloadName,
    downloadUrl,
    image,
    isRefreshing: imageQuery.isFetching,
    refresh: () => {
      void imageQuery.refetch()
    },
  }

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

            {presentation !== 'modal' || isModalSecondaryContentReady ? (
              <>
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
                    renderItemPersistentOverlay={renderDuplicateImageOverlay}
                  />
                ) : null}

                <ImageDetailSimilaritySection
                  presentation={presentation}
                  currentSimilaritySettings={effectiveSimilaritySettings}
                  similarImageItems={similarImageItems}
                  similarImagesLoading={similarQuery.isLoading || settingsQuery.isLoading}
                  similarImagesError={similarQuery.isError ? similarQuery.error : null}
                  promptSimilarImageItems={promptSimilarImageItems}
                  promptSimilarImages={promptSimilarImages}
                  promptSimilarImagesLoading={promptSimilarQuery.isLoading || settingsQuery.isLoading}
                  promptSimilarImagesError={promptSimilarQuery.isError ? promptSimilarQuery.error : null}
                  mobileCardColumns={relatedImageMobileColumns}
                  desktopCardColumns={relatedImageDesktopColumns}
                  cardAspectRatio={relatedImageAspectRatio}
                />
              </>
            ) : null}
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
