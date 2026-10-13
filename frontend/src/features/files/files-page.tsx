import type { SystemFolderRootId } from '@conai/shared'
import { useSearchParams } from 'react-router-dom'
import { FileBrowser } from './file-browser'
import { WorkspaceBrowser } from './workspace-browser'

const SYSTEM_ROOTS: readonly SystemFolderRootId[] = ['recycle-bin', 'uploads', 'save', 'temp', 'logs']

export function FilesPage() {
  const [params, setParams] = useSearchParams()
  if (params.get('view') === 'workspaces') return <WorkspaceBrowser key={params.get('workspace') ?? 'new'} projectId={params.get('workspace')} onProject={id => setParams(id ? { view: 'workspaces', workspace: id } : { view: 'workspaces' })} onBack={() => setParams({})} />
  const parentId = params.get('folder') || null
  // `system` + `path`: a server folder (admins) instead of the store.
  const systemRoot = params.get('system')
  const system = systemRoot && SYSTEM_ROOTS.includes(systemRoot as SystemFolderRootId)
    ? { root: systemRoot as SystemFolderRootId, path: params.get('path') ?? '' }
    : null
  const update = (next: { folder: string | null }) => {
    const search: Record<string, string> = {}
    if (next.folder) search.folder = next.folder
    setParams(search)
  }
  return (
    <FileBrowser
      key={system ? 'system' : `shared:${parentId ?? 'root'}`}
      parentId={parentId}
      onWorkspacesOpen={() => setParams({ view: 'workspaces' })}
      onNavigate={(id) => update({ folder: id })}
      system={system}
      onSystemNavigate={(location) => setParams(location.path ? { system: location.root, path: location.path } : { system: location.root })}
    />
  )
}
