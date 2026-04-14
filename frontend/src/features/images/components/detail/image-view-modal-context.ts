import { createContext, useContext } from 'react'
import type { ImageRecord } from '@/types/image'

export interface ImageViewModalAccessOptions {
  allowDetailNavigation?: boolean
  allowEditAction?: boolean
  allowGroupAssignAction?: boolean
}

export interface ImageViewModalOpenInput {
  compositeHash: string
  compositeHashes?: string[]
  sourceId?: string
  sourceItems?: ImageRecord[]
  stripFocusBehavior?: ScrollBehavior | null
  accessOptions?: ImageViewModalAccessOptions
}

export interface ImageViewModalSyncInput {
  compositeHashes: string[]
  sourceId: string
  sourceItems?: ImageRecord[]
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
