import { useState, type DragEvent } from 'react'

interface UseDropZoneStateOptions<TElement extends HTMLElement> {
  /** Handle dropped files after the drag state is cleared. */
  onDropFiles: (files: File[], event: DragEvent<TElement>) => void
}

/** Share drag-enter/leave/over/drop state across upload drop surfaces. */
export function useDropZoneState<TElement extends HTMLElement>({ onDropFiles }: UseDropZoneStateOptions<TElement>) {
  const [isDragActive, setIsDragActive] = useState(false)

  const handleDragEnter = (event: DragEvent<TElement>) => {
    event.preventDefault()
    setIsDragActive(true)
  }

  const handleDragOver = (event: DragEvent<TElement>) => {
    event.preventDefault()
    setIsDragActive(true)
  }

  const handleDragLeave = (event: DragEvent<TElement>) => {
    event.preventDefault()
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return
    }

    setIsDragActive(false)
  }

  const handleDrop = (event: DragEvent<TElement>) => {
    event.preventDefault()
    setIsDragActive(false)
    onDropFiles(Array.from(event.dataTransfer.files ?? []), event)
  }

  return {
    isDragActive,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  }
}
