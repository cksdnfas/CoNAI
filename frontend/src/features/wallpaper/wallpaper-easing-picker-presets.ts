import { useCallback, useMemo, useState } from 'react'
import type { WallpaperAnimationEasing } from './wallpaper-types'
import { normalizeWallpaperAnimationEasing } from './wallpaper-widget-utils'

export interface WallpaperSavedEasingPreset {
  id: string
  name: string
  easing: WallpaperAnimationEasing
  createdAt: string
  pinned: boolean
}

interface WallpaperSavedEasingPresetExportPayload {
  version: 1
  presets: WallpaperSavedEasingPreset[]
}

const WALLPAPER_EASING_PRESETS_STORAGE_KEY = 'conai:wallpaper:easing-presets'
export const MAX_WALLPAPER_SAVED_EASING_PRESETS = 24

// Normalize unknown storage data into a saved easing preset.
function normalizeWallpaperSavedEasingPreset(candidate: unknown, fallbackId: string) {
  if (!candidate || typeof candidate !== 'object') {
    return null
  }

  const value = candidate as Partial<WallpaperSavedEasingPreset>
  if (typeof value.name !== 'string' || typeof value.easing !== 'string') {
    return null
  }

  const trimmedName = value.name.trim()
  if (!trimmedName) {
    return null
  }

  return {
    id: typeof value.id === 'string' && value.id.trim().length > 0 ? value.id : fallbackId,
    name: trimmedName,
    easing: normalizeWallpaperAnimationEasing(value.easing),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    pinned: value.pinned === true,
  } satisfies WallpaperSavedEasingPreset
}

// Load saved easing presets from local storage.
function loadWallpaperSavedEasingPresets() {
  if (typeof window === 'undefined') {
    return [] as WallpaperSavedEasingPreset[]
  }

  try {
    const rawValue = window.localStorage.getItem(WALLPAPER_EASING_PRESETS_STORAGE_KEY)
    if (!rawValue) {
      return []
    }

    const parsedValue = JSON.parse(rawValue) as unknown
    if (!Array.isArray(parsedValue)) {
      return []
    }

    return parsedValue.flatMap((entry, index) => {
      const normalizedPreset = normalizeWallpaperSavedEasingPreset(entry, `wallpaper-easing-imported-${index}`)
      return normalizedPreset ? [normalizedPreset] : []
    })
  }
  catch {
    return []
  }
}

// Persist a bounded preset list back to local storage.
function saveWallpaperSavedEasingPresets(presets: WallpaperSavedEasingPreset[]) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(
    WALLPAPER_EASING_PRESETS_STORAGE_KEY,
    JSON.stringify(presets.slice(0, MAX_WALLPAPER_SAVED_EASING_PRESETS)),
  )
}

// Keep pinned presets grouped first while preserving existing order.
function sortWallpaperSavedEasingPresets(presets: WallpaperSavedEasingPreset[]) {
  return [...presets].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return Number(right.pinned) - Number(left.pinned)
    }

    return 0
  })
}

// Parse an imported preset file into normalized saved presets.
function parseWallpaperSavedEasingPresetImport(rawText: string) {
  const parsedValue = JSON.parse(rawText) as unknown
  const entries = Array.isArray(parsedValue)
    ? parsedValue
    : (parsedValue && typeof parsedValue === 'object' && Array.isArray((parsedValue as WallpaperSavedEasingPresetExportPayload).presets)
        ? (parsedValue as WallpaperSavedEasingPresetExportPayload).presets
        : null)

  if (!entries) {
    throw new Error('프리셋 배열을 찾을 수 없어.')
  }

  return entries.flatMap((entry, index) => {
    const normalizedPreset = normalizeWallpaperSavedEasingPreset(entry, `wallpaper-easing-imported-${Date.now()}-${index}`)
    return normalizedPreset ? [normalizedPreset] : []
  })
}

// Merge imported presets into the current saved preset collection.
function mergeImportedWallpaperSavedEasingPresets(
  currentPresets: WallpaperSavedEasingPreset[],
  importedPresets: WallpaperSavedEasingPreset[],
) {
  const nextByName = new Map(currentPresets.map((preset) => [preset.name, preset]))
  importedPresets.forEach((preset) => {
    const existingPreset = nextByName.get(preset.name)
    nextByName.set(preset.name, existingPreset ? { ...existingPreset, easing: preset.easing, pinned: preset.pinned } : preset)
  })

  return sortWallpaperSavedEasingPresets(Array.from(nextByName.values())).slice(0, MAX_WALLPAPER_SAVED_EASING_PRESETS)
}

// Manage saved easing preset storage, import, export, and mutations.
export function useWallpaperEasingPresetManager() {
  const [savedPresets, setSavedPresets] = useState<WallpaperSavedEasingPreset[]>(() => loadWallpaperSavedEasingPresets())
  const [importExportMessage, setImportExportMessage] = useState<string | null>(null)
  const [importExportError, setImportExportError] = useState<string | null>(null)

  const sortedSavedPresets = useMemo(() => sortWallpaperSavedEasingPresets(savedPresets), [savedPresets])

  const resetImportExportFeedback = useCallback(() => {
    setImportExportMessage(null)
    setImportExportError(null)
  }, [])

  const reloadSavedPresets = useCallback(() => {
    setSavedPresets(loadWallpaperSavedEasingPresets())
    resetImportExportFeedback()
  }, [resetImportExportFeedback])

  const savePreset = useCallback((name: string, easing: WallpaperAnimationEasing) => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      return false
    }

    setSavedPresets((current) => {
      const existingPreset = current.find((preset) => preset.name === trimmedName)
      const nextPresets = existingPreset
        ? current.map((preset) => preset.id === existingPreset.id ? { ...preset, easing } : preset)
        : [{
            id: `wallpaper-easing-${Date.now()}`,
            name: trimmedName,
            easing,
            createdAt: new Date().toISOString(),
            pinned: false,
          }, ...current]

      const normalizedPresets = sortWallpaperSavedEasingPresets(nextPresets).slice(0, MAX_WALLPAPER_SAVED_EASING_PRESETS)
      saveWallpaperSavedEasingPresets(normalizedPresets)
      return normalizedPresets
    })

    return true
  }, [])

  const removePreset = useCallback((presetId: string) => {
    setSavedPresets((current) => {
      const nextPresets = current.filter((preset) => preset.id !== presetId)
      saveWallpaperSavedEasingPresets(nextPresets)
      return nextPresets
    })
  }, [])

  const renamePreset = useCallback((presetId: string, nextName: string) => {
    const trimmedName = nextName.trim()
    if (!trimmedName) {
      return false
    }

    setSavedPresets((current) => {
      const nextPresets = current.map((preset) => preset.id === presetId ? { ...preset, name: trimmedName } : preset)
      const normalizedPresets = sortWallpaperSavedEasingPresets(nextPresets)
      saveWallpaperSavedEasingPresets(normalizedPresets)
      return normalizedPresets
    })

    return true
  }, [])

  const togglePinnedPreset = useCallback((presetId: string) => {
    setSavedPresets((current) => {
      const nextPresets = current.map((preset) => preset.id === presetId ? { ...preset, pinned: !preset.pinned } : preset)
      const normalizedPresets = sortWallpaperSavedEasingPresets(nextPresets)
      saveWallpaperSavedEasingPresets(normalizedPresets)
      return normalizedPresets
    })
  }, [])

  const exportPresets = useCallback(() => {
    if (typeof window === 'undefined' || sortedSavedPresets.length === 0) {
      return false
    }

    const payload: WallpaperSavedEasingPresetExportPayload = {
      version: 1,
      presets: sortedSavedPresets,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const objectUrl = window.URL.createObjectURL(blob)
    const link = window.document.createElement('a')
    link.href = objectUrl
    link.download = 'conai-wallpaper-easing-presets.json'
    link.click()
    window.URL.revokeObjectURL(objectUrl)
    setImportExportError(null)
    setImportExportMessage(`${sortedSavedPresets.length}개 프리셋을 내보냈어.`)
    return true
  }, [sortedSavedPresets])

  const importPresets = useCallback(async (file: File) => {
    try {
      const importedText = await file.text()
      const importedPresets = parseWallpaperSavedEasingPresetImport(importedText)
      if (importedPresets.length === 0) {
        throw new Error('가져올 수 있는 프리셋이 없어.')
      }

      setSavedPresets((current) => {
        const normalizedPresets = mergeImportedWallpaperSavedEasingPresets(current, importedPresets)
        saveWallpaperSavedEasingPresets(normalizedPresets)
        return normalizedPresets
      })
      setImportExportError(null)
      setImportExportMessage(`${importedPresets.length}개 프리셋을 가져왔어.`)
      return true
    }
    catch (error) {
      setImportExportMessage(null)
      setImportExportError(error instanceof Error ? error.message : '프리셋 가져오기에 실패했어.')
      return false
    }
  }, [])

  return {
    savedPresets,
    sortedSavedPresets,
    importExportMessage,
    importExportError,
    resetImportExportFeedback,
    reloadSavedPresets,
    savePreset,
    removePreset,
    renamePreset,
    togglePinnedPreset,
    exportPresets,
    importPresets,
  }
}
