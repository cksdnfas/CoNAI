import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AlertCircle, Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import type { SpriteRect, SpriteVideoInfo } from '@/lib/api-sprite'
import { cn } from '@/lib/utils'
import { detectBorderColor } from './sprite-color-detect'
import { formatSeconds } from './sprite-options'

export interface SpriteVideoHandle {
  currentTime: () => number
  seek: (time: number) => void
  /** The most common colour along the shown frame's border, or null when it cannot be read. */
  detectBackground: () => string | null
}

const MEDIA_ERRORS: Record<number, string> = { 1: 'ABORTED', 2: 'NETWORK', 3: 'DECODE', 4: 'SRC_NOT_SUPPORTED' }

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se'

/**
 * The selected library video with its own transport bar: the chosen range is tinted on the seek bar. Two modes on top
 * of the picture: a colour pick (one click samples the frame under the pointer) and the pre-crop box in source pixels.
 * When the browser cannot play the file, it says so and can switch to stills rendered by the server at the seek position.
 */
export const SpriteVideoSource = forwardRef<SpriteVideoHandle, {
  src: string
  /** A server-rendered still at `time` seconds, used when the browser cannot play `src`. */
  frameUrl: (time: number) => string
  info: SpriteVideoInfo
  rangeStart: number
  rangeEnd: number
  picking: boolean
  onPick: (hex: string) => void
  preCrop: SpriteRect | null
  onPreCropChange: (rect: SpriteRect) => void
}>(function SpriteVideoSource({ src, frameUrl, info, rangeStart, rangeEnd, picking, onPick, preCrop, onPreCropChange }, ref) {
  const { t } = useI18n()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const stillRef = useRef<HTMLImageElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [mediaError, setMediaError] = useState<number | null>(null)
  const [stills, setStills] = useState(false)
  /** The still shown in server mode: follows the seek bar once it rests. */
  const [stillTime, setStillTime] = useState(0)
  const duration = Math.max(info.duration, info.lastFrameTime, 0.001)

  const pictureSource = useCallback((): { source: CanvasImageSource; width: number; height: number } | null => {
    if (stills) {
      const still = stillRef.current
      return still && still.naturalWidth ? { source: still, width: still.naturalWidth, height: still.naturalHeight } : null
    }
    const video = videoRef.current
    return video && video.videoWidth ? { source: video, width: video.videoWidth, height: video.videoHeight } : null
  }, [stills])

  useImperativeHandle(ref, () => ({
    currentTime: () => (stills ? time : videoRef.current?.currentTime ?? time),
    seek: (next) => { setTime(next); setStillTime(next); if (videoRef.current) videoRef.current.currentTime = next },
    detectBackground: () => { const picture = pictureSource(); return picture ? detectBorderColor(picture.source, picture.width, picture.height) : null },
  }), [time, stills, pictureSource])

  useEffect(() => { setTime(0); setStillTime(0); setPlaying(false); setMediaError(null); setStills(false) }, [src])
  useEffect(() => {
    if (!stills) return
    const timer = window.setTimeout(() => setStillTime(time), 150)
    return () => window.clearTimeout(timer)
  }, [stills, time])

  const toggle = () => {
    const video = videoRef.current
    if (!video || stills || mediaError !== null) return
    if (video.paused) void video.play()
    else video.pause()
  }

  const pick = (event: ReactPointerEvent<HTMLDivElement>) => {
    const picture = pictureSource()
    const frame = frameRef.current
    if (!picture || !frame) { onPick(''); return }
    const box = frame.getBoundingClientRect()
    const x = Math.floor(((event.clientX - box.left) / box.width) * picture.width)
    const y = Math.floor(((event.clientY - box.top) / box.height) * picture.height)
    const canvas = document.createElement('canvas')
    canvas.width = picture.width
    canvas.height = picture.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return
    context.drawImage(picture.source, 0, 0)
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
        {stills ? (
          <img ref={stillRef} src={frameUrl(stillTime)} alt={t({ ko: '서버 프레임', en: 'Server still' })} draggable={false} className="block size-full object-fill" />
        ) : (
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
            onError={(event) => { setPlaying(false); setMediaError(event.currentTarget.error?.code ?? 0) }}
            onClick={picking ? undefined : toggle}
          />
        )}
        {mediaError !== null && !stills ? (
          <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black p-6 text-center">
            <AlertCircle className="size-7 text-destructive" />
            <span className="text-sm">{t({ ko: '이 브라우저에서 재생할 수 없어', en: 'This browser cannot play the video' })}</span>
            <span className="font-mono text-xs text-muted-foreground">MEDIA_ERR {MEDIA_ERRORS[mediaError] ?? mediaError} · {info.width}×{info.height} · {info.formatName}</span>
            <Button size="sm" variant="secondary" onClick={() => { setStills(true); setStillTime(time) }}>{t({ ko: '서버 프레임으로 보기', en: 'Show server stills' })}</Button>
          </div>
        ) : null}
        {stills ? <span className="absolute left-2 top-2 rounded-sm bg-surface-container/85 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">{t({ ko: '서버 프레임', en: 'Server still' })}</span> : null}
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
        <IconButton size="icon-xs" variant="ghost" disabled={stills || mediaError !== null} label={playing ? t({ ko: '일시정지', en: 'Pause' }) : t({ ko: '재생', en: 'Play' })} onClick={toggle}>
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
      <div className="truncate font-mono text-xs text-muted-foreground">{info.width}×{info.height} · {Number(info.fps.toFixed(2))}fps · {info.frameCount}{t({ ko: '프레임', en: ' frames' })}</div>
    </div>
  )
})
