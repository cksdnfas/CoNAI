import { useCallback, useEffect, useState } from 'react'

export type ViewMode = 'masonry' | 'grid'
export type ImageSize = 'small' | 'medium' | 'large'

export interface ImageListSettings {
  viewMode: ViewMode
  gridColumns: number
  imageSize: ImageSize
  activeScrollMode: 'infinite' | 'pagination'
  pageSize: number
  fitToScreen?: boolean
}

const DEFAULT_SETTINGS: ImageListSettings = {
  viewMode: 'masonry',
  gridColumns: 4,
  imageSize: 'medium',
  activeScrollMode: 'infinite',
  pageSize: 50,
  fitToScreen: false,
}

const STORAGE_KEY = 'image-manager-list-settings'
const EVENT_NAME = 'image_list_settings_changed'

export const useImageListSettings = (contextId: string) => {
  const loadSettings = (): ImageListSettings => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, ImageListSettings>
        return { ...DEFAULT_SETTINGS, ...parsed[contextId] }
      }
    } catch (error) {
      console.error('Failed to load image list settings:', error)
    }
    return DEFAULT_SETTINGS
  }

  const [settings, setSettings] = useState<ImageListSettings>(loadSettings)

  const updateSettings = useCallback(
    (updater: (prev: ImageListSettings) => ImageListSettings) => {
      setSettings((prev) => {
        const next = updater(prev)

        try {
          const stored = localStorage.getItem(STORAGE_KEY)
          const allSettings = stored ? (JSON.parse(stored) as Record<string, ImageListSettings>) : {}

          allSettings[contextId] = next
          localStorage.setItem(STORAGE_KEY, JSON.stringify(allSettings))

          window.dispatchEvent(
            new CustomEvent(EVENT_NAME, {
              detail: { contextId, settings: next },
            }),
          )

          return next
        } catch (error) {
          console.error('Failed to save image list settings:', error)
          return prev
        }
      })
    },
    [contextId],
  )

  useEffect(() => {
    const handleSettingsChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ contextId: string; settings: ImageListSettings }>
      if (customEvent.detail.contextId === contextId) {
        setSettings((prev) => {
          const next = customEvent.detail.settings
          if (JSON.stringify(prev) !== JSON.stringify(next)) {
            return next
          }
          return prev
        })
      }
    }

    window.addEventListener(EVENT_NAME, handleSettingsChange)
    return () => {
      window.removeEventListener(EVENT_NAME, handleSettingsChange)
    }
  }, [contextId])

  const setViewMode = useCallback((mode: ViewMode) => {
    updateSettings((prev) => ({ ...prev, viewMode: mode }))
  }, [updateSettings])

  const setGridColumns = useCallback((columns: number) => {
    updateSettings((prev) => ({ ...prev, gridColumns: columns }))
  }, [updateSettings])

  const setImageSize = useCallback((size: ImageSize) => {
    updateSettings((prev) => ({ ...prev, imageSize: size }))
  }, [updateSettings])

  const setActiveScrollMode = useCallback((mode: 'infinite' | 'pagination') => {
    updateSettings((prev) => ({ ...prev, activeScrollMode: mode }))
  }, [updateSettings])

  const setPageSize = useCallback((size: number) => {
    updateSettings((prev) => ({ ...prev, pageSize: size }))
  }, [updateSettings])

  const setFitToScreen = useCallback((fit: boolean) => {
    updateSettings((prev) => ({ ...prev, fitToScreen: fit }))
  }, [updateSettings])

  return {
    settings,
    setViewMode,
    setGridColumns,
    setImageSize,
    setActiveScrollMode,
    setPageSize,
    setFitToScreen,
  }
}
