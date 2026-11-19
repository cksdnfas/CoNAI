import { useEffect, useState, type DragEvent } from 'react'

/** Marks a drop-target element (a tree row, a breadcrumb); the value is the target id the hook hands to its callbacks. */
export const DROP_ID_ATTRIBUTE = 'data-drop-id'

type DropEffect = DataTransfer['dropEffect']

interface DropTargetOptions {
  /**
   * Whether the drag may be dropped on this target. Runs on every dragover, when only `dataTransfer.types` is readable
   * (not the payload), and again on drop.
   */
  accepts: (targetId: string, event: DragEvent<HTMLElement>) => boolean
  /** Effect shown over an accepted target. Omit to keep the browser's choice (from the source's `effectAllowed`). */
  dropEffect?: DropEffect | ((targetId: string, event: DragEvent<HTMLElement>) => DropEffect)
  /** An accepted drop; the payload is readable here. */
  onDrop: (targetId: string, event: DragEvent<HTMLElement>) => void
}

export interface DropTarget {
  /** The target the current drag may be dropped on, or null. Cleared on leave, drop and when the drag ends elsewhere. */
  targetId: string | null
  /**
   * Handlers for the element that holds the targets. Several containers that do not nest (a tree and the breadcrumbs
   * above it) may share one hook; do not spread them on nested containers.
   */
  containerProps: {
    onDragOver: (event: DragEvent<HTMLElement>) => void
    onDragLeave: (event: DragEvent<HTMLElement>) => void
    onDrop: (event: DragEvent<HTMLElement>) => void
  }
  /** `data-*` attributes of a target element: its id, and `data-drop-target="true"` while it is the current target. */
  getTargetAttributes: (id: string) => Record<`data-${string}`, string | undefined>
}

/**
 * Delegated drag-and-drop targets: one container handles the drag events and finds the target under the pointer
 * through `DROP_ID_ATTRIBUTE`, so rows only render `getTargetAttributes(id)`. Rows, SidebarItem and Button `nav`
 * style `data-drop-target`.
 */
export function useDropTarget({ accepts, dropEffect, onDrop }: DropTargetOptions): DropTarget {
  const [targetId, setTargetId] = useState<string | null>(null)

  // A drag can end without a leave reaching the container (cancelled, dropped elsewhere, source removed).
  useEffect(() => {
    if (targetId === null) {
      return
    }

    const clear = () => setTargetId(null)
    document.addEventListener('dragend', clear, true)
    document.addEventListener('drop', clear, true)
    return () => {
      document.removeEventListener('dragend', clear, true)
      document.removeEventListener('drop', clear, true)
    }
  }, [targetId])

  /** The accepted target under the pointer inside the container that got the event. */
  const resolveTarget = (event: DragEvent<HTMLElement>) => {
    const element = event.target instanceof Element ? event.target.closest(`[${DROP_ID_ATTRIBUTE}]`) : null
    const id = element && event.currentTarget.contains(element) ? element.getAttribute(DROP_ID_ATTRIBUTE) : null
    return id !== null && accepts(id, event) ? id : null
  }

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    const id = resolveTarget(event)
    if (id === null) {
      setTargetId(null)
      return
    }

    event.preventDefault()
    const effect = typeof dropEffect === 'function' ? dropEffect(id, event) : dropEffect
    if (effect) {
      event.dataTransfer.dropEffect = effect
    }
    setTargetId(id)
  }

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return
    }
    setTargetId(null)
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    setTargetId(null)
    if (event.defaultPrevented) {
      return
    }

    const id = resolveTarget(event)
    if (id === null) {
      return
    }

    event.preventDefault()
    onDrop(id, event)
  }

  return {
    targetId,
    containerProps: { onDragOver: handleDragOver, onDragLeave: handleDragLeave, onDrop: handleDrop },
    getTargetAttributes: (id) => ({ [DROP_ID_ATTRIBUTE]: id, 'data-drop-target': targetId === id ? 'true' : undefined }),
  }
}
