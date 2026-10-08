import type { SystemFolderRootId } from '@conai/shared'
import { useSearchParams } from 'react-router-dom'
import { FileBrowser } from './file-browser'

const SYSTEM_ROOTS: readonly SystemFolderRootId[] = ['recycle-bin', 'uploads', 'save', 'temp', 'logs']

export function FilesPage() {
  const [params, setParams] = useSearchParams()
  const parentId = params.get('folder') || null
  // `owner`: absent = own store, `all` = account list (admins), otherwise another account's store key.
  const owner = params.get('owner') || null
  // `system` + `path`: a server folder (admins) instead of the store.
  const systemRoot = params.get('system')
  const system = systemRoot && SYSTEM_ROOTS.includes(systemRoot as SystemFolderRootId)
    ? { root: systemRoot as SystemFolderRootId, path: params.get('path') ?? '' }
    : null
  const update = (next: { owner: string | null; folder: string | null }) => {
    const search: Record<string, string> = {}
    if (next.owner) search.owner = next.owner
    if (next.folder) search.folder = next.folder
    setParams(search)
  }
  return (
    <FileBrowser
      key={system ? 'system' : `${owner ?? 'self'}:${parentId ?? 'root'}`}
      parentId={parentId}
      owner={owner}
      onNavigate={(id) => update({ owner: system ? null : owner, folder: id })}
      onOwnerChange={(next) => update({ owner: next, folder: null })}
      system={system}
      onSystemNavigate={(location) => setParams(location.path ? { system: location.root, path: location.path } : { system: location.root })}
    />
  )
}
