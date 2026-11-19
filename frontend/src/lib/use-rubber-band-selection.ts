import { useEffect, useLayoutEffect, useRef } from 'react'
import SelectionArea from '@viselect/vanilla'
import { useMultiTouchSelectionStartGuard } from '@/lib/use-multi-touch-selection-start-guard'

interface RubberBandOptions {
  containerElement: HTMLElement | null
  enabled: boolean
  /** CSS selector of the elements the band can cover. */
  selectables: string
  /** A press the band leaves alone, besides one inside `[data-no-select-drag="true"]` (e.g. a press that starts a drag). */
  ignorePress?: (target: HTMLElement) => boolean
  onDragStateChange?: (isDragging: boolean) => void
  /** While the band moves, for lists that show the selection growing; the preview class below is set either way. */
  onPreview?: (elements: HTMLElement[], additive: boolean) => void
  /** The finished band: the elements it covered, and whether Ctrl/⌘ was held when it started. */
  onSelect: (elements: HTMLElement[], additive: boolean) => void
}

/**
 * Drag a rubber band over `selectables` of a container. The covered elements carry `is-selection-preview` while the
 * band moves, outside React; the caller commits the result. `shouldSuppressClick` is true right after a band ends, so
 * the click the mouse-up raises does not count as a click on the container.
 */
export function useRubberBandSelection(options: RubberBandOptions) {
  const { containerElement, enabled, selectables } = options
  const optionsRef = useRef(options)
  const previewElementsRef = useRef<Set<HTMLElement>>(new Set())
  const suppressClickUntilRef = useRef(0)
  const canStartSelection = useMultiTouchSelectionStartGuard(containerElement, enabled)

  useLayoutEffect(() => {
    optionsRef.current = options
  })

  useEffect(() => {
    const container = containerElement
    if (!container || !enabled) return

    let additive = false
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
      selectables: [selectables],
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
        if (target.closest('[data-no-select-drag="true"]') || optionsRef.current.ignorePress?.(target)) {
          return false
        }
        additive = Boolean(event?.ctrlKey || event?.metaKey)
      })
      .on('start', () => {
        optionsRef.current.onDragStateChange?.(true)
      })
      .on('move', ({ store }) => {
        const elements = store.selected as HTMLElement[]
        applyPreviewElements(elements)
        optionsRef.current.onPreview?.(elements, additive)
      })
      .on('stop', ({ store }) => {
        suppressClickUntilRef.current = Date.now() + 220

        const elements = store.selected as HTMLElement[]
        clearPreviewElements()
        optionsRef.current.onDragStateChange?.(false)
        optionsRef.current.onSelect(elements, additive)
      })

    return () => {
      optionsRef.current.onDragStateChange?.(false)
      clearPreviewElements()
      selection.destroy()
    }
  }, [canStartSelection, containerElement, enabled, selectables])

  return {
    shouldSuppressClick: () => Date.now() < suppressClickUntilRef.current,
  }
}
