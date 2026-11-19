import { useRef, type DragEvent } from 'react'
import { useDropTarget } from '@/lib/use-drop-target'
import { droppedIds, isMoveDrag, startMoveDrag } from './file-drag'
import { collectDroppedEntries, type UploadEntry } from './folder-upload'

/**
 * The folders of a file box (tiles, rows, tree rows, breadcrumbs, the list itself) as drop targets: items moved from
 * the list, or files from the computer. A folder is addressed by its id (workspace: its path), the top by ''.
 */
export function useEntryDrop({ moveType, canMove, canUpload, busy, allowsMove, onMove, onUpload, onUploadTree }: {
  /** The drag payload type of this browser's moves. */
  moveType: string
  canMove: boolean
  canUpload: boolean
  busy: boolean
  /** Whether `ids` may be moved into the folder: not onto themselves, their own subfolders or where they already are. */
  allowsMove: (folderId: string, ids: readonly string[]) => boolean
  onMove: (ids: string[], folderId: string) => void
  onUpload: (files: File[], folderId: string) => void
  /** With it, files and folders from the computer arrive as entries (folders walked) instead of through `onUpload`. */
  onUploadTree?: (entries: Promise<UploadEntry[]>, folderId: string) => void
}) {
  // What this list is dragging: a dragover cannot read the payload, only the types.
  const dragged = useRef<string[]>([])
  const drop = useDropTarget({
    accepts: (folderId, event) => {
      if (busy) return false
      if (isMoveDrag(event, moveType)) return canMove && allowsMove(folderId, dragged.current)
      return canUpload && event.dataTransfer.types.includes('Files')
    },
    dropEffect: (_folderId, event) => (isMoveDrag(event, moveType) ? 'move' : 'copy'),
    onDrop: (folderId, event) => {
      const ids = droppedIds(event, moveType)
      if (ids) {
        if (ids.length > 0 && allowsMove(folderId, ids)) onMove(ids, folderId)
      } else if (onUploadTree) {
        if (event.dataTransfer.items.length > 0) onUploadTree(collectDroppedEntries(event.dataTransfer), folderId)
      } else if (event.dataTransfer.files.length > 0) {
        onUpload(Array.from(event.dataTransfer.files), folderId)
      }
    },
  })

  // A file the box does not take (busy, no right to upload, over no target) must not reach the browser's own drop
  // handling, which opens it and leaves the page: the drag is answered, with "not allowed".
  const refuseFiles = (handle: (event: DragEvent<HTMLElement>) => void) => (event: DragEvent<HTMLElement>) => {
    handle(event)
    if (event.defaultPrevented || !event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    if (event.type === 'dragover') event.dataTransfer.dropEffect = 'none'
  }

  return {
    drop: { ...drop, containerProps: { ...drop.containerProps, onDragOver: refuseFiles(drop.containerProps.onDragOver), onDrop: refuseFiles(drop.containerProps.onDrop) } },
    startMove: (event: DragEvent, ids: string[]) => {
      dragged.current = ids
      startMoveDrag(event, moveType, ids)
    },
    endMove: () => {
      dragged.current = []
    },
  }
}
