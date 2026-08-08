import { type CSSProperties, type DragEventHandler, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import { getImageListPreviewUrl } from './image-list-utils'

/**
 * 뷰포트 진입 직전에 미리 스트리밍을 시작시키는 여유 마진.
 * 원본 영상은 페이지당 수십 MB 라서, 화면 밖 카드까지 미리 받는 것은 금물이다.
 */
const VIDEO_PREVIEW_VIEWPORT_ROOT_MARGIN = '200px 0px'

interface ImageListVideoPreviewProps {
  image: ImageRecord
  className?: string
  style?: CSSProperties
  draggable?: boolean
  onDragStart?: DragEventHandler<HTMLVideoElement>
  onError?: () => void
  /** 블러 카드는 포스터만 보여주고 원본 영상 스트리밍을 아예 시작하지 않는다. */
  suspendPlayback?: boolean
}

/**
 * 포스터 우선 비디오 프리뷰.
 *
 * 카드의 첫 페인트는 항상 webp 포스터(`thumbnail_url`)가 담당하고, `<video>` 는 뷰포트에
 * 들어온 카드에만 마운트한다. 뷰포트를 벗어나면 언마운트해서 디코더와 네트워크를 반납한다 —
 * 포스터가 즉시 자리를 지키므로 스크롤 복귀 시 빈 칸이 보이지 않는다.
 * 포스터가 아직 없는 과거 미디어는 종전처럼 뷰포트 안에서 영상 메타데이터 로드로 폴백한다
 * (포스터 백필은 백엔드 후처리 잡 담당).
 */
export function ImageListVideoPreview({
  image,
  className,
  style,
  draggable = false,
  onDragStart,
  onError,
  suspendPlayback = false,
}: ImageListVideoPreviewProps) {
  const previewUrl = getImageListPreviewUrl(image)
  const posterUrl = image.thumbnail_url || null
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [isInViewport, setIsInViewport] = useState(false)
  const [hasLoadedFrame, setHasLoadedFrame] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof IntersectionObserver === 'undefined') {
      setIsInViewport(true)
      return
    }

    const observer = new IntersectionObserver((entries) => {
      setIsInViewport(entries.some((entry) => entry.isIntersecting))
    }, { rootMargin: VIDEO_PREVIEW_VIEWPORT_ROOT_MARGIN })

    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const shouldMountVideo = Boolean(previewUrl) && isInViewport && !suspendPlayback

  // 영상이 내려가거나 소스가 바뀌면 다음 마운트의 첫 프레임 전까지 포스터가 다시 자리를 지킨다.
  useEffect(() => {
    setHasLoadedFrame(false)
  }, [previewUrl, shouldMountVideo])

  if (!previewUrl && !posterUrl) {
    return null
  }

  const handlePreviewReady = () => {
    setHasLoadedFrame(true)
  }

  return (
    <div ref={containerRef} className="relative" style={style}>
      {shouldMountVideo ? (
        <video
          key={previewUrl}
          src={previewUrl ?? undefined}
          poster={posterUrl ?? undefined}
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
            onError?.()
          }}
          onDragStart={onDragStart}
        />
      ) : null}
      {posterUrl ? (
        <img
          src={posterUrl}
          alt=""
          aria-hidden
          className={cn(
            className,
            'pointer-events-none absolute inset-0 transition-opacity duration-200',
            shouldMountVideo && hasLoadedFrame && 'opacity-0',
          )}
          loading="lazy"
          draggable={false}
        />
      ) : (
        <div
          className={cn(
            'pointer-events-none absolute inset-0 rounded-[inherit] bg-surface-lowest transition-opacity duration-200',
            shouldMountVideo && hasLoadedFrame ? 'opacity-0' : 'opacity-100',
            shouldMountVideo && !hasLoadedFrame && 'animate-pulse',
          )}
        />
      )}
    </div>
  )
}
