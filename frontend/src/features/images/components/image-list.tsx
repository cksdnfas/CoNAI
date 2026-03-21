import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ImageRecord } from '@/types/image'
import { getBackendOrigin } from '@/utils/backend'
import { Button } from '@/components/ui/button'
import { imageApi } from '@/services/image-api'
import { buildPreviewMediaUrl } from '@/features/images/components/image-preview-url'
import { ImageViewerDialog } from '@/features/images/viewer/image-viewer-dialog'
import { ImageEditorModal } from '@/features/images/editor/image-editor-modal'
import { getImageTitle, isVideoLike } from '@/features/images/viewer/image-viewer-helpers'
import type { ViewerActionContext } from '@/features/images/viewer/viewer-action-adapter'
import {
  type ImageListAdapterPolicy,
  type ImageListSelectionConfig,
  createInfiniteImageListAdapter,
  getImageStableIdentity,
} from './image-list-contract'
import './image-list.css'

interface ImageListProps {
  images: ImageRecord[]
  loading: boolean
  viewMode?: 'grid' | 'masonry'
  gridColumns?: number
  selectable?: boolean
  selection?: ImageListSelectionConfig
  adapter?: ImageListAdapterPolicy
}

const DEFAULT_IMAGE_LIST_ADAPTER = createInfiniteImageListAdapter({
  infiniteScroll: {
    hasMore: false,
    loadMore: () => undefined,
  },
})


export default function ImageList({
  images,
  loading,
  viewMode = 'grid',
  gridColumns = 3,
  selectable = false,
  selection,
  adapter = DEFAULT_IMAGE_LIST_ADAPTER,
}: ImageListProps) {
  const { mode, infiniteScroll, pagination, total, capabilities, viewerActions, viewerEditor } = adapter

  const markerColumns = Math.min(10, Math.max(1, Math.floor(gridColumns)))
  const backendOrigin = getBackendOrigin()
  const isMasonryMode = viewMode === 'masonry'
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [viewerImages, setViewerImages] = useState<ImageRecord[]>(images)
  const [editorSession, setEditorSession] = useState<{ fileId: number; compositeHash: string; index: number } | null>(null)
  const [lastCheckedIndex, setLastCheckedIndex] = useState<number | null>(null)

  const sentinelRef = useRef<HTMLDivElement>(null)
  const infiniteScrollCycleKey = infiniteScroll?.rawDataLength ?? viewerImages.length

  const infiniteScrollStateRef = useRef({ loadMore: infiniteScroll?.loadMore, loading })
  useEffect(() => {
    infiniteScrollStateRef.current = { loadMore: infiniteScroll?.loadMore, loading }
  }, [infiniteScroll?.loadMore, loading])

  useEffect(() => {
    if (mode !== 'infinite') return
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const hasMore = infiniteScroll?.hasMore ?? false
    if (!hasMore) return

    const rootElement = sentinel.closest('[data-slot="scroll-area-viewport"], [data-radix-scroll-area-viewport]') || null

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          const { loadMore, loading: currentLoading } = infiniteScrollStateRef.current
          if (loadMore && !currentLoading) {
            loadMore()
          }
        }
      },
      { root: rootElement, rootMargin: '400px', threshold: 0 },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [infiniteScrollCycleKey, mode, infiniteScroll?.hasMore])

  useEffect(() => {
    setViewerImages(images)
  }, [images])

  const canEditImage = useCallback((image: ImageRecord) => {
    return image.file_type === 'image' && Boolean(image.composite_hash)
  }, [])

  const handleOpenEditor = useCallback(async (context: { image: ImageRecord; index: number }) => {
    const { image, index } = context
    if (!canEditImage(image)) {
      return
    }

    let resolvedImage = image
    if (typeof resolvedImage.file_id !== 'number' || resolvedImage.file_id <= 0) {
      try {
        const response = await imageApi.getImage(resolvedImage.composite_hash as string)
        if (!response.success || !response.data || typeof response.data.file_id !== 'number' || response.data.file_id <= 0) {
          return
        }
        resolvedImage = response.data
        setViewerImages((current) => current.map((value, currentIndex) => (currentIndex === index ? response.data as ImageRecord : value)))
      } catch {
        return
      }
    }

    setEditorSession({
      fileId: resolvedImage.file_id as number,
      compositeHash: resolvedImage.composite_hash as string,
      index,
    })
  }, [canEditImage])

  const handleEditorSaved = useCallback(async () => {
    if (!editorSession) {
      return
    }

    let refreshedImage: ImageRecord | null = null

    try {
      const response = await imageApi.getImage(editorSession.compositeHash)
      if (response.success && response.data) {
        refreshedImage = response.data
        setViewerImages((current) => current.map((image, index) => (index === editorSession.index ? response.data as ImageRecord : image)))
      }
    } catch {
      refreshedImage = null
    }

    const callbackImage = refreshedImage ?? viewerImages[editorSession.index]
    if (callbackImage) {
      await viewerEditor?.onSave?.({
        image: callbackImage,
        index: editorSession.index,
        images: viewerImages,
      })
    }
  }, [editorSession, viewerEditor, viewerImages])

  const effectiveViewerActions = useMemo(() => {
    const externalOpenEditor = viewerActions?.openEditor

    return {
      ...viewerActions,
      canOpenEditor: (context: ViewerActionContext) => {
        if (!canEditImage(context.image)) {
          return false
        }

        if (viewerActions?.canOpenEditor) {
          return viewerActions.canOpenEditor(context)
        }

        return true
      },
      openEditor: externalOpenEditor ?? ((context: ViewerActionContext) => {
        handleOpenEditor({ image: context.image, index: context.index })
      }),
    }
  }, [canEditImage, handleOpenEditor, viewerActions])

  const listClassName = isMasonryMode ? 'grid gap-2' : 'grid gap-2'
  const listStyle = isMasonryMode
    ? { gridTemplateColumns: `repeat(${markerColumns}, minmax(0, 1fr))`, alignItems: 'start' as const }
    : { gridTemplateColumns: `repeat(${markerColumns}, minmax(0, 1fr))` }

  const itemStyle = undefined

  // Custom Masonry Distribution
  const masonryColumns = useMemo(() => {
    if (!isMasonryMode) return []
    const cols = Array.from({ length: markerColumns }, () => [] as { image: ImageRecord; index: number }[])
    const heights = Array.from({ length: markerColumns }, () => 0)

    viewerImages.forEach((image, index) => {
      const shortestIndex = heights.indexOf(Math.min(...heights))
      cols[shortestIndex].push({ image, index })
      const ratio = (image.height && image.width) ? image.height / image.width : 1.5
      heights[shortestIndex] += ratio
    })
    return cols
  }, [isMasonryMode, markerColumns, viewerImages])

  const supportsStableSelection = Boolean(selection?.onStableSelectionChange)

  const toggleSelection = (numericId: number | null, stableKey: string, index: number, isShiftKey: boolean, isCurrentlyChecked: boolean) => {
    if (!selection) {
      return
    }

    if (supportsStableSelection && selection.onStableSelectionChange) {
      const currentStableKeys = selection.selectedStableKeys ?? []
      if (isShiftKey && lastCheckedIndex !== null) {
        const start = Math.min(lastCheckedIndex, index)
        const end = Math.max(lastCheckedIndex, index)
        const imagesToSelect = viewerImages.slice(start, end + 1)
        const keysToSelect = imagesToSelect.map((img, i) => getImageStableIdentity(img, start + i).stableKey)

        if (isCurrentlyChecked) {
          const keysToRemove = new Set(keysToSelect)
          const next = currentStableKeys.filter(key => !keysToRemove.has(key))
          selection.onStableSelectionChange(next)
        } else {
          const next = Array.from(new Set([...currentStableKeys, ...keysToSelect]))
          selection.onStableSelectionChange(next)
        }
      } else {
        const next = isCurrentlyChecked
          ? currentStableKeys.filter((value) => value !== stableKey)
          : [...currentStableKeys, stableKey]
        selection.onStableSelectionChange(next)
      }
      setLastCheckedIndex(index)
      return
    }

    if (numericId === null) {
      return
    }

    if (isShiftKey && lastCheckedIndex !== null) {
      const start = Math.min(lastCheckedIndex, index)
      const end = Math.max(lastCheckedIndex, index)
      const imagesToSelect = viewerImages.slice(start, end + 1)
      const idsToSelect = imagesToSelect
        .map((img, i) => getImageStableIdentity(img, start + i).numericId)
        .filter((id): id is number => id !== null)

      if (isCurrentlyChecked) {
        const idsToRemove = new Set(idsToSelect)
        const next = selection.selectedIds.filter(id => !idsToRemove.has(id))
        selection.onSelectionChange(next)
      } else {
        const next = Array.from(new Set([...selection.selectedIds, ...idsToSelect]))
        selection.onSelectionChange(next)
      }
    } else {
      const next = isCurrentlyChecked
        ? selection.selectedIds.filter((value) => value !== numericId)
        : [...selection.selectedIds, numericId]
      selection.onSelectionChange(next)
    }
    setLastCheckedIndex(index)
  }

  const openViewer = (index: number) => {
    setViewerIndex(index)
  }

  if (loading && viewerImages.length === 0) {
    return (
      <div className="space-y-3" data-testid="image-list-root" data-layout-mode={viewMode} data-columns={markerColumns}>
        <div className="py-10 text-center text-sm text-muted-foreground">Loading images...</div>
      </div>
    )
  }

  if (viewerImages.length === 0) {
    return (
      <div className="space-y-3" data-testid="image-list-root" data-layout-mode={viewMode} data-columns={markerColumns}>
        <div className="rounded-md border p-6 text-center">
          <p className="text-sm text-muted-foreground">No images available.</p>
          {capabilities?.emptyStateAction ? (
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              onClick={capabilities.emptyStateAction.onClick}
            >
              {capabilities.emptyStateAction.label ?? 'Open Search'}
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="image-list-root" data-layout-mode={viewMode} data-columns={markerColumns}>
      <div className="text-xs text-muted-foreground">Total: {total ?? viewerImages.length}</div>
      {mode === 'infinite' ? (
        <>
          {isMasonryMode ? (
            <div className="flex gap-2 items-start">
              {masonryColumns.map((column, colIdx) => (
                <div key={colIdx} className="flex-1 flex flex-col gap-2">
                  {column.map(({ image, index }) => {
                    const stableIdentity = getImageStableIdentity(image, index)
                    const numericId = stableIdentity.numericId
                    const isChecked = Boolean(
                      selection
                      && (supportsStableSelection
                        ? (selection.selectedStableKeys ?? []).includes(stableIdentity.stableKey)
                        : (numericId !== null && selection.selectedIds.includes(numericId))),
                    )
                    const previewUrl = buildPreviewMediaUrl(image, backendOrigin)
                    const isVideo = isVideoLike(image)

                    return (
                      <div
                        key={stableIdentity.stableKey}
                        className="group cursor-pointer"
                        data-testid="image-list-item"
                        onClick={() => openViewer(index)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            openViewer(index)
                          }
                        }}
                      >
                        <div className="relative overflow-hidden rounded-md border bg-muted/20">
                          {selectable && selection && (numericId !== null || supportsStableSelection) ? (
                            <div className="absolute left-2 top-2 z-10 rounded bg-background/50 p-1 opacity-70 backdrop-blur-sm transition-opacity hover:opacity-100">
                              <input
                                type="checkbox"
                                className="m-0 block h-4 w-4 cursor-pointer accent-primary"
                                checked={isChecked}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  if (event.shiftKey) {
                                    event.preventDefault()
                                    toggleSelection(numericId, stableIdentity.stableKey, index, true, isChecked)
                                  }
                                }}
                                onPointerDown={(event) => event.stopPropagation()}
                                onChange={() => toggleSelection(numericId, stableIdentity.stableKey, index, false, isChecked)}
                                aria-label={`Select image ${numericId ?? stableIdentity.stableKey}`}
                              />
                            </div>
                          ) : null}
                          {isVideo ? (
                            <video className="w-full h-auto object-contain" src={previewUrl} muted loop autoPlay playsInline>
                              <track kind="captions" />
                            </video>
                          ) : (
                            <img className="w-full h-auto object-contain" src={previewUrl} alt={getImageTitle(image, index)} loading="lazy" />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          ) : (
            <ul className={listClassName} style={listStyle}>
              {viewerImages.map((image, index) => {
                const stableIdentity = getImageStableIdentity(image, index)
                const numericId = stableIdentity.numericId
                const isChecked = Boolean(
                  selection
                  && (supportsStableSelection
                    ? (selection.selectedStableKeys ?? []).includes(stableIdentity.stableKey)
                    : (numericId !== null && selection.selectedIds.includes(numericId))),
                )
                const previewUrl = buildPreviewMediaUrl(image, backendOrigin)
                const isVideo = isVideoLike(image)

                return (
                  <li
                    key={stableIdentity.stableKey}
                    className="group cursor-pointer"
                    style={itemStyle}
                    data-testid="image-list-item"
                    onClick={() => openViewer(index)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openViewer(index)
                      }
                    }}
                  >
                    <div className="relative overflow-hidden rounded-md border bg-muted/20">
                      {selectable && selection && (numericId !== null || supportsStableSelection) ? (
                        <div className="absolute left-2 top-2 z-10 rounded bg-background/50 p-1 opacity-70 backdrop-blur-sm transition-opacity hover:opacity-100">
                          <input
                            type="checkbox"
                            className="m-0 block h-4 w-4 cursor-pointer accent-primary"
                            checked={isChecked}
                            onClick={(event) => {
                              event.stopPropagation()
                              if (event.shiftKey) {
                                event.preventDefault()
                                toggleSelection(numericId, stableIdentity.stableKey, index, true, isChecked)
                              }
                            }}
                            onPointerDown={(event) => event.stopPropagation()}
                            onChange={() => toggleSelection(numericId, stableIdentity.stableKey, index, false, isChecked)}
                            aria-label={`Select image ${numericId ?? stableIdentity.stableKey}`}
                          />
                        </div>
                      ) : null}
                      {isVideo ? (
                        <video className="aspect-square w-full object-cover" src={previewUrl} muted loop autoPlay playsInline>
                          <track kind="captions" />
                        </video>
                      ) : (
                        <img className="aspect-square w-full object-cover" src={previewUrl} alt={getImageTitle(image, index)} loading="lazy" />
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          {(infiniteScroll?.hasMore ?? false) ? (
            <div ref={sentinelRef} className="flex justify-center py-4">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : null}
        </>
      ) : (
        <ul className={listClassName} style={listStyle}>
          {viewerImages.map((image, index) => {
            const stableIdentity = getImageStableIdentity(image, index)
            const numericId = stableIdentity.numericId
            const isChecked = Boolean(
              selection
              && (supportsStableSelection
                ? (selection.selectedStableKeys ?? []).includes(stableIdentity.stableKey)
                : (numericId !== null && selection.selectedIds.includes(numericId))),
            )
            const previewUrl = buildPreviewMediaUrl(image, backendOrigin)
            const isVideo = isVideoLike(image)

            const mediaClassName = isMasonryMode
              ? 'w-full h-auto object-contain'
              : 'aspect-square w-full object-cover'

            return (
              <li
                key={stableIdentity.stableKey}
                className="group cursor-pointer"
                style={itemStyle}
                data-testid="image-list-item"
                onClick={() => openViewer(index)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    openViewer(index)
                  }
                }}
              >
                <div className="relative overflow-hidden rounded-md border bg-muted/20">
                  {selectable && selection && (numericId !== null || supportsStableSelection) ? (
                    <div className="absolute left-2 top-2 z-10 rounded bg-background/50 p-1 opacity-70 backdrop-blur-sm transition-opacity hover:opacity-100">
                      <input
                        type="checkbox"
                        className="m-0 block h-4 w-4 cursor-pointer accent-primary"
                        checked={isChecked}
                        onClick={(event) => {
                          event.stopPropagation()
                          if (event.shiftKey) {
                            event.preventDefault()
                            toggleSelection(numericId, stableIdentity.stableKey, index, true, isChecked)
                          }
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onChange={() => toggleSelection(numericId, stableIdentity.stableKey, index, false, isChecked)}
                        aria-label={`Select image ${numericId ?? stableIdentity.stableKey}`}
                      />
                    </div>
                  ) : null}
                  {isVideo ? (
                    <video className={mediaClassName} src={previewUrl} muted loop autoPlay playsInline>
                      <track kind="captions" />
                    </video>
                  ) : (
                    <img className={mediaClassName} src={previewUrl} alt={getImageTitle(image, index)} loading="lazy" />
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <ImageViewerDialog
        images={viewerImages}
        viewerIndex={viewerIndex}
        backendOrigin={backendOrigin}
        onViewerIndexChange={setViewerIndex}
        actionAdapter={effectiveViewerActions}
      />

      <ImageEditorModal
        open={editorSession !== null}
        fileId={editorSession?.fileId ?? null}
        onOpenChange={(open) => {
          if (!open) {
            setEditorSession(null)
          }
        }}
        onSaved={handleEditorSaved}
      />

      {/* For pagination mode, keep the old UI. InfiniteScroll handles the loader for infinite mode. */}

      {mode === 'pagination' && pagination ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pagination.currentPage <= 1}
              onClick={() => pagination.onPageChange(Math.max(1, pagination.currentPage - 1))}
            >
              Prev
            </Button>
            <span>
              Page {pagination.currentPage} / {Math.max(pagination.totalPages, 1)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pagination.currentPage >= pagination.totalPages}
              onClick={() => pagination.onPageChange(Math.min(pagination.totalPages, pagination.currentPage + 1))}
            >
              Next
            </Button>
          </div>
          <select
            className="rounded-md border bg-background px-2 py-1"
            value={pagination.pageSize}
            onChange={(event) => pagination.onPageSizeChange(Number(event.target.value))}
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
      ) : null}
    </div>
  )
}
