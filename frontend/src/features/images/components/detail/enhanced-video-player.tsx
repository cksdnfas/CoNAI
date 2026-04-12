import 'plyr/dist/plyr.css'
import './image-detail-media.css'

import type Plyr from 'plyr'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

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
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const playerRef = useRef<Plyr | null>(null)

  useEffect(() => {
    let disposed = false

    const setup = async () => {
      const node = videoRef.current
      if (!node) {
        return
      }

      const { default: PlyrClass } = await import('plyr')
      if (disposed || !videoRef.current) {
        return
      }

      playerRef.current?.destroy()
      playerRef.current = new PlyrClass(videoRef.current, {
        autoplay: autoPlay,
        controls: ['play-large', 'restart', 'rewind', 'play', 'fast-forward', 'progress', 'current-time', 'duration', 'mute', 'volume', 'settings', 'pip', 'airplay', 'fullscreen'],
        hideControls: true,
        keyboard: { focused: true, global: false },
        clickToPlay: true,
        resetOnEnd: false,
        seekTime: 5,
        fullscreen: { enabled: true, iosNative: true },
        tooltips: { controls: true, seek: true },
      })

      if (autoPlay) {
        void videoRef.current.play().catch(() => {
          // Browser autoplay policy may still block unmuted playback.
        })
      }
    }

    void setup()

    return () => {
      disposed = true
      playerRef.current?.destroy()
      playerRef.current = null
    }
  }, [autoPlay, renderUrl])

  return (
    <div
      className={cn('conai-video-player w-full overflow-hidden rounded-sm bg-black', className)}
      style={{
        ['--plyr-color-main' as string]: 'var(--primary)',
        ['--plyr-control-icon-size' as string]: '18px',
        ['--plyr-control-spacing' as string]: '0.5rem',
        ['--plyr-control-radius' as string]: '999px',
        ['--plyr-video-control-background-hover' as string]: 'color-mix(in srgb, var(--primary) 32%, black)',
        ['--plyr-video-controls-background' as string]: 'linear-gradient(transparent, rgba(0, 0, 0, 0.82))',
        ['--plyr-menu-background' as string]: 'rgba(18, 18, 22, 0.96)',
        ['--plyr-menu-color' as string]: 'white',
        ['--plyr-menu-radius' as string]: '14px',
        ['--plyr-range-thumb-height' as string]: '13px',
        ['--plyr-range-thumb-shadow' as string]: '0 0 0 4px rgb(249 94 20 / 0.18)',
        ['--plyr-video-progress-buffered-background' as string]: 'rgb(255 255 255 / 0.14)',
      }}
    >
      <video
        key={renderUrl}
        ref={videoRef}
        className="conai-video-player__media h-full w-full bg-black object-contain"
        autoPlay={autoPlay}
        controls
        loop={loop}
        playsInline
        preload={preload}
      >
        <source src={renderUrl} />
      </video>
    </div>
  )
}
