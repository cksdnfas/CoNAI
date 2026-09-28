import { createContext, useContext } from 'react'
import type { ImageRecord } from '@/types/image'

export interface ImageViewModalAccessOptions {
  allowDetailNavigation?: boolean
  allowEditAction?: boolean
  allowGroupAssignAction?: boolean
  /** Show "copy prompt" / "load these settings" for generation-history images. Off unless set. */
  allowHistoryReuseActions?: boolean
}

/**
 * Real size of the list the modal navigates, when the source knows more than its loaded page.
 * `pending` while the count request is in flight, `unavailable` when it failed or is not offered.
 */
export type ImageViewSequenceTotal =
  | { status: 'known'; count: number }
  | { status: 'pending' }
  | { status: 'unavailable' }

export interface ImageViewModalOpenInput {
  compositeHash: string
  compositeHashes?: string[]
  sourceId?: string
  sourceItems?: ImageRecord[]
  /** Total for the whole source list; omit when the source has no total. */
  sequenceTotal?: ImageViewSequenceTotal
  /** Whether the source can load more items than `compositeHashes`. */
  sequenceHasMore?: boolean
  stripFocusBehavior?: ScrollBehavior | null
  accessOptions?: ImageViewModalAccessOptions
}

export interface ImageViewModalSyncInput {
  compositeHashes: string[]
  sourceId: string
  sourceItems?: ImageRecord[]
  sequenceTotal?: ImageViewSequenceTotal
  sequenceHasMore?: boolean
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
