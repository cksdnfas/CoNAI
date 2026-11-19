import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Folder } from 'lucide-react'
import type { StoredFileEntry } from '@conai/shared'
import { HierarchyNav, hierarchyReservesToggleColumn, type HierarchyNodeId } from '@/components/common/hierarchy-nav'
import { ActionContextMenu, type ActionMenuEntry } from '@/components/ui/action-menu'
import { SidebarGroupLabel, SidebarItem } from '@/components/ui/sidebar'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { FILES_QUERY_KEY, listStoredFolders } from '@/lib/api-files'
import type { DropTarget } from '@/lib/use-drop-target'
import { createSessionStore } from './session-store'

export type StoreFolder = { folder: StoredFileEntry; depth: number; path: string }

const NO_FOLDERS: StoredFileEntry[] = []
/** The drop id of the top row (a folder's is its id). */
const TOP_DROP_ID = ''

/** The folders the person opened in the sidebar tree: kept for the session, as the files page remounts the tree per folder. */
const openFolders = createSessionStore<HierarchyNodeId[]>([])
const setFoldersOpen = (ids: HierarchyNodeId[], open: boolean) => {
  const current = openFolders.get()
  openFolders.set(open ? [...new Set([...current, ...ids])] : current.filter((id) => !ids.includes(id)))
}

const getFolderId = (folder: StoredFileEntry) => folder.id
const getFolderParentId = (folder: StoredFileEntry) => folder.parentId
const getFolderLabel = (folder: StoredFileEntry) => folder.name

function folderTree(folders: StoredFileEntry[]) {
  const children = new Map<string | null, StoredFileEntry[]>()
  for (const folder of folders) {
    const siblings = children.get(folder.parentId) ?? []
    siblings.push(folder)
    children.set(folder.parentId, siblings)
  }
  const result: StoreFolder[] = []
  const walk = (parentId: string | null, depth: number, parentPath: string) => {
    if (depth >= 64) return
    for (const folder of children.get(parentId) ?? []) {
      const path = `${parentPath}/${folder.name}`
      result.push({ folder, depth, path })
      walk(folder.id, depth + 1, path)
    }
  }
  walk(null, 0, '')
  return result
}

/**
 * Every file store folder: as a depth-first list with paths (move dialog, assistant options), as the flat rows the
 * tree takes (`entries`) and by id (`byId`).
 */
export function useStoreFolders(enabled = true) {
  const auth = useAuthStatusQuery()
  const accountKey = auth.data?.accountId ?? (auth.data?.hasCredentials ? 'anonymous' : 'bootstrap')
  const query = useQuery({ queryKey: [...FILES_QUERY_KEY, accountKey, 'folders'], queryFn: ({ signal }) => listStoredFolders(signal), enabled })
  const entries = query.data ?? NO_FOLDERS
  const folders = useMemo(() => folderTree(entries), [entries])
  const byId = useMemo(() => new Map(entries.map((folder) => [folder.id, folder] as const)), [entries])
  return { folders, entries, byId, query }
}

/** Whether `folderId` is one of `ids` or lies inside one of them (a folder moved there would end up inside itself). */
export function isInsideFolders(byId: ReadonlyMap<string, StoredFileEntry>, folderId: string, ids: readonly string[]) {
  let current: string | null = folderId
  for (let depth = 0; current !== null && depth < 64; depth += 1) {
    if (ids.includes(current)) return true
    current = byId.get(current)?.parentId ?? null
  }
  return false
}

/**
 * Files sidebar group of the shared store: its top row and a collapsible folder tree. `activeId` undefined marks none
 * (another view is open). Without `dropTarget` and `getFolderMenu` it only navigates.
 */
export function StoreFolderSidebarGroup({ activeId, onOpen, labelled = true, dropTarget, getFolderMenu }: {
  activeId: string | null | undefined
  onOpen: (id: string | null) => void
  /** With the 보관함 caption (the files page, beside other groups). */
  labelled?: boolean
  /** The browser's drop hook (its container sits around this group): the top row and every folder take drops. */
  dropTarget?: DropTarget
  /** A folder's actions (null: the top row), opened by right-click / long-press. */
  getFolderMenu?: (folder: StoredFileEntry | null) => ActionMenuEntry[]
}) {
  const { t } = useI18n()
  const { entries } = useStoreFolders()
  const expandedIds = openFolders.useValue()
  return (
    <>
      {labelled ? <SidebarGroupLabel>{t({ ko: '보관함', en: 'File store' })}</SidebarGroupLabel> : null}
      <ActionContextMenu entries={getFolderMenu?.(null) ?? []}>
        <SidebarItem icon={Folder} depth={hierarchyReservesToggleColumn(entries, getFolderId, getFolderParentId) ? 1 : 0} label={t({ ko: '공용 파일', en: 'Shared files' })} active={activeId === null} onClick={() => onOpen(null)} {...dropTarget?.getTargetAttributes(TOP_DROP_ID)} />
      </ActionContextMenu>
      <HierarchyNav
        variant="sidebar"
        baseDepth={1}
        items={entries}
        selectedId={activeId}
        onSelect={(folder) => onOpen(folder.id)}
        getId={getFolderId}
        getParentId={getFolderParentId}
        getLabel={getFolderLabel}
        getItemDataAttributes={(folder) => dropTarget?.getTargetAttributes(folder.id) ?? {}}
        getItemMenu={getFolderMenu ? (folder) => getFolderMenu(folder) : undefined}
        expandOnDragHover={dropTarget !== undefined}
        expandedIds={expandedIds}
        onExpandedChange={setFoldersOpen}
      />
    </>
  )
}
