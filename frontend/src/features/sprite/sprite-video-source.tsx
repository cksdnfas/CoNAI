import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Pause, Play } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import type { SpriteRect, SpriteVideoInfo } from '@/lib/api-sprite'
import { cn } from '@/lib/utils'
import { formatSeconds } from './sprite-options'

export interface SpriteVideoHandle {
  currentTime: () => number
  seek: (time: number) => void
}

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se'

/**
 * The selected library video with its own transport bar: the chosen range is tinted on the seek bar. Two modes on top
 * of the picture: a colour pick (one click samples the frame under the pointer) and the pre-crop box in source pixels.
 */
export const SpriteVideoSource = forwardRef<SpriteVideoHandle, {
  src: string
  info: SpriteVideoInfo
  rangeStart: number
  rangeEnd: number
  picking: boolean
  onPick: (hex: string) => void
  preCrop: SpriteRect | null
  onPreCropChange: (rect: SpriteRect) => void
}>(function SpriteVideoSource({ src, info, rangeStart, rangeEnd, picking, onPick, preCrop, onPreCropChange }, ref) {
  const { t } = useI18n()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const duration = Math.max(info.duration, info.lastFrameTime, 0.001)

  useImperativeHandle(ref, () => ({
    currentTime: () => videoRef.current?.currentTime ?? time,
    seek: (next) => { if (videoRef.current) videoRef.current.currentTime = next },
  }), [time])

  useEffect(() => { setTime(0); setPlaying(false) }, [src])

  const toggle = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play()
    else video.pause()
  }

  const pick = (event: ReactPointerEvent<HTMLDivElement>) => {
    const video = videoRef.current
    const frame = frameRef.current
    if (!video || !frame || !video.videoWidth) return
    const box = frame.getBoundingClientRect()
    const x = Math.floor(((event.clientX - box.left) / box.width) * video.videoWidth)
    const y = Math.floor(((event.clientY - box.top) / box.height) * video.videoHeight)
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return
    context.drawImage(video, 0, 0)
    try {
      const [r, g, b] = context.getImageData(Math.min(canvas.width - 1, Math.max(0, x)), Math.min(canvas.height - 1, Math.max(0, y)), 1, 1).data
      onPick(`#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`)
    } catch {
      onPick('')
    }
  }

  const scale = useCallback(() => {
    const box = frameRef.current?.getBoundingClientRect()
    return box ? { box, sx: info.width / box.width, sy: info.height / box.height } : null
  }, [info.width, info.height])

  const startDrag = (mode: DragMode) => (event: ReactPointerEvent) => {
    if (!preCrop) return
    event.preventDefault()
    event.stopPropagation()
    const metrics = scale()
    if (!metrics) return
    const origin = { x: event.clientX, y: event.clientY, rect: preCrop }
    const move = (moveEvent: PointerEvent) => {
      const dx = Math.round((moveEvent.clientX - origin.x) * metrics.sx)
      const dy = Math.round((moveEvent.clientY - origin.y) * metrics.sy)
      let { x, y, width, height } = origin.rect
      if (mode === 'move') {
        x = Math.min(info.width - width, Math.max(0, x + dx))
        y = Math.min(info.height - height, Math.max(0, y + dy))
      } else {
        if (mode === 'nw' || mode === 'sw') { const right = x + width; x = Math.min(right - 8, Math.max(0, x + dx)); width = right - x }
        if (mode === 'ne' || mode === 'se') width = Math.min(info.width - x, Math.max(8, width + dx))
        if (mode === 'nw' || mode === 'ne') { const bottom = y + height; y = Math.min(bottom - 8, Math.max(0, y + dy)); height = bottom - y }
        if (mode === 'sw' || mode === 'se') height = Math.min(info.height - y, Math.max(8, height + dy))
      }
      onPreCropChange({ x, y, width, height })
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const percent = (value: number) => `${Math.min(100, Math.max(0, (value / duration) * 100))}%`

  return (
    <div className="flex flex-col gap-2">
      <div ref={frameRef} className="relative w-full overflow-hidden rounded-sm bg-black" style={{ aspectRatio: `${info.width} / ${info.height}` }}>
        <video
          ref={videoRef}
          src={src}
          className="block size-full object-fill"
          muted
          playsInline
          preload="auto"
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
          onSeeked={(event) => setTime(event.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onClick={picking ? undefined : toggle}
        />
        {picking ? <div className="absolute inset-0 cursor-crosshair" onPointerDown={pick} /> : null}
        {preCrop && !picking ? (
          <div
            className="absolute cursor-move border-[1.5px] border-primary shadow-[0_0_0_9999px_rgb(0_0_0/0.4)]"
            style={{ left: `${(preCrop.x / info.width) * 100}%`, top: `${(preCrop.y / info.height) * 100}%`, width: `${(preCrop.width / info.width) * 100}%`, height: `${(preCrop.height / info.height) * 100}%` }}
            onPointerDown={startDrag('move')}
          >
            {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
              <span
                key={corner}
                onPointerDown={startDrag(corner)}
                className={cn('absolute size-2.5 bg-primary', corner[0] === 'n' ? '-top-1.5' : '-bottom-1.5', corner[1] === 'w' ? '-left-1.5' : '-right-1.5', corner === 'nw' || corner === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize')}
              />
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <IconButton size="icon-xs" variant="ghost" label={playing ? t({ ko: '일시정지', en: 'Pause' }) : t({ ko: '재생', en: 'Play' })} onClick={toggle}>
          {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
        </IconButton>
        <div className="relative h-1 flex-1 rounded-full bg-surface-highest">
          <div className="absolute -inset-y-0.5 rounded-full bg-primary/45" style={{ left: percent(rangeStart), width: `calc(${percent(rangeEnd)} - ${percent(rangeStart)})` }} />
          <div className="absolute -top-1.5 h-4 w-0.5 rounded-full bg-foreground" style={{ left: percent(time) }} />
          <input
            type="range"
            min={0}
            max={duration}
            step={1 / Math.max(1, info.fps)}
            value={time}
            aria-label={t({ ko: '재생 위치', en: 'Playback position' })}
            onChange={(event) => { const next = Number(event.target.value); setTime(next); if (videoRef.current) videoRef.current.currentTime = next }}
            className="absolute inset-0 h-4 w-full -translate-y-1.5 cursor-pointer opacity-0"
          />
        </div>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatSeconds(time)} / {formatSeconds(duration)}</span>
      </div>
      <div className="truncate font-mono text-xs text-muted-foreground">{info.name} · {info.width}×{info.height} · {Number(info.fps.toFixed(2))}fps · {info.frameCount}{t({ ko: '프레임', en: ' frames' })}</div>
    </div>
  )
})
