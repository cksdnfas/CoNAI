import { useEffect, useMemo, useState } from 'react'
import type { ImageRecord } from '@/types/image'
import { getBackendOrigin } from '@/utils/backend'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import PromptDisplay, { type NaiCharacterPrompt } from '@/components/prompt-display'
import { settingsApi } from '@/services/settings-api'

interface PaginationConfig {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  pageSize: number
  onPageSizeChange: (size: number) => void
}

interface InfiniteScrollConfig {
  hasMore: boolean
  loadMore: () => void
}

interface SelectionConfig {
  selectedIds: number[]
  onSelectionChange: (selectedIds: number[]) => void
}

interface ImageListProps {
  images: ImageRecord[]
  loading: boolean
  viewMode?: 'grid' | 'masonry'
  gridColumns?: number
  selectable?: boolean
  selection?: SelectionConfig
  onSearchClick?: () => void
  contextId?: string
  mode?: 'infinite' | 'pagination'
  infiniteScroll?: InfiniteScrollConfig
  pagination?: PaginationConfig
  total?: number
  showCollectionType?: boolean
  currentGroupId?: number
  isModal?: boolean
}

interface RawNaiParametersShape {
  v4_prompt?: {
    caption?: {
      char_captions?: unknown
    }
  }
}

function getImageTitle(image: ImageRecord, index: number): string {
  if (image.prompt) {
    return image.prompt.slice(0, 80)
  }
  if (image.model_name) {
    return image.model_name
  }
  if (image.composite_hash) {
    return image.composite_hash
  }
  return `Image ${index + 1}`
}

function getPreviewMediaUrl(image: ImageRecord, backendOrigin: string): string {
  const originalPath = image.original_file_path || ''
  const isProcessing = image.is_processing || !image.composite_hash

  if (isProcessing) {
    return `${backendOrigin}/api/images/by-path/${encodeURIComponent(originalPath)}`
  }

  if (image.file_type === 'video' || image.file_type === 'animated') {
    return `${backendOrigin}/api/images/${image.composite_hash}/file`
  }

  return `${backendOrigin}/api/images/${image.composite_hash}/thumbnail`
}

function isVideoLike(image: ImageRecord): boolean {
  return image.file_type === 'video' || image.file_type === 'animated'
}

function formatNullable(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return 'N/A'
  }
  return String(value)
}

function formatFileSize(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'N/A'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  const digits = unitIndex === 0 ? 0 : 2
  return `${size.toFixed(digits)} ${units[unitIndex]}`
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return 'N/A'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return parsed.toLocaleString()
}

function extractCharacterPrompts(rawNaiParameters: unknown): NaiCharacterPrompt[] | undefined {
  const rawNaiParams = rawNaiParameters as RawNaiParametersShape | null | undefined
  const rawCaptions = rawNaiParams?.v4_prompt?.caption?.char_captions
  if (!Array.isArray(rawCaptions)) {
    return undefined
  }

  const normalized = rawCaptions
    .map((entry): NaiCharacterPrompt | null => {
      if (!entry || typeof entry !== 'object') {
        return null
      }

      const candidate = entry as { char_caption?: unknown; centers?: unknown }
      if (typeof candidate.char_caption !== 'string' || candidate.char_caption.trim().length === 0) {
        return null
      }

      const centers = Array.isArray(candidate.centers)
        ? candidate.centers.flatMap((point) => {
            if (!point || typeof point !== 'object') {
              return []
            }

            const typedPoint = point as { x?: unknown; y?: unknown }
            if (typeof typedPoint.x === 'number' && typeof typedPoint.y === 'number') {
              return [{ x: typedPoint.x, y: typedPoint.y }]
            }
            return []
          })
        : []

      return {
        char_caption: candidate.char_caption,
        centers,
      }
    })
    .filter((entry): entry is NaiCharacterPrompt => entry !== null)

  return normalized.length > 0 ? normalized : undefined
}

export default function ImageList({
  images,
  loading,
  viewMode = 'grid',
  gridColumns = 3,
  selectable = false,
  selection,
  onSearchClick,
  mode = 'infinite',
  infiniteScroll,
  pagination,
  total,
  showCollectionType,
  currentGroupId,
  contextId,
  isModal,
}: ImageListProps) {
  void showCollectionType
  void currentGroupId
  void contextId
  void isModal

  const markerColumns = Math.min(10, Math.max(1, Math.floor(gridColumns)))
  const backendOrigin = getBackendOrigin()
  const isMasonryMode = viewMode === 'masonry'
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [isTaggerEnabled, setIsTaggerEnabled] = useState(false)

  const listClassName = isMasonryMode ? 'm-0 list-none p-0' : 'grid gap-2'
  const listStyle = isMasonryMode
    ? { columnCount: markerColumns, columnGap: '0.5rem' }
    : { gridTemplateColumns: `repeat(${markerColumns}, minmax(0, 1fr))` }

  const itemClassName = isMasonryMode ? 'mb-2 inline-block w-full align-top rounded-md border p-3' : 'rounded-md border p-3'
  const itemStyle = isMasonryMode ? { breakInside: 'avoid' as const } : undefined
  const activeViewerIndex = viewerIndex !== null && viewerIndex >= 0 && viewerIndex < images.length ? viewerIndex : null
  const activeImage = activeViewerIndex !== null ? images[activeViewerIndex] : null

  useEffect(() => {
    let cancelled = false

    const loadSettings = async () => {
      try {
        const settings = await settingsApi.getSettings()
        if (!cancelled) {
          setIsTaggerEnabled(settings.tagger.enabled)
        }
      } catch {
        if (!cancelled) {
          setIsTaggerEnabled(false)
        }
      }
    }

    void loadSettings()

    return () => {
      cancelled = true
    }
  }, [])

  const activeGeneration = activeImage?.ai_metadata?.generation_params
  const activePrompts = activeImage?.ai_metadata?.prompts
  const activeCharacterPrompts = useMemo(() => extractCharacterPrompts(activeImage?.ai_metadata?.raw_nai_parameters), [activeImage?.ai_metadata?.raw_nai_parameters])

  const toggleSelection = (id: number) => {
    if (!selection) {
      return
    }
    const selected = selection.selectedIds.includes(id)
    const next = selected
      ? selection.selectedIds.filter((value) => value !== id)
      : [...selection.selectedIds, id]
    selection.onSelectionChange(next)
  }

  const openViewer = (index: number) => {
    setViewerIndex(index)
  }

  const closeViewer = () => {
    setViewerIndex(null)
  }

  const showPrevious = () => {
    if (activeViewerIndex === null || activeViewerIndex <= 0) {
      return
    }
    setViewerIndex(activeViewerIndex - 1)
  }

  const showNext = () => {
    if (activeViewerIndex === null || activeViewerIndex >= images.length - 1) {
      return
    }
    setViewerIndex(activeViewerIndex + 1)
  }

  if (loading) {
    return (
      <div className="space-y-3" data-testid="image-list-root" data-layout-mode={viewMode} data-columns={markerColumns}>
        <div className="py-10 text-center text-sm text-muted-foreground">Loading images...</div>
      </div>
    )
  }

  if (images.length === 0) {
    return (
      <div className="space-y-3" data-testid="image-list-root" data-layout-mode={viewMode} data-columns={markerColumns}>
        <div className="rounded-md border p-6 text-center">
          <p className="text-sm text-muted-foreground">No images available.</p>
          {onSearchClick ? <Button type="button" variant="outline" className="mt-3" onClick={onSearchClick}>Open Search</Button> : null}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="image-list-root" data-layout-mode={viewMode} data-columns={markerColumns}>
      <div className="text-xs text-muted-foreground">Total: {total ?? images.length}</div>
      <ul className={listClassName} style={listStyle}>
        {images.map((image, index) => {
          const id = image.id ?? -1
          const isChecked = Boolean(selection && id !== -1 && selection.selectedIds.includes(id))
          const previewUrl = getPreviewMediaUrl(image, backendOrigin)
          const isVideo = isVideoLike(image)

          const mediaClassName = isMasonryMode
            ? 'w-full h-auto object-contain'
            : 'aspect-square w-full object-cover'

          return (
            <li
              key={`${image.composite_hash || 'image'}-${index}`}
              className={`${itemClassName} group cursor-pointer transition-colors hover:bg-muted/30`}
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
              <div className="mb-2 overflow-hidden rounded-md border bg-muted/20">
                {isVideo ? (
                  <video className={mediaClassName} src={previewUrl} muted loop autoPlay playsInline>
                    <track kind="captions" />
                  </video>
                ) : (
                  <img className={mediaClassName} src={previewUrl} alt={getImageTitle(image, index)} loading="lazy" />
                )}
              </div>

              <div className="flex items-start justify-between gap-2">
                <p className="line-clamp-2 text-sm font-medium leading-snug">{getImageTitle(image, index)}</p>
                {selectable && selection && id !== -1 ? (
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onChange={() => toggleSelection(id)}
                    aria-label={`Select image ${id}`}
                  />
                ) : null}
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-full border px-2 py-0.5 uppercase tracking-wide">{image.file_type}</span>
                <span>{image.width} x {image.height}</span>
              </div>
            </li>
          )
        })}
      </ul>

      <Dialog open={activeImage !== null} onOpenChange={(open) => (open ? undefined : closeViewer())}>
        <DialogContent className="max-h-[92vh] w-[min(96vw,1220px)] max-w-none overflow-hidden p-0">
          <DialogTitle className="sr-only">
            {activeImage ? getImageTitle(activeImage, activeViewerIndex ?? 0) : 'Image viewer'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {activeViewerIndex !== null ? `Viewing image ${activeViewerIndex + 1} of ${images.length}.` : 'View image in full size.'}
          </DialogDescription>
          {activeImage ? (
            <div className="flex h-[min(88vh,920px)] flex-col">
              <div className="flex items-center justify-between gap-2 border-b px-3 py-2 sm:px-4">
                <p className="line-clamp-1 text-sm font-semibold">{getImageTitle(activeImage, activeViewerIndex ?? 0)}</p>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={showPrevious}
                    disabled={activeViewerIndex === null || activeViewerIndex <= 0}
                  >
                    Prev
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={showNext}
                    disabled={activeViewerIndex === null || activeViewerIndex >= images.length - 1}
                  >
                    Next
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={closeViewer}>
                    Close
                  </Button>
                </div>
              </div>

              <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_350px]">
                <div className="flex min-h-0 items-center justify-center overflow-auto bg-muted/20 p-3">
                  {isVideoLike(activeImage) ? (
                    <video
                      className="max-h-[74vh] w-full rounded-md border bg-black/80 object-contain"
                      src={getPreviewMediaUrl(activeImage, backendOrigin)}
                      controls
                      autoPlay
                      playsInline
                    >
                      <track kind="captions" />
                    </video>
                  ) : (
                    <img
                      className="max-h-[74vh] w-full rounded-md border bg-black/10 object-contain"
                      src={getPreviewMediaUrl(activeImage, backendOrigin)}
                      alt={getImageTitle(activeImage, activeViewerIndex ?? 0)}
                    />
                  )}
                </div>

                <aside className="min-h-0 overflow-y-auto border-t bg-background p-3 md:border-t-0 md:border-l">
                  <div className="space-y-4">
                    <section className="space-y-2">
                      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Prompt Details</h3>
                      <div className="rounded-md border bg-muted/10 p-2">
                        <PromptDisplay
                          prompt={activePrompts?.prompt ?? activeImage.prompt}
                          negativePrompt={activePrompts?.negative_prompt ?? activeImage.negative_prompt}
                          showGrouped={true}
                          imageId={activeImage.composite_hash ?? undefined}
                          autoTags={activeImage.auto_tags}
                          isTaggerEnabled={isTaggerEnabled}
                          characterPrompts={activeCharacterPrompts}
                          rawNaiParameters={activeImage.ai_metadata?.raw_nai_parameters ?? null}
                        />
                      </div>
                    </section>

                    <section className="space-y-2">
                      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Generation</h3>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-md border p-2">
                          <p className="text-muted-foreground">Model</p>
                          <p className="font-medium break-words">{formatNullable(activeImage.ai_metadata?.model_name ?? activeImage.model_name)}</p>
                        </div>
                        <div className="rounded-md border p-2">
                          <p className="text-muted-foreground">Tool</p>
                          <p className="font-medium break-words">{formatNullable(activeImage.ai_metadata?.ai_tool ?? activeImage.ai_tool)}</p>
                        </div>
                        <div className="rounded-md border p-2">
                          <p className="text-muted-foreground">Sampler</p>
                          <p className="font-medium break-words">{formatNullable(activeGeneration?.sampler ?? activeImage.sampler)}</p>
                        </div>
                        <div className="rounded-md border p-2">
                          <p className="text-muted-foreground">Scheduler</p>
                          <p className="font-medium break-words">{formatNullable(activeGeneration?.scheduler ?? activeImage.scheduler)}</p>
                        </div>
                        <div className="rounded-md border p-2">
                          <p className="text-muted-foreground">Seed</p>
                          <p className="font-medium break-words">{formatNullable(activeGeneration?.seed ?? activeImage.seed)}</p>
                        </div>
                        <div className="rounded-md border p-2">
                          <p className="text-muted-foreground">Steps</p>
                          <p className="font-medium break-words">{formatNullable(activeGeneration?.steps ?? activeImage.steps)}</p>
                        </div>
                        <div className="rounded-md border p-2">
                          <p className="text-muted-foreground">CFG</p>
                          <p className="font-medium break-words">{formatNullable(activeGeneration?.cfg_scale ?? activeImage.cfg_scale)}</p>
                        </div>
                        <div className="rounded-md border p-2">
                          <p className="text-muted-foreground">Denoise</p>
                          <p className="font-medium break-words">{formatNullable(activeGeneration?.denoise_strength ?? activeImage.denoise_strength)}</p>
                        </div>
                        <div className="rounded-md border p-2">
                          <p className="text-muted-foreground">Batch size</p>
                          <p className="font-medium break-words">{formatNullable(activeGeneration?.batch_size ?? activeImage.batch_size)}</p>
                        </div>
                        <div className="rounded-md border p-2">
                          <p className="text-muted-foreground">Batch index</p>
                          <p className="font-medium break-words">{formatNullable(activeGeneration?.batch_index ?? activeImage.batch_index)}</p>
                        </div>
                        <div className="col-span-2 rounded-md border p-2">
                          <p className="text-muted-foreground">Lora models</p>
                          <p className="font-medium break-words">{formatNullable(activeImage.ai_metadata?.lora_models ? JSON.stringify(activeImage.ai_metadata.lora_models) : activeImage.lora_models)}</p>
                        </div>
                      </div>
                    </section>

                    <section className="space-y-2">
                      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">File Details</h3>
                      <div className="space-y-1 rounded-md border p-2 text-xs">
                        <p><span className="text-muted-foreground">Type:</span> {formatNullable(activeImage.file_type)}</p>
                        <p><span className="text-muted-foreground">Size:</span> {activeImage.width} x {activeImage.height}</p>
                        <p><span className="text-muted-foreground">File size:</span> {formatFileSize(activeImage.file_size)}</p>
                        <p><span className="text-muted-foreground">Rating score:</span> {formatNullable(activeImage.rating_score)}</p>
                        <p><span className="text-muted-foreground">First seen:</span> {formatDate(activeImage.first_seen_date)}</p>
                        <p><span className="text-muted-foreground">Path:</span> <span className="break-all">{formatNullable(activeImage.original_file_path)}</span></p>
                        <p><span className="text-muted-foreground">Hash:</span> <span className="break-all">{formatNullable(activeImage.composite_hash)}</span></p>
                        {activeImage.duration !== null ? (
                          <p><span className="text-muted-foreground">Duration:</span> {activeImage.duration}s</p>
                        ) : null}
                        {activeImage.fps !== null ? (
                          <p><span className="text-muted-foreground">FPS:</span> {activeImage.fps}</p>
                        ) : null}
                        {activeImage.groups && activeImage.groups.length > 0 ? (
                          <p>
                            <span className="text-muted-foreground">Groups:</span>{' '}
                            {activeImage.groups.map((group) => group.name).join(', ')}
                          </p>
                        ) : null}
                      </div>
                    </section>
                  </div>
                </aside>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {mode === 'infinite' && infiniteScroll?.hasMore ? (
        <div className="flex justify-center">
          <Button type="button" variant="outline" onClick={infiniteScroll.loadMore}>Load more</Button>
        </div>
      ) : null}

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
