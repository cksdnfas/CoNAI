import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getImagesBatch } from '@/lib/api'
import type { ImageRecord } from '@/types/image'
import { ImageViewModalContext, type ImageViewModalOpenInput } from './image-view-modal-context'
import type { ImageViewModalMode } from './image-view-modal-actions'

interface ImageViewModalState {
  compositeHash: string | null
  compositeHashes: string[]
  sourceId: string | null
  sourceItemsByHash: Record<string, ImageRecord>
  openSessionId: number
  stripFocusRequestId: number
  stripFocusBehavior: ScrollBehavior | null
}

const ImageViewModalOverlayLazy = lazy(async () => {
  const module = await import('./image-view-modal-overlay')
  return { default: module.ImageViewModalOverlay }
})

const IMAGE_VIEW_MODAL_MODE_STORAGE_KEY = 'conai:image-view-modal:mode'

function loadImageViewModalMode(): ImageViewModalMode {
  if (typeof window === 'undefined') {
    return 'full'
  }

  const savedValue = window.localStorage.getItem(IMAGE_VIEW_MODAL_MODE_STORAGE_KEY)
  return savedValue === 'medium' || savedValue === 'minimal' ? savedValue : 'full'
}

function persistImageViewModalMode(mode: ImageViewModalMode) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(IMAGE_VIEW_MODAL_MODE_STORAGE_KEY, mode)
}

function ImageViewModalFallback() {
  return <div className="fixed inset-0 z-[90] bg-black/72" aria-hidden="true" />
}

function buildSourceItemsByHash(items?: ImageRecord[]) {
  const entries = (items ?? [])
    .map((item) => {
      const compositeHash = item.composite_hash
      return typeof compositeHash === 'string' && compositeHash.length > 0 ? ([compositeHash, item] as const) : null
    })
    .filter((entry): entry is readonly [string, ImageRecord] => entry !== null)

  return Object.fromEntries(entries) as Record<string, ImageRecord>
}

/** Provide a global image view modal for app-shell image browsing flows. */
export function ImageViewModalProvider({ children }: PropsWithChildren) {
  const [modalState, setModalState] = useState<ImageViewModalState>({
    compositeHash: null,
    compositeHashes: [],
    sourceId: null,
    sourceItemsByHash: {},
    openSessionId: 0,
    stripFocusRequestId: 0,
    stripFocusBehavior: null,
  })
  const [viewMode, setViewMode] = useState<ImageViewModalMode>(() => loadImageViewModalMode())

  const activeIndex = useMemo(() => {
    if (!modalState.compositeHash) {
      return -1
    }

    return modalState.compositeHashes.indexOf(modalState.compositeHash)
  }, [modalState.compositeHash, modalState.compositeHashes])

  const canViewPrevious = activeIndex > 0
  const canViewNext = activeIndex >= 0 && activeIndex < modalState.compositeHashes.length - 1

  const missingThumbnailStripCompositeHashes = useMemo(
    () => modalState.compositeHashes.filter((compositeHash) => !modalState.sourceItemsByHash[compositeHash]),
    [modalState.compositeHashes, modalState.sourceItemsByHash],
  )

  const thumbnailStripQuery = useQuery({
    queryKey: ['image-view-thumbnail-strip', missingThumbnailStripCompositeHashes],
    queryFn: () => getImagesBatch(missingThumbnailStripCompositeHashes),
    enabled: viewMode === 'full' && missingThumbnailStripCompositeHashes.length > 0,
    staleTime: 60_000,
  })

  /** Open the image view modal with an optional ordered navigation context. */
  const openImageView = useCallback((input: ImageViewModalOpenInput) => {
    const compositeHashes = Array.from(new Set((input.compositeHashes ?? []).filter((value) => typeof value === 'string' && value.length > 0)))
    const nextCompositeHashes = compositeHashes.includes(input.compositeHash)
      ? compositeHashes
      : [input.compositeHash, ...compositeHashes]
    const nextSourceItemsByHash = buildSourceItemsByHash(input.sourceItems)

    setModalState((current) => {
      const isFreshOpen = !current.compositeHash
      const isSourceChanged = Boolean(input.sourceId) && current.sourceId !== input.sourceId

      const shouldFocusStrip = isFreshOpen || typeof input.stripFocusBehavior === 'string'
      const nextStripFocusBehavior = isFreshOpen
        ? (input.stripFocusBehavior ?? 'auto')
        : (typeof input.stripFocusBehavior === 'string' ? input.stripFocusBehavior : current.stripFocusBehavior)

      return {
        compositeHash: input.compositeHash,
        compositeHashes: nextCompositeHashes,
        sourceId: input.sourceId ?? current.sourceId ?? null,
        sourceItemsByHash: isFreshOpen || isSourceChanged
          ? nextSourceItemsByHash
          : { ...current.sourceItemsByHash, ...nextSourceItemsByHash },
        openSessionId: isFreshOpen ? current.openSessionId + 1 : current.openSessionId,
        stripFocusRequestId: shouldFocusStrip ? current.stripFocusRequestId + 1 : current.stripFocusRequestId,
        stripFocusBehavior: nextStripFocusBehavior,
      }
    })
  }, [])

  const syncImageViewSequence = useCallback((input: { compositeHashes: string[]; sourceId: string; sourceItems?: ImageRecord[] }) => {
    setModalState((current) => {
      if (!current.compositeHash || !current.sourceId || current.sourceId !== input.sourceId) {
        return current
      }

      const nextCompositeHashes = Array.from(new Set(input.compositeHashes.filter((value) => typeof value === 'string' && value.length > 0)))
      if (!nextCompositeHashes.includes(current.compositeHash)) {
        return current
      }

      const nextSourceItemsByHash = buildSourceItemsByHash(input.sourceItems)
      const mergedSourceItemsByHash = Object.keys(nextSourceItemsByHash).length > 0
        ? { ...current.sourceItemsByHash, ...nextSourceItemsByHash }
        : current.sourceItemsByHash
      const isSameSequence = nextCompositeHashes.length === current.compositeHashes.length
        && nextCompositeHashes.every((value, index) => value === current.compositeHashes[index])
      const isSameItems = Object.keys(mergedSourceItemsByHash).length === Object.keys(current.sourceItemsByHash).length
        && Object.entries(mergedSourceItemsByHash).every(([key, value]) => current.sourceItemsByHash[key] === value)

      if (isSameSequence && isSameItems) {
        return current
      }

      return {
        ...current,
        compositeHashes: nextCompositeHashes,
        sourceItemsByHash: mergedSourceItemsByHash,
      }
    })
  }, [])

  const closeImageView = useCallback(() => {
    setModalState((current) => ({
      compositeHash: null,
      compositeHashes: [],
      sourceId: null,
      sourceItemsByHash: {},
      openSessionId: current.openSessionId,
      stripFocusRequestId: current.stripFocusRequestId,
      stripFocusBehavior: null,
    }))
  }, [])

  const handleViewModeChange = useCallback((nextMode: ImageViewModalMode) => {
    setViewMode(nextMode)
    persistImageViewModalMode(nextMode)
  }, [])

  /** Move to the previous image within the active modal navigation context. */
  const viewPreviousImage = useCallback(() => {
    setModalState((current) => {
      if (!current.compositeHash) {
        return current
      }

      const currentIndex = current.compositeHashes.indexOf(current.compositeHash)
      if (currentIndex <= 0) {
        return current
      }

      return {
        ...current,
        compositeHash: current.compositeHashes[currentIndex - 1],
        stripFocusRequestId: current.stripFocusRequestId + 1,
        stripFocusBehavior: 'smooth',
      }
    })
  }, [])

  /** Move to the next image within the active modal navigation context. */
  const viewNextImage = useCallback(() => {
    setModalState((current) => {
      if (!current.compositeHash) {
        return current
      }

      const currentIndex = current.compositeHashes.indexOf(current.compositeHash)
      if (currentIndex < 0 || currentIndex >= current.compositeHashes.length - 1) {
        return current
      }

      return {
        ...current,
        compositeHash: current.compositeHashes[currentIndex + 1],
        stripFocusRequestId: current.stripFocusRequestId + 1,
        stripFocusBehavior: 'smooth',
      }
    })
  }, [])

  useEffect(() => {
    if (!modalState.compositeHash) {
      return
    }

    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeImageView()
        return
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        viewPreviousImage()
        return
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault()
        viewNextImage()
      }
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeImageView, modalState.compositeHash, viewNextImage, viewPreviousImage])

  const thumbnailStripFallbackItemsByHash = useMemo(
    () => Object.fromEntries(((thumbnailStripQuery.data ?? []) as ImageRecord[])
      .map((item) => {
        const compositeHash = item.composite_hash
        return typeof compositeHash === 'string' && compositeHash.length > 0 ? ([compositeHash, item] as const) : null
      })
      .filter((entry): entry is readonly [string, ImageRecord] => entry !== null)),
    [thumbnailStripQuery.data],
  )

  const thumbnailStripItems = useMemo(
    () => modalState.compositeHashes
      .map((compositeHash) => modalState.sourceItemsByHash[compositeHash] ?? thumbnailStripFallbackItemsByHash[compositeHash] ?? null)
      .filter((item): item is ImageRecord => item !== null),
    [modalState.compositeHashes, modalState.sourceItemsByHash, thumbnailStripFallbackItemsByHash],
  )
  const thumbnailStripCompositeHashes = useMemo(
    () => thumbnailStripItems.map((item) => item.composite_hash).filter((value): value is string => typeof value === 'string' && value.length > 0),
    [thumbnailStripItems],
  )

  const contextValue = useMemo(
    () => ({
      activeCompositeHash: modalState.compositeHash,
      activeCompositeHashes: modalState.compositeHashes,
      activeIndex,
      canViewPrevious,
      canViewNext,
      openImageView,
      syncImageViewSequence,
      closeImageView,
      viewPreviousImage,
      viewNextImage,
    }),
    [activeIndex, canViewNext, canViewPrevious, closeImageView, modalState.compositeHash, modalState.compositeHashes, openImageView, syncImageViewSequence, viewNextImage, viewPreviousImage],
  )

  return (
    <ImageViewModalContext.Provider value={contextValue}>
      {children}
      {modalState.compositeHash ? (
        <Suspense fallback={<ImageViewModalFallback />}>
          <ImageViewModalOverlayLazy
            compositeHash={modalState.compositeHash}
            activeIndex={activeIndex}
            totalCount={modalState.compositeHashes.length}
            thumbnailStripItems={thumbnailStripItems}
            thumbnailStripCompositeHashes={thumbnailStripCompositeHashes}
            viewMode={viewMode}
            onChangeViewMode={handleViewModeChange}
            openSessionId={modalState.openSessionId}
            stripFocusRequestId={modalState.stripFocusRequestId}
            stripFocusBehavior={modalState.stripFocusBehavior}
            canViewPrevious={canViewPrevious}
            canViewNext={canViewNext}
            onClose={closeImageView}
            onViewPrevious={viewPreviousImage}
            onViewNext={viewNextImage}
            onSelectImage={openImageView}
          />
        </Suspense>
      ) : null}
    </ImageViewModalContext.Provider>
  )
}
