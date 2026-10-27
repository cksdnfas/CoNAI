import { useState } from 'react'
import { FolderOpen, Plus } from 'lucide-react'
import { HierarchyNav } from '@/components/common/hierarchy-nav'
import { HierarchyPicker } from '@/components/common/hierarchy-picker'
import { SearchField } from '@/components/common/search-field'
import type { ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { IconButton } from '@/components/ui/icon-button'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { usePageSidebar } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/i18n'
import type { CharacterFolder } from '@/lib/api-character-library'
import { sortFoldersByName } from '../character-library-shared'

const getFolderId = (folder: CharacterFolder) => folder.id
const getFolderParentId = (folder: CharacterFolder) => folder.parentId

/** Folders whose name matches plus every ancestor of a match (so the path stays visible), and those ancestors to expand. */
function filterFolders(folders: CharacterFolder[], text: string) {
  const query = text.trim().toLocaleLowerCase()
  if (!query) return { visible: folders, expanded: [] as number[] }
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const kept = new Set<number>()
  const expanded = new Set<number>()
  for (const folder of folders) {
    if (!folder.name.toLocaleLowerCase().includes(query)) continue
    kept.add(folder.id)
    let parentId = folder.parentId
    while (parentId !== null && !expanded.has(parentId)) {
      expanded.add(parentId)
      kept.add(parentId)
      parentId = byId.get(parentId)?.parentId ?? null
    }
  }
  return { visible: folders.filter((folder) => kept.has(folder.id)), expanded: [...expanded] }
}

/**
 * The page sidebar: the top level, a name filter and the folder tree (right-click / long-press for a folder's actions).
 * In the page's narrow-screen drawer a pick closes the drawer (`inDialog`: never, the tree sits in a picker).
 */
export function CharacterFolderSidebar({ folders, selectedId, loading, error, onSelect, onCreate, getMenu, inDialog = false }: {
  folders: CharacterFolder[]
  /** null: the top level. */
  selectedId: number | null
  loading: boolean
  error: unknown
  onSelect: (folderId: number | null) => void
  onCreate?: () => void
  getMenu?: (folder: CharacterFolder) => ActionMenuEntry[]
  inDialog?: boolean
}) {
  const { t } = useI18n()
  const surroundingSidebar = usePageSidebar()
  const pageSidebar = inDialog ? null : surroundingSidebar
  const [filterText, setFilterText] = useState('')
  const { visible, expanded } = filterFolders(folders, filterText)
  const pick = (folderId: number | null) => {
    if (pageSidebar && !pageSidebar.isDesktop) pageSidebar.setMobileOpen(false)
    onSelect(folderId)
  }
  const getLabel = (folder: CharacterFolder) => (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <span className="truncate">{folder.name}</span>
      {folder.settingCount ? <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{folder.settingCount}</span> : null}
    </div>
  )
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <SearchField value={filterText} onChange={setFilterText} placeholder={t({ ko: '폴더 검색', en: 'Search folders' })} />
        {onCreate ? <IconButton label={t({ ko: '새 폴더', en: 'New folder' })} size="icon-sm" variant="ghost" onClick={() => { if (pageSidebar && !pageSidebar.isDesktop) pageSidebar.setMobileOpen(false); onCreate() }}><Plus /></IconButton> : null}
      </div>
      {loading ? <div className="space-y-2">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} radius="sm" className="h-9 w-full" />)}</div> : null}
      {error ? <ErrorState size="compact" title={t({ ko: '폴더를 불러오지 못했어', en: 'Could not load folders' })} error={error instanceof Error ? error.message : undefined} /> : null}
      {!loading && !error ? (
        <div className="space-y-1">
          {!filterText.trim() ? (
            <Button type="button" variant="nav" size="sm" onClick={() => pick(null)} data-active={selectedId === null ? 'true' : undefined} aria-current={selectedId === null ? 'true' : undefined}>
              <FolderOpen />
              {t({ ko: '최상위', en: 'Top level' })}
            </Button>
          ) : null}
          {visible.length ? (
            <HierarchyNav
              items={visible}
              expandable
              defaultExpandedIds={expanded}
              selectedId={selectedId}
              onSelect={(folder) => pick(folder.id)}
              getId={getFolderId}
              getParentId={getFolderParentId}
              getLabel={getLabel}
              sortItems={sortFoldersByName}
              getItemMenu={getMenu}
            />
          ) : filterText.trim() ? <EmptyState size="compact" title={t({ ko: '맞는 폴더가 없어', en: 'No matching folders' })} /> : null}
        </div>
      ) : null}
    </div>
  )
}

/** Pick a folder (or the top level) for a move or a setting's place; `excludeIds` are not offered (a folder's own subtree). */
export function CharacterFolderPickerModal({ title, folders, value, excludeIds, submitLabel, busy = false, onPick, onClose }: {
  title: string
  folders: CharacterFolder[]
  value: number | null
  excludeIds?: ReadonlySet<number>
  submitLabel?: string
  busy?: boolean
  onPick: (folderId: number | null) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [picked, setPicked] = useState(value)
  const items = excludeIds ? folders.filter((folder) => !excludeIds.has(folder.id)) : folders
  return (
    <Modal open appearance="card" widthClassName="max-w-md" title={title} onClose={() => { if (!busy) onClose() }}>
      <ModalBody>
        <HierarchyPicker
          items={items}
          selectedId={picked}
          onSelectRoot={() => setPicked(null)}
          onSelect={(folder) => setPicked(folder.id)}
          getId={getFolderId}
          getParentId={getFolderParentId}
          getLabel={(folder) => <span className="truncate">{folder.name}</span>}
          sortItems={sortFoldersByName}
          rootLabel={t({ ko: '최상위', en: 'Top level' })}
        />
      </ModalBody>
      <ModalFooter>
        <span className="flex-1" />
        <Button type="button" disabled={busy || picked === value} onClick={() => onPick(picked)}>{submitLabel ?? t({ ko: '여기로 옮기기', en: 'Move here' })}</Button>
      </ModalFooter>
    </Modal>
  )
}
