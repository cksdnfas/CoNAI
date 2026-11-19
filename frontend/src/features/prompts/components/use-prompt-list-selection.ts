import { useEffect } from 'react'
import { useRubberBandSelection } from '@/lib/use-rubber-band-selection'

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

/** Keep prompt drag-selection preview outside React and commit only the final result. */
export function usePromptListSelection({
  containerElement,
  selectable,
  selectedIds,
  onSelectedIdsChange,
  onDragStateChange,
}: UsePromptListSelectionParams): UsePromptListSelectionResult {
  const { shouldSuppressClick } = useRubberBandSelection({
    containerElement,
    enabled: selectable && Boolean(onSelectedIdsChange),
    selectables: '.prompt-list-selectable',
    onDragStateChange,
    onSelect: (elements) => {
      onSelectedIdsChange?.(Array.from(
        new Set(
          elements
            .map((element) => Number(element.dataset.promptId))
            .filter((value) => Number.isFinite(value) && value > 0),
        ),
      ))
    },
  })

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

  return { shouldSuppressClick }
}
