import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ImageRecord } from '@/types/image'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ChevronLeft, ChevronRight, Copy, Check, Download, FlipHorizontal, FlipVertical, Info, Pencil, RefreshCcw, RotateCcw, RotateCw, Shuffle, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react'
import PromptDisplay from '@/components/prompt-display'
import { settingsApi } from '@/services/settings-api'
import { buildPreviewMediaUrl } from '@/features/images/components/image-preview-url'
import type { ViewerActionAdapter, ViewerActionHandler } from './viewer-action-adapter'
import { useImageViewerTransform } from './use-image-viewer-transform'
import {
  extractCharacterPrompts,
  formatDate,
  formatFileSize,
  getImageTitle,
  hasMetadataValue,
  isVideoLike,
} from './image-viewer-helpers'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const tag = target.tagName
  return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

interface ImageViewerDialogProps {
  images: ImageRecord[]
  viewerIndex: number | null
  backendOrigin: string
  onViewerIndexChange: (index: number | null) => void
  actionAdapter?: ViewerActionAdapter
}

export function ImageViewerDialog({
  images,
  viewerIndex,
  backendOrigin,
  onViewerIndexChange,
  actionAdapter,
}: ImageViewerDialogProps) {
  const mediaContainerRef = useRef<HTMLDivElement | null>(null)
  const [isTaggerEnabled, setIsTaggerEnabled] = useState(false)
  const [fileInfoMode, setFileInfoMode] = useState<'closed' | 'hover' | 'pinned'>('closed')
  const [copied, setCopied] = useState(false)

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
  const {
    transformStyle,
    zoomIn,
    zoomOut,
    rotateLeft,
    rotateRight,
    flipHorizontal,
    flipVertical,
    reset,
    startDrag,
  } = useImageViewerTransform(activeImage?.composite_hash ?? null)
  const generationFields = useMemo(() => {
    if (!activeImage) {
      return [] as Array<{ key: string; label: string; value: string }>
    }

    const fields = [
      { key: 'tool', label: 'Tool', value: activeImage.ai_metadata?.ai_tool ?? activeImage.ai_tool },
      { key: 'model', label: 'Model', value: activeImage.ai_metadata?.model_name ?? activeImage.model_name },
      { key: 'sampler', label: 'Sampler', value: activeGeneration?.sampler ?? activeImage.sampler },
      { key: 'scheduler', label: 'Scheduler', value: activeGeneration?.scheduler ?? activeImage.scheduler },
      { key: 'seed', label: 'Seed', value: activeGeneration?.seed ?? activeImage.seed },
      { key: 'steps', label: 'Steps', value: activeGeneration?.steps ?? activeImage.steps },
      { key: 'cfg-scale', label: 'CFG', value: activeGeneration?.cfg_scale ?? activeImage.cfg_scale },
      { key: 'denoise-strength', label: 'Denoise', value: activeGeneration?.denoise_strength ?? activeImage.denoise_strength },
      { key: 'batch-size', label: 'Batch size', value: activeGeneration?.batch_size ?? activeImage.batch_size },
      { key: 'batch-index', label: 'Batch index', value: activeGeneration?.batch_index ?? activeImage.batch_index },
      {
        key: 'lora-models',
        label: 'Lora models',
        value: activeImage.ai_metadata?.lora_models ? JSON.stringify(activeImage.ai_metadata.lora_models) : activeImage.lora_models,
      },
    ]

    return fields
      .filter((field) => hasMetadataValue(field.value))
      .map((field) => ({ ...field, value: String(field.value) }))
  }, [activeGeneration, activeImage])

  const fileInfoSummary = useMemo(() => {
    if (!activeImage) {
      return [] as Array<{ key: string; label: string; value: string }>
    }

    const normalizedPath = (activeImage.original_file_path ?? '').replace(/\\/g, '/')
    const segments = normalizedPath.split('/').filter((segment) => segment.length > 0)
    const filename = segments.length > 0 ? segments[segments.length - 1] : normalizedPath

    return [
      { key: 'filename', label: 'Filename', value: filename || '-' },
      { key: 'dimensions', label: 'Dimensions', value: `${activeImage.width} x ${activeImage.height}` },
      { key: 'file-size', label: 'File size', value: formatFileSize(activeImage.file_size) },
      { key: 'first-seen', label: 'First seen', value: activeImage.first_seen_date ? formatDate(activeImage.first_seen_date) : '-' },
    ]
  }, [activeImage])

  const closeViewer = useCallback(() => {
    onViewerIndexChange(null)
    setFileInfoMode('closed')
  }, [onViewerIndexChange])

  const showPrevious = () => {
    if (activeViewerIndex === null || activeViewerIndex <= 0) {
      return
    }
    onViewerIndexChange(activeViewerIndex - 1)
  }

  const showNext = () => {
    if (activeViewerIndex === null || activeViewerIndex >= images.length - 1) {
      return
    }
    onViewerIndexChange(activeViewerIndex + 1)
  }

  useEffect(() => {
    if (activeImage === null || activeViewerIndex === null) {
      return
    }

    const randomHandler = actionAdapter?.random

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTypingTarget(event.target)) {
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        onViewerIndexChange(null)
        setFileInfoMode('closed')
        return
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        if (activeViewerIndex > 0) {
          onViewerIndexChange(activeViewerIndex - 1)
        }
        return
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault()
        if (activeViewerIndex < images.length - 1) {
          onViewerIndexChange(activeViewerIndex + 1)
        }
        return
      }

      const isSpace = event.key === ' ' || event.key === 'Spacebar'
      if (isSpace && randomHandler) {
        event.preventDefault()
        void randomHandler({
          image: activeImage,
          index: activeViewerIndex,
          images,
          closeViewer,
          setViewerIndex: onViewerIndexChange,
        })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [actionAdapter?.random, activeImage, activeViewerIndex, closeViewer, images, onViewerIndexChange])

  useEffect(() => {
    if (activeImage === null) {
      return
    }

    const container = mediaContainerRef.current
    if (!container) {
      return
    }

    let lastZoomTime = 0
    const handleWheel = (event: WheelEvent) => {
      if (!event.cancelable) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const now = Date.now()
      if (now - lastZoomTime < 50) {
        return
      }
      lastZoomTime = now

      if (event.deltaY < 0) {
        zoomIn()
      } else {
        zoomOut()
      }
    }

    container.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      container.removeEventListener('wheel', handleWheel)
    }
  }, [activeImage, zoomIn, zoomOut])

  const runAction = async (handler: ViewerActionHandler | undefined) => {
    if (!handler || activeImage === null || activeViewerIndex === null) {
      return
    }

    await handler({
      image: activeImage,
      index: activeViewerIndex,
      images,
      closeViewer,
      setViewerIndex: onViewerIndexChange,
    })
  }

  const handleFileInfoToggle = () => {
    setFileInfoMode((mode) => (mode === 'closed' ? 'pinned' : 'closed'))
  }

  const isFileInfoOpen = fileInfoMode !== 'closed'

  const hasCustomActions = Boolean(
    actionAdapter?.openDetail
    || actionAdapter?.download
    || actionAdapter?.delete
    || actionAdapter?.random,
  )
  const canRunEditorAction = Boolean(
    actionAdapter?.openEditor
    && activeImage
    && activeViewerIndex !== null
    && (actionAdapter.canOpenEditor
      ? actionAdapter.canOpenEditor({
        image: activeImage,
        index: activeViewerIndex,
        images,
        closeViewer,
        setViewerIndex: onViewerIndexChange,
      })
      : true),
  )
  const hasAnyCustomActions = hasCustomActions || canRunEditorAction
  const visibleViewerTitle = activeViewerIndex !== null ? `Image ${activeViewerIndex + 1} of ${images.length}` : 'Image viewer'

  return (
    <Dialog open={activeImage !== null} onOpenChange={(open) => (open ? undefined : closeViewer())}>
      <DialogContent
        data-testid="image-viewer-dialog"
        className="flex flex-col gap-0 h-[100dvh] w-[100vw] max-h-[100dvh] max-w-[100vw] overflow-hidden p-0 sm:h-[82vh] sm:w-[82vw] sm:max-h-[82vh] sm:max-w-[82vw]"
      >
        <DialogTitle className="sr-only">{visibleViewerTitle}</DialogTitle>
        <DialogDescription className="sr-only">
          {activeViewerIndex !== null ? `Viewing image ${activeViewerIndex + 1} of ${images.length}.` : 'View image in full size.'}
        </DialogDescription>
        {activeImage ? (
          <div className="flex flex-1 min-h-0 flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 sm:px-4">
              <p data-testid="viewer-title" className="text-sm font-semibold">
                {visibleViewerTitle}
              </p>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
              <div ref={mediaContainerRef} className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-muted/20 p-3">
                {isVideoLike(activeImage) ? (
                  <video
                    className="max-h-[74vh] max-w-full rounded-md border bg-black/80 object-contain"
                    src={buildPreviewMediaUrl(activeImage, backendOrigin)}
                    style={transformStyle}
                    onMouseDown={startDrag}
                    controls
                    autoPlay
                    playsInline
                  >
                    <track kind="captions" />
                  </video>
                ) : (
                  <img
                    className="max-h-[74vh] max-w-full rounded-md border bg-black/10 object-contain"
                    src={buildPreviewMediaUrl(activeImage, backendOrigin)}
                    alt={getImageTitle(activeImage, activeViewerIndex ?? 0)}
                    style={transformStyle}
                    onMouseDown={startDrag}
                  />
                )}

                <div className="pointer-events-none absolute bottom-4 left-3 top-4 z-10 flex w-12 flex-col justify-center sm:left-4">
                  <div className="pointer-events-auto flex max-h-full flex-col items-center gap-1 overflow-y-auto rounded-full bg-black/50 py-2 text-white shadow-lg backdrop-blur-md transition-opacity hover:bg-black/70 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0 rounded-full hover:bg-white/20 hover:text-white" onClick={zoomIn} title="Zoom In"><ZoomIn className="h-4 w-4" /></Button>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0 rounded-full hover:bg-white/20 hover:text-white" onClick={zoomOut} title="Zoom Out"><ZoomOut className="h-4 w-4" /></Button>
                    <div className="my-1 h-px w-4 flex-shrink-0 bg-white/20" />
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0 rounded-full hover:bg-white/20 hover:text-white" onClick={rotateLeft} title="Rotate Left"><RotateCcw className="h-4 w-4" /></Button>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0 rounded-full hover:bg-white/20 hover:text-white" onClick={rotateRight} title="Rotate Right"><RotateCw className="h-4 w-4" /></Button>
                    <div className="my-1 h-px w-4 flex-shrink-0 bg-white/20" />
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0 rounded-full hover:bg-white/20 hover:text-white" onClick={flipHorizontal} title="Flip Horizontal"><FlipHorizontal className="h-4 w-4" /></Button>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0 rounded-full hover:bg-white/20 hover:text-white" onClick={flipVertical} title="Flip Vertical"><FlipVertical className="h-4 w-4" /></Button>
                    <div className="my-1 h-px w-4 flex-shrink-0 bg-white/20" />
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0 rounded-full hover:bg-white/20 hover:text-white" onClick={reset} title="Reset"><RefreshCcw className="h-4 w-4" /></Button>

                    {hasAnyCustomActions ? (
                      <>
                        <div className="my-1 h-px w-4 flex-shrink-0 bg-white/20" />
                        {actionAdapter?.openDetail ? (
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0 rounded-full hover:bg-white/20 hover:text-white" onClick={() => void runAction(actionAdapter.openDetail)} title="Detail"><Info className="h-4 w-4" /></Button>
                        ) : null}
                        {canRunEditorAction ? (
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0 rounded-full hover:bg-white/20 hover:text-white" onClick={() => void runAction(actionAdapter?.openEditor)} title="Editor" data-testid="viewer-edit-action"><Pencil className="h-4 w-4" /></Button>
                        ) : null}
                        {actionAdapter?.download ? (
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0 rounded-full hover:bg-white/20 hover:text-white" onClick={() => void runAction(actionAdapter.download)} title="Download"><Download className="h-4 w-4" /></Button>
                        ) : null}
                        {actionAdapter?.random ? (
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0 rounded-full hover:bg-white/20 hover:text-white" onClick={() => void runAction(actionAdapter.random)} title="Random"><Shuffle className="h-4 w-4" /></Button>
                        ) : null}
                        {actionAdapter?.delete ? (
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0 rounded-full text-red-400 hover:bg-red-500/20 hover:text-red-300" onClick={() => void runAction(actionAdapter.delete)} title="Delete"><Trash2 className="h-4 w-4" /></Button>
                        ) : null}
                      </>
                    ) : null}

                    <div className="my-1 h-px w-4 flex-shrink-0 bg-white/20" />
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0 rounded-full hover:bg-white/20 hover:text-white" onClick={showPrevious} disabled={activeViewerIndex === null || activeViewerIndex <= 0} title="Previous"><ChevronLeft className="h-4 w-4" /></Button>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0 rounded-full hover:bg-white/20 hover:text-white" onClick={showNext} disabled={activeViewerIndex === null || activeViewerIndex >= images.length - 1} title="Next"><ChevronRight className="h-4 w-4" /></Button>
                    <div className="my-1 h-px w-4 flex-shrink-0 bg-white/20" />
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0 rounded-full hover:bg-red-500/50 hover:text-white" onClick={closeViewer} title="Close"><X className="h-4 w-4" /></Button>
                  </div>
                </div>
              </div>

              <aside
                data-testid="viewer-sidebar-scroll"
                className="flex flex-col min-h-0 max-h-[50%] w-full flex-shrink-0 border-t bg-background md:h-full md:max-h-none md:w-[320px] md:border-t-0 md:border-l"
              >
                <ScrollArea className="flex-1 min-h-0">
                  <div className="p-3 space-y-4">
                    <section className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => {
                          if (activeImage?.composite_hash) {
                            navigator.clipboard.writeText(activeImage.composite_hash).catch(console.error)
                            setCopied(true)
                            setTimeout(() => setCopied(false), 2000)
                          }
                        }}
                        title="Copy Hash"
                      >
                        {copied ? <Check className="mr-1.5 h-3.5 w-3.5 text-green-500" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
                        {copied ? 'Copied' : 'Copy hash'}
                      </Button>

                      <TooltipProvider delayDuration={200}>
                        <Tooltip
                          open={isFileInfoOpen}
                          onOpenChange={(open) => {
                            if (fileInfoMode === 'pinned') return;
                            setFileInfoMode(open ? 'hover' : 'closed');
                          }}
                        >
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="flex-1"
                              data-testid="viewer-file-info-trigger"
                              onClick={handleFileInfoToggle}
                            >
                              File info
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent
                            side="right"
                            align="start"
                            sideOffset={16}
                            className="bg-background text-foreground border shadow-lg w-auto max-w-[min(90vw,26rem)] p-3 space-y-1 z-[100]"
                          >
                            {fileInfoSummary.map((field) => (
                              <div key={field.key} className="grid grid-cols-[90px_minmax(0,1fr)] gap-2 text-xs">
                                <p className="text-muted-foreground">{field.label}</p>
                                <p className="font-medium break-all">{field.value}</p>
                              </div>
                            ))}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </section>

                    <section className="space-y-2">
                      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Prompt Details</h3>
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
                    </section>

                    <section className="space-y-2">
                      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Generation</h3>
                      {generationFields.length > 0 ? (
                        <div className="grid grid-cols-1 gap-2 text-xs">
                          {generationFields.map((field) => (
                            <div key={field.key} className="flex flex-row items-center justify-between rounded-md border p-2 gap-4">
                              <p className="text-muted-foreground flex-shrink-0">{field.label}</p>
                              <p className="font-medium text-right break-words overflow-wrap-anywhere whitespace-normal">{field.value}</p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </section>

                    {activeImage.groups && activeImage.groups.length > 0 ? (
                      <div className="mt-2 w-full text-xs">
                        <span className="text-muted-foreground">Groups:</span>{' '}
                        {activeImage.groups.map((group) => group.name).join(', ')}
                      </div>
                    ) : null}
                  </div>
                </ScrollArea>
              </aside>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
