import 'plyr/dist/plyr.css'
import './image-detail-media.css'

import type Plyr from 'plyr'
import { useEffect, useRef, useState } from 'react'
import { useCachedVideoSource } from '@/features/images/components/video/use-cached-video-source'
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

function bindVolumePopoverBehavior(
  container: HTMLDivElement,
  isOpenRef: { current: boolean },
  setOpen: (open: boolean) => void,
) {
  const volumeRoot = container.querySelector('.plyr__volume')
  const muteButton = volumeRoot?.querySelector('[data-plyr="mute"]')
  const volumeInput = volumeRoot?.querySelector('input[type="range"]')

  if (!(volumeRoot instanceof HTMLElement) || !(muteButton instanceof HTMLButtonElement) || !(volumeInput instanceof HTMLInputElement)) {
    setOpen(false)
    return () => {}
  }

  const open = () => {
    setOpen(true)
    window.setTimeout(() => {
      volumeInput.focus({ preventScroll: true })
    }, 0)
  }

  const close = () => {
    setOpen(false)
  }

  const handleMuteButtonClick = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()

    if (isOpenRef.current) {
      close()
      return
    }

    open()
  }

  const handleDocumentPointerDown = (event: PointerEvent) => {
    const target = event.target
    if (target instanceof Node && volumeRoot.contains(target)) {
      return
    }

    close()
  }

  const handleEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      close()
    }
  }

  const handleFocusOut = (event: FocusEvent) => {
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && volumeRoot.contains(nextTarget)) {
      return
    }

    window.setTimeout(() => {
      const activeElement = document.activeElement
      if (!(activeElement instanceof Node) || !volumeRoot.contains(activeElement)) {
        close()
      }
    }, 0)
  }

  muteButton.addEventListener('click', handleMuteButtonClick, true)
  volumeRoot.addEventListener('focusout', handleFocusOut)
  document.addEventListener('pointerdown', handleDocumentPointerDown, true)
  document.addEventListener('keydown', handleEscape)

  return () => {
    muteButton.removeEventListener('click', handleMuteButtonClick, true)
    volumeRoot.removeEventListener('focusout', handleFocusOut)
    document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
    document.removeEventListener('keydown', handleEscape)
    close()
  }
}

interface EnhancedVideoPlayerProps {
  renderUrl: string
  className?: string
  loop?: boolean
  autoPlay?: boolean
  preload?: 'none' | 'metadata' | 'auto'
}

/** Render the shared Plyr-based video player used by detail/modal and other full playback surfaces. */
export function EnhancedVideoPlayer({
  renderUrl,
  className,
  loop = false,
  autoPlay = false,
  preload = 'metadata',
}: EnhancedVideoPlayerProps) {
  const { resolvedSourceUrl } = useCachedVideoSource(renderUrl)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const playerRef = useRef<Plyr | null>(null)
  const volumePopoverOpenRef = useRef(false)
  const [useNativeControlsFallback, setUseNativeControlsFallback] = useState(false)
  const [isVolumePopoverOpen, setIsVolumePopoverOpen] = useState(false)

  useEffect(() => {
    volumePopoverOpenRef.current = isVolumePopoverOpen
  }, [isVolumePopoverOpen])

  useEffect(() => {
    setUseNativeControlsFallback(false)
    setIsVolumePopoverOpen(false)
  }, [resolvedSourceUrl])

  useEffect(() => {
    if (!resolvedSourceUrl) {
      const activePlayer = playerRef.current
      playerRef.current = null
      destroyPlyrSafely(activePlayer)
      return
    }

    let disposed = false
    let cleanupVolumePopover = () => {}

    const setup = async () => {
      const node = videoRef.current
      if (!node) {
        return
      }

      const previousPlayer = playerRef.current
      playerRef.current = null
      destroyPlyrSafely(previousPlayer)

      try {
        const { default: PlyrClass } = await import('plyr')
        if (disposed || videoRef.current !== node) {
          return
        }

        const createdPlayer = new PlyrClass(node, {
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

        if (disposed || videoRef.current !== node) {
          destroyPlyrSafely(createdPlayer)
          return
        }

        playerRef.current = createdPlayer

        if (containerRef.current) {
          cleanupVolumePopover = bindVolumePopoverBehavior(containerRef.current, volumePopoverOpenRef, setIsVolumePopoverOpen)
        }

        if (autoPlay) {
          void node.play().catch(() => {
            // Browser autoplay policy may still block unmuted playback.
          })
        }
      } catch (error) {
        console.warn('[EnhancedVideoPlayer] Falling back to native video controls.', error)
        cleanupVolumePopover()
        setUseNativeControlsFallback(true)
      }
    }

    void setup()

    return () => {
      disposed = true
      cleanupVolumePopover()
      const activePlayer = playerRef.current
      playerRef.current = null
      destroyPlyrSafely(activePlayer)
    }
  }, [autoPlay, resolvedSourceUrl])

  return (
    <div
      ref={containerRef}
      className={cn(
        'conai-video-player relative w-full overflow-hidden rounded-sm bg-black',
        isVolumePopoverOpen && 'conai-video-player--volume-open',
        className,
      )}
      style={{
        ['--plyr-color-main' as string]: 'var(--primary)',
        ['--plyr-control-icon-size' as string]: '17px',
        ['--plyr-control-spacing' as string]: '0.56rem',
        ['--plyr-control-radius' as string]: '999px',
        ['--plyr-video-control-color' as string]: 'rgb(255 255 255 / 0.82)',
        ['--plyr-video-control-color-hover' as string]: 'rgb(255 255 255 / 0.96)',
        ['--plyr-video-control-background-hover' as string]: 'color-mix(in srgb, var(--primary) 18%, var(--surface-high))',
        ['--plyr-video-controls-background' as string]: 'color-mix(in srgb, var(--theme-floating-surface) 92%, rgb(8 8 10 / 0.86))',
        ['--plyr-menu-background' as string]: 'color-mix(in srgb, var(--surface-container) 94%, rgb(16 16 20 / 0.96))',
        ['--plyr-menu-color' as string]: 'var(--foreground)',
        ['--plyr-menu-radius' as string]: '14px',
        ['--plyr-range-thumb-height' as string]: '13px',
        ['--plyr-range-thumb-shadow' as string]: '0 0 0 4px color-mix(in srgb, var(--primary) 18%, transparent)',
        ['--plyr-video-range-track-background' as string]: 'color-mix(in srgb, var(--border) 60%, transparent)',
        ['--plyr-video-progress-buffered-background' as string]: 'color-mix(in srgb, var(--foreground) 10%, transparent)',
      }}
    >
      {!resolvedSourceUrl ? (
        <div className="absolute inset-0 z-10 animate-pulse bg-surface-lowest" aria-hidden="true" />
      ) : (
        <video
          key={resolvedSourceUrl}
          ref={videoRef}
          className="conai-video-player__media h-full w-full bg-black object-contain"
          autoPlay={autoPlay}
          controls={useNativeControlsFallback}
          loop={loop}
          playsInline
          preload={preload}
        >
          <source src={resolvedSourceUrl} />
        </video>
      )}
    </div>
  )
}
