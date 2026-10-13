import { useEffect, useRef, useState } from 'react'
import { audioCandidateFileUrl } from '@/lib/api-audio'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'

/**
 * Waveforms are decoded in the browser from the take's own file (no server thumbnails): peaks are computed once per
 * file hash, cached for the session, and at most two files decode at a time.
 */
const PEAK_COUNT = 800
type AudioWaveform = { peaks: Float32Array; editorPeaks: Float32Array; duration: number }
type WaveformLoad = { promise: Promise<AudioWaveform>; controller: AbortController; users: number; settled: boolean }
const peakCache = new Map<string, WaveformLoad>()
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
  else active += 1
  try {
    return await work()
  } finally {
    const next = waiting.shift()
    if (next) next()
    else active -= 1
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

/** Lists and the editor share one decode; only peaks and duration stay cached, scoped to the account and source URL. */
export function loadAudioWaveform(candidateId: string, fileHash: string, options: { scope: string; src?: string; signal?: AbortSignal }): Promise<AudioWaveform> {
  const signal = options.signal
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  const url = options.src ?? audioCandidateFileUrl(candidateId)
  const key = JSON.stringify([options.scope, fileHash, url])
  let entry = peakCache.get(key)
  if (!entry) {
    const controller = new AbortController()
    const created: WaveformLoad = { controller, users: 0, settled: false, promise: null! }
    created.promise = slot(async () => {
      controller.signal.throwIfAborted()
      const response = await fetch(url, { credentials: 'include', signal: controller.signal })
      if (!response.ok) throw new Error(`waveform ${response.status}`)
      const buffer = await context().decodeAudioData(await response.arrayBuffer())
      controller.signal.throwIfAborted()
      return { peaks: computePeaks(buffer), editorPeaks: computePeaks(buffer, 1600), duration: buffer.duration }
    }).then((result) => { created.settled = true; return result }, (error: unknown) => {
      created.settled = true
      if (peakCache.get(key) === created) peakCache.delete(key)
      throw error
    })
    peakCache.set(key, created)
    if (peakCache.size > MAX_CACHE) peakCache.delete(peakCache.keys().next().value as string)
    entry = created
  }
  const shared = entry
  shared.users += 1
  return new Promise((resolve, reject) => {
    let released = false
    const release = () => {
      if (released) return false
      released = true
      signal?.removeEventListener('abort', onAbort)
      shared.users -= 1
      if (!shared.users && !shared.settled) {
        shared.controller.abort()
        if (peakCache.get(key) === shared) peakCache.delete(key)
      }
      return true
    }
    const onAbort = () => { if (release()) reject(new DOMException('Aborted', 'AbortError')) }
    signal?.addEventListener('abort', onAbort, { once: true })
    shared.promise.then((result) => { if (release()) resolve(result) }, (error: unknown) => { if (release()) reject(error) })
  })
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
  const auth = useAuthStatusQuery()
  const scope = JSON.stringify([auth.data?.accountId, auth.data?.hasCredentials, auth.data?.permissionKeys])
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
    const controller = new AbortController()
    setPeaks(null)
    loadAudioWaveform(candidateId, fileHash, { src, scope, signal: controller.signal }).then((value) => { if (!controller.signal.aborted) setPeaks(value.peaks) }).catch(() => undefined)
    return () => controller.abort()
  }, [visible, ghost, candidateId, fileHash, src, scope])

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
