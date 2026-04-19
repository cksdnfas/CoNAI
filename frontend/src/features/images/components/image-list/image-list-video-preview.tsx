import { type CSSProperties, type DragEventHandler, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import { getImageListPreviewUrl } from './image-list-utils'

const MAX_CONCURRENT_VIDEO_PREVIEW_LOADS = 3
const VIDEO_PREVIEW_VISIBILITY_ROOT_MARGIN = '600px 0px 600px 0px'

interface VideoPreviewLoadTask {
  id: string
  order: number
  getPriorityTop: () => number
  start: () => void
}

let nextVideoPreviewLoadOrder = 0
const pendingVideoPreviewLoadTasks = new Map<string, VideoPreviewLoadTask>()
const activeVideoPreviewLoadTaskIds = new Set<string>()

function getVideoPreviewTaskPriority(task: VideoPreviewLoadTask) {
  return [task.getPriorityTop(), task.order] as const
}

function compareVideoPreviewLoadTasks(left: VideoPreviewLoadTask, right: VideoPreviewLoadTask) {
  const [leftTop, leftOrder] = getVideoPreviewTaskPriority(left)
  const [rightTop, rightOrder] = getVideoPreviewTaskPriority(right)

  if (leftTop !== rightTop) {
    return leftTop - rightTop
  }

  return leftOrder - rightOrder
}

/** Start queued list-video previews in viewport order while keeping concurrent requests low. */
function pumpVideoPreviewLoadQueue() {
  while (activeVideoPreviewLoadTaskIds.size < MAX_CONCURRENT_VIDEO_PREVIEW_LOADS && pendingVideoPreviewLoadTasks.size > 0) {
    const nextTask = [...pendingVideoPreviewLoadTasks.values()].sort(compareVideoPreviewLoadTasks)[0]
    if (!nextTask) {
      return
    }

    pendingVideoPreviewLoadTasks.delete(nextTask.id)
    activeVideoPreviewLoadTaskIds.add(nextTask.id)
    nextTask.start()
  }
}

/** Register one list-video preview load request and return a cleanup callback for it. */
function queueVideoPreviewLoad(task: Omit<VideoPreviewLoadTask, 'order'>) {
  const queuedTask: VideoPreviewLoadTask = {
    ...task,
    order: nextVideoPreviewLoadOrder++,
  }

  pendingVideoPreviewLoadTasks.set(queuedTask.id, queuedTask)
  pumpVideoPreviewLoadQueue()

  return () => {
    pendingVideoPreviewLoadTasks.delete(queuedTask.id)
    if (activeVideoPreviewLoadTaskIds.delete(queuedTask.id)) {
      pumpVideoPreviewLoadQueue()
    }
  }
}

/** Release one active list-video preview slot so the next queued preview can start. */
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

/** Render one list video preview with queued source attachment to avoid burst loading on refresh. */
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
  const [isNearViewport, setIsNearViewport] = useState(false)
  const [isSourceAttached, setIsSourceAttached] = useState(false)
  const [hasLoadedFrame, setHasLoadedFrame] = useState(false)
  const releaseLoadRef = useRef<(() => void) | null>(null)
  const hasReleasedLoadRef = useRef(false)

  useEffect(() => {
    setIsNearViewport(false)
    setIsSourceAttached(false)
    setHasLoadedFrame(false)
    hasReleasedLoadRef.current = false
    releaseLoadRef.current?.()
    releaseLoadRef.current = null
  }, [previewUrl])

  useEffect(() => {
    if (!videoNode) {
      return
    }

    if (typeof IntersectionObserver === 'undefined') {
      setIsNearViewport(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        setIsNearViewport(Boolean(entries[0]?.isIntersecting))
      },
      {
        root: null,
        rootMargin: VIDEO_PREVIEW_VISIBILITY_ROOT_MARGIN,
        threshold: 0,
      },
    )

    observer.observe(videoNode)
    return () => observer.disconnect()
  }, [videoNode])

  useEffect(() => {
    if (!videoNode || isNearViewport) {
      return
    }

    releaseLoadRef.current?.()
    releaseLoadRef.current = null

    if (!isSourceAttached) {
      return
    }

    videoNode.pause()
  }, [isNearViewport, isSourceAttached, videoNode])

  useEffect(() => {
    if (!videoNode || !isNearViewport || !isSourceAttached) {
      return
    }

    void videoNode.play().catch(() => {
      // Visibility transitions can race with browser autoplay rules.
    })
  }, [isNearViewport, isSourceAttached, videoNode])

  useEffect(() => {
    if (!previewUrl || !videoNode || !isNearViewport || isSourceAttached) {
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

        setIsSourceAttached(true)
      },
    })

    return () => {
      cancelled = true
      releaseLoadRef.current?.()
      releaseLoadRef.current = null
    }
  }, [isNearViewport, isSourceAttached, previewUrl, requestId, videoNode])

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
        src={isSourceAttached ? previewUrl : undefined}
        className={cn(
          className,
          'transition-opacity duration-200',
          !hasLoadedFrame && 'opacity-0',
        )}
        muted
        loop
        autoPlay
        playsInline
        preload="metadata"
        draggable={draggable}
        controls={false}
        disablePictureInPicture
        controlsList="nodownload noplaybackrate noremoteplayback"
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
