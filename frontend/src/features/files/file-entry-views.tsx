import { useRef, type DragEvent, type ReactNode } from 'react'
import { MediaCard } from '@/components/common/media-card'
import { ActionContextMenu, ActionMenuButton, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DataCheckTd, DataCheckTh, DataTable, DataTd, DataTh, DataTr } from '@/components/ui/data-table'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

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
}

export type EntryViewProps = {
  items: EntryItem[]
  mode: 'grid' | 'list'
  selected: string[]
  onToggle: (id: string, checked: boolean) => void
  /** List header checkbox; without it the header has none. */
  onSelectAll?: (checked: boolean) => void
  canSelect?: (item: EntryItem) => boolean
  /** A click on the item (not on its checkbox). Long-press menus never also open the item. */
  onOpen: (item: EntryItem) => void
  /** Row actions for its ⋯ button and right-click / long-press menu; none in pickers. */
  menu?: (item: EntryItem) => ActionMenuEntry[]
  formatSize: (bytes: number) => string
  /** Drag items onto folders (and elsewhere: `onDragStart` sets the payload). */
  draggable?: boolean
  onDragStart?: (item: EntryItem, event: DragEvent) => void
  onFolderDragOver?: (event: DragEvent) => void
  onFolderDrop?: (item: EntryItem, event: DragEvent) => void
  /** Smaller grid tiles (pickers in a dialog). */
  compact?: boolean
}

/** The file list both stores share: icon grid or detail table, checkboxes, row menus, drag onto folders. */
export function FileEntryView({ items, mode, selected, onToggle, onSelectAll, canSelect = () => true, onOpen, menu, formatSize, draggable = false, onDragStart, onFolderDragOver, onFolderDrop, compact = false }: EntryViewProps) {
  const { t } = useI18n()
  // A long-press opens the row menu; the click that may follow it should not also open the item.
  const touchMenuAt = useRef(0)
  const pointerType = useRef('mouse')
  const menuOpenChange = (open: boolean) => { if (open && pointerType.current !== 'mouse') touchMenuAt.current = Date.now() }
  const open = (item: EntryItem) => { if (Date.now() - touchMenuAt.current >= 800) onOpen(item) }
  const dragProps = (item: EntryItem) => ({
    draggable,
    onPointerDown: (event: { pointerType: string }) => { pointerType.current = event.pointerType },
    onDragStart: draggable && onDragStart ? (event: DragEvent) => onDragStart(item, event) : undefined,
    onDragOver: item.folder ? onFolderDragOver : undefined,
    onDrop: item.folder && onFolderDrop ? (event: DragEvent) => onFolderDrop(item, event) : undefined,
  })

  if (mode === 'grid') {
    // Folders first, as in a file manager.
    const ordered = [...items].sort((left, right) => (left.folder === right.folder ? 0 : left.folder ? -1 : 1))
    return (
      <div className={cn('grid gap-1.5', compact ? 'grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))]')}>
        {ordered.map((item) => {
          const isSelected = selected.includes(item.id)
          const selectable = canSelect(item)
          return (
            <ActionContextMenu key={item.id} entries={menu?.(item) ?? []} onOpenChange={menuOpenChange}>
              <div {...dragProps(item)} title={item.name} className="group relative min-w-0 [-webkit-touch-callout:none]">
                <MediaCard
                  onClick={() => open(item)}
                  title={<span className="line-clamp-2 whitespace-normal break-all">{item.name}</span>}
                  selected={isSelected}
                  className="w-full"
                  mediaClassName="aspect-square w-full"
                  media={<span className="flex size-full items-center justify-center">{item.face}</span>}
                  meta={item.folder ? undefined : formatSize(item.size)}
                />
                {selectable ? (
                  <span className={cn('absolute left-2.5 top-2.5 rounded-sm bg-background/80 p-0.5 transition-opacity', isSelected || selected.length > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100')}>
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

  const selectable = items.filter(canSelect)
  const allSelected = selectable.length > 0 && selectable.every((item) => selected.includes(item.id))
  const showModified = items.some((item) => item.modified !== undefined)
  return (
    <DataTable
      head={(
        <>
          <DataCheckTh>
            {onSelectAll ? <Checkbox aria-label={t({ ko: '전체 선택', en: 'Select all' })} disabled={selectable.length === 0} checked={allSelected} onCheckedChange={(checked) => onSelectAll(checked === true)} /> : null}
          </DataCheckTh>
          <DataTh>{t({ ko: '이름', en: 'Name' })}</DataTh>
          {showModified ? <DataTh className="hidden sm:table-cell">{t({ ko: '수정일', en: 'Modified' })}</DataTh> : null}
          <DataTh className="text-right">{t({ ko: '크기', en: 'Size' })}</DataTh>
          {menu ? <DataTh className="w-10"><span className="sr-only">{t({ ko: '더 보기', en: 'More' })}</span></DataTh> : null}
        </>
      )}
    >
      {items.map((item) => {
        const isSelected = selected.includes(item.id)
        const entries = menu?.(item) ?? []
        return (
          <ActionContextMenu key={item.id} entries={entries} onOpenChange={menuOpenChange}>
            <DataTr interactive selected={isSelected} {...dragProps(item)}>
              <DataCheckTd>
                {canSelect(item) ? <Checkbox aria-label={t({ ko: '{name} 선택', en: 'Select {name}' }, { name: item.name })} checked={isSelected} onCheckedChange={(checked) => onToggle(item.id, checked === true)} /> : null}
              </DataCheckTd>
              <DataTd flush className="min-w-40">
                <Button variant="ghost" className="max-w-full justify-start" onClick={() => open(item)}>
                  {item.icon}
                  <span className="max-w-80 truncate">{item.name}</span>
                </Button>
              </DataTd>
              {showModified ? <DataTd meta flush className="hidden sm:table-cell">{item.modified ?? ''}</DataTd> : null}
              <DataTd meta flush className="text-right">{item.folder ? '' : formatSize(item.size)}</DataTd>
              {menu ? (
                <DataTd flush>
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
