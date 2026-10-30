export type LibraryFolder = { id: number; parentId: number | null; name: string; settingCount?: number; profileCount?: number }

/** A fixed collation keeps the browser tree and server directories in the same order. */
export const sortFoldersByName = (left: Pick<LibraryFolder, 'id' | 'name'>, right: Pick<LibraryFolder, 'id' | 'name'>) => left.name.localeCompare(right.name, 'ko') || left.id - right.id

export function folderPath<T extends LibraryFolder>(byId: ReadonlyMap<number, T>, folderId: number | null): T[] {
  const path: T[] = []
  const seen = new Set<number>()
  for (let current = folderId; current !== null && !seen.has(current);) {
    seen.add(current)
    const folder = byId.get(current)
    if (!folder) break
    path.unshift(folder)
    current = folder.parentId
  }
  return path
}

export function folderSubtreeIds(folders: LibraryFolder[], rootId: number) {
  const children = new Map<number | null, number[]>()
  for (const folder of folders) children.set(folder.parentId, [...(children.get(folder.parentId) ?? []), folder.id])
  const ids = new Set<number>(), pending = [rootId]
  while (pending.length) {
    const id = pending.pop()!
    if (ids.has(id)) continue
    ids.add(id)
    pending.push(...(children.get(id) ?? []))
  }
  return ids
}

export function foldersDepthFirst<T extends LibraryFolder>(folders: T[]): T[] {
  const children = new Map<number | null, T[]>()
  for (const folder of folders) {
    const siblings = children.get(folder.parentId) ?? []
    siblings.push(folder)
    children.set(folder.parentId, siblings)
  }
  for (const siblings of children.values()) siblings.sort(sortFoldersByName)
  const pending = [...(children.get(null) ?? [])].reverse(), result: T[] = []
  while (pending.length) {
    const folder = pending.pop()!
    result.push(folder)
    pending.push(...[...(children.get(folder.id) ?? [])].reverse())
  }
  return result
}

export function compareFolderPaths(left: Array<Pick<LibraryFolder, 'id' | 'name'>>, right: Array<Pick<LibraryFolder, 'id' | 'name'>>) {
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const order = sortFoldersByName(left[index], right[index])
    if (order) return order
  }
  return left.length - right.length
}
