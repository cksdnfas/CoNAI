import { useEffect, useRef, useState } from 'react'
import { audioCandidateFileUrl } from '@/lib/api-audio'
import { cn } from '@/lib/utils'

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

/** Decode a take once per file hash. */
export function loadPeaks(candidateId: string, fileHash: string): Promise<Float32Array> {
  const cached = peakCache.get(fileHash)
  if (cached) return cached
  const promise = slot(async () => {
    const response = await fetch(audioCandidateFileUrl(candidateId), { credentials: 'include' })
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
export function WaveformThumb({ candidateId, fileHash, progress, ghost = false, className }: { candidateId: string; fileHash: string; progress?: number; ghost?: boolean; className?: string }) {
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
    loadPeaks(candidateId, fileHash).then((value) => { if (!cancelled) setPeaks(value) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [visible, ghost, candidateId, fileHash])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const render = () => drawPeaks(canvas, peaks, { progress, ghost })
    render()
    const observer = new ResizeObserver(render)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [peaks, progress, ghost])

  return <canvas ref={canvasRef} aria-hidden className={cn('block h-7 w-full border-0 border-primary text-foreground/35', className)} />
}
