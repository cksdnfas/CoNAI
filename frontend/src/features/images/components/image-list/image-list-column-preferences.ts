import { useEffect, useState } from 'react'

export type ImageListColumnPreferenceScope = 'home' | 'group' | 'history'

const IMAGE_LIST_COLUMN_PREFERENCE_STORAGE_KEY_PREFIX = 'conai:image-list:preferred-columns:v1:'
const IMAGE_LIST_COLUMN_PREFERENCE_MIN = 1
const IMAGE_LIST_COLUMN_PREFERENCE_MAX = 8

export const DEFAULT_IMAGE_LIST_COLUMN_PREFERENCES: Record<ImageListColumnPreferenceScope, number> = {
  home: 4,
  group: 4,
  history: 4,
}

function clampImageListColumnPreference(value: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback
  }

  return Math.min(
    IMAGE_LIST_COLUMN_PREFERENCE_MAX,
    Math.max(IMAGE_LIST_COLUMN_PREFERENCE_MIN, Math.round(value)),
  )
}

function buildImageListColumnPreferenceStorageKey(scope: ImageListColumnPreferenceScope) {
  return `${IMAGE_LIST_COLUMN_PREFERENCE_STORAGE_KEY_PREFIX}${scope}`
}

function readImageListColumnPreference(scope: ImageListColumnPreferenceScope, fallback: number) {
  if (typeof window === 'undefined') {
    return fallback
  }

  try {
    const rawValue = window.localStorage.getItem(buildImageListColumnPreferenceStorageKey(scope))
    if (!rawValue) {
      return fallback
    }

    return clampImageListColumnPreference(Number(rawValue), fallback)
  } catch {
    return fallback
  }
}

function writeImageListColumnPreference(scope: ImageListColumnPreferenceScope, value: number) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(buildImageListColumnPreferenceStorageKey(scope), String(value))
  } catch {
    // Ignore private-mode or quota failures.
  }
}

export function useImageListColumnPreference(
  scope: ImageListColumnPreferenceScope,
  fallback = DEFAULT_IMAGE_LIST_COLUMN_PREFERENCES[scope],
) {
  const [columnCount, setColumnCount] = useState(() => readImageListColumnPreference(scope, fallback))

  useEffect(() => {
    setColumnCount(readImageListColumnPreference(scope, fallback))
  }, [fallback, scope])

  useEffect(() => {
    writeImageListColumnPreference(scope, clampImageListColumnPreference(columnCount, fallback))
  }, [columnCount, fallback, scope])

  return {
    columnCount: clampImageListColumnPreference(columnCount, fallback),
    setColumnCount: (nextValue: number) => setColumnCount(clampImageListColumnPreference(nextValue, fallback)),
    resetColumnCount: () => setColumnCount(fallback),
    minColumnCount: IMAGE_LIST_COLUMN_PREFERENCE_MIN,
    maxColumnCount: IMAGE_LIST_COLUMN_PREFERENCE_MAX,
    defaultColumnCount: fallback,
  }
}
