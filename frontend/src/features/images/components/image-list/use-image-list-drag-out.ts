import { useEffect, useRef } from 'react'

interface UseImageListDragOutParams {
  containerElement: HTMLDivElement | null
  /** Called from the tile's native dragstart; fill `event.dataTransfer` here. Omit to keep drag-out off. */
  onItemDragStart?: (itemId: string, event: DragEvent) => void
}

/** A still press this long arms the tile for a native drag. Moving sooner is a rubber-band selection. */
const DRAG_ARM_HOLD_MS = 220
const DRAG_ARM_MOVE_TOLERANCE_PX = 4

/**
 * Opt-in drag-out for image tiles (desktop mouse only) that coexists with rubber-band selection.
 * A plain press-and-move still starts the viselect rubber band. Holding the mouse still on a tile for
 * DRAG_ARM_HOLD_MS arms it: the tile becomes `draggable` and the next move starts an HTML5 drag, which the
 * selection hook ignores while `isDragArmed()` is true.
 */
export function useImageListDragOut({ containerElement, onItemDragStart }: UseImageListDragOutParams) {
  const armedRef = useRef(false)
  const onItemDragStartRef = useRef(onItemDragStart)
  const isEnabled = Boolean(onItemDragStart)

  useEffect(() => {
    onItemDragStartRef.current = onItemDragStart
  }, [onItemDragStart])

  useEffect(() => {
    const container = containerElement
    if (!container || !isEnabled) return

    let timer = 0
    let pending: { tile: HTMLElement; pointerId: number; x: number; y: number } | null = null
    let armedTile: HTMLElement | null = null

    const disarm = () => {
      window.clearTimeout(timer)
      timer = 0
      pending = null
      if (armedTile) {
        armedTile.draggable = false
        delete armedTile.dataset.dragArmed
        armedTile = null
      }
      armedRef.current = false
    }

    const arm = () => {
      if (!pending) return
      armedTile = pending.tile
      armedTile.draggable = true
      armedTile.dataset.dragArmed = 'true'
      armedRef.current = true
    }

    const handlePointerDown = (event: PointerEvent) => {
      disarm()
      if (event.pointerType !== 'mouse' || event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return

      const target = event.target
      if (!(target instanceof Element) || target.closest('[data-no-select-drag="true"]')) return
      const tile = target.closest<HTMLElement>('.image-list-selectable')
      if (!tile?.dataset.imageId || !container.contains(tile)) return

      pending = { tile, pointerId: event.pointerId, x: event.clientX, y: event.clientY }
      timer = window.setTimeout(arm, DRAG_ARM_HOLD_MS)
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!pending || armedTile || event.pointerId !== pending.pointerId) return
      if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > DRAG_ARM_MOVE_TOLERANCE_PX) {
        // Moved before the hold elapsed: leave the gesture to the rubber band.
        disarm()
      }
    }

    // pointercancel is what Chrome fires once a native drag takes over, so only a release disarms here.
    const handlePointerUp = () => disarm()

    const handleDragStart = (event: DragEvent) => {
      const tile = armedTile
      const itemId = tile?.dataset.imageId
      if (!tile || !itemId || event.target !== tile) return
      onItemDragStartRef.current?.(itemId, event)
    }

    container.addEventListener('pointerdown', handlePointerDown, true)
    container.addEventListener('pointermove', handlePointerMove, true)
    document.addEventListener('pointerup', handlePointerUp, true)
    container.addEventListener('dragstart', handleDragStart)
    document.addEventListener('dragend', disarm, true)

    return () => {
      disarm()
      container.removeEventListener('pointerdown', handlePointerDown, true)
      container.removeEventListener('pointermove', handlePointerMove, true)
      document.removeEventListener('pointerup', handlePointerUp, true)
      container.removeEventListener('dragstart', handleDragStart)
      document.removeEventListener('dragend', disarm, true)
    }
  }, [containerElement, isEnabled])

  return {
    isDragArmed: () => armedRef.current,
  }
}
