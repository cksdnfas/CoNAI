import { useState } from 'react'
import {
  IMAGE_PIXEL_PREVIEW_PRESETS,
  loadImagePixelPreviewMode,
  loadImagePixelPreviewSettings,
  loadLastActiveImagePixelPreviewMode,
  normalizePixelPreviewSettings,
  persistImagePixelPreviewMode,
  persistImagePixelPreviewSettings,
  type PixelPreviewMode,
  type PixelPreviewSettings,
} from './image-detail-pixel-preview-utils'
import { loadImageDetailRenderMode, persistImageDetailRenderMode, type ImageDetailRenderMode } from './image-detail-utils'

export const IMAGE_WHEEL_ZOOM_ENABLED_STORAGE_KEY = 'conai:image-detail-media:wheel-zoom-enabled'
export const IMAGE_CONTROLS_COLLAPSED_STORAGE_KEY = 'conai:image-detail-media:controls-collapsed'

type BooleanPreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>

export function readImageDetailBooleanPreference(storage: Pick<BooleanPreferenceStorage, 'getItem'> | null, key: string) {
  return storage?.getItem(key) === 'true'
}

export function writeImageDetailBooleanPreference(storage: Pick<BooleanPreferenceStorage, 'setItem'> | null, key: string, value: boolean) {
  storage?.setItem(key, value ? 'true' : 'false')
}

function getBrowserPreferenceStorage(): BooleanPreferenceStorage | null {
  return typeof window === 'undefined' ? null : window.localStorage
}

export function useImageDetailRenderModePreference() {
  const [preferredRenderMode, setPreferredRenderMode] = useState<ImageDetailRenderMode>(() => loadImageDetailRenderMode())
  const updatePreferredRenderMode = (mode: ImageDetailRenderMode) => {
    setPreferredRenderMode(mode)
    persistImageDetailRenderMode(mode)
  }
  return { preferredRenderMode, updatePreferredRenderMode }
}

/** Own every persisted preference used by the image-detail media surface. */
export function useImageDetailMediaPreferences() {
  const [isWheelZoomEnabled, setIsWheelZoomEnabled] = useState(() => readImageDetailBooleanPreference(getBrowserPreferenceStorage(), IMAGE_WHEEL_ZOOM_ENABLED_STORAGE_KEY))
  const [isControlsCollapsed, setIsControlsCollapsed] = useState(() => readImageDetailBooleanPreference(getBrowserPreferenceStorage(), IMAGE_CONTROLS_COLLAPSED_STORAGE_KEY))
  const [pixelPreviewMode, setPixelPreviewMode] = useState<PixelPreviewMode>(() => loadImagePixelPreviewMode())
  const [pixelPreviewSettings, setPixelPreviewSettings] = useState<PixelPreviewSettings>(() => loadImagePixelPreviewSettings())
  const [isPixelPreviewPanelOpen, setIsPixelPreviewPanelOpen] = useState(false)

  const toggleWheelZoomEnabled = () => setIsWheelZoomEnabled((current) => {
    const nextValue = !current
    writeImageDetailBooleanPreference(getBrowserPreferenceStorage(), IMAGE_WHEEL_ZOOM_ENABLED_STORAGE_KEY, nextValue)
    return nextValue
  })
  const toggleControlsCollapsed = () => setIsControlsCollapsed((current) => {
    const nextValue = !current
    writeImageDetailBooleanPreference(getBrowserPreferenceStorage(), IMAGE_CONTROLS_COLLAPSED_STORAGE_KEY, nextValue)
    return nextValue
  })
  const setPixelPreviewModeAndPersist = (mode: PixelPreviewMode) => {
    setPixelPreviewMode(mode)
    persistImagePixelPreviewMode(mode)
    if (mode === 'soft' || mode === 'medium' || mode === 'strong') {
      setPixelPreviewSettings(IMAGE_PIXEL_PREVIEW_PRESETS[mode])
      persistImagePixelPreviewSettings(IMAGE_PIXEL_PREVIEW_PRESETS[mode])
    }
  }
  const togglePixelPreviewEnabled = () => setPixelPreviewModeAndPersist(pixelPreviewMode === 'off' ? loadLastActiveImagePixelPreviewMode() : 'off')
  const updatePixelPreviewSettings = (patch: Partial<PixelPreviewSettings>) => setPixelPreviewSettings((current) => {
    const baseSettings = pixelPreviewMode === 'soft' || pixelPreviewMode === 'medium' || pixelPreviewMode === 'strong' ? IMAGE_PIXEL_PREVIEW_PRESETS[pixelPreviewMode] : current
    const nextSettings = normalizePixelPreviewSettings({ ...baseSettings, ...patch })
    persistImagePixelPreviewSettings(nextSettings)
    persistImagePixelPreviewMode('custom')
    setPixelPreviewMode('custom')
    return nextSettings
  })

  return {
    isControlsCollapsed,
    isPixelPreviewEnabled: pixelPreviewMode !== 'off',
    isPixelPreviewPanelOpen,
    isWheelZoomEnabled,
    pixelPreviewMode,
    pixelPreviewSettings,
    setIsPixelPreviewPanelOpen,
    setPixelPreviewModeAndPersist,
    toggleControlsCollapsed,
    togglePixelPreviewEnabled,
    toggleWheelZoomEnabled,
    updatePixelPreviewSettings,
  }
}
