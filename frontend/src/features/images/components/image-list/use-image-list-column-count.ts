import { useEffect, useState } from 'react'

/** Calculate a responsive masonry column count from the container width. */
export function useImageListColumnCount(
  containerElement: HTMLElement | null,
  minColumnWidth: number,
  columnGap: number,
) {
  const [columnCount, setColumnCount] = useState(1)

  useEffect(() => {
    if (!containerElement) return

    const updateColumnCount = () => {
      const width = containerElement.clientWidth
      const effectiveWidth = Math.max(1, minColumnWidth + columnGap)
      const nextColumnCount = Math.max(1, Math.floor((width + columnGap) / effectiveWidth))
      setColumnCount(nextColumnCount)
    }

    updateColumnCount()

    const observer = new ResizeObserver(() => updateColumnCount())
    observer.observe(containerElement)

    return () => observer.disconnect()
  }, [columnGap, containerElement, minColumnWidth])

  return columnCount
}
