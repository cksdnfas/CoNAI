import { useEffect, useRef, useState } from 'react'
import { audioCandidateFileUrl } from '@/lib/api-audio'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'

/**
 * Waveforms are decoded in the browser from the take's own file (no server thumbnails): peaks are computed once per
 * file hash, cached for the session, and at most two files decode at a time.
 */
const PEAK_COUNT = 800
const peakCache = new Map<string, Promise<Float32Array>>()
const MAX_CACHE = 400
let active = 0
const waiting: Array<() => void> = []
let sharedContext: AudioContext | null = null

function context(): AudioContext {
  if (!sharedContext) sharedContext = new AudioContext()
  return sharedContext
}

async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve))
  active += 1
  try {
    return await work()
  } finally {
    active -= 1
    waiting.shift()?.()
  }
}

/** Peak amplitude per bucket (0..1), max over channels. */
export function computePeaks(buffer: AudioBuffer, count = PEAK_COUNT): Float32Array {
  const peaks = new Float32Array(count)
  const length = buffer.length
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let bucket = 0; bucket < count; bucket += 1) {
      const from = Math.floor((bucket * length) / count)
      const to = Math.max(from + 1, Math.floor(((bucket + 1) * length) / count))
      let peak = 0
      for (let index = from; index < to && index < length; index += 1) {
        const value = Math.abs(data[index])
        if (value > peak) peak = value
      }
      if (peak > peaks[bucket]) peaks[bucket] = peak
    }
  }
  return peaks
}

/** Decode a take once per file hash. `src` overrides where the bytes come from (e.g. the owner-scoped history route). */
export function loadPeaks(candidateId: string, fileHash: string, src?: string): Promise<Float32Array> {
  const cached = peakCache.get(fileHash)
  if (cached) return cached
  const promise = slot(async () => {
    const response = await fetch(src ?? audioCandidateFileUrl(candidateId), { credentials: 'include' })
    if (!response.ok) throw new Error(`waveform ${response.status}`)
    const buffer = await context().decodeAudioData(await response.arrayBuffer())
    return computePeaks(buffer)
  })
  promise.catch(() => peakCache.delete(fileHash))
  peakCache.set(fileHash, promise)
  if (peakCache.size > MAX_CACHE) peakCache.delete(peakCache.keys().next().value as string)
  return promise
}

/** Decode the full buffer (editor panel needs the duration and finer peaks). */
export async function loadAudioBuffer(url: string, signal?: AbortSignal): Promise<AudioBuffer> {
  const response = await fetch(url, { credentials: 'include', signal })
  if (!response.ok) throw new Error(`audio ${response.status}`)
  return await context().decodeAudioData(await response.arrayBuffer())
}

export function drawPeaks(canvas: HTMLCanvasElement, peaks: Float32Array | null, options: { progress?: number; ghost?: boolean; bar?: number; gap?: number }) {
  const ratio = window.devicePixelRatio || 1
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (width === 0 || height === 0) return
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
  }
  const draw = canvas.getContext('2d')
  if (!draw) return
  draw.setTransform(ratio, 0, 0, ratio, 0, 0)
  draw.clearRect(0, 0, width, height)
  // Colours come from the canvas' own classes, resolved by the browser: `text-*` = bars, `border-*` = played part.
  const style = getComputedStyle(canvas)
  const base = style.color || 'rgba(128,128,128,0.45)'
  const played = style.borderTopColor || '#f95e14'
  const bar = options.bar ?? 2
  const step = bar + (options.gap ?? 1)
  const bars = Math.max(1, Math.floor(width / step))
  for (let index = 0; index < bars; index += 1) {
    const t = index / bars
    let amplitude = 0.04
    if (peaks && !options.ghost) {
      const from = Math.floor(t * peaks.length)
      const to = Math.max(from + 1, Math.floor(((index + 1) / bars) * peaks.length))
      for (let peak = from; peak < to; peak += 1) amplitude = Math.max(amplitude, peaks[peak])
    }
    const barHeight = Math.max(1, Math.min(1, amplitude) * (height - 2))
    draw.fillStyle = !options.ghost && options.progress !== undefined && t < options.progress ? played : base
    draw.beginPath()
    draw.roundRect(index * step, (height - barHeight) / 2, bar, barHeight, 1)
    draw.fill()
  }
}

/** Small waveform for list rows and chat cards; decodes when it scrolls into view. */
export function WaveformThumb({ candidateId, fileHash, src, progress, ghost = false, className, duration = 0, onSeek, onToggle }: { candidateId: string; fileHash: string; src?: string; progress?: number; ghost?: boolean; className?: string; duration?: number; onSeek?: (seconds: number) => void; onToggle?: () => void }) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [peaks, setPeaks] = useState<Float32Array | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || ghost) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '200px' })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [ghost])

  useEffect(() => {
    if (!visible || ghost) return
    let cancelled = false
    loadPeaks(candidateId, fileHash, src).then((value) => { if (!cancelled) setPeaks(value) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [visible, ghost, candidateId, fileHash, src])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const render = () => drawPeaks(canvas, peaks, { progress, ghost })
    render()
    const observer = new ResizeObserver(render)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [peaks, progress, ghost])

  const canvas = <canvas ref={canvasRef} aria-hidden className={cn('block h-7 w-full border-0 border-primary text-foreground/35', !onSeek && className)} />
  if (!onSeek || ghost) return canvas
  const position = Math.max(0, Math.min(duration, (progress ?? 0) * duration))
  const seekAt = (clientX: number, target: HTMLDivElement) => {
    const rect = target.getBoundingClientRect()
    if (duration > 0 && rect.width > 0) onSeek(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration)
  }
  return <div
    role="slider"
    tabIndex={duration > 0 ? 0 : -1}
    aria-label={t({ ko: '오디오 재생 위치', en: 'Audio playback position' })}
    aria-valuemin={0}
    aria-valuemax={duration}
    aria-valuenow={position}
    aria-valuetext={`${position.toFixed(2)} / ${duration.toFixed(2)}s`}
    aria-disabled={duration <= 0}
    title={t({ ko: '클릭·드래그로 재생 위치 이동 · ← → 1초 (Shift: 5초) · Space 재생/정지', en: 'Click or drag to seek · ← → 1 s (Shift: 5 s) · Space play/pause' })}
    className={cn('touch-none cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
    onClick={(event) => event.stopPropagation()}
    onPointerDown={(event) => {
      event.stopPropagation()
      if (event.button !== 0 || !event.isPrimary || duration <= 0) return
      event.preventDefault()
      event.currentTarget.focus()
      event.currentTarget.setPointerCapture(event.pointerId)
      seekAt(event.clientX, event.currentTarget)
    }}
    onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) seekAt(event.clientX, event.currentTarget) }}
    onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
    onDragStart={(event) => { event.preventDefault(); event.stopPropagation() }}
    onKeyDown={(event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || duration <= 0) return
      if ((event.key === ' ' || event.key === 'Enter') && onToggle) { event.preventDefault(); event.stopPropagation(); if (!event.repeat) onToggle(); return }
      const step = event.shiftKey ? 5 : 1
      const next = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? position - step : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? position + step : event.key === 'Home' ? 0 : event.key === 'End' ? duration : null
      if (next === null) return
      event.preventDefault()
      event.stopPropagation()
      onSeek(Math.max(0, Math.min(duration, next)))
    }}
  >{canvas}</div>
}
