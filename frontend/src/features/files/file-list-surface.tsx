import { useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { ActionContextMenu, type ActionMenuEntry } from '@/components/ui/action-menu'
import { hasOpenDialog, useHotkey } from '@/lib/keyboard-shortcut'
import type { DropTarget } from '@/lib/use-drop-target'
import { useRubberBandSelection } from '@/lib/use-rubber-band-selection'
import { cn } from '@/lib/utils'

/** What a click or a press on the list does not count as "on empty space". */
const CONTROL_SELECTOR = '[data-entry-id], button, a, input, [role="checkbox"]'

/** The selection of a browser's list (not a picker's): gestures on empty space and the keys while the list has focus. */
export type FileListSelection = {
  selectedIds: string[]
  /** Every item of the current page, in order. */
  pageIds: string[]
  onSelectedIdsChange: (ids: string[]) => void
  /** Each key acts only when its callback is given (the permission and the selection allow it). */
  onOpen?: () => void
  onDelete?: () => void
  onRename?: () => void
  onParent?: () => void
  /** Ctrl/⌘+X marks the selection, Ctrl/⌘+V moves the marked items here; Esc also drops the mark (given while one exists). */
  onCut?: () => void
  onPaste?: () => void
  onCancelCut?: () => void
  /** Right-click on empty space: the create actions of the store. */
  menu: ActionMenuEntry[]
}

/**
 * The area of a file browser's list (also an empty folder or an error): the current folder as a drop target with the
 * upload overlay, and, in a browser, the rubber band, a click that clears the selection, the Explorer keys and the
 * empty-space menu.
 */
export function FileListSurface({ children, drop, dropId, dropLabel, selection }: {
  children: ReactNode
  /** The page's drop hook; the surface carries its container handlers. */
  drop: DropTarget
  /** The folder the list shows, as its drop id ('' is the top). Files from the computer dropped on empty space land here. */
  dropId: string
  /** The overlay's text while files from the computer hover the list. */
  dropLabel: string
  selection?: FileListSelection
}) {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const enabled = selection !== undefined
  // The selection when the band began: with Ctrl/⌘ the band adds to it, and a shrinking band gives its items back.
  const bandBase = useRef<string[]>([])
  const bandIds = useRef<string[]>([])

  /** The items under the band become the selection as it moves (with Ctrl/⌘, they join the earlier one). */
  const follow = (elements: HTMLElement[], additive: boolean) => {
    if (!selection) return
    const covered = elements.flatMap((item) => item.dataset.entryId ?? [])
    const ids = additive ? [...new Set([...bandBase.current, ...covered])] : covered
    if (ids.length === bandIds.current.length && ids.every((id, index) => id === bandIds.current[index])) return
    bandIds.current = ids
    selection.onSelectedIdsChange(ids)
  }
  const { shouldSuppressClick } = useRubberBandSelection({
    containerElement: element,
    enabled,
    selectables: '[data-entry-id]',
    // A press on an item starts its move drag; a press on a button is that button's.
    ignorePress: (target) => target.closest(CONTROL_SELECTOR) !== null,
    onDragStateChange: (dragging) => {
      if (!dragging) return
      bandBase.current = selection?.selectedIds ?? []
      bandIds.current = bandBase.current
    },
    onPreview: follow,
    onSelect: follow,
  })

  // The list owns the keys while it holds focus (an item or the empty space), unless a field, a menu or a dialog does.
  const listensTo = (event: KeyboardEvent) => element !== null && event.target instanceof Node && element.contains(event.target) && !hasOpenDialog()
  const onControl = (event: KeyboardEvent) => event.target instanceof Element && event.target.closest('button, a, [role="checkbox"]') !== null
  useHotkey('Mod+A', (event) => {
    if (!listensTo(event) || !selection) return
    event.preventDefault()
    selection.onSelectedIdsChange(selection.pageIds)
  }, enabled)
  useHotkey('Escape', (event) => {
    if (!listensTo(event) || !selection) return
    selection.onCancelCut?.()
    selection.onSelectedIdsChange([])
  }, selection !== undefined && (selection.selectedIds.length > 0 || selection.onCancelCut !== undefined))
  useHotkey('Mod+X', (event) => {
    if (!listensTo(event) || !selection?.onCut) return
    event.preventDefault()
    selection.onCut()
  }, enabled)
  useHotkey('Mod+V', (event) => {
    if (!listensTo(event) || !selection?.onPaste) return
    event.preventDefault()
    selection.onPaste()
  }, enabled)
  useHotkey('Delete', (event) => {
    if (!listensTo(event) || !selection?.onDelete) return
    event.preventDefault()
    selection.onDelete()
  }, enabled)
  // A focused item or button keeps its own Enter (it opens that item).
  useHotkey('Enter', (event) => {
    if (!listensTo(event) || onControl(event) || !selection?.onOpen) return
    event.preventDefault()
    selection.onOpen()
  }, enabled)
  useHotkey('Backspace', (event) => {
    if (!listensTo(event) || !selection?.onParent) return
    event.preventDefault()
    selection.onParent()
  }, enabled)
  useHotkey('F2', (event) => {
    if (!listensTo(event) || !selection?.onRename) return
    event.preventDefault()
    selection.onRename()
  }, enabled)

  const clearOnEmptySpace = (event: MouseEvent) => {
    if (!selection || shouldSuppressClick() || selection.selectedIds.length === 0) return
    if (event.target instanceof Element && event.target.closest(CONTROL_SELECTOR)) return
    selection.onSelectedIdsChange([])
  }

  // This menu is for empty space; an item has its own. A right-click on an item is already the item menu's (Radix skips
  // the outer trigger for an event the inner one handled), but a touch long-press is timed by every trigger above the
  // item: marking the press as handled here, after the item's trigger saw it, keeps this one from also opening.
  const keepItemLongPress = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' && event.target instanceof Element && event.target.closest('[data-entry-id]')) event.preventDefault()
  }

  return (
    <ActionContextMenu entries={selection?.menu ?? []}>
      <div
        ref={setElement}
        tabIndex={enabled ? -1 : undefined}
        {...drop.containerProps}
        {...drop.getTargetAttributes(dropId)}
        onPointerDown={keepItemLongPress}
        onClick={clearOnEmptySpace}
        className={cn('relative space-y-3 outline-none', enabled ? 'min-h-[calc(var(--shell-content-height)-3.5rem-var(--theme-shell-main-padding-bottom))]' : 'min-h-72')}
      >
        {drop.targetId === dropId ? (
          // Only files from the computer get here: a move onto the folder it is already in is refused.
          <div aria-hidden className="pointer-events-none absolute inset-0 z-10 rounded-md bg-primary/10 ring-2 ring-primary/60 ring-inset">
            <span className="sticky top-1/3 mx-auto mt-24 block w-fit rounded-sm bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground shadow-elevation-2">{dropLabel}</span>
          </div>
        ) : null}
        {children}
      </div>
    </ActionContextMenu>
  )
}
