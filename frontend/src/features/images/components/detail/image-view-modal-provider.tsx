import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useOverlayBackClose } from '@/components/ui/use-overlay-back-close'
import type { ImageRecord } from '@/types/image'
import {
  ImageViewModalContext,
  type ImageViewModalAccessOptions,
  type ImageViewModalOpenInput,
  type ImageViewModalSyncInput,
  type ImageViewSequenceTotal,
} from './image-view-modal-context'
import { getImage, getImageDetailQueryKey } from '@/lib/api-images'
import { registerTranslationCatalog } from '@/i18n'

type ImageViewModalOverlayModule = typeof import('./image-view-modal-overlay')
type ImageViewModalOverlayComponent = ImageViewModalOverlayModule['ImageViewModalOverlay']
type IdlePreloadWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

let imageViewModalOverlayLoadPromise: Promise<{ default: ImageViewModalOverlayComponent }> | null = null

function loadImageViewModalOverlay() {
  // The overlay opens from any route (chat, files, ...), so it must bring its own
  // catalogs instead of relying on the current route having registered them.
  imageViewModalOverlayLoadPromise ??= Promise.all([
    import('./image-view-modal-overlay'),
    import('@/i18n/resources/images').then((module) => module.imagesCatalog),
    import('@/i18n/resources/image-editor').then((module) => module.imageEditorCatalog),
  ])
    .then(([module, imagesCatalog, imageEditorCatalog]) => {
      registerTranslationCatalog(imagesCatalog)
      registerTranslationCatalog(imageEditorCatalog)
      return { default: module.ImageViewModalOverlay }
    })
    .catch((error: unknown) => {
      imageViewModalOverlayLoadPromise = null
      throw error
    })

  return imageViewModalOverlayLoadPromise
}

function scheduleImageViewModalOverlayPreload() {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const idleWindow = window as IdlePreloadWindow
  if (typeof idleWindow.requestIdleCallback === 'function') {
    const idleHandle = idleWindow.requestIdleCallback(() => {
      void loadImageViewModalOverlay()
    }, { timeout: 2500 })

    return () => idleWindow.cancelIdleCallback?.(idleHandle)
  }

  const timeoutHandle = window.setTimeout(() => {
    void loadImageViewModalOverlay()
  }, 1200)

  return () => window.clearTimeout(timeoutHandle)
}

const ImageViewModalOverlayLazy = lazy(loadImageViewModalOverlay)
const MAX_WARMED_IMAGE_PREVIEW_SOURCE_URLS = 48
const warmedImagePreviewSourceUrls: string[] = []
const warmedImagePreviewSourceUrlSet = new Set<string>()

interface ImageViewModalState {
  compositeHash: string | null
  compositeHashes: string[]
  compositeHashIndexByHash: Map<string, number>
  sourceId: string | null
  sourceItemsByHash: Record<string, ImageRecord>
  sequenceTotal: ImageViewSequenceTotal | null
  sequenceHasMore: boolean
  openSessionId: number
  stripFocusRequestId: number
  stripFocusBehavior: ScrollBehavior | null
  accessOptions: ImageViewModalAccessOptions
}

function buildCompositeHashIndexByHash(compositeHashes: string[]) {
  return new Map(compositeHashes.map((compositeHash, index) => [compositeHash, index] as const))
}

function buildUniqueCompositeHashes(compositeHashes: readonly string[] | undefined) {
  const uniqueCompositeHashes: string[] = []
  const seenCompositeHashes = new Set<string>()

  for (const compositeHash of compositeHashes ?? []) {
    if (typeof compositeHash !== 'string' || compositeHash.length === 0 || seenCompositeHashes.has(compositeHash)) {
      continue
    }

    seenCompositeHashes.add(compositeHash)
    uniqueCompositeHashes.push(compositeHash)
  }

  return uniqueCompositeHashes
}

function createClosedModalState(current: ImageViewModalState): ImageViewModalState {
  return {
    compositeHash: null,
    compositeHashes: [],
    compositeHashIndexByHash: new Map(),
    sourceId: null,
    sourceItemsByHash: {},
    sequenceTotal: null,
    sequenceHasMore: false,
    openSessionId: current.openSessionId,
    stripFocusRequestId: current.stripFocusRequestId,
    stripFocusBehavior: null,
    accessOptions: {},
  }
}

function getModalActiveIndex(state: ImageViewModalState) {
  return state.compositeHash ? (state.compositeHashIndexByHash.get(state.compositeHash) ?? -1) : -1
}

function warmImagePreviewSource(image?: ImageRecord | null) {
  if (typeof window === 'undefined' || !image) {
    return
  }

  const previewUrl = image.thumbnail_url || image.image_url
  if (!previewUrl) {
    return
  }

  if (!rememberWarmedImagePreviewSourceUrl(previewUrl)) {
    return
  }

  const previewImage = new Image()
  previewImage.decoding = 'async'
  previewImage.src = previewUrl
}

function rememberWarmedImagePreviewSourceUrl(previewUrl: string) {
  if (warmedImagePreviewSourceUrlSet.has(previewUrl)) {
    return false
  }

  warmedImagePreviewSourceUrlSet.add(previewUrl)
  warmedImagePreviewSourceUrls.push(previewUrl)

  while (warmedImagePreviewSourceUrls.length > MAX_WARMED_IMAGE_PREVIEW_SOURCE_URLS) {
    const expiredPreviewUrl = warmedImagePreviewSourceUrls.shift()
    if (expiredPreviewUrl) {
      warmedImagePreviewSourceUrlSet.delete(expiredPreviewUrl)
    }
  }

  return true
}

function buildSourceItemsByHash(items?: ImageRecord[]) {
  const sourceItemsByHash: Record<string, ImageRecord> = {}

  for (const item of items ?? []) {
    const compositeHash = item.composite_hash
    if (typeof compositeHash === 'string' && compositeHash.length > 0) {
      sourceItemsByHash[compositeHash] = item
    }
  }

  return sourceItemsByHash
}

function areCompositeHashesEqual(currentHashes: string[], nextHashes: string[]) {
  if (currentHashes.length !== nextHashes.length) {
    return false
  }

  for (let index = 0; index < nextHashes.length; index += 1) {
    if (currentHashes[index] !== nextHashes[index]) {
      return false
    }
  }

  return true
}

function areSequenceTotalsEqual(current: ImageViewSequenceTotal | null, next: ImageViewSequenceTotal | null) {
  if (current === next) {
    return true
  }

  if (!current || !next || current.status !== next.status) {
    return false
  }

  return current.status !== 'known' || next.status !== 'known' || current.count === next.count
}

function mergeSourceItemsByHash(currentItemsByHash: Record<string, ImageRecord>, nextItemsByHash: Record<string, ImageRecord>) {
  for (const compositeHash in nextItemsByHash) {
    if (currentItemsByHash[compositeHash] !== nextItemsByHash[compositeHash]) {
      return { ...currentItemsByHash, ...nextItemsByHash }
    }
  }

  return currentItemsByHash
}

function isModalKeyboardEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const tagName = target.tagName
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target.isContentEditable
}

/** Provide a global image view modal for app-shell image browsing flows. */
export function ImageViewModalProvider({ children }: PropsWithChildren) {
  const { canViewImages } = useImagePermissions()
  const queryClient = useQueryClient()
  const [modalState, setModalState] = useState<ImageViewModalState>({
    compositeHash: null,
    compositeHashes: [],
    compositeHashIndexByHash: new Map(),
    sourceId: null,
    sourceItemsByHash: {},
    sequenceTotal: null,
    sequenceHasMore: false,
    openSessionId: 0,
    stripFocusRequestId: 0,
    stripFocusBehavior: null,
    accessOptions: {},
  })


  // Images deleted from the viewer; a source list re-sync that still lists them must not bring them back.
  const removedCompositeHashesRef = useRef(new Set<string>())
  const activeIndex = useMemo(() => getModalActiveIndex(modalState), [modalState])

  const canViewPrevious = activeIndex > 0
  const canViewNext = activeIndex >= 0 && activeIndex < modalState.compositeHashes.length - 1
  const activeSourceItem = modalState.compositeHash ? modalState.sourceItemsByHash[modalState.compositeHash] : null
  const isModalOpen = Boolean(modalState.compositeHash)

  useEffect(() => scheduleImageViewModalOverlayPreload(), [])

  useEffect(() => {
    if (!canViewImages || !modalState.compositeHash || activeIndex < 0) {
      return
    }

    const neighborHashes = [modalState.compositeHashes[activeIndex - 1], modalState.compositeHashes[activeIndex + 1]]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)

    for (const neighborHash of neighborHashes) {
      const neighborImage = modalState.sourceItemsByHash[neighborHash]
      warmImagePreviewSource(neighborImage)
      void queryClient.prefetchQuery({
        queryKey: getImageDetailQueryKey(neighborHash, neighborImage),
        queryFn: () => getImage(neighborHash, undefined, neighborImage),
        staleTime: 0,
      })
    }
  }, [canViewImages, activeIndex, modalState.compositeHash, modalState.compositeHashes, modalState.sourceItemsByHash, queryClient])

  // 썸네일 스트립은 성능 문제로 잠시 비활성화한다.
  // 탐색 컨텍스트 자체는 유지하므로, 필요할 때 UI와 배치 로드만 다시 연결하면 된다.

  /** Open the image view modal with an optional ordered navigation context. */
  const openImageView = useCallback((input: ImageViewModalOpenInput) => {
    if (!canViewImages) return
    const compositeHashes = buildUniqueCompositeHashes(input.compositeHashes)
    const hasInputCompositeHash = compositeHashes.includes(input.compositeHash)
    const nextCompositeHashes = hasInputCompositeHash
      ? compositeHashes
      : [input.compositeHash, ...compositeHashes]
    const nextCompositeHashIndexByHash = buildCompositeHashIndexByHash(nextCompositeHashes)
    const nextSourceItemsByHash = buildSourceItemsByHash(input.sourceItems)
    const activeInputImage = nextSourceItemsByHash[input.compositeHash]

    void loadImageViewModalOverlay()
    warmImagePreviewSource(activeInputImage)
    void queryClient.prefetchQuery({
      queryKey: getImageDetailQueryKey(input.compositeHash, activeInputImage),
      queryFn: () => getImage(input.compositeHash, undefined, activeInputImage),
      staleTime: 0,
    })

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
        compositeHashIndexByHash: nextCompositeHashIndexByHash,
        sourceId: input.sourceId ?? current.sourceId ?? null,
        sourceItemsByHash: isFreshOpen || isSourceChanged
          ? nextSourceItemsByHash
          : { ...current.sourceItemsByHash, ...nextSourceItemsByHash },
        sequenceTotal: input.sequenceTotal ?? null,
        sequenceHasMore: input.sequenceHasMore ?? false,
        openSessionId: isFreshOpen ? current.openSessionId + 1 : current.openSessionId,
        stripFocusRequestId: shouldFocusStrip ? current.stripFocusRequestId + 1 : current.stripFocusRequestId,
        stripFocusBehavior: nextStripFocusBehavior,
        accessOptions: input.accessOptions ?? current.accessOptions,
      }
    })
  }, [canViewImages, queryClient])

  const syncImageViewSequence = useCallback((input: ImageViewModalSyncInput) => {
    setModalState((current) => {
      if (!current.compositeHash || !current.sourceId || current.sourceId !== input.sourceId) {
        return current
      }

      const removedCompositeHashes = removedCompositeHashesRef.current
      const nextCompositeHashes = buildUniqueCompositeHashes(input.compositeHashes)
        .filter((compositeHash) => !removedCompositeHashes.has(compositeHash))
      const nextCompositeHashIndexByHash = buildCompositeHashIndexByHash(nextCompositeHashes)
      if (!nextCompositeHashIndexByHash.has(current.compositeHash)) {
        return current
      }

      const nextSourceItemsByHash = buildSourceItemsByHash(input.sourceItems)
      const mergedSourceItemsByHash = mergeSourceItemsByHash(current.sourceItemsByHash, nextSourceItemsByHash)
      const isSameSequence = areCompositeHashesEqual(current.compositeHashes, nextCompositeHashes)
      const isSameItems = mergedSourceItemsByHash === current.sourceItemsByHash
      const nextSequenceTotal = input.sequenceTotal ?? null
      const nextSequenceHasMore = input.sequenceHasMore ?? false
      const isSameTotal = areSequenceTotalsEqual(current.sequenceTotal, nextSequenceTotal)
        && current.sequenceHasMore === nextSequenceHasMore

      if (isSameSequence && isSameItems && isSameTotal) {
        return current
      }

      return {
        ...current,
        compositeHashes: nextCompositeHashes,
        compositeHashIndexByHash: nextCompositeHashIndexByHash,
        sourceItemsByHash: mergedSourceItemsByHash,
        sequenceTotal: isSameTotal ? current.sequenceTotal : nextSequenceTotal,
        sequenceHasMore: nextSequenceHasMore,
      }
    })
  }, [])

  const closeImageView = useCallback(() => {
    removedCompositeHashesRef.current.clear()
    setModalState(createClosedModalState)
  }, [])

  const removeImageFromView = useCallback((compositeHash: string) => {
    removedCompositeHashesRef.current.add(compositeHash)
    setModalState((current) => {
      const removedIndex = current.compositeHashIndexByHash.get(compositeHash)
      if (removedIndex === undefined) {
        return current.compositeHash === compositeHash ? createClosedModalState(current) : current
      }

      const nextCompositeHashes = current.compositeHashes.filter((candidate) => candidate !== compositeHash)
      const nextActiveCompositeHash = current.compositeHash === compositeHash
        ? nextCompositeHashes[removedIndex] ?? null
        : current.compositeHash
      if (!nextActiveCompositeHash) {
        return createClosedModalState(current)
      }

      const nextSequenceTotal = current.sequenceTotal?.status === 'known'
        ? { status: 'known' as const, count: Math.max(0, current.sequenceTotal.count - 1) }
        : current.sequenceTotal

      return {
        ...current,
        compositeHash: nextActiveCompositeHash,
        compositeHashes: nextCompositeHashes,
        compositeHashIndexByHash: buildCompositeHashIndexByHash(nextCompositeHashes),
        sequenceTotal: nextSequenceTotal,
      }
    })
  }, [])

  useOverlayBackClose({ open: isModalOpen, onClose: closeImageView })

  /** Move to the previous image within the active modal navigation context. */
  const viewPreviousImage = useCallback(() => {
    setModalState((current) => {
      if (!current.compositeHash) {
        return current
      }

      const currentIndex = getModalActiveIndex(current)
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

      const currentIndex = getModalActiveIndex(current)
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
    if (!isModalOpen) {
      return
    }

    const openedAtHref = window.location.href
    const scrollX = window.scrollX
    const scrollY = window.scrollY
    const previousBodyStyle = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      right: document.body.style.right,
      width: document.body.style.width,
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return
      }

      if (event.key === 'Escape') {
        closeImageView()
        return
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (isModalKeyboardEditingTarget(event.target)) {
          return
        }

        event.preventDefault()

        if (event.key === 'ArrowLeft') {
          viewPreviousImage()
          return
        }

        viewNextImage()
      }
    }

    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.left = `-${scrollX}px`
    document.body.style.right = '0'
    document.body.style.width = '100%'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousBodyStyle.overflow
      document.body.style.position = previousBodyStyle.position
      document.body.style.top = previousBodyStyle.top
      document.body.style.left = previousBodyStyle.left
      document.body.style.right = previousBodyStyle.right
      document.body.style.width = previousBodyStyle.width
      window.removeEventListener('keydown', handleKeyDown)

      if (window.location.href === openedAtHref) {
        window.requestAnimationFrame(() => {
          window.scrollTo({ top: scrollY, left: scrollX, behavior: 'instant' as ScrollBehavior })
        })
      }
    }
  }, [closeImageView, isModalOpen, viewNextImage, viewPreviousImage])

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
      removeImageFromView,
    }),
    [activeIndex, canViewNext, canViewPrevious, closeImageView, modalState.compositeHash, modalState.compositeHashes, openImageView, removeImageFromView, syncImageViewSequence, viewNextImage, viewPreviousImage],
  )

  return (
    <ImageViewModalContext.Provider value={contextValue}>
      {children}
      {canViewImages && modalState.compositeHash ? (
        <Suspense fallback={null}>
          <ImageViewModalOverlayLazy
            compositeHash={modalState.compositeHash}
            initialImage={activeSourceItem}
            activeIndex={activeIndex}
            totalCount={modalState.compositeHashes.length}
            sequenceTotal={modalState.sequenceTotal}
            sequenceHasMore={modalState.sequenceHasMore}
            openSessionId={modalState.openSessionId}
            canViewPrevious={canViewPrevious}
            canViewNext={canViewNext}
            accessOptions={modalState.accessOptions}
            onClose={closeImageView}
            onViewPrevious={viewPreviousImage}
            onViewNext={viewNextImage}
          />
        </Suspense>
      ) : null}
    </ImageViewModalContext.Provider>
  )
}
