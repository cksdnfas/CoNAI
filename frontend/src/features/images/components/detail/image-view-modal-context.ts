import { createContext, useContext } from 'react'

export interface ImageViewModalOpenInput {
  compositeHash: string
  compositeHashes?: string[]
  sourceId?: string
}

export interface ImageViewModalSyncInput {
  compositeHashes: string[]
  sourceId: string
}

export interface ImageViewModalApi {
  activeCompositeHash: string | null
  activeCompositeHashes: string[]
  activeIndex: number
  canViewPrevious: boolean
  canViewNext: boolean
  openImageView: (input: ImageViewModalOpenInput) => void
  syncImageViewSequence: (input: ImageViewModalSyncInput) => void
  closeImageView: () => void
  viewPreviousImage: () => void
  viewNextImage: () => void
}

export const ImageViewModalContext = createContext<ImageViewModalApi | null>(null)

/** Read the current image view modal API when the provider is available. */
export function useImageViewModal() {
  return useContext(ImageViewModalContext)
}
