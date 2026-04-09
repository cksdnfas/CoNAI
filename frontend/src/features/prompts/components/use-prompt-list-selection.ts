import { useEffect, useRef } from 'react'
import SelectionArea from '@viselect/vanilla'

interface UsePromptListSelectionParams {
  containerElement: HTMLDivElement | null
  selectable: boolean
  selectedIds: number[]
  onSelectedIdsChange?: (selectedIds: number[]) => void
  onDragStateChange?: (isDragging: boolean) => void
}

interface UsePromptListSelectionResult {
  shouldSuppressClick: () => boolean
}

function isTouchSelectionEvent(event: Event | null | undefined) {
  if (!event) {
    return false
  }

  if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) {
    return true
  }

  return 'pointerType' in event && typeof event.pointerType === 'string' && event.pointerType === 'touch'
}

/** Keep prompt drag-selection preview outside React and commit only the final result. */
export function usePromptListSelection({
  containerElement,
  selectable,
  selectedIds,
  onSelectedIdsChange,
  onDragStateChange,
}: UsePromptListSelectionParams): UsePromptListSelectionResult {
  const selectionRef = useRef<SelectionArea | null>(null)
  const previewElementsRef = useRef<Set<HTMLElement>>(new Set())
  const suppressClickUntilRef = useRef(0)

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
      selectionAreaClass: 'image-list-selection-area',
      container,
      startAreas: [container],
      boundaries: [container],
      selectables: ['.prompt-list-selectable'],
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
        if (isTouchSelectionEvent(event)) {
          return false
        }

        const target = event?.target
        if (!(target instanceof HTMLElement)) return
        if (target.closest('[data-no-select-drag="true"]')) {
          return false
        }
      })
      .on('start', () => {
        onDragStateChange?.(true)
      })
      .on('move', ({ store }) => {
        applyPreviewElements(store.selected as HTMLElement[])
      })
      .on('stop', ({ store }) => {
        suppressClickUntilRef.current = Date.now() + 220

        const nextSelectedIds = Array.from(
          new Set(
            (store.selected as HTMLElement[])
              .map((element) => Number(element.dataset.promptId))
              .filter((value) => Number.isFinite(value) && value > 0),
          ),
        )

        clearPreviewElements()
        onDragStateChange?.(false)
        onSelectedIdsChange(nextSelectedIds)
      })

    selectionRef.current = selection

    return () => {
      onDragStateChange?.(false)
      clearPreviewElements()
      selection.destroy()
      selectionRef.current = null
    }
  }, [containerElement, onDragStateChange, onSelectedIdsChange, selectable])

  useEffect(() => {
    const container = containerElement
    if (!container || !selectable) return

    const syncSelectedState = () => {
      const selectedIdSet = new Set(selectedIds)
      const selectableElements = container.querySelectorAll<HTMLElement>('.prompt-list-selectable')

      for (const element of selectableElements) {
        const promptId = Number(element.dataset.promptId ?? '0')
        const isSelected = selectedIdSet.has(promptId)
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
  }, [containerElement, selectable, selectedIds])

  return {
    shouldSuppressClick: () => Date.now() < suppressClickUntilRef.current,
  }
}
