/** Private drag type for images dragged out of the group image list; the payload is a JSON array of composite hashes. */
export const GROUP_IMAGE_DRAG_TYPE = 'application/x-conai-image-hashes'

/** True when a drag carries our image payload (only the type list is readable before drop). */
export function isGroupImageDrag(dataTransfer: DataTransfer | null) {
  return Boolean(dataTransfer && Array.from(dataTransfer.types).includes(GROUP_IMAGE_DRAG_TYPE))
}

/** Read the dragged composite hashes on drop. */
export function readGroupImageDrag(dataTransfer: DataTransfer | null): string[] {
  const raw = dataTransfer?.getData(GROUP_IMAGE_DRAG_TYPE)
  if (!raw) {
    return []
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string' && value.length > 0) : []
  } catch {
    return []
  }
}

/**
 * Put the hashes on the drag and, for several images, swap the ghost for a small count badge
 * (the browser snapshots the element synchronously, so it is removed on the next frame).
 */
export function writeGroupImageDrag(event: DragEvent, compositeHashes: string[], countLabel: string) {
  const dataTransfer = event.dataTransfer
  if (!dataTransfer) {
    return
  }

  dataTransfer.effectAllowed = 'copy'
  dataTransfer.setData(GROUP_IMAGE_DRAG_TYPE, JSON.stringify(compositeHashes))

  if (compositeHashes.length > 1) {
    const badge = document.createElement('div')
    badge.textContent = countLabel
    badge.className = 'fixed -left-[999px] top-0 rounded-sm bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground shadow-elevation-2'
    document.body.appendChild(badge)
    dataTransfer.setDragImage(badge, 12, 12)
    window.requestAnimationFrame(() => badge.remove())
  }
}
