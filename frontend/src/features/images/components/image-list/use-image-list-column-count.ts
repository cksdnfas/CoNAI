import { useEffect, useState } from 'react'

const IMAGE_LIST_PREFERRED_MIN_COLUMN_WIDTH = 52

/** Calculate a responsive column count while allowing tighter user-chosen mobile layouts. */
export function useImageListColumnCount(
  containerElement: HTMLElement | null,
  minColumnWidth: number,
  columnGap: number,
  preferredColumnCount?: number | null,
) {
  const [columnCount, setColumnCount] = useState(1)

  useEffect(() => {
    if (!containerElement) return

    const updateColumnCount = () => {
      const width = containerElement.clientWidth
      const defaultEffectiveWidth = Math.max(1, minColumnWidth + columnGap)
      const preferredEffectiveWidth = Math.max(1, Math.min(minColumnWidth, IMAGE_LIST_PREFERRED_MIN_COLUMN_WIDTH) + columnGap)
      const maxFitColumnCount = Math.max(1, Math.floor((width + columnGap) / defaultEffectiveWidth))
      const maxPreferredFitColumnCount = Math.max(1, Math.floor((width + columnGap) / preferredEffectiveWidth))
      const nextColumnCount = preferredColumnCount && preferredColumnCount > 0
        ? Math.min(maxPreferredFitColumnCount, preferredColumnCount)
        : maxFitColumnCount
      setColumnCount(nextColumnCount)
    }

    updateColumnCount()

    const observer = new ResizeObserver(() => updateColumnCount())
    observer.observe(containerElement)

    return () => observer.disconnect()
  }, [columnGap, containerElement, minColumnWidth, preferredColumnCount])

  return columnCount
}
