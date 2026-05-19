import 'plyr/dist/plyr.css'
import './image-detail-media.css'

import type Plyr from 'plyr'
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

function destroyPlyrSafely(player: Plyr | null) {
  if (!player) {
    return
  }

  try {
    player.destroy()
  } catch (error) {
    console.warn('[EnhancedVideoPlayer] Failed to destroy Plyr cleanly.', error)
  }
}

function supportsFullscreen() {
  if (typeof document === 'undefined') {
    return false
  }

  return Boolean(
    document.fullscreenEnabled
    || (document as Document & { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled,
  )
}

function supportsCoarsePointer() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }

  return window.matchMedia('(pointer: coarse)').matches
}

function buildPlyrControls() {
  const coarsePointer = supportsCoarsePointer()
  const controls: Plyr.Options['controls'] = coarsePointer
    ? ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume']
    : ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume']

  if (supportsFullscreen()) {
    controls.push('fullscreen')
  }

  return controls
}

interface EnhancedVideoPlayerProps {
  renderUrl: string
  className?: string
  loop?: boolean
  autoPlay?: boolean
  preload?: 'none' | 'metadata' | 'auto'
}

type MediaSize = {
  width: number
  height: number
}

function getLargestContainedSize(bounds: MediaSize, media: MediaSize): MediaSize | null {
  if (bounds.width <= 0 || bounds.height <= 0 || media.width <= 0 || media.height <= 0) {
    return null
  }

  const mediaRatio = media.width / media.height
  const boundsRatio = bounds.width / bounds.height

  return boundsRatio > mediaRatio
    ? { width: Math.floor(bounds.height * mediaRatio), height: Math.floor(bounds.height) }
    : { width: Math.floor(bounds.width), height: Math.floor(bounds.width / mediaRatio) }
}

/** Render the shared Plyr-based video player used by detail/modal and other full playback surfaces. */
export function EnhancedVideoPlayer({
  renderUrl,
  className,
  loop = false,
  autoPlay = false,
  preload = 'metadata',
}: EnhancedVideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mediaMountRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<Plyr | null>(null)
  const [naturalSize, setNaturalSize] = useState<MediaSize | null>(null)
  const [availableSize, setAvailableSize] = useState<MediaSize | null>(null)

  const updateAvailableSize = useCallback(() => {
    const hostElement = containerRef.current?.parentElement
    if (!hostElement) {
      return
    }

    const rect = hostElement.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      setAvailableSize({ width: rect.width, height: rect.height })
    }
  }, [])

  useEffect(() => {
    setNaturalSize(null)
  }, [renderUrl])

  useEffect(() => {
    updateAvailableSize()

    const hostElement = containerRef.current?.parentElement
    if (!hostElement || typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(updateAvailableSize)
    observer.observe(hostElement)

    return () => observer.disconnect()
  }, [updateAvailableSize])

  useEffect(() => {
    const mountElement = mediaMountRef.current
    if (!mountElement) {
      return
    }

    const previousPlayer = playerRef.current
    playerRef.current = null
    destroyPlyrSafely(previousPlayer)
    mountElement.replaceChildren()

    if (!renderUrl) {
      return
    }

    let disposed = false
    const videoElement = document.createElement('video')
    videoElement.className = 'conai-video-player__media h-full w-full bg-black object-contain'
    videoElement.autoplay = autoPlay
    videoElement.controls = false
    videoElement.loop = loop
    videoElement.playsInline = true
    videoElement.preload = preload
    // Keep full playback on the backend range-streaming URL. Warming videos as
    // full blobs competes with modal navigation and can starve later media loads.
    videoElement.src = renderUrl

    const handleLoadedMetadata = () => {
      if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
        setNaturalSize({ width: videoElement.videoWidth, height: videoElement.videoHeight })
        updateAvailableSize()
      }
    }

    videoElement.addEventListener('loadedmetadata', handleLoadedMetadata)
    mountElement.appendChild(videoElement)

    const setup = async () => {
      try {
        const { default: PlyrClass } = await import('plyr')
        if (disposed || !mountElement.contains(videoElement)) {
          return
        }

        const createdPlayer = new PlyrClass(videoElement, {
          autoplay: autoPlay,
          iconUrl: '/vendor/plyr.svg',
          controls: buildPlyrControls(),
          hideControls: true,
          keyboard: { focused: true, global: false },
          clickToPlay: true,
          resetOnEnd: false,
          seekTime: 5,
          fullscreen: { enabled: supportsFullscreen(), iosNative: true },
          tooltips: { controls: true, seek: true },
          settings: [],
        })

        if (disposed) {
          destroyPlyrSafely(createdPlayer)
          return
        }

        playerRef.current = createdPlayer

        if (autoPlay) {
          void videoElement.play().catch(() => {
            // Browser autoplay policy may still block unmuted playback.
          })
        }
      } catch (error) {
        console.warn('[EnhancedVideoPlayer] Falling back to native video controls.', error)
        videoElement.controls = true
      }
    }

    void setup()

    return () => {
      disposed = true
      videoElement.removeEventListener('loadedmetadata', handleLoadedMetadata)
      videoElement.pause()
      const activePlayer = playerRef.current
      playerRef.current = null
      destroyPlyrSafely(activePlayer)
      mountElement.replaceChildren()
    }
  }, [autoPlay, loop, preload, renderUrl, updateAvailableSize])

  const fittedSize = availableSize && naturalSize ? getLargestContainedSize(availableSize, naturalSize) : null
  const fittedStyle: CSSProperties = fittedSize
    ? { width: fittedSize.width, height: fittedSize.height }
    : {}

  return (
    <div
      ref={containerRef}
      className={cn('conai-video-player relative w-full overflow-hidden rounded-sm bg-black', className)}
      style={{
        ...fittedStyle,
        ['--plyr-color-main' as string]: 'var(--primary)',
        ['--plyr-control-icon-size' as string]: '17px',
        ['--plyr-control-spacing' as string]: '0.56rem',
        ['--plyr-control-radius' as string]: 'var(--radius-sm)',
        ['--plyr-video-control-color' as string]: 'rgb(255 255 255 / 0.82)',
        ['--plyr-video-control-color-hover' as string]: 'rgb(255 255 255 / 0.96)',
        ['--plyr-video-control-background-hover' as string]: 'color-mix(in srgb, var(--primary) 18%, var(--surface-high))',
        ['--plyr-video-controls-background' as string]: 'color-mix(in srgb, var(--theme-floating-surface) 92%, rgb(8 8 10 / 0.86))',
        ['--plyr-menu-background' as string]: 'color-mix(in srgb, var(--surface-container) 94%, rgb(16 16 20 / 0.96))',
        ['--plyr-menu-color' as string]: 'var(--foreground)',
        ['--plyr-menu-radius' as string]: 'var(--radius)',
        ['--plyr-range-thumb-height' as string]: '11px',
        ['--plyr-range-thumb-shadow' as string]: '0 0 0 4px color-mix(in srgb, var(--primary) 18%, transparent)',
        ['--plyr-video-range-track-background' as string]: 'color-mix(in srgb, var(--border) 60%, transparent)',
        ['--plyr-video-progress-buffered-background' as string]: 'color-mix(in srgb, var(--foreground) 10%, transparent)',
      }}
    >
      {!renderUrl ? <div className="absolute inset-0 z-10 animate-pulse bg-surface-lowest" aria-hidden="true" /> : null}
      <div ref={mediaMountRef} className="conai-video-player__mount h-full w-full" />
    </div>
  )
}
