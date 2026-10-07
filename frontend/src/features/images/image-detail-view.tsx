import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Info } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { getImage, getImageDetailQueryKey, getImageDuplicates, getPromptSimilarImages, getSimilarImages } from '@/lib/api-images'
import { getRuntimeSimilaritySettings } from '@/lib/api-settings'
import { getAppSettings } from '@/lib/api-settings-general'
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
import { shouldAutoRunImageSimilarityChecks } from './components/detail/image-similarity-policy'
import { RelatedImageGallerySection } from './components/detail/related-image-gallery-section'
import { useImageDetailChatPage } from './use-image-detail-chat-page'

const SIMILARITY_INSPECTION_STABLE_DELAY_MS = 350

type ImageDetailImageAreaTab = 'current' | 'similar'

export interface ImageDetailViewHeaderControls {
  downloadName: string
  downloadUrl: string | null
  image: ImageRecord | undefined
  isRefreshing: boolean
  refresh: () => void
  /** Similar / duplicate scan trigger for the page top bar. */
  similarity: { available: boolean; active: boolean; onRequest: () => void }
}

interface ImageDetailViewModalNavigation {
  activeIndex: number
  totalCount: number
  canViewPrevious: boolean
  canViewNext: boolean
  onViewPrevious: () => void
  onViewNext: () => void
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

function ImageDetailModalNavigationButtons({ navigation }: { navigation?: ImageDetailViewModalNavigation }) {
  const { t } = useI18n()

  if (!navigation || (!navigation.canViewPrevious && !navigation.canViewNext)) {
    return null
  }

  const buttonClassName = 'group/modal-nav pointer-events-auto absolute top-1/2 z-30 flex h-28 w-12 -translate-y-1/2 items-center text-white/80 opacity-100 transition hover:text-white focus-visible:opacity-100 md:h-40 md:w-16 md:text-white/74 md:opacity-0 md:group-hover/image-pane:opacity-100'
  const buttonInnerClassName = 'flex h-10 w-10 items-center justify-center rounded-sm bg-backdrop/50 shadow-elevation-2 backdrop-blur-md transition-colors group-hover/modal-nav:bg-backdrop/80 md:h-12 md:w-12'

  return (
    <>
      {navigation.canViewPrevious ? (
        // eslint-disable-next-line no-restricted-syntax -- tall edge hit-zone with a photo scrim; Button sizes/tones do not fit
        <button
          type="button"
          className={cn(buttonClassName, 'left-0 justify-start bg-gradient-to-r from-black/36 via-black/12 to-transparent pl-1.5 md:pl-3')}
          onClick={navigation.onViewPrevious}
          onMouseDown={(event) => event.stopPropagation()}
          aria-label={t('images.components.detail.image.view.modal.overlay.previous.images')}
        >
          <span className={buttonInnerClassName}>
            <ChevronLeft className="h-6 w-6" />
          </span>
        </button>
      ) : null}

      {navigation.canViewNext ? (
        // eslint-disable-next-line no-restricted-syntax -- tall edge hit-zone with a photo scrim; Button sizes/tones do not fit
        <button
          type="button"
          className={cn(buttonClassName, 'right-0 justify-end bg-gradient-to-l from-black/36 via-black/12 to-transparent pr-1.5 md:pr-3')}
          onClick={navigation.onViewNext}
          onMouseDown={(event) => event.stopPropagation()}
          aria-label={t('images.components.detail.image.view.modal.overlay.next.images')}
        >
          <span className={buttonInnerClassName}>
            <ChevronRight className="h-6 w-6" />
          </span>
        </button>
      ) : null}
    </>
  )
}

interface ImageDetailViewProps {
  compositeHash: string
  presentation?: 'page' | 'modal'
  initialImage?: ImageRecord | null
  renderHeader?: (controls: ImageDetailViewHeaderControls) => ReactNode
  modalNavigation?: ImageDetailViewModalNavigation
}

/** Render the shared image detail body so page and modal presentations stay aligned. */
export function ImageDetailView({ compositeHash, presentation = 'page', initialImage = null, renderHeader, modalNavigation }: ImageDetailViewProps) {
  const { t } = useI18n()
  const canUseSplitPaneScroll = useMinWidth(1280)
  const canUseDesktopModalLayout = useMinWidth(920)
  const usesDesktopRelatedImageColumns = useMinWidth(768)
  const [activeImageAreaTab, setActiveImageAreaTab] = useState<ImageDetailImageAreaTab>('current')
  const [isModalInfoViewerOpen, setIsModalInfoViewerOpen] = useState(canUseDesktopModalLayout)
  const [isPrimaryMediaReady, setIsPrimaryMediaReady] = useState(false)
  const [isSimilarityInspectionRequested, setIsSimilarityInspectionRequested] = useState(false)
  const [isImageSimilarityInspectionRequested, setIsImageSimilarityInspectionRequested] = useState(false)
  const [isPromptSimilarityInspectionRequested, setIsPromptSimilarityInspectionRequested] = useState(false)
  const [stableSimilarityInspectionCompositeHash, setStableSimilarityInspectionCompositeHash] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const detailUrl = initialImage?.detail_url
  const detailScopeKey = initialImage?.detail_scope_key
  const imageDetailSource = useMemo(
    () => ({ detail_url: detailUrl, detail_scope_key: detailScopeKey }),
    [detailScopeKey, detailUrl],
  )
  const imageDetailQueryKey = useMemo(
    () => getImageDetailQueryKey(compositeHash, imageDetailSource),
    [compositeHash, imageDetailSource],
  )

  const cachedInitialImage = useMemo(() => {
    if (initialImage?.composite_hash === compositeHash) {
      return initialImage
    }

    const prefetchedImage = queryClient.getQueryData<ImageRecord>(imageDetailQueryKey)
    if (prefetchedImage?.composite_hash === compositeHash) {
      return prefetchedImage
    }

    if (presentation === 'modal') {
      return undefined
    }

    const queries = queryClient.getQueryCache().findAll()
    for (const query of queries) {
      const found = findCachedImageRecord(query.state.data, compositeHash)
      if (found) return found
    }

    return undefined
  }, [compositeHash, imageDetailQueryKey, initialImage, presentation, queryClient])

  useEffect(() => {
    if (presentation === 'page') {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
    }
  }, [compositeHash, presentation])

  useEffect(() => {
    setIsPrimaryMediaReady(false)
    setIsSimilarityInspectionRequested(false)
    setIsImageSimilarityInspectionRequested(false)
    setIsPromptSimilarityInspectionRequested(false)
    setStableSimilarityInspectionCompositeHash(null)
    setActiveImageAreaTab('current')
  }, [compositeHash])

  useEffect(() => {
    if (presentation === 'modal') {
      setIsModalInfoViewerOpen(canUseDesktopModalLayout)
    }
  }, [canUseDesktopModalLayout, presentation])

  useEffect(() => {
    return () => {
      void queryClient.cancelQueries({ queryKey: ['image-duplicates', compositeHash] })
      void queryClient.cancelQueries({ queryKey: ['image-similar', compositeHash] })
      void queryClient.cancelQueries({ queryKey: ['image-prompt-similar', compositeHash] })
    }
  }, [compositeHash, queryClient])

  const authStatusQuery = useAuthStatusQuery()
  const appearanceQuery = useGlobalAppearanceSettingsQuery()
  const appSettingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
    staleTime: 60_000,
  })
  const effectiveAppearanceSettings = appearanceQuery.data
  const canManageSimilaritySettings = hasAuthPermission(authStatusQuery.data?.permissionKeys, 'page.settings.view')
  const shouldAutoRunSimilarityInspection = shouldAutoRunImageSimilarityChecks(appSettingsQuery.data?.general)
  const isRelatedImageAreaActive = presentation === 'modal' ? activeImageAreaTab === 'similar' : isSimilarityInspectionRequested || shouldAutoRunSimilarityInspection

  const relatedImageMobileColumns = effectiveAppearanceSettings?.detailRelatedImageMobileColumns ?? 1
  const relatedImageDesktopColumns = effectiveAppearanceSettings?.detailRelatedImageColumns ?? 3
  const relatedImageAspectRatio = effectiveAppearanceSettings?.detailRelatedImageAspectRatio ?? 'square'
  const activeRelatedImageColumns = usesDesktopRelatedImageColumns ? relatedImageDesktopColumns : relatedImageMobileColumns

  const imageQuery = useQuery({
    queryKey: imageDetailQueryKey,
    queryFn: ({ signal }) => getImage(compositeHash, { signal }, imageDetailSource),
    enabled: Boolean(compositeHash),
    placeholderData: cachedInitialImage,
    staleTime: 0,
  })
  const refetchImage = imageQuery.refetch

  const image = imageQuery.data
  useImageDetailChatPage(image, presentation, activeImageAreaTab, setActiveImageAreaTab)
  const mediaKind = image ? getImageListMediaKind(image) : null
  const canLoadRelatedImages = mediaKind === 'image'
  const isSecondaryContentReady = Boolean(image) && canLoadRelatedImages && isPrimaryMediaReady
  const canRunSimilarityInspection = isSimilarityInspectionRequested && Boolean(compositeHash) && isSecondaryContentReady
  const canRunStabilizedSimilarityInspection = canRunSimilarityInspection && stableSimilarityInspectionCompositeHash === compositeHash
  const isSimilarityInspectionSettling = canRunSimilarityInspection && !canRunStabilizedSimilarityInspection
  const shouldLoadRuntimeSimilaritySettings = canRunStabilizedSimilarityInspection && (isImageSimilarityInspectionRequested || isPromptSimilarityInspectionRequested)

  const runtimeSimilarityQuery = useQuery({
    queryKey: ['runtime-similarity-settings'],
    queryFn: ({ signal }) => getRuntimeSimilaritySettings({ signal }),
    enabled: shouldLoadRuntimeSimilaritySettings,
  })

  const effectiveSimilaritySettings = runtimeSimilarityQuery.data
  const detailSimilarRows = normalizeSimilarityResultRows(effectiveSimilaritySettings?.detailSimilarLimit)
  const promptSimilarRows = normalizeSimilarityResultRows(effectiveSimilaritySettings?.promptSimilarity?.resultLimit)
  const detailSimilarLimit = resolveSimilarityResultLimit(detailSimilarRows, activeRelatedImageColumns)
  const promptSimilarLimit = resolveSimilarityResultLimit(promptSimilarRows, activeRelatedImageColumns)

  const handlePrimaryMediaReady = useCallback(() => {
    setIsPrimaryMediaReady(true)
  }, [])

  const relatedImagesRef = useRef<HTMLDivElement | null>(null)
  const shouldScrollToRelatedRef = useRef(false)

  const handleRequestSimilarityInspection = useCallback(() => {
    setIsSimilarityInspectionRequested(true)
    setIsImageSimilarityInspectionRequested(true)
    setIsPromptSimilarityInspectionRequested(true)
    shouldScrollToRelatedRef.current = true
  }, [])

  const handleRequestImageSimilarityInspection = useCallback(() => {
    setIsSimilarityInspectionRequested(true)
    setIsImageSimilarityInspectionRequested(true)
  }, [])

  const handleRequestPromptSimilarityInspection = useCallback(() => {
    setIsSimilarityInspectionRequested(true)
    setIsPromptSimilarityInspectionRequested(true)
  }, [])

  const handleSelectImageAreaTab = useCallback((tab: string) => {
    const nextTab = tab === 'similar' ? 'similar' : 'current'
    setActiveImageAreaTab(nextTab)

    if (nextTab === 'similar') {
      setIsSimilarityInspectionRequested(true)
    }
  }, [])

  useEffect(() => {
    if (!shouldAutoRunSimilarityInspection || !isRelatedImageAreaActive) {
      return
    }

    setIsSimilarityInspectionRequested(true)
    setIsImageSimilarityInspectionRequested(true)
    setIsPromptSimilarityInspectionRequested(true)
  }, [shouldAutoRunSimilarityInspection, isRelatedImageAreaActive, compositeHash])

  useEffect(() => {
    if (!canRunSimilarityInspection) {
      setStableSimilarityInspectionCompositeHash(null)
      return
    }

    const timerId = window.setTimeout(() => {
      setStableSimilarityInspectionCompositeHash(compositeHash)
    }, SIMILARITY_INSPECTION_STABLE_DELAY_MS)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [canRunSimilarityInspection, compositeHash])

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
    queryFn: ({ signal }) => getImageDuplicates(compositeHash, 5, { signal }),
    enabled: canRunStabilizedSimilarityInspection,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
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
    queryFn: ({ signal }) =>
      getSimilarImages(
        compositeHash,
        {
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
        },
        { signal },
      ),
    enabled: canRunStabilizedSimilarityInspection && isImageSimilarityInspectionRequested && Boolean(effectiveSimilaritySettings),
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
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
    queryFn: ({ signal }) => getPromptSimilarImages(compositeHash, promptSimilarLimit, { signal }),
    enabled: canRunStabilizedSimilarityInspection && isPromptSimilarityInspectionRequested && Boolean(effectiveSimilaritySettings),
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
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

  const renderDuplicateImageOverlay = useCallback((duplicateImage: ImageRecord): ReactNode => {
    const compositeHash = duplicateImage.composite_hash
    if (typeof compositeHash !== 'string' || compositeHash.length === 0) {
      return null
    }

    const item = duplicateImageItemByHash.get(compositeHash)
    return item ? <SimilarImageScoreOverlay item={item} /> : null
  }, [duplicateImageItemByHash])

  const refreshImage = useCallback(() => {
    void refetchImage()
  }, [refetchImage])

  const headerControls = useMemo<ImageDetailViewHeaderControls>(() => ({
    downloadName,
    downloadUrl,
    image,
    isRefreshing: imageQuery.isFetching,
    refresh: refreshImage,
    similarity: {
      available: canLoadRelatedImages,
      active: isSimilarityInspectionRequested,
      onRequest: handleRequestSimilarityInspection,
    },
  }), [canLoadRelatedImages, downloadName, downloadUrl, handleRequestSimilarityInspection, image, imageQuery.isFetching, isSimilarityInspectionRequested, refreshImage])

  // The page's scan trigger sits in the top bar; bring the results into view once they render below the image.
  useEffect(() => {
    if (presentation !== 'page' || !shouldScrollToRelatedRef.current || !isSimilarityInspectionRequested || !isSecondaryContentReady) {
      return
    }

    shouldScrollToRelatedRef.current = false
    const frameId = window.requestAnimationFrame(() => {
      relatedImagesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [isSecondaryContentReady, isSimilarityInspectionRequested, presentation])

  const duplicateImagesLoading = isSimilarityInspectionSettling || duplicatesQuery.isLoading
  const duplicateImagesErrorMessage = duplicatesQuery.isError
    ? getErrorMessage(duplicatesQuery.error, t('images.image.detail.view.an.unknown.error.occurred'))
    : null
  const similarImagesLoading = isImageSimilarityInspectionRequested && (isSimilarityInspectionSettling || similarQuery.isLoading || runtimeSimilarityQuery.isLoading)
  const promptSimilarImagesLoading = isPromptSimilarityInspectionRequested && (isSimilarityInspectionSettling || promptSimilarQuery.isLoading || runtimeSimilarityQuery.isLoading)
  const similarImagesError = isImageSimilarityInspectionRequested
    ? (similarQuery.isError ? similarQuery.error : runtimeSimilarityQuery.isError ? runtimeSimilarityQuery.error : null)
    : null
  const promptSimilarImagesError = isPromptSimilarityInspectionRequested
    ? (promptSimilarQuery.isError ? promptSimilarQuery.error : runtimeSimilarityQuery.isError ? runtimeSimilarityQuery.error : null)
    : null
  const shouldShowDuplicateSection = duplicateImagesLoading || Boolean(duplicateImagesErrorMessage) || duplicateImages.length > 0 || (presentation === 'page' && isSimilarityInspectionRequested)
  const shouldShowRelatedEmptyState = presentation === 'modal'
    && isSimilarityInspectionRequested
    && isImageSimilarityInspectionRequested
    && isPromptSimilarityInspectionRequested
    && !duplicateImagesLoading
    && !similarImagesLoading
    && !promptSimilarImagesLoading
    && !duplicateImagesErrorMessage
    && !similarImagesError
    && !promptSimilarImagesError
    && duplicateImages.length === 0
    && similarImageItems.length === 0
    && promptSimilarImages.length === 0

  const relatedImagesContent = (
    <div className="space-y-6">
      {shouldShowDuplicateSection ? (
        <RelatedImageGallerySection
          title={t('images.image.detail.view.duplicate.images')}
          items={duplicateImages}
          isLoading={duplicateImagesLoading}
          errorMessage={duplicateImagesErrorMessage}
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
        similarImagesLoading={similarImagesLoading}
        similarImagesError={similarImagesError}
        similarImagesRequested={isImageSimilarityInspectionRequested}
        onRequestSimilarImages={handleRequestImageSimilarityInspection}
        promptSimilarImageItems={promptSimilarImageItems}
        promptSimilarImages={promptSimilarImages}
        promptSimilarImagesLoading={promptSimilarImagesLoading}
        promptSimilarImagesError={promptSimilarImagesError}
        promptSimilarImagesRequested={isPromptSimilarityInspectionRequested}
        onRequestPromptSimilarImages={handleRequestPromptSimilarityInspection}
        mobileCardColumns={relatedImageMobileColumns}
        desktopCardColumns={relatedImageDesktopColumns}
        cardAspectRatio={relatedImageAspectRatio}
        hideEmptySections={presentation === 'modal'}
      />

      {shouldShowRelatedEmptyState ? (
        <EmptyState title={t({ ko: '표시할 유사/중복 이미지가 없어.', en: 'No similar or duplicate images to show.' })} />
      ) : null}
    </div>
  )

  if (presentation === 'modal') {
    const activeTabIsCurrent = activeImageAreaTab === 'current'
    const modalInfoToggleLabel = isModalInfoViewerOpen
      ? t({ ko: '정보 뷰어 닫기', en: 'Close info viewer' })
      : t({ ko: '정보 뷰어 열기', en: 'Open info viewer' })

    return (
      <div className="image-detail-modal-shell">
        <div className={cn('image-detail-modal-layout', isModalInfoViewerOpen ? 'info-open' : 'info-collapsed')}>
          <section className="image-detail-modal-image-pane group/image-pane">
            <div className="image-detail-modal-toolbar">
              <div className="image-detail-modal-toolbar-inner">
                <div className="image-detail-modal-header-actions min-w-0 flex-1">{renderHeader ? renderHeader(headerControls) : null}</div>
                <SegmentedControl
                  value={activeImageAreaTab}
                  items={[
                    { value: 'current', label: t({ ko: '이미지', en: 'Image' }) },
                    { value: 'similar', label: t({ ko: '유사', en: 'Similar' }), disabled: Boolean(image) && !canLoadRelatedImages },
                  ]}
                  onChange={handleSelectImageAreaTab}
                  size="xs"
                  className="image-detail-modal-image-tabs shrink-0 flex-nowrap whitespace-nowrap border-transparent bg-backdrop/50 text-white shadow-elevation-2 backdrop-blur-md"
                />
              </div>
            </div>

            {!isModalInfoViewerOpen && canUseDesktopModalLayout ? (
              <Button
                type="button"
                size="icon-sm"
                variant="secondary"
                className="image-detail-modal-info-reopen-desktop"
                onClick={() => setIsModalInfoViewerOpen(true)}
                aria-label={modalInfoToggleLabel}
                title={modalInfoToggleLabel}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            ) : null}

            <div className="image-detail-modal-stage">
              {imageQuery.isLoading ? (
                <div className="flex h-full w-full items-center justify-center p-6">
                  <Skeleton className="h-[min(70vh,52rem)] w-full max-w-5xl rounded-sm bg-white/8" />
                </div>
              ) : null}

              {imageQuery.isError ? (
                <div className="flex h-full w-full items-center justify-center p-6">
                  <Alert variant="destructive" className="max-w-xl">
                    <AlertTitle>{t('images.image.detail.view.images.details.failed.to.load')}</AlertTitle>
                    <AlertDescription>{getErrorMessage(imageQuery.error, t('images.image.detail.view.an.unknown.error.occurred'))}</AlertDescription>
                  </Alert>
                </div>
              ) : null}

              {!imageQuery.isLoading && !imageQuery.isError && image && activeTabIsCurrent ? (
                <div className="relative h-full w-full bg-black">
                  <ImageDetailModalNavigationButtons navigation={modalNavigation} />
                  <div className="flex h-full w-full items-center justify-center bg-black">
                    <ImageDetailMedia image={image as ImageRecord} renderUrl={renderUrl} className="max-h-full max-w-full w-auto object-contain" onPrimaryLoad={handlePrimaryMediaReady} />
                  </div>
                </div>
              ) : null}

              {!imageQuery.isLoading && !imageQuery.isError && image && !activeTabIsCurrent ? (
                <div className="image-detail-modal-related-pane image-detail-scroll-pane">
                  {!canLoadRelatedImages ? (
                    <EmptyState title={t({ ko: '이미지 파일만 유사 이미지 검사를 사용할 수 있어.', en: 'Similarity checks are available for image files only.' })} />
                  ) : isSecondaryContentReady ? relatedImagesContent : (
                    <div className="space-y-4">
                      <Skeleton className="h-10 w-48 rounded-sm" />
                      <Skeleton className="h-64 w-full rounded-sm" />
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </section>

          {/* Flat column: one hairline against the stage, page background, no shadow (the phone sheet keeps its lift). */}
          <aside className="image-detail-modal-info-pane border-line bg-background min-[920px]:shadow-none">
            {canUseDesktopModalLayout ? (
              <Button
                type="button"
                size="icon-sm"
                variant="secondary"
                className="image-detail-modal-info-toggle-desktop"
                onClick={() => setIsModalInfoViewerOpen(false)}
                aria-label={modalInfoToggleLabel}
                title={modalInfoToggleLabel}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : null}

            {/* eslint-disable-next-line no-restricted-syntax -- index.css toggles this row's display per breakpoint; Button's inline-flex would override it */}
            <button
              type="button"
              className="image-detail-modal-info-mobile-header"
              onClick={() => setIsModalInfoViewerOpen((current) => !current)}
              aria-expanded={isModalInfoViewerOpen}
              aria-label={modalInfoToggleLabel}
            >
              <span className="inline-flex items-center gap-2">
                <Info className="h-4 w-4" />
                {t({ ko: '정보 뷰어', en: 'Info viewer' })}
              </span>
              {isModalInfoViewerOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>

            <div className="image-detail-modal-info-content image-detail-scroll-pane min-[920px]:px-6 min-[920px]:pt-5">
              {imageQuery.isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-6 w-2/3 rounded-sm" />
                  <Skeleton className="h-4 w-full rounded-sm" />
                  <Skeleton className="h-4 w-5/6 rounded-sm" />
                  <Skeleton className="h-4 w-3/4 rounded-sm" />
                </div>
              ) : null}

              {!imageQuery.isLoading && !imageQuery.isError && image ? <ImageDetailMetaCard image={image as ImageRecord} /> : null}
            </div>
          </aside>
        </div>
      </div>
    )
  }

  // Page: top bar (hairline below) · stage on the checkerboard | metadata column behind one vertical hairline.
  // Below xl the metadata follows the image. Similar / duplicate results open under the image from the top-bar scan icon.
  const stageHeightClassName = 'h-[max(420px,calc(100svh-var(--theme-shell-header-height)-7rem))]'
  const metaColumnClassName = 'min-w-0 border-t border-line pt-6 xl:border-t-0 xl:border-l xl:pt-6 xl:pl-6'

  return (
    <div>
      {renderHeader ? renderHeader(headerControls) : null}

      {imageQuery.isLoading ? (
        <div className="grid xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="py-6 xl:pr-6">
            <Skeleton className={cn('w-full rounded-sm', stageHeightClassName)} />
          </div>
          <div className={cn(metaColumnClassName, 'space-y-3')}>
            <Skeleton className="h-6 w-2/3 rounded-sm" />
            <Skeleton className="h-4 w-full rounded-sm" />
            <Skeleton className="h-4 w-5/6 rounded-sm" />
            <Skeleton className="h-4 w-3/4 rounded-sm" />
          </div>
        </div>
      ) : null}

      {imageQuery.isError ? (
        <Alert variant="destructive" className="mt-6">
          <AlertTitle>{t('images.image.detail.view.images.details.failed.to.load')}</AlertTitle>
          <AlertDescription>{getErrorMessage(imageQuery.error, t('images.image.detail.view.an.unknown.error.occurred'))}</AlertDescription>
        </Alert>
      ) : null}

      {!imageQuery.isLoading && !imageQuery.isError && image ? (
        <div className="grid xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-10 py-6 xl:pr-6">
            <div className={cn('flex items-center justify-center', stageHeightClassName)}>
              <ImageDetailMedia image={image as ImageRecord} renderUrl={renderUrl} onPrimaryLoad={handlePrimaryMediaReady} />
            </div>

            {!canUseSplitPaneScroll ? (
              <div className={metaColumnClassName}>
                <ImageDetailMetaCard image={image as ImageRecord} />
              </div>
            ) : null}

            {isSecondaryContentReady && isRelatedImageAreaActive ? (
              <div ref={relatedImagesRef} className="scroll-mt-[calc(var(--theme-shell-header-height)+1rem)]">
                {relatedImagesContent}
              </div>
            ) : null}
          </div>

          {canUseSplitPaneScroll ? (
            <div className={cn(metaColumnClassName, 'pb-6')}>
              <ImageDetailMetaCard image={image as ImageRecord} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
