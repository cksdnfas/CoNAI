import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HierarchyNav, hierarchyReservesToggleColumn } from '@/components/common/hierarchy-nav'
import { listWorkspaceFolders } from '@/lib/api-workspaces'
import type { DropTarget } from '@/lib/use-drop-target'

export const join = (...parts: string[]) => parts.filter(Boolean).join('/')
export const baseName = (target: string) => target.split('/').at(-1) ?? target
export const parentOf = (target: string) => (target.includes('/') ? target.slice(0, target.lastIndexOf('/')) : '')

/** One folder of a project: its path, its own name and its parent's path ('' is the project's top). */
export type WorkspaceFolder = { path: string; name: string; parent: string }

const NO_PATHS: string[] = []

const getFolderPath = (folder: WorkspaceFolder) => folder.path
const getFolderParent = (folder: WorkspaceFolder) => folder.parent || null
const getFolderName = (folder: WorkspaceFolder) => folder.name

/** Whether the folder tree has a chevron column; the rows beside it indent by one level to line up. */
export const workspaceTreeReservesToggle = (folders: WorkspaceFolder[]) => hierarchyReservesToggleColumn(folders, getFolderPath, getFolderParent)

/** The server lists folder paths; every ancestor gets its own row too, so the tree has no gaps. */
function folderRows(paths: string[]) {
  const rows: WorkspaceFolder[] = []
  const known = new Set<string>()
  const add = (path: string) => {
    if (path === '' || known.has(path)) return
    const parent = parentOf(path)
    add(parent)
    known.add(path)
    rows.push({ path, name: baseName(path), parent })
  }
  for (const path of paths) add(path)
  return rows
}

/** Every folder of a project (the server sends at most 2,000), for its sidebar tree and the move dialog. */
export function useWorkspaceFolders(projectId: string) {
  const query = useQuery({ queryKey: ['workspaces', projectId, 'folders'], queryFn: () => listWorkspaceFolders(projectId) })
  const paths = query.data ?? NO_PATHS
  const folders = useMemo(() => folderRows(paths), [paths])
  return { folders, query }
}

/** The open project's folders as a sidebar tree, under the project's row (which stands for its top folder). */
export function WorkspaceFolderTree({ folders, dir, onOpen, dropTarget }: {
  folders: WorkspaceFolder[]
  /** The open folder ('' is the top). */
  dir: string
  onOpen: (path: string) => void
  /** The browser's drop hook: every folder takes drops. */
  dropTarget?: DropTarget
}) {
  return (
    <HierarchyNav
      variant="sidebar"
      baseDepth={1}
      items={folders}
      selectedId={dir || null}
      onSelect={(folder) => onOpen(folder.path)}
      getId={getFolderPath}
      getParentId={getFolderParent}
      getLabel={getFolderName}
      getItemDataAttributes={(folder) => dropTarget?.getTargetAttributes(folder.path) ?? {}}
      expandOnDragHover={dropTarget !== undefined}
    />
  )
}
