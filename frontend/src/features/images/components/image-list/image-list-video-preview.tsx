import { type CSSProperties, type DragEventHandler, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import { getImageListPreviewUrl } from './image-list-utils'

const MAX_CONCURRENT_INITIAL_VIDEO_PREVIEW_LOADS = 3

type VideoPreviewLoadTask = {
  id: string
  getPriorityTop: () => number
  start: () => void
}

const startedVideoPreviewSources = new Set<string>()
const pendingVideoPreviewLoadTasks = new Map<string, VideoPreviewLoadTask>()
const activeVideoPreviewLoadTaskIds = new Set<string>()

function pumpVideoPreviewLoadQueue() {
  while (
    activeVideoPreviewLoadTaskIds.size < MAX_CONCURRENT_INITIAL_VIDEO_PREVIEW_LOADS
    && pendingVideoPreviewLoadTasks.size > 0
  ) {
    const nextTask = [...pendingVideoPreviewLoadTasks.values()]
      .sort((left, right) => left.getPriorityTop() - right.getPriorityTop())[0]

    if (!nextTask) {
      return
    }

    pendingVideoPreviewLoadTasks.delete(nextTask.id)
    activeVideoPreviewLoadTaskIds.add(nextTask.id)
    nextTask.start()
  }
}

function queueVideoPreviewLoad(task: VideoPreviewLoadTask) {
  pendingVideoPreviewLoadTasks.set(task.id, task)
  pumpVideoPreviewLoadQueue()

  return () => {
    pendingVideoPreviewLoadTasks.delete(task.id)
    if (activeVideoPreviewLoadTaskIds.delete(task.id)) {
      pumpVideoPreviewLoadQueue()
    }
  }
}

function releaseVideoPreviewLoad(taskId: string) {
  if (!activeVideoPreviewLoadTaskIds.delete(taskId)) {
    return
  }

  pumpVideoPreviewLoadQueue()
}

interface ImageListVideoPreviewProps {
  image: ImageRecord
  className?: string
  style?: CSSProperties
  draggable?: boolean
  onDragStart?: DragEventHandler<HTMLVideoElement>
  onError?: () => void
}

/** Render one list video preview while staggering first source attachment from the top of the list. */
export function ImageListVideoPreview({
  image,
  className,
  style,
  draggable = false,
  onDragStart,
  onError,
}: ImageListVideoPreviewProps) {
  const previewUrl = getImageListPreviewUrl(image)
  const requestId = useMemo(
    () => `${String(image.composite_hash ?? image.id ?? 'video-preview')}:${Math.random().toString(36).slice(2)}`,
    [image.composite_hash, image.id],
  )
  const [videoNode, setVideoNode] = useState<HTMLVideoElement | null>(null)
  const [hasLoadedFrame, setHasLoadedFrame] = useState(false)
  const [isSourceEnabled, setIsSourceEnabled] = useState(() => Boolean(previewUrl && startedVideoPreviewSources.has(previewUrl)))
  const releaseLoadRef = useRef<(() => void) | null>(null)
  const hasReleasedLoadRef = useRef(false)

  useEffect(() => {
    setHasLoadedFrame(false)
    hasReleasedLoadRef.current = false
    releaseLoadRef.current?.()
    releaseLoadRef.current = null
    setIsSourceEnabled(Boolean(previewUrl && startedVideoPreviewSources.has(previewUrl)))
  }, [previewUrl])

  useEffect(() => {
    if (!previewUrl || !videoNode || isSourceEnabled) {
      return
    }

    let cancelled = false
    releaseLoadRef.current = queueVideoPreviewLoad({
      id: requestId,
      getPriorityTop: () => videoNode.getBoundingClientRect().top,
      start: () => {
        if (cancelled) {
          releaseVideoPreviewLoad(requestId)
          return
        }

        startedVideoPreviewSources.add(previewUrl)
        setIsSourceEnabled(true)
      },
    })

    return () => {
      cancelled = true
      releaseLoadRef.current?.()
      releaseLoadRef.current = null
    }
  }, [isSourceEnabled, previewUrl, requestId, videoNode])

  const finishActiveLoad = () => {
    if (hasReleasedLoadRef.current) {
      return
    }

    hasReleasedLoadRef.current = true
    releaseLoadRef.current = null
    releaseVideoPreviewLoad(requestId)
  }

  if (!previewUrl) {
    return null
  }

  const handlePreviewReady = () => {
    setHasLoadedFrame(true)
    finishActiveLoad()
  }

  return (
    <div className="relative" style={style}>
      <div
        className={cn(
          'pointer-events-none absolute inset-0 rounded-[inherit] bg-surface-lowest transition-opacity duration-200',
          hasLoadedFrame ? 'opacity-0' : 'animate-pulse opacity-100',
        )}
      />
      <video
        ref={setVideoNode}
        src={isSourceEnabled ? previewUrl : undefined}
        className={cn(
          className,
          'transition-opacity duration-200',
          !hasLoadedFrame && 'opacity-0',
        )}
        muted
        loop
        autoPlay
        playsInline
        preload={isSourceEnabled ? 'metadata' : 'none'}
        draggable={draggable}
        controls={false}
        disablePictureInPicture
        controlsList="nodownload noplaybackrate noremoteplayback"
        onLoadedMetadata={finishActiveLoad}
        onLoadedData={handlePreviewReady}
        onCanPlay={handlePreviewReady}
        onError={() => {
          finishActiveLoad()
          onError?.()
        }}
        onDragStart={onDragStart}
      />
    </div>
  )
}
