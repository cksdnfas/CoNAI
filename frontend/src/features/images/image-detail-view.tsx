import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { getImage, getImageDuplicates, getPromptSimilarImages, getRuntimeSimilaritySettings, getSimilarImages } from '@/lib/api'
import { getErrorMessage } from '@/lib/error-message'
import { useI18n } from '@/i18n'
import { useGlobalAppearanceSettingsQuery } from '@/lib/use-global-appearance-settings'
import { useMinWidth } from '@/lib/use-min-width'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import type { SimilarImage } from '@/types/similarity'
import { ImageDetailMedia } from './components/detail/image-detail-media'
import { ImageDetailMetaCard } from './components/detail/image-detail-meta-card'
import { ImageDetailSimilaritySection } from './components/detail/image-detail-similarity-section'
import { SimilarImageScoreOverlay } from './components/detail/similarity-score-overlay'
import { getImageListMediaKind } from './components/image-list/image-list-utils'
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

function isImageRecordLike(value: unknown): value is ImageRecord {
  return Boolean(value && typeof value === 'object' && typeof (value as ImageRecord).composite_hash === 'string')
}

function findCachedImageRecord(value: unknown, compositeHash: string, depth = 0): ImageRecord | undefined {
  if (!value || depth > 4) {
    return undefined
  }

  if (isImageRecordLike(value) && value.composite_hash === compositeHash) {
    return value
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findCachedImageRecord(item, compositeHash, depth + 1)
      if (found) return found
    }
    return undefined
  }

  if (typeof value !== 'object') {
    return undefined
  }

  const record = value as Record<string, unknown>
  for (const key of ['images', 'items', 'pages', 'image', 'data']) {
    const found = findCachedImageRecord(record[key], compositeHash, depth + 1)
    if (found) return found
  }

  return undefined
}

interface ImageDetailViewProps {
  compositeHash: string
  presentation?: 'page' | 'modal'
  initialImage?: ImageRecord | null
  renderHeader?: (controls: ImageDetailViewHeaderControls) => ReactNode
}

/** Render the shared image detail body so page and modal presentations stay aligned. */
export function ImageDetailView({ compositeHash, presentation = 'page', initialImage = null, renderHeader }: ImageDetailViewProps) {
  const { t } = useI18n()
  const canUseSplitPaneScroll = useMinWidth(1280)
  const useSplitPaneScroll = presentation === 'modal' && canUseSplitPaneScroll
  const usesDesktopRelatedImageColumns = useMinWidth(768)
  const [isPrimaryMediaReady, setIsPrimaryMediaReady] = useState(false)
  const queryClient = useQueryClient()

  const cachedInitialImage = useMemo(() => {
    if (initialImage?.composite_hash === compositeHash) {
      return initialImage
    }

    const queries = queryClient.getQueryCache().findAll()
    for (const query of queries) {
      const found = findCachedImageRecord(query.state.data, compositeHash)
      if (found) return found
    }

    return undefined
  }, [compositeHash, initialImage, queryClient])

  useEffect(() => {
    if (presentation === 'page') {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
    }
  }, [compositeHash, presentation])

  useEffect(() => {
    setIsPrimaryMediaReady(false)
  }, [compositeHash])

  const authStatusQuery = useAuthStatusQuery()
  const appearanceQuery = useGlobalAppearanceSettingsQuery()

  const runtimeSimilarityQuery = useQuery({
    queryKey: ['runtime-similarity-settings'],
    queryFn: getRuntimeSimilaritySettings,
  })

  const effectiveSimilaritySettings = runtimeSimilarityQuery.data
  const effectiveAppearanceSettings = appearanceQuery.data
  const canManageSimilaritySettings = hasAuthPermission(authStatusQuery.data?.permissionKeys, 'page.settings.view')

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
    initialData: cachedInitialImage,
  })

  const image = imageQuery.data
  const mediaKind = image ? getImageListMediaKind(image) : null
  const canLoadRelatedImages = mediaKind === 'image'
  const isSecondaryContentReady = Boolean(image) && canLoadRelatedImages && isPrimaryMediaReady

  const handlePrimaryMediaReady = useCallback(() => {
    setIsPrimaryMediaReady(true)
  }, [])

  useEffect(() => {
    if (!image || isPrimaryMediaReady) {
      return
    }

    const fallbackDelayMs = presentation === 'modal' ? 1200 : 800
    const timerId = window.setTimeout(() => {
      setIsPrimaryMediaReady(true)
    }, fallbackDelayMs)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [image, isPrimaryMediaReady, presentation])

  const duplicatesQuery = useQuery({
    queryKey: ['image-duplicates', compositeHash],
    queryFn: () => getImageDuplicates(compositeHash, 5),
    enabled: Boolean(compositeHash) && Boolean(image) && canLoadRelatedImages && isSecondaryContentReady,
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
    enabled: Boolean(compositeHash) && Boolean(image) && canLoadRelatedImages && Boolean(effectiveSimilaritySettings) && isSecondaryContentReady,
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
    enabled: Boolean(compositeHash) && Boolean(image) && canLoadRelatedImages && Boolean(effectiveSimilaritySettings) && isSecondaryContentReady,
  })

  const renderUrl = getImageDetailRenderUrl(image)
  const downloadUrl = getImageDetailDownloadUrl(image)
  const downloadName = getDownloadName(image?.original_file_path, image?.composite_hash)

  const duplicateImageItems = useMemo(() => duplicatesQuery.data?.similar ?? [], [duplicatesQuery.data?.similar])

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
          <AlertTitle>{t('images.image.detail.view.images.details.failed.to.load')}</AlertTitle>
          <AlertDescription>{getErrorMessage(imageQuery.error, t('images.image.detail.view.an.unknown.error.occurred'))}</AlertDescription>
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
              <div className="flex h-[max(540px,72vh)] items-center justify-center bg-surface-lowest">
                <ImageDetailMedia image={image as ImageRecord} renderUrl={renderUrl} onPrimaryLoad={handlePrimaryMediaReady} />
              </div>
            </div>

            {isSecondaryContentReady ? (
              <>
                {duplicateImages.length > 0 ? (
                  <RelatedImageGallerySection
                    title={t('images.image.detail.view.duplicate.images')}
                    items={duplicateImages}
                    isLoading={false}
                    errorMessage={null}
                    emptyMessage={t('images.image.detail.view.there.are.no.duplicate.images.right.now')}
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
                  canEditSettings={canManageSimilaritySettings}
                  similarImageItems={similarImageItems}
                  similarImagesLoading={similarQuery.isLoading || runtimeSimilarityQuery.isLoading}
                  similarImagesError={similarQuery.isError ? similarQuery.error : runtimeSimilarityQuery.isError ? runtimeSimilarityQuery.error : null}
                  promptSimilarImageItems={promptSimilarImageItems}
                  promptSimilarImages={promptSimilarImages}
                  promptSimilarImagesLoading={promptSimilarQuery.isLoading || runtimeSimilarityQuery.isLoading}
                  promptSimilarImagesError={promptSimilarQuery.isError ? promptSimilarQuery.error : runtimeSimilarityQuery.isError ? runtimeSimilarityQuery.error : null}
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
