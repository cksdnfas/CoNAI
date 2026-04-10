import { useEffect, useState } from 'react'
import type { ImageRecord } from '@/types/image'
import type { GraphExecutionArtifactRecord, GraphExecutionFinalResultRecord } from '@/lib/api'
import type { WallpaperAnimationEasing } from './wallpaper-types'

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

export const WALLPAPER_ANIMATION_EASING_OPTIONS: Array<{ value: WallpaperAnimationEasing; label: string }> = [
  { value: 'linear', label: 'linear' },
  { value: 'easeInOutSine', label: 'easeInOutSine' },
  { value: 'easeOutCubic', label: 'easeOutCubic' },
  { value: 'easeInOutCubic', label: 'easeInOutCubic' },
  { value: 'easeOutExpo', label: 'easeOutExpo' },
  { value: 'easeOutBack', label: 'easeOutBack' },
  { value: 'easeOutBounce', label: 'easeOutBounce' },
]

function clampWallpaperNumericIntensity(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function getWallpaperAnimationEasingCss(easing: WallpaperAnimationEasing | undefined) {
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
