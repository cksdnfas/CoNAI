import { useEffect, useState } from 'react'
import type { ImageRecord } from '@/types/image'

type PreviewImagesResponse = {
  success: boolean
  data?: ImageRecord[]
}

interface UseGroupPreviewImageOptions {
  groupId: number
  fetchPreviewImages: (groupId: number) => Promise<PreviewImagesResponse>
  onError?: (error: unknown) => void
}

export function useGroupPreviewImage({ groupId, fetchPreviewImages, onError }: UseGroupPreviewImageOptions): ImageRecord | null {
  const [preview, setPreview] = useState<ImageRecord | null>(null)

  useEffect(() => {
    let disposed = false

    const loadPreview = async () => {
      try {
        const response = await fetchPreviewImages(groupId)
        if (!disposed) {
          setPreview(response.success && response.data && response.data.length > 0 ? response.data[0] : null)
        }
      } catch (error) {
        if (!disposed) {
          onError?.(error)
          setPreview(null)
        }
      }
    }

    void loadPreview()

    return () => {
      disposed = true
    }
  }, [fetchPreviewImages, groupId, onError])

  return preview
}
