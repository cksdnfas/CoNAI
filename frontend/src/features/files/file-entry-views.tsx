import { useRef, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import type { FileStoreSortKey } from '@conai/shared'
import { MediaCard } from '@/components/common/media-card'
import { ActionContextMenu, ActionMenuButton, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DataCheckTd, DataCheckTh, DataTable, DataTd, DataTh, DataTr } from '@/components/ui/data-table'
import { useI18n } from '@/i18n'
import { setDragCountBadge } from '@/lib/drag-count-badge'
import type { DropTarget } from '@/lib/use-drop-target'
import { cn } from '@/lib/utils'
import type { FileSort } from './file-view-mode'
import { InlineNameInput } from './inline-name-input'

/** One file or folder as the shared list shows it (file store, project workspaces). */
export type EntryItem = {
  id: string
  name: string
  folder: boolean
  /** Bytes; folders show none. */
  size: number
  /** Already formatted; the list adds the 수정일 column when any item has one. */
  modified?: string
  /** Small icon in the list row. */
  icon: ReactNode
  /** Square face of the grid tile (thumbnail or large icon). */
  face: ReactNode
  /** A file the picker cannot take: shown dimmed, with no checkbox, and a click does nothing. */
  disabled?: boolean
  /** Why it is dimmed; shown with the name on hover. */
  disabledReason?: string
}

export type EntryViewProps = {
  items: EntryItem[]
  mode: 'grid' | 'list'
  selected: string[]
  onToggle: (id: string, checked: boolean) => void
  /** List header checkbox; without it the header has none. */
  onSelectAll?: (checked: boolean) => void
  canSelect?: (item: EntryItem) => boolean
  /**
   * Open the item: a click in pickers, and in the browsers a double-click, Enter, or a touch / pen tap. Long-press menus
   * never also open the item.
   */
  onOpen: (item: EntryItem) => void
  /**
   * Browsers only: the selection as Explorer has it. A mouse click selects that item alone, Ctrl/⌘ toggles it, Shift
   * selects the range from the last click. Touch and pen taps keep opening (or, in the grid with a selection,
   * toggling). Without it (pickers) a click is `onOpen`.
   */
  onSelect?: (ids: string[]) => void
  /** Row actions for its ⋯ button and right-click / long-press menu; none in pickers. */
  menu?: (item: EntryItem) => ActionMenuEntry[]
  formatSize: (bytes: number) => string
  /** Drag items onto folders (and elsewhere: `onDragStart` sets the payload). */
  draggable?: boolean
  /** A drag began on `ids`: the whole selection when the dragged item is in it, else that item. */
  onDragStart?: (ids: string[], event: DragEvent) => void
  onDragEnd?: () => void
  /** The page's drop hook: folders take drops and show where one will land. */
  dropTarget?: DropTarget
  /** Smaller grid tiles (pickers in a dialog). */
  compact?: boolean
  /** The list's order and what a column header may sort by; without `onSort` the headers are plain. */
  sort?: FileSort
  sortKeys?: readonly FileStoreSortKey[]
  onSort?: (key: FileStoreSortKey) => void
  /** Items marked for a move (cut): shown dimmed. */
  cutIds?: readonly string[]
  /** One item whose name is edited in place (its tile's caption or its row's name). */
  renaming?: { id: string; value: string; onChange: (value: string) => void; onCommit: () => Promise<unknown> | void; onCancel: () => void }
}

/** A column header that sorts: a button with the direction arrow on the sorted column (`aria-sort` goes on its `th`). */
function SortHeader({ label, active, direction, onClick, numeric = false }: { label: string; active: boolean; direction: FileSort['direction']; onClick: () => void; numeric?: boolean }) {
  const Arrow = direction === 'asc' ? ArrowUp : ArrowDown
  return (
    <div className={cn('flex', numeric && 'justify-end')}>
      <Button variant="ghost" size="compact" onClick={onClick}>
        {label}
        {active ? <Arrow aria-hidden /> : null}
      </Button>
    </div>
  )
}

/** The file list both stores share: icon grid or detail table, checkboxes, row menus, selection gestures, drag onto folders. */
export function FileEntryView({ items, mode, selected, onToggle, onSelectAll, canSelect = () => true, onOpen, onSelect, menu, formatSize, draggable = false, onDragStart, onDragEnd, dropTarget, compact = false, sort, sortKeys, onSort, cutIds, renaming }: EntryViewProps) {
  const { t } = useI18n()
  // A long-press opens the row menu; the click that may follow it should not also open the item.
  const touchMenuAt = useRef(0)
  const pointerType = useRef('mouse')
  // Where a Shift+click range starts: the item last clicked.
  const anchorId = useRef<string | null>(null)
  const menuOpenChange = (open: boolean) => { if (open && pointerType.current !== 'mouse') touchMenuAt.current = Date.now() }
  const afterTouchMenu = () => Date.now() - touchMenuAt.current >= 800
  const open = (item: EntryItem) => { if (!item.disabled && afterTouchMenu()) onOpen(item) }
  // Folders first in the grid, as in a file manager; the list keeps its order.
  const ordered = mode === 'grid' ? [...items].sort((left, right) => (left.folder === right.folder ? 0 : left.folder ? -1 : 1)) : items
  const toggled = (id: string) => (selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id])
  const choose = (item: EntryItem, event: MouseEvent) => {
    if (!onSelect) {
      open(item)
      return
    }
    // Enter on a focused item is a click without a pointer: it opens, as do touch and pen taps (a grid with a selection toggles).
    if (event.detail === 0) {
      open(item)
      return
    }
    if (pointerType.current !== 'mouse') {
      if (!afterTouchMenu()) return
      if (!item.folder && mode === 'grid' && selected.length > 0) onSelect(toggled(item.id))
      else open(item)
      return
    }
    const additive = event.ctrlKey || event.metaKey
    const from = ordered.findIndex((entry) => entry.id === anchorId.current)
    if (event.shiftKey && from >= 0) {
      const to = ordered.findIndex((entry) => entry.id === item.id)
      const range = ordered.slice(Math.min(from, to), Math.max(from, to) + 1).map((entry) => entry.id)
      onSelect(additive ? [...new Set([...selected, ...range])] : range)
      return
    }
    anchorId.current = item.id
    onSelect(additive ? toggled(item.id) : [item.id])
  }
  const openByMouse = (item: EntryItem) => { if (onSelect && pointerType.current === 'mouse') open(item) }
  // The checkbox and the ⋯ button belong to the row, but a click on them is not a click on the item.
  const stopRow = onSelect ? (event: MouseEvent) => event.stopPropagation() : undefined
  const isCut = (item: EntryItem) => cutIds?.includes(item.id) === true
  const editor = (item: EntryItem) => renaming?.id === item.id ? (
    <InlineNameInput value={renaming.value} folder={item.folder} onChange={renaming.onChange} onCommit={renaming.onCommit} onCancel={renaming.onCancel} />
  ) : null
  const dragProps = (item: EntryItem) => ({
    draggable: draggable && renaming?.id !== item.id,
    onPointerDown: (event: { pointerType: string }) => { pointerType.current = event.pointerType },
    onDragStart: draggable && onDragStart && renaming?.id !== item.id ? (event: DragEvent) => {
      const ids = selected.includes(item.id) ? selected : [item.id]
      if (ids.length > 1) setDragCountBadge(event.dataTransfer, t({ ko: '{count}개 항목', en: '{count} items' }, { count: ids.length }))
      onDragStart(ids, event)
    } : undefined,
    onDragEnd: draggable ? onDragEnd : undefined,
    'data-entry-id': item.id,
    ...(item.folder ? dropTarget?.getTargetAttributes(item.id) : undefined),
  })

  if (mode === 'grid') {
    return (
      <div className={cn('grid gap-1.5', compact ? 'grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))]', onSelect && 'select-none')}>
        {ordered.map((item) => {
          const isSelected = selected.includes(item.id)
          const selectable = canSelect(item)
          return (
            <ActionContextMenu key={item.id} entries={menu?.(item) ?? []} onOpenChange={menuOpenChange}>
              <div {...dragProps(item)} title={item.disabledReason ? `${item.name} · ${item.disabledReason}` : item.name} className={cn('group relative min-w-0 rounded-sm [-webkit-touch-callout:none] data-[drop-target=true]:bg-primary/20 data-[drop-target=true]:ring-2 data-[drop-target=true]:ring-primary/60', item.disabled && 'opacity-40', isCut(item) && 'opacity-50')}>
                <MediaCard
                  onClick={(event) => choose(item, event)}
                  onDoubleClick={() => openByMouse(item)}
                  title={renaming?.id === item.id ? undefined : <span className="line-clamp-2 whitespace-normal wrap-anywhere">{item.name}</span>}
                  selected={isSelected}
                  className="w-full"
                  mediaClassName="aspect-square w-full"
                  media={<span className="flex size-full items-center justify-center">{item.face}</span>}
                  meta={item.folder ? undefined : formatSize(item.size)}
                />
                {editor(item)}
                {selectable ? (
                  <span className={cn('absolute left-2.5 top-2.5 rounded-sm bg-background/80 p-0.5 transition-opacity', isSelected || selected.length > 0 || compact ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100')}>
                    <Checkbox aria-label={t({ ko: '{name} 선택', en: 'Select {name}' }, { name: item.name })} checked={isSelected} onCheckedChange={(checked) => onToggle(item.id, checked === true)} />
                  </span>
                ) : null}
              </div>
            </ActionContextMenu>
          )
        })}
      </div>
    )
  }

  const columnHeader = (key: FileStoreSortKey, label: string, numeric = false) => {
    const sortable = onSort !== undefined && sort !== undefined && (sortKeys?.includes(key) ?? true)
    return (
      <DataTh className={key === 'modified' ? 'hidden sm:table-cell' : numeric ? 'text-right' : undefined} aria-sort={sortable && sort.sort === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
        {sortable ? <SortHeader label={label} active={sort.sort === key} direction={sort.direction} numeric={numeric} onClick={() => onSort(key)} /> : label}
      </DataTh>
    )
  }
  const selectable = items.filter(canSelect)
  const allSelected = selectable.length > 0 && selectable.every((item) => selected.includes(item.id))
  const showModified = items.some((item) => item.modified !== undefined)
  return (
    <DataTable
      className={cn(onSelect && 'select-none')}
      head={(
        <>
          <DataCheckTh>
            {onSelectAll ? <Checkbox aria-label={t({ ko: '전체 선택', en: 'Select all' })} disabled={selectable.length === 0} checked={allSelected} onCheckedChange={(checked) => onSelectAll(checked === true)} /> : null}
          </DataCheckTh>
          {columnHeader('name', t({ ko: '이름', en: 'Name' }))}
          {showModified ? columnHeader('modified', t({ ko: '수정일', en: 'Modified' })) : null}
          {columnHeader('size', t({ ko: '크기', en: 'Size' }), true)}
          {menu ? <DataTh className="w-10"><span className="sr-only">{t({ ko: '더 보기', en: 'More' })}</span></DataTh> : null}
        </>
      )}
    >
      {items.map((item) => {
        const isSelected = selected.includes(item.id)
        const entries = menu?.(item) ?? []
        return (
          <ActionContextMenu key={item.id} entries={entries} onOpenChange={menuOpenChange}>
            <DataTr interactive selected={isSelected} {...dragProps(item)} onClick={onSelect ? (event) => choose(item, event) : undefined} onDoubleClick={onSelect ? () => openByMouse(item) : undefined}>
              <DataCheckTd onClick={stopRow} onDoubleClick={stopRow}>
                {canSelect(item) ? <Checkbox aria-label={t({ ko: '{name} 선택', en: 'Select {name}' }, { name: item.name })} checked={isSelected} onCheckedChange={(checked) => onToggle(item.id, checked === true)} /> : null}
              </DataCheckTd>
              <DataTd flush className="min-w-40">
                {renaming?.id === item.id ? (
                  <div className="flex items-center gap-2 pr-2">
                    {item.icon}
                    {editor(item)}
                  </div>
                ) : (
                  <div className={cn(isCut(item) && 'opacity-50')}>
                    <Button variant="ghost" className="max-w-full justify-start" disabled={item.disabled} title={item.disabledReason} onClick={onSelect ? undefined : () => open(item)}>
                      {item.icon}
                      <span className="max-w-80 truncate">{item.name}</span>
                    </Button>
                  </div>
                )}
              </DataTd>
              {showModified ? <DataTd meta flush className="hidden sm:table-cell">{item.modified ?? ''}</DataTd> : null}
              <DataTd meta flush className="text-right">{item.folder ? '' : formatSize(item.size)}</DataTd>
              {menu ? (
                <DataTd flush onClick={stopRow} onDoubleClick={stopRow}>
                  <ActionMenuButton entries={entries} label={t({ ko: '더 보기', en: 'More' })} />
                </DataTd>
              ) : null}
            </DataTr>
          </ActionContextMenu>
        )
      })}
    </DataTable>
  )
}
