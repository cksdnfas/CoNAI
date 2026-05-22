import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useOverlayBackClose } from '@/components/ui/use-overlay-back-close'
import type { ImageRecord } from '@/types/image'
import { ImageViewModalContext, type ImageViewModalAccessOptions, type ImageViewModalOpenInput } from './image-view-modal-context'
import { getImage } from '@/lib/api-images'

type ImageViewModalOverlayModule = typeof import('./image-view-modal-overlay')
type ImageViewModalOverlayComponent = ImageViewModalOverlayModule['ImageViewModalOverlay']
type IdlePreloadWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

let imageViewModalOverlayLoadPromise: Promise<{ default: ImageViewModalOverlayComponent }> | null = null

function loadImageViewModalOverlay() {
  imageViewModalOverlayLoadPromise ??= import('./image-view-modal-overlay')
    .then((module) => ({ default: module.ImageViewModalOverlay }))
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
  openSessionId: number
  stripFocusRequestId: number
  stripFocusBehavior: ScrollBehavior | null
  accessOptions: ImageViewModalAccessOptions
}

function buildCompositeHashIndexByHash(compositeHashes: string[]) {
  return new Map(compositeHashes.map((compositeHash, index) => [compositeHash, index] as const))
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
  const queryClient = useQueryClient()
  const [modalState, setModalState] = useState<ImageViewModalState>({
    compositeHash: null,
    compositeHashes: [],
    compositeHashIndexByHash: new Map(),
    sourceId: null,
    sourceItemsByHash: {},
    openSessionId: 0,
    stripFocusRequestId: 0,
    stripFocusBehavior: null,
    accessOptions: {},
  })


  const activeIndex = useMemo(() => getModalActiveIndex(modalState), [modalState.compositeHash, modalState.compositeHashIndexByHash])

  const canViewPrevious = activeIndex > 0
  const canViewNext = activeIndex >= 0 && activeIndex < modalState.compositeHashes.length - 1
  const activeSourceItem = modalState.compositeHash ? modalState.sourceItemsByHash[modalState.compositeHash] : null
  const isModalOpen = Boolean(modalState.compositeHash)

  useEffect(() => scheduleImageViewModalOverlayPreload(), [])

  useEffect(() => {
    if (!modalState.compositeHash || activeIndex < 0) {
      return
    }

    const neighborHashes = [modalState.compositeHashes[activeIndex - 1], modalState.compositeHashes[activeIndex + 1]]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)

    for (const neighborHash of neighborHashes) {
      warmImagePreviewSource(modalState.sourceItemsByHash[neighborHash])
      void queryClient.prefetchQuery({
        queryKey: ['image-detail', neighborHash],
        queryFn: () => getImage(neighborHash),
        staleTime: 0,
      })
    }
  }, [activeIndex, modalState.compositeHash, modalState.compositeHashes, modalState.sourceItemsByHash, queryClient])

  // 썸네일 스트립은 성능 문제로 잠시 비활성화한다.
  // 탐색 컨텍스트 자체는 유지하므로, 필요할 때 UI와 배치 로드만 다시 연결하면 된다.

  /** Open the image view modal with an optional ordered navigation context. */
  const openImageView = useCallback((input: ImageViewModalOpenInput) => {
    const compositeHashSet = new Set((input.compositeHashes ?? []).filter((value) => typeof value === 'string' && value.length > 0))
    const compositeHashes = Array.from(compositeHashSet)
    const nextCompositeHashes = compositeHashSet.has(input.compositeHash)
      ? compositeHashes
      : [input.compositeHash, ...compositeHashes]
    const nextCompositeHashIndexByHash = buildCompositeHashIndexByHash(nextCompositeHashes)
    const nextSourceItemsByHash = buildSourceItemsByHash(input.sourceItems)
    const activeInputImage = nextSourceItemsByHash[input.compositeHash]

    void loadImageViewModalOverlay()
    warmImagePreviewSource(activeInputImage)
    void queryClient.prefetchQuery({
      queryKey: ['image-detail', input.compositeHash],
      queryFn: () => getImage(input.compositeHash),
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
        openSessionId: isFreshOpen ? current.openSessionId + 1 : current.openSessionId,
        stripFocusRequestId: shouldFocusStrip ? current.stripFocusRequestId + 1 : current.stripFocusRequestId,
        stripFocusBehavior: nextStripFocusBehavior,
        accessOptions: input.accessOptions ?? current.accessOptions,
      }
    })
  }, [queryClient])

  const syncImageViewSequence = useCallback((input: { compositeHashes: string[]; sourceId: string; sourceItems?: ImageRecord[] }) => {
    setModalState((current) => {
      if (!current.compositeHash || !current.sourceId || current.sourceId !== input.sourceId) {
        return current
      }

      const nextCompositeHashes = Array.from(new Set(input.compositeHashes.filter((value) => typeof value === 'string' && value.length > 0)))
      const nextCompositeHashIndexByHash = buildCompositeHashIndexByHash(nextCompositeHashes)
      if (!nextCompositeHashIndexByHash.has(current.compositeHash)) {
        return current
      }

      const nextSourceItemsByHash = buildSourceItemsByHash(input.sourceItems)
      const mergedSourceItemsByHash = mergeSourceItemsByHash(current.sourceItemsByHash, nextSourceItemsByHash)
      const isSameSequence = areCompositeHashesEqual(current.compositeHashes, nextCompositeHashes)
      const isSameItems = mergedSourceItemsByHash === current.sourceItemsByHash

      if (isSameSequence && isSameItems) {
        return current
      }

      return {
        ...current,
        compositeHashes: nextCompositeHashes,
        compositeHashIndexByHash: nextCompositeHashIndexByHash,
        sourceItemsByHash: mergedSourceItemsByHash,
      }
    })
  }, [])

  const closeImageView = useCallback(() => {
    setModalState((current) => ({
      compositeHash: null,
      compositeHashes: [],
      compositeHashIndexByHash: new Map(),
      sourceId: null,
      sourceItemsByHash: {},
      openSessionId: current.openSessionId,
      stripFocusRequestId: current.stripFocusRequestId,
      stripFocusBehavior: null,
      accessOptions: {},
    }))
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
    }),
    [activeIndex, canViewNext, canViewPrevious, closeImageView, modalState.compositeHash, modalState.compositeHashes, openImageView, syncImageViewSequence, viewNextImage, viewPreviousImage],
  )

  return (
    <ImageViewModalContext.Provider value={contextValue}>
      {children}
      {modalState.compositeHash ? (
        <Suspense fallback={null}>
          <ImageViewModalOverlayLazy
            compositeHash={modalState.compositeHash}
            initialImage={activeSourceItem}
            activeIndex={activeIndex}
            totalCount={modalState.compositeHashes.length}
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
