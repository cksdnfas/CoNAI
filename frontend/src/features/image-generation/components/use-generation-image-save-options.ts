import { useQuery } from '@tanstack/react-query'
import { getRuntimeImageSaveSettings } from '@/lib/api-settings'
import { DEFAULT_IMAGE_SAVE_SETTINGS } from '@/lib/image-save-output'

/** The same runtime image-save settings and queue payload for every generation surface. */
export function useGenerationImageSaveOptions(enabled = true) {
  const query = useQuery({
    queryKey: ['runtime-image-save-settings'],
    queryFn: getRuntimeImageSaveSettings,
    enabled,
  })
  const settings = query.data?.imageSave ?? DEFAULT_IMAGE_SAVE_SETTINGS
  return {
    settings,
    options: {
      format: settings.defaultFormat,
      quality: settings.quality,
      resizeEnabled: settings.resizeEnabled,
      maxWidth: settings.maxWidth,
      maxHeight: settings.maxHeight,
    },
  }
}
