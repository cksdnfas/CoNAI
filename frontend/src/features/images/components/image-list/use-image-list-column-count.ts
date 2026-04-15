import { useEffect, useState } from 'react'

/** Calculate a responsive masonry column count from the container width. */
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
      const effectiveWidth = Math.max(1, minColumnWidth + columnGap)
      const maxFitColumnCount = Math.max(1, Math.floor((width + columnGap) / effectiveWidth))
      const nextColumnCount = preferredColumnCount && preferredColumnCount > 0
        ? Math.min(maxFitColumnCount, preferredColumnCount)
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
