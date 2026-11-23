import { useState, type ReactNode } from 'react'
import { useImageListColumnCount } from '@/features/images/components/image-list/use-image-list-column-count'
import type { ChatImageSize } from './chat-appearance'

/** The narrowest masonry column per size setting; the column count follows the transcript's width. */
const MASONRY_MIN_COLUMN_PX: Record<ChatImageSize, number> = { sm: 120, md: 180, full: 240 }
const MASONRY_GAP_PX = 8

/**
 * Several results of one reply, like the library's masonry: each tile at its own ratio, in reading order across the
 * columns (round-robin, so a placeholder turning into its image never moves the others to another column). `full`
 * spreads a few results over the whole width; smaller sizes keep their column width and leave the rest empty.
 */
export function ChatMediaMasonry({ tiles, size }: { tiles: ReactNode[]; size: ChatImageSize }) {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const fit = useImageListColumnCount(element, MASONRY_MIN_COLUMN_PX[size], MASONRY_GAP_PX)
  const columnCount = Math.max(2, size === 'full' ? Math.min(fit, tiles.length) : fit)
  const columns = Array.from({ length: columnCount }, (_, column) => tiles.filter((_, index) => index % columnCount === column))
  return (
    <div ref={setElement} className="flex items-start gap-2">
      {columns.map((column, index) => <div key={index} className="flex min-w-0 flex-1 flex-col gap-2">{column}</div>)}
    </div>
  )
}
