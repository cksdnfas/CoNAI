import type { DragEvent } from 'react'

/** Starts dragging list items (`ids`) to move them; `type` keeps one browser's drags out of another's drops. */
export function startMoveDrag(event: DragEvent, type: string, ids: string[]) {
  event.dataTransfer.setData(type, JSON.stringify(ids))
  event.dataTransfer.effectAllowed = 'move'
}

/** Whether a drag over a drop zone is one of ours (a move) rather than files from the computer (an import). */
export function isMoveDrag(event: DragEvent, type: string) {
  return event.dataTransfer.types.includes(type)
}

/** The ids a move drop carries; null when it is not a move of ours (files from the computer, unrelated payloads). */
export function droppedIds(event: DragEvent, type: string) {
  const dragged = event.dataTransfer.getData(type)
  if (!dragged) return null
  try {
    const ids: unknown = JSON.parse(dragged)
    return Array.isArray(ids) && ids.every((id) => typeof id === 'string') ? ids as string[] : []
  } catch {
    return []
  }
}
