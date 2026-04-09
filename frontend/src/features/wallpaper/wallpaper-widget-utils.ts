import { useEffect, useState } from 'react'
import type { ImageRecord } from '@/types/image'
import type { GraphExecutionArtifactRecord, GraphExecutionFinalResultRecord } from '@/lib/api'

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

export function getWallpaperMotionStrengthMultiplier(strength: 'soft' | 'medium' | 'strong') {
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
