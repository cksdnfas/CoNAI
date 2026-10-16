import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { GenerationLayoutBlock } from '@conai/shared'
import type { GenerationLayoutDropTarget } from './generation-layout-ops'

/** Where the drop line shows: an edge of a block frame, or the end of a column. */
export type LayoutDropIndicator = { block: GenerationLayoutBlock; edge: 'top' | 'bottom' } | { column: number }

type DragState = { block: GenerationLayoutBlock; x: number; y: number; target: GenerationLayoutDropTarget | null; indicator: LayoutDropIndicator | null }

/**
 * Find the drop spot under the pointer. Block frames carry `data-layout-block/column/index`; a column's free area carries
 * `data-layout-column-drop` and `data-layout-column-size` (its block count, hidden blocks included).
 */
function locate(x: number, y: number) {
  for (const element of document.elementsFromPoint(x, y)) {
    if (!(element instanceof HTMLElement)) continue
    const frame = element.closest<HTMLElement>('[data-layout-block]')
    if (frame) {
      const rect = frame.getBoundingClientRect()
      const before = y < rect.top + rect.height / 2
      const index = Number(frame.dataset.layoutIndex)
      return {
        target: { column: Number(frame.dataset.layoutColumn), index: before ? index : index + 1 },
        indicator: { block: frame.dataset.layoutBlock as GenerationLayoutBlock, edge: before ? 'top' as const : 'bottom' as const },
      }
    }
    const column = element.closest<HTMLElement>('[data-layout-column-drop]')
    if (column) {
      const columnIndex = Number(column.dataset.layoutColumnDrop)
      return { target: { column: columnIndex, index: Number(column.dataset.layoutColumnSize) }, indicator: { column: columnIndex } }
    }
  }
  return null
}

/**
 * Pointer-driven block dragging for the layout editors. Pointer events (not HTML drag and drop) so touch screens can
 * reorder too; the grip captures the pointer and the drop spot is read from what lies under it.
 */
export function useLayoutBlockDrag(onDrop: (block: GenerationLayoutBlock, target: GenerationLayoutDropTarget) => void, labelOf: (block: GenerationLayoutBlock) => string) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const update = (next: DragState | null) => {
    dragRef.current = next
    setDrag(next)
  }

  const gripProps = (block: GenerationLayoutBlock) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      update({ block, x: event.clientX, y: event.clientY, target: null, indicator: null })
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const current = dragRef.current
      if (!current) return
      const spot = locate(event.clientX, event.clientY)
      update({ ...current, x: event.clientX, y: event.clientY, target: spot?.target ?? null, indicator: spot?.indicator ?? null })
    },
    onPointerUp: () => {
      const current = dragRef.current
      update(null)
      if (current?.target) onDrop(current.block, current.target)
    },
    onPointerCancel: () => update(null),
    style: { touchAction: 'none' as const },
  })

  const ghost = drag && typeof document !== 'undefined'
    ? createPortal(
      <div
        aria-hidden
        className="pointer-events-none fixed z-floating -rotate-1 rounded-md bg-surface-high px-3 py-2 text-sm font-semibold text-foreground shadow-elevation-1 outline outline-primary"
        style={{ left: drag.x + 12, top: drag.y + 12 }}
      >
        {labelOf(drag.block)}
      </div>,
      document.body,
    )
    : null

  return { dragging: drag?.block ?? null, indicator: drag?.indicator ?? null, gripProps, ghost }
}
