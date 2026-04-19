import 'plyr/dist/plyr.css'
import './image-detail-media.css'

import type Plyr from 'plyr'
import { useEffect, useRef } from 'react'
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
  const { resolvedSourceUrl, isCachePending } = useCachedVideoSource(renderUrl)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const playerRef = useRef<Plyr | null>(null)

  useEffect(() => {
    let disposed = false

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
          controls: ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'settings', 'pip', 'airplay', 'fullscreen'],
          hideControls: true,
          keyboard: { focused: true, global: false },
          clickToPlay: true,
          resetOnEnd: false,
          seekTime: 5,
          fullscreen: { enabled: true, iosNative: true },
          tooltips: { controls: true, seek: true },
        })

        if (disposed || videoRef.current !== node) {
          destroyPlyrSafely(createdPlayer)
          return
        }

        playerRef.current = createdPlayer

        if (autoPlay) {
          void node.play().catch(() => {
            // Browser autoplay policy may still block unmuted playback.
          })
        }
      } catch (error) {
        console.warn('[EnhancedVideoPlayer] Falling back to native video controls.', error)
      }
    }

    void setup()

    return () => {
      disposed = true
      const activePlayer = playerRef.current
      playerRef.current = null
      destroyPlyrSafely(activePlayer)
    }
  }, [autoPlay, resolvedSourceUrl])

  return (
    <div
      className={cn('conai-video-player relative w-full overflow-hidden rounded-sm bg-black', className)}
      style={{
        ['--plyr-color-main' as string]: 'var(--primary)',
        ['--plyr-control-icon-size' as string]: '18px',
        ['--plyr-control-spacing' as string]: '0.56rem',
        ['--plyr-control-radius' as string]: '999px',
        ['--plyr-video-control-color' as string]: 'rgb(255 255 255 / 0.96)',
        ['--plyr-video-control-color-hover' as string]: '#fff',
        ['--plyr-video-control-background-hover' as string]: 'color-mix(in srgb, var(--primary) 38%, black)',
        ['--plyr-video-controls-background' as string]: 'linear-gradient(180deg, rgb(0 0 0 / 0.08), rgb(0 0 0 / 0.78))',
        ['--plyr-menu-background' as string]: 'rgba(18, 18, 22, 0.96)',
        ['--plyr-menu-color' as string]: 'white',
        ['--plyr-menu-radius' as string]: '14px',
        ['--plyr-range-thumb-height' as string]: '13px',
        ['--plyr-range-thumb-shadow' as string]: '0 0 0 4px rgb(249 94 20 / 0.18)',
        ['--plyr-video-range-track-background' as string]: 'rgb(255 255 255 / 0.18)',
        ['--plyr-video-progress-buffered-background' as string]: 'rgb(255 255 255 / 0.14)',
      }}
    >
      {isCachePending && !resolvedSourceUrl ? (
        <div className="absolute inset-0 z-10 animate-pulse bg-surface-lowest" aria-hidden="true" />
      ) : null}
      <video
        key={resolvedSourceUrl ?? renderUrl}
        ref={videoRef}
        className={cn(
          'conai-video-player__media h-full w-full bg-black object-contain',
          isCachePending && !resolvedSourceUrl && 'opacity-0',
        )}
        autoPlay={autoPlay}
        controls
        loop={loop}
        playsInline
        preload={preload}
      >
        {resolvedSourceUrl ? <source src={resolvedSourceUrl} /> : null}
      </video>
    </div>
  )
}
