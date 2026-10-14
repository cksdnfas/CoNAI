import { useMemo, type DragEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Folder } from 'lucide-react'
import type { StoredFileEntry } from '@conai/shared'
import { SidebarGroupLabel, SidebarItem } from '@/components/ui/sidebar'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { FILES_QUERY_KEY, listStoredFolders } from '@/lib/api-files'

export type StoreFolder = { folder: StoredFileEntry; depth: number; path: string }

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

/** Every file store folder as a depth-first tree (sidebar, move dialog). */
export function useStoreFolders(enabled = true) {
  const auth = useAuthStatusQuery()
  const accountKey = auth.data?.accountId ?? (auth.data?.hasCredentials ? 'anonymous' : 'bootstrap')
  const query = useQuery({ queryKey: [...FILES_QUERY_KEY, accountKey, 'folders'], queryFn: ({ signal }) => listStoredFolders(signal), enabled })
  const folders = useMemo(() => folderTree(query.data ?? []), [query.data])
  return { folders, query }
}

/**
 * Files sidebar group of the shared store: its top and folder tree. `activeId` undefined marks none (another view is
 * open); `onDragOver` / `onDrop` let rows take dragged items.
 */
export function StoreFolderSidebarGroup({ activeId, onOpen, onDragOver, onDrop, labelled = true }: {
  activeId: string | null | undefined
  onOpen: (id: string | null) => void
  onDragOver?: (event: DragEvent) => void
  onDrop?: (event: DragEvent, id: string | null) => void
  /** With the 보관함 caption (the files page, beside other groups). */
  labelled?: boolean
}) {
  const { t } = useI18n()
  const { folders } = useStoreFolders()
  return (
    <>
      {labelled ? <SidebarGroupLabel>{t({ ko: '보관함', en: 'File store' })}</SidebarGroupLabel> : null}
      <SidebarItem icon={Folder} label={t({ ko: '공용 파일', en: 'Shared files' })} active={activeId === null} onClick={() => onOpen(null)} onDragOver={onDragOver} onDrop={onDrop ? (event) => onDrop(event, null) : undefined} />
      {folders.map(({ folder, depth }) => (
        <SidebarItem key={folder.id} icon={Folder} depth={depth + 1} label={folder.name} active={folder.id === activeId} onClick={() => onOpen(folder.id)} onDragOver={onDragOver} onDrop={onDrop ? (event) => onDrop(event, folder.id) : undefined} />
      ))}
    </>
  )
}
