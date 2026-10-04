import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface MediaHoverPreviewSource {
  /** Shown right away; usually the thumbnail the trigger already loaded. */
  src: string
  /** Swapped in once it has loaded, e.g. the original file. */
  fullSrc?: string | null
  /** A video to play (muted, looped) instead of the still; `src` is its poster while it loads. */
  videoSrc?: string | null
  /** Line under the media. Defaults to the pixel size once `fullSrc` has loaded. */
  caption?: ReactNode
}

const HOVER_DELAY_MS = 300
const VIEWPORT_MARGIN = 12
const ANCHOR_GAP = 12
const MAX_EDGE_PX = 480
const FINE_HOVER_QUERY = '(hover: hover) and (pointer: fine)'

type Size = { width: number; height: number }

function canHover() {
  return typeof window !== 'undefined' && window.matchMedia?.(FINE_HOVER_QUERY).matches === true
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/** Fit the media into the preview box (up to 480px, 40vw × 60vh), upscaling small thumbnails. */
function fitPreviewSize(natural: Size): Size {
  const maxWidth = Math.min(MAX_EDGE_PX, window.innerWidth * 0.4)
  const maxHeight = Math.min(MAX_EDGE_PX, window.innerHeight * 0.6)
  const scale = Math.min(maxWidth / natural.width, maxHeight / natural.height)
  return { width: Math.round(natural.width * scale), height: Math.round(natural.height * scale) }
}

function MediaHoverPreviewCard({ anchor, source }: { anchor: DOMRect; source: MediaHoverPreviewSource }) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [aspectSize, setAspectSize] = useState<Size | null>(null)
  const [fullSize, setFullSize] = useState<Size | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const fullSrc = source.fullSrc && source.fullSrc !== source.src ? source.fullSrc : null
  const videoSrc = source.videoSrc ?? null

  // A video's box is sized from its poster first, so the card can show before the stream's metadata arrives.
  useEffect(() => {
    if (!videoSrc) {
      return
    }
    const poster = new Image()
    poster.onload = () => setAspectSize((current) => current ?? { width: poster.naturalWidth, height: poster.naturalHeight })
    poster.src = source.src
    return () => {
      poster.onload = null
    }
  }, [source.src, videoSrc])

  useEffect(() => {
    if (!fullSrc) {
      return
    }

    const image = new Image()
    image.onload = () => setFullSize({ width: image.naturalWidth, height: image.naturalHeight })
    image.src = fullSrc
    return () => {
      image.onload = null
    }
  }, [fullSrc])

  const displaySize = fullSize ?? aspectSize
  const fittedSize = displaySize ? fitPreviewSize(displaySize) : null
  const fittedWidth = fittedSize?.width ?? null
  const fittedHeight = fittedSize?.height ?? null
  const caption = source.caption ?? (fullSize ? `${fullSize.width} × ${fullSize.height}` : null)

  // Beside the thumbnail: right when it fits, else whichever side has more room; centred on it vertically.
  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card || fittedWidth === null || fittedHeight === null) {
      return
    }

    const { width, height } = card.getBoundingClientRect()
    const spaceRight = window.innerWidth - anchor.right
    const placeRight = spaceRight >= width + ANCHOR_GAP + VIEWPORT_MARGIN || spaceRight >= anchor.left
    const left = placeRight ? anchor.right + ANCHOR_GAP : anchor.left - ANCHOR_GAP - width
    setPosition({
      left: clamp(left, VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN),
      top: clamp(anchor.top + anchor.height / 2 - height / 2, VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN),
    })
  }, [anchor, fittedWidth, fittedHeight, caption])

  return createPortal(
    <div
      ref={cardRef}
      aria-hidden="true"
      className="pointer-events-none fixed z-popover rounded-md bg-surface-high p-2 text-foreground shadow-elevation-2"
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position && fittedSize ? 'visible' : 'hidden' }}
    >
      {videoSrc ? (
        <video
          src={videoSrc}
          poster={source.src}
          muted
          loop
          autoPlay
          playsInline
          disablePictureInPicture
          className="block rounded-sm bg-black object-contain"
          style={fittedSize ?? { width: 1, height: 1 }}
          onLoadedMetadata={(event) => {
            const { videoWidth, videoHeight } = event.currentTarget
            if (videoWidth > 0 && videoHeight > 0) {
              setFullSize({ width: videoWidth, height: videoHeight })
            }
          }}
        />
      ) : (
        <img
          src={fullSize && fullSrc ? fullSrc : source.src}
          alt=""
          className="block rounded-sm object-contain"
          style={fittedSize ?? { width: 1, height: 1 }}
          onLoad={(event) => {
            const { naturalWidth, naturalHeight } = event.currentTarget
            if (naturalWidth > 0 && naturalHeight > 0) {
              setAspectSize((current) => current ?? { width: naturalWidth, height: naturalHeight })
            }
          }}
        />
      )}
      {caption ? <div className="mt-2 max-w-full truncate text-xs tabular-nums text-muted-foreground" style={{ width: fittedSize?.width }}>{caption}</div> : null}
    </div>,
    document.body,
  )
}

/**
 * PC-only enlarged preview beside a thumbnail: spread `triggerProps` on the thumbnail and render `preview` anywhere.
 * It waits a beat before showing and hides on leave, press, scroll or wheel. Touch and coarse pointers never get it.
 */
export function useMediaHoverPreview(source: MediaHoverPreviewSource | null) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const hide = useCallback(() => {
    clearTimer()
    setAnchor(null)
  }, [clearTimer])

  useEffect(() => clearTimer, [clearTimer])

  useEffect(() => {
    if (!anchor) {
      return
    }

    window.addEventListener('scroll', hide, true)
    window.addEventListener('wheel', hide, { passive: true })
    window.addEventListener('blur', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('wheel', hide)
      window.removeEventListener('blur', hide)
    }
  }, [anchor, hide])

  const handlePointerEnter = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse' || !source || !canHover()) {
      return
    }

    const target = event.currentTarget
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      if (target.isConnected) {
        setAnchor(target.getBoundingClientRect())
      }
    }, HOVER_DELAY_MS)
  }, [clearTimer, source])

  return {
    triggerProps: {
      onPointerEnter: handlePointerEnter,
      onPointerLeave: hide,
      onPointerDown: hide,
    },
    preview: anchor && source ? <MediaHoverPreviewCard key={source.src} anchor={anchor} source={source} /> : null,
    hide,
  }
}
