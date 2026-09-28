import { useMemo, useState, useSyncExternalStore } from 'react'

export type ImageListColumnPreferenceScope = 'home' | 'group' | 'history'

/** Phones and wide screens keep separate column choices: 4 columns at 390px makes thumbnails unreadable. */
export type ImageListViewportClass = 'narrow' | 'wide'

const IMAGE_LIST_COLUMN_PREFERENCE_STORAGE_KEY_PREFIX = 'conai:image-list:preferred-columns:v1:'
const IMAGE_LIST_COLUMN_PREFERENCE_MIN = 1
const IMAGE_LIST_COLUMN_PREFERENCE_MAX = 8
/** Tailwind `sm` breakpoint: below it the viewport counts as narrow. */
const IMAGE_LIST_NARROW_VIEWPORT_QUERY = '(max-width: 639.98px)'
const IMAGE_LIST_NARROW_DEFAULT_COLUMN_COUNT = 2

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

// Wide keeps the original key so existing desktop choices survive; narrow gets its own suffix.
function buildImageListColumnPreferenceStorageKey(scope: ImageListColumnPreferenceScope, viewport: ImageListViewportClass) {
  return `${IMAGE_LIST_COLUMN_PREFERENCE_STORAGE_KEY_PREFIX}${scope}${viewport === 'narrow' ? ':narrow' : ''}`
}

function readImageListColumnPreference(storageKey: string, fallback: number) {
  if (typeof window === 'undefined') {
    return fallback
  }

  try {
    const rawValue = window.localStorage.getItem(storageKey)
    if (!rawValue) {
      return fallback
    }

    return clampImageListColumnPreference(Number(rawValue), fallback)
  } catch {
    return fallback
  }
}

function writeImageListColumnPreference(storageKey: string, value: number | null) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    if (value === null) {
      window.localStorage.removeItem(storageKey)
    } else {
      window.localStorage.setItem(storageKey, String(value))
    }
  } catch {
    // Ignore private-mode or quota failures.
  }
}

function subscribeNarrowViewport(onChange: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }

  const mediaQuery = window.matchMedia(IMAGE_LIST_NARROW_VIEWPORT_QUERY)
  mediaQuery.addEventListener('change', onChange)
  return () => mediaQuery.removeEventListener('change', onChange)
}

function getNarrowViewportSnapshot() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(IMAGE_LIST_NARROW_VIEWPORT_QUERY).matches
    : false
}

/** Track whether the viewport is below the `sm` breakpoint. */
function useImageListViewportClass(): ImageListViewportClass {
  const isNarrow = useSyncExternalStore(subscribeNarrowViewport, getNarrowViewportSnapshot, () => false)
  return isNarrow ? 'narrow' : 'wide'
}

/**
 * Remember the "cards per row" choice for one gallery, separately for narrow (<640px) and wide viewports.
 * Narrow defaults to 2 columns; crossing the breakpoint switches to that class's own stored value.
 */
export function useImageListColumnPreference(
  scope: ImageListColumnPreferenceScope,
  fallback?: number,
) {
  const viewport = useImageListViewportClass()
  const resolvedFallback = fallback ?? (viewport === 'narrow' ? IMAGE_LIST_NARROW_DEFAULT_COLUMN_COUNT : DEFAULT_IMAGE_LIST_COLUMN_PREFERENCES[scope])
  const storageKey = buildImageListColumnPreferenceStorageKey(scope, viewport)
  // Choices made in this session, keyed by storage key; anything else is read from storage for the current class.
  const [sessionValues, setSessionValues] = useState<Record<string, number>>({})
  const storedValue = useMemo(() => readImageListColumnPreference(storageKey, resolvedFallback), [storageKey, resolvedFallback])
  const columnCount = sessionValues[storageKey] ?? storedValue

  return {
    columnCount,
    setColumnCount: (nextValue: number) => {
      const clampedValue = clampImageListColumnPreference(nextValue, resolvedFallback)
      writeImageListColumnPreference(storageKey, clampedValue)
      setSessionValues((current) => ({ ...current, [storageKey]: clampedValue }))
    },
    resetColumnCount: () => {
      writeImageListColumnPreference(storageKey, null)
      setSessionValues((current) => ({ ...current, [storageKey]: resolvedFallback }))
    },
    minColumnCount: IMAGE_LIST_COLUMN_PREFERENCE_MIN,
    maxColumnCount: IMAGE_LIST_COLUMN_PREFERENCE_MAX,
    defaultColumnCount: resolvedFallback,
    viewportClass: viewport,
  }
}
