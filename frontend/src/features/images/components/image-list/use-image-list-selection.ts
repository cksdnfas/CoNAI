import { useEffect, useMemo, useRef } from 'react'
import SelectionArea from '@viselect/vanilla'
import { useMultiTouchSelectionStartGuard } from '@/lib/use-multi-touch-selection-start-guard'

interface UseImageListSelectionParams {
  containerElement: HTMLDivElement | null
  selectable: boolean
  selectedIds: string[]
  onSelectedIdsChange?: (selectedIds: string[]) => void
  onDragStateChange?: (isDragging: boolean) => void
  selectionAreaClass?: string
  /** Touch long-press on a tile: toggle that tile. */
  onLongPressSelect?: (imageId: string) => void
  /** True while a held tile is armed for drag-out; the rubber band stands down so the native drag wins. */
  isDragArmed?: () => boolean
}

const LONG_PRESS_DELAY_MS = 450
const LONG_PRESS_MOVE_TOLERANCE_PX = 10
/** The click a browser fires after lifting a long-pressed finger must not also open or toggle the tile. */
const LONG_PRESS_CLICK_SUPPRESS_MS = 450

/** Keep DOM selection preview outside React and commit only the final result. */
export function useImageListSelection({
  containerElement,
  selectable,
  selectedIds,
  onSelectedIdsChange,
  onDragStateChange,
  selectionAreaClass = 'image-list-selection-area',
  onLongPressSelect,
  isDragArmed,
}: UseImageListSelectionParams) {
  const selectionRef = useRef<SelectionArea | null>(null)
  const previewElementsRef = useRef<Set<HTMLElement>>(new Set())
  const suppressClickUntilRef = useRef(0)
  const didDragSelectionRef = useRef(false)
  const canStartSelection = useMultiTouchSelectionStartGuard(containerElement, selectable)
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const onLongPressSelectRef = useRef(onLongPressSelect)
  const isDragArmedRef = useRef(isDragArmed)

  useEffect(() => {
    onLongPressSelectRef.current = onLongPressSelect
  }, [onLongPressSelect])

  useEffect(() => {
    isDragArmedRef.current = isDragArmed
  }, [isDragArmed])

  /**
   * One delegated listener set per list (never per tile): a still, single-finger press held for
   * LONG_PRESS_DELAY_MS selects the tile. Moving, a second finger, or the browser taking the
   * gesture for scrolling (pointercancel) aborts it.
   */
  useEffect(() => {
    const container = containerElement
    if (!container || !selectable) return

    let timer = 0
    let pending: { imageId: string; pointerId: number; x: number; y: number } | null = null
    let firedPointerId: number | null = null

    const cancelPending = () => {
      window.clearTimeout(timer)
      timer = 0
      pending = null
    }

    const fire = () => {
      if (!pending) return
      const { imageId, pointerId } = pending
      cancelPending()
      firedPointerId = pointerId
      suppressClickUntilRef.current = Number.POSITIVE_INFINITY
      navigator.vibrate?.(12)
      onLongPressSelectRef.current?.(imageId)
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || !event.isPrimary) {
        cancelPending()
        return
      }

      const target = event.target
      if (!(target instanceof Element) || target.closest('[data-no-select-drag="true"]')) return
      const tile = target.closest<HTMLElement>('.image-list-selectable')
      const imageId = tile?.dataset.imageId
      if (!tile || !imageId || !container.contains(tile)) return

      cancelPending()
      pending = { imageId, pointerId: event.pointerId, x: event.clientX, y: event.clientY }
      timer = window.setTimeout(fire, LONG_PRESS_DELAY_MS)
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!pending || event.pointerId !== pending.pointerId) return
      if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > LONG_PRESS_MOVE_TOLERANCE_PX) {
        cancelPending()
      }
    }

    const handlePointerEnd = (event: PointerEvent) => {
      if (pending?.pointerId === event.pointerId) {
        cancelPending()
      }
      if (firedPointerId === event.pointerId) {
        firedPointerId = null
        suppressClickUntilRef.current = performance.now() + LONG_PRESS_CLICK_SUPPRESS_MS
      }
    }

    // Android raises the context menu around the same delay; treat it as the long-press itself.
    const handleContextMenu = (event: MouseEvent) => {
      if (pending) {
        event.preventDefault()
        fire()
        return
      }
      if (firedPointerId !== null) {
        event.preventDefault()
      }
    }

    container.addEventListener('pointerdown', handlePointerDown, true)
    container.addEventListener('pointermove', handlePointerMove, true)
    container.addEventListener('pointerup', handlePointerEnd, true)
    container.addEventListener('pointercancel', handlePointerEnd, true)
    container.addEventListener('contextmenu', handleContextMenu, true)

    return () => {
      cancelPending()
      container.removeEventListener('pointerdown', handlePointerDown, true)
      container.removeEventListener('pointermove', handlePointerMove, true)
      container.removeEventListener('pointerup', handlePointerEnd, true)
      container.removeEventListener('pointercancel', handlePointerEnd, true)
      container.removeEventListener('contextmenu', handleContextMenu, true)
      if (firedPointerId !== null) {
        suppressClickUntilRef.current = performance.now() + LONG_PRESS_CLICK_SUPPRESS_MS
      }
    }
  }, [containerElement, selectable])

  useEffect(() => {
    const container = containerElement
    if (!container || !selectable || !onSelectedIdsChange) return

    const applyPreviewElements = (elements: HTMLElement[]) => {
      const nextPreviewElements = new Set(elements)

      for (const element of previewElementsRef.current) {
        if (!nextPreviewElements.has(element)) {
          element.classList.remove('is-selection-preview')
        }
      }

      for (const element of nextPreviewElements) {
        element.classList.add('is-selection-preview')
      }

      previewElementsRef.current = nextPreviewElements
    }

    const clearPreviewElements = () => {
      applyPreviewElements([])
    }

    const selection = new SelectionArea({
      selectionAreaClass,
      container,
      startAreas: [container],
      boundaries: [container],
      selectables: ['.image-list-selectable'],
      behaviour: {
        overlap: 'keep',
        intersect: 'touch',
        startThreshold: 8,
        triggers: [0],
      },
      features: {
        touch: true,
        range: false,
        deselectOnBlur: false,
        singleTap: {
          allow: false,
          intersect: 'native',
        },
      },
    })

    selection
      .on('beforestart', ({ event }) => {
        if (!canStartSelection(event)) {
          return false
        }

        const target = event?.target
        if (!(target instanceof HTMLElement)) return
        if (target.closest('[data-no-select-drag="true"]')) {
          return false
        }
      })
      .on('beforedrag', ({ event }) => {
        if (isDragArmedRef.current?.()) {
          return false
        }
        // A native drag swallows the mouseup, so the pending tap can outlive the press; never start without a button down.
        if (event instanceof MouseEvent && event.buttons === 0) {
          return false
        }
      })
      .on('start', () => {
        didDragSelectionRef.current = false
        onDragStateChange?.(true)
      })
      .on('move', ({ store }) => {
        didDragSelectionRef.current = true
        applyPreviewElements(store.selected as HTMLElement[])
      })
      .on('stop', ({ store }) => {
        const nextSelectedIds = Array.from(
          new Set(
            (store.selected as HTMLElement[])
              .map((element) => element.dataset.imageId)
              .filter((value): value is string => typeof value === 'string' && value.length > 0),
          ),
        )

        const shouldCommitSelectionDrag = didDragSelectionRef.current
        didDragSelectionRef.current = false
        clearPreviewElements()
        onDragStateChange?.(false)

        if (!shouldCommitSelectionDrag) {
          return
        }

        suppressClickUntilRef.current = performance.now() + 180
        onSelectedIdsChange(nextSelectedIds)
      })

    selectionRef.current = selection

    return () => {
      onDragStateChange?.(false)
      clearPreviewElements()
      selection.destroy()
      selectionRef.current = null
    }
  }, [canStartSelection, containerElement, onDragStateChange, onSelectedIdsChange, selectable, selectionAreaClass])

  useEffect(() => {
    const container = containerElement
    if (!container || !selectable) return

    const syncSelectedState = () => {
      const selectableElements = container.querySelectorAll<HTMLElement>('.image-list-selectable')

      for (const element of selectableElements) {
        const imageId = element.dataset.imageId ?? ''
        const isSelected = selectedIdSet.has(imageId)
        element.dataset.selected = isSelected ? 'true' : 'false'
        element.classList.toggle('is-selected', isSelected)
      }
    }

    syncSelectedState()

    const observer = new MutationObserver(() => {
      syncSelectedState()
    })

    observer.observe(container, {
      childList: true,
      subtree: true,
    })

    return () => observer.disconnect()
  }, [containerElement, selectable, selectedIdSet])

  return {
    shouldSuppressClick: () => performance.now() < suppressClickUntilRef.current,
    clearSelectionPreview: () => {
      for (const element of previewElementsRef.current) {
        element.classList.remove('is-selection-preview')
      }
      previewElementsRef.current.clear()
    },
  }
}
