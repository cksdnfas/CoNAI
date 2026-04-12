import { useEffect, useState } from 'react'
import type { ImageRecord } from '@/types/image'
import type { GraphExecutionArtifactRecord, GraphExecutionFinalResultRecord } from '@/lib/api'
import type { WallpaperAnimationEasing, WallpaperAnimationEasingPreset, WallpaperImageHoverMotion, WallpaperImageTransitionSpeed } from './wallpaper-types'

/** Render one live clock string for the wallpaper clock widget. */
export function useWallpaperClockText() {
  const [currentTime, setCurrentTime] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)
    return () => {
      window.clearInterval(timer)
    }
  }, [])

  return currentTime
}

/** Rotate through a widget image list on an interval when motion is enabled. */
export function useWallpaperRotatingIndex(length: number, intervalMs: number, enabled: boolean) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!enabled || length <= 1) {
      return
    }

    const timer = window.setInterval(() => {
      setTick((current) => current + 1)
    }, Math.max(2_000, intervalMs))

    return () => {
      window.clearInterval(timer)
    }
  }, [enabled, intervalMs, length])

  if (!enabled || length <= 1) {
    return 0
  }

  return tick % length
}

/** Drive subtle ambient motion without a full animation system. */
export function useWallpaperMotionTick(enabled: boolean) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!enabled) {
      return
    }

    const timer = window.setInterval(() => {
      setTick((current) => current + 1)
    }, 90)

    return () => {
      window.clearInterval(timer)
    }
  }, [enabled])

  return tick
}

/** Drive smoother motion time for widgets that need continuous animation. */
export function useWallpaperMotionTime(enabled: boolean) {
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    if (!enabled) {
      return
    }

    const startTime = performance.now()
    let frameId = 0

    const step = (now: number) => {
      setElapsedMs(now - startTime)
      frameId = window.requestAnimationFrame(step)
    }

    frameId = window.requestAnimationFrame(step)
    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [enabled])

  return elapsedMs
}

export interface WallpaperBezierControlPoints {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface WallpaperEasingStopPoint {
  x: number
  y: number
}

export const WALLPAPER_ANIMATION_EASING_OPTIONS: Array<{ value: WallpaperAnimationEasingPreset; label: string }> = [
  { value: 'linear', label: 'linear' },
  { value: 'easeInOutSine', label: 'easeInOutSine' },
  { value: 'easeOutCubic', label: 'easeOutCubic' },
  { value: 'easeInOutCubic', label: 'easeInOutCubic' },
  { value: 'easeOutExpo', label: 'easeOutExpo' },
  { value: 'easeOutBack', label: 'easeOutBack' },
  { value: 'easeOutBounce', label: 'easeOutBounce' },
]

const WALLPAPER_CUSTOM_EASING_FALLBACK: WallpaperBezierControlPoints = {
  x1: 0.22,
  y1: 1,
  x2: 0.36,
  y2: 1,
}

const WALLPAPER_CUSTOM_EASING_FALLBACK_STOPS: WallpaperEasingStopPoint[] = [
  { x: 0, y: 0 },
  { x: 0.18, y: 0.62 },
  { x: 0.42, y: 0.92 },
  { x: 0.72, y: 0.985 },
  { x: 1, y: 1 },
]

function clampWallpaperNumericIntensity(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function formatWallpaperBezierNumber(value: number) {
  const rounded = Number(value.toFixed(3))
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
}

function clampWallpaperEasingStopPoint(point: WallpaperEasingStopPoint): WallpaperEasingStopPoint {
  return {
    x: clampWallpaperNumericIntensity(point.x, 0, 1),
    y: clampWallpaperNumericIntensity(point.y, -3, 3),
  }
}

export function isWallpaperAnimationEasingPreset(value: string): value is WallpaperAnimationEasingPreset {
  return WALLPAPER_ANIMATION_EASING_OPTIONS.some((option) => option.value === value)
}

export function normalizeWallpaperEasingStopPoints(points: WallpaperEasingStopPoint[]) {
  const normalizedInterior = points
    .map(clampWallpaperEasingStopPoint)
    .filter((point) => point.x > 0 && point.x < 1)
    .sort((left, right) => left.x - right.x)

  const dedupedInterior: WallpaperEasingStopPoint[] = []
  for (const point of normalizedInterior) {
    const previous = dedupedInterior[dedupedInterior.length - 1]
    if (previous && Math.abs(previous.x - point.x) < 0.001) {
      dedupedInterior[dedupedInterior.length - 1] = point
      continue
    }

    dedupedInterior.push(point)
  }

  return [
    { x: 0, y: 0 },
    ...dedupedInterior,
    { x: 1, y: 1 },
  ]
}

export function getWallpaperAnimationEasingLabel(easing: WallpaperAnimationEasing | undefined) {
  if (!easing) {
    return 'easeOutCubic'
  }

  if (isWallpaperAnimationEasingPreset(easing)) {
    return easing
  }

  return parseWallpaperCubicBezierEasing(easing) || parseWallpaperLinearEasing(easing) ? '커스텀' : 'easeOutCubic'
}

export function getWallpaperPresetBezierControlPoints(preset: WallpaperAnimationEasingPreset): WallpaperBezierControlPoints | null {
  switch (preset) {
    case 'linear':
      return { x1: 0, y1: 0, x2: 1, y2: 1 }
    case 'easeInOutSine':
      return { x1: 0.37, y1: 0, x2: 0.63, y2: 1 }
    case 'easeInOutCubic':
      return { x1: 0.65, y1: 0, x2: 0.35, y2: 1 }
    case 'easeOutExpo':
      return { x1: 0.16, y1: 1, x2: 0.3, y2: 1 }
    case 'easeOutBack':
      return { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 }
    case 'easeOutCubic':
      return { x1: 0.22, y1: 1, x2: 0.36, y2: 1 }
    case 'easeOutBounce':
    default:
      return null
  }
}

export function parseWallpaperCubicBezierEasing(easing: string | undefined): WallpaperBezierControlPoints | null {
  if (!easing) {
    return null
  }

  const match = /^cubic-bezier\(\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*\)$/i.exec(easing)
  if (!match) {
    return null
  }

  const [x1, y1, x2, y2] = match.slice(1).map(Number)
  if ([x1, y1, x2, y2].some((value) => !Number.isFinite(value))) {
    return null
  }

  return {
    x1: clampWallpaperNumericIntensity(x1, 0, 1),
    y1: clampWallpaperNumericIntensity(y1, -3, 3),
    x2: clampWallpaperNumericIntensity(x2, 0, 1),
    y2: clampWallpaperNumericIntensity(y2, -3, 3),
  }
}

export function parseWallpaperLinearEasing(easing: string | undefined): WallpaperEasingStopPoint[] | null {
  if (!easing) {
    return null
  }

  const match = /^linear\((.*)\)$/i.exec(easing.trim())
  if (!match) {
    return null
  }

  const rawStops = match[1]
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (rawStops.length < 2) {
    return null
  }

  const parsedStops: WallpaperEasingStopPoint[] = []
  for (let index = 0; index < rawStops.length; index += 1) {
    const stopMatch = /^(-?\d*\.?\d+)(?:\s+(-?\d*\.?\d+)%)?$/i.exec(rawStops[index])
    if (!stopMatch) {
      return null
    }

    const y = Number(stopMatch[1])
    const explicitPercent = stopMatch[2] !== undefined ? Number(stopMatch[2]) / 100 : undefined
    const fallbackPercent = rawStops.length === 1 ? 0 : index / (rawStops.length - 1)
    const x = explicitPercent ?? fallbackPercent
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null
    }

    parsedStops.push({ x, y })
  }

  return normalizeWallpaperEasingStopPoints(parsedStops)
}

export function buildWallpaperCubicBezierEasing(points: WallpaperBezierControlPoints): WallpaperAnimationEasing {
  const normalizedPoints = {
    x1: clampWallpaperNumericIntensity(points.x1, 0, 1),
    y1: clampWallpaperNumericIntensity(points.y1, -3, 3),
    x2: clampWallpaperNumericIntensity(points.x2, 0, 1),
    y2: clampWallpaperNumericIntensity(points.y2, -3, 3),
  }

  return `cubic-bezier(${formatWallpaperBezierNumber(normalizedPoints.x1)}, ${formatWallpaperBezierNumber(normalizedPoints.y1)}, ${formatWallpaperBezierNumber(normalizedPoints.x2)}, ${formatWallpaperBezierNumber(normalizedPoints.y2)})`
}

export function buildWallpaperLinearEasing(points: WallpaperEasingStopPoint[]): WallpaperAnimationEasing {
  const normalizedPoints = normalizeWallpaperEasingStopPoints(points)
  const formattedStops = normalizedPoints.map((point) => `${formatWallpaperBezierNumber(point.y)} ${formatWallpaperBezierNumber(point.x * 100)}%`)
  return `linear(${formattedStops.join(', ')})`
}

function evaluateWallpaperBezierComponent(p1: number, p2: number, time: number) {
  const inverseTime = 1 - time
  return (3 * inverseTime * inverseTime * time * p1) + (3 * inverseTime * time * time * p2) + (time * time * time)
}

function evaluateWallpaperBezierEasingAtTime(points: WallpaperBezierControlPoints, time: number) {
  let lowerBound = 0
  let upperBound = 1

  for (let iteration = 0; iteration < 18; iteration += 1) {
    const parameter = (lowerBound + upperBound) / 2
    const x = evaluateWallpaperBezierComponent(points.x1, points.x2, parameter)
    if (x < time) {
      lowerBound = parameter
    }
    else {
      upperBound = parameter
    }
  }

  return evaluateWallpaperBezierComponent(points.y1, points.y2, (lowerBound + upperBound) / 2)
}

function evaluateWallpaperBounceEasingAtTime(time: number) {
  const bounceFactor = 7.5625
  const bounceStep = 2.75

  if (time < 1 / bounceStep) {
    return bounceFactor * time * time
  }

  if (time < 2 / bounceStep) {
    const shifted = time - (1.5 / bounceStep)
    return (bounceFactor * shifted * shifted) + 0.75
  }

  if (time < 2.5 / bounceStep) {
    const shifted = time - (2.25 / bounceStep)
    return (bounceFactor * shifted * shifted) + 0.9375
  }

  const shifted = time - (2.625 / bounceStep)
  return (bounceFactor * shifted * shifted) + 0.984375
}

function evaluateWallpaperLinearEasingAtTime(points: WallpaperEasingStopPoint[], time: number) {
  const normalizedTime = clampWallpaperNumericIntensity(time, 0, 1)
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    if (normalizedTime <= current.x || index === points.length - 1) {
      const segmentWidth = Math.max(current.x - previous.x, 0.0001)
      const progress = clampWallpaperNumericIntensity((normalizedTime - previous.x) / segmentWidth, 0, 1)
      return previous.y + ((current.y - previous.y) * progress)
    }
  }

  return points[points.length - 1]?.y ?? 1
}

export function evaluateWallpaperAnimationEasingAtTime(easing: WallpaperAnimationEasing | undefined, time: number) {
  const normalizedEasing = normalizeWallpaperAnimationEasing(easing)
  if (normalizedEasing === 'easeOutBounce') {
    return evaluateWallpaperBounceEasingAtTime(time)
  }

  const linearStops = parseWallpaperLinearEasing(normalizedEasing)
  if (linearStops) {
    return evaluateWallpaperLinearEasingAtTime(linearStops, time)
  }

  const customBezier = parseWallpaperCubicBezierEasing(normalizedEasing)
  const presetBezier = isWallpaperAnimationEasingPreset(normalizedEasing)
    ? getWallpaperPresetBezierControlPoints(normalizedEasing)
    : null
  const bezierPoints = customBezier ?? presetBezier
  if (bezierPoints) {
    return evaluateWallpaperBezierEasingAtTime(bezierPoints, time)
  }

  return clampWallpaperNumericIntensity(time, 0, 1)
}

export function normalizeWallpaperAnimationEasing(easing: string | undefined, fallback: WallpaperAnimationEasingPreset = 'easeOutCubic'): WallpaperAnimationEasing {
  if (easing && isWallpaperAnimationEasingPreset(easing)) {
    return easing
  }

  const customLinear = parseWallpaperLinearEasing(easing)
  if (customLinear) {
    return buildWallpaperLinearEasing(customLinear)
  }

  const customBezier = parseWallpaperCubicBezierEasing(easing)
  if (customBezier) {
    return buildWallpaperCubicBezierEasing(customBezier)
  }

  return fallback
}

export function getWallpaperEditableBezierControlPoints(
  easing: WallpaperAnimationEasing | undefined,
  fallback: WallpaperAnimationEasingPreset = 'easeOutCubic',
): WallpaperBezierControlPoints {
  const customBezier = parseWallpaperCubicBezierEasing(easing)
  if (customBezier) {
    return customBezier
  }

  if (easing && isWallpaperAnimationEasingPreset(easing)) {
    return getWallpaperPresetBezierControlPoints(easing) ?? getWallpaperPresetBezierControlPoints(fallback) ?? WALLPAPER_CUSTOM_EASING_FALLBACK
  }

  return getWallpaperPresetBezierControlPoints(fallback) ?? WALLPAPER_CUSTOM_EASING_FALLBACK
}

export function getWallpaperEditableEasingStopPoints(
  easing: WallpaperAnimationEasing | undefined,
  fallback: WallpaperAnimationEasingPreset = 'easeOutCubic',
): WallpaperEasingStopPoint[] {
  const customLinear = parseWallpaperLinearEasing(easing)
  if (customLinear) {
    return customLinear
  }

  const normalizedEasing = normalizeWallpaperAnimationEasing(easing, fallback)
  const sampleTimes = normalizedEasing === 'easeOutBounce'
    ? [0, 0.08, 0.16, 0.28, 0.4, 0.56, 0.72, 0.86, 1]
    : [0, 0.18, 0.36, 0.56, 0.78, 1]

  return normalizeWallpaperEasingStopPoints(
    sampleTimes.map((time, index) => (
      index === 0
        ? { x: 0, y: 0 }
        : index === sampleTimes.length - 1
          ? { x: 1, y: 1 }
          : { x: time, y: evaluateWallpaperAnimationEasingAtTime(normalizedEasing, time) }
    )),
  )
}

export function getWallpaperAnimationEasingCss(easing: WallpaperAnimationEasing | undefined) {
  const customLinear = parseWallpaperLinearEasing(easing)
  if (customLinear) {
    return buildWallpaperLinearEasing(customLinear)
  }

  const customBezier = parseWallpaperCubicBezierEasing(easing)
  if (customBezier) {
    return buildWallpaperCubicBezierEasing(customBezier)
  }

  switch (easing) {
    case 'linear':
      return 'linear'
    case 'easeInOutSine':
      return 'cubic-bezier(0.37, 0, 0.63, 1)'
    case 'easeInOutCubic':
      return 'cubic-bezier(0.65, 0, 0.35, 1)'
    case 'easeOutExpo':
      return 'cubic-bezier(0.16, 1, 0.3, 1)'
    case 'easeOutBack':
      return 'cubic-bezier(0.34, 1.56, 0.64, 1)'
    case 'easeOutBounce':
      return 'linear(0, 0.012, 0.047 2.2%, 0.188 4.9%, 0.398 8.6%, 0.641 13.2%, 0.797 16.1%, 0.891, 0.934, 0.965, 0.988, 1.002, 1.008, 1.01, 1.008, 1.002, 1 30%, 0.955 34.2%, 0.938 37.2%, 0.937, 0.946, 0.963, 0.987, 1.015, 1.025, 1.028, 1.024, 1.015, 1.005, 1 52%, 0.979 57.3%, 0.974 60.9%, 0.975, 0.985, 1.001, 1.014, 1.02, 1.021, 1.017, 1.009, 1 76%, 0.991 84%, 0.989, 0.991, 0.997, 1)'
    case 'easeOutCubic':
    default:
      return 'cubic-bezier(0.22, 1, 0.36, 1)'
  }
}

export const WALLPAPER_IMAGE_TRANSITION_DURATIONS: Record<WallpaperImageTransitionSpeed, number> = {
  fast: 220,
  normal: 340,
  slow: 520,
}

export function getWallpaperImageTransitionDurationMs(speed: WallpaperImageTransitionSpeed | undefined, explicitDurationMs?: number) {
  if (typeof explicitDurationMs === 'number' && Number.isFinite(explicitDurationMs)) {
    return Math.min(4000, Math.max(80, Math.round(explicitDurationMs)))
  }

  return WALLPAPER_IMAGE_TRANSITION_DURATIONS[speed ?? 'normal']
}

export function getWallpaperMotionStrengthMultiplier(strength: number | 'soft' | 'medium' | 'strong') {
  if (typeof strength === 'number' && Number.isFinite(strength)) {
    return clampWallpaperNumericIntensity(strength, 0, 2.5)
  }

  if (strength === 'soft') {
    return 0.7
  }

  if (strength === 'strong') {
    return 1.4
  }

  return 1
}

export function getWallpaperHoverMotionAmount(strength: number | 'none' | 'soft' | 'medium' | 'strong') {
  if (typeof strength === 'number' && Number.isFinite(strength)) {
    return clampWallpaperNumericIntensity(strength, 0, 2.5)
  }

  if (strength === 'none') {
    return 0
  }

  if (strength === 'soft') {
    return 0.7
  }

  if (strength === 'strong') {
    return 1.4
  }

  return 1
}

export function resolveWallpaperHoverMotionMetrics(hoverMotion: WallpaperImageHoverMotion | undefined) {
  const intensity = getWallpaperHoverMotionAmount(hoverMotion ?? 1)

  return {
    intensity,
    surfaceScale: 1 + (intensity * 0.018),
    imageScale: 1 + (intensity * 0.03),
    surfaceShadow: intensity <= 0
      ? 'none'
      : `0 ${Math.round(10 + intensity * 7)}px ${Math.round(26 + intensity * 18)}px rgba(0,0,0,${(0.14 + intensity * 0.07).toFixed(3)})`,
  }
}

/** Resolve one image preview url from a generic ImageRecord. */
export function getWallpaperImageUrl(image: ImageRecord | null | undefined) {
  return image?.thumbnail_url || image?.image_url || null
}

/** Build one artifact-like record from a final-result row so shared preview helpers can be reused. */
export function buildWallpaperFinalResultArtifact(finalResult: GraphExecutionFinalResultRecord): GraphExecutionArtifactRecord {
  return {
    id: finalResult.source_artifact_id,
    execution_id: finalResult.source_execution_id ?? finalResult.execution_id,
    node_id: finalResult.source_node_id,
    port_key: finalResult.source_port_key,
    artifact_type: finalResult.artifact_type,
    storage_path: finalResult.source_storage_path,
    metadata: finalResult.source_metadata,
    created_date: finalResult.created_date,
  }
}
