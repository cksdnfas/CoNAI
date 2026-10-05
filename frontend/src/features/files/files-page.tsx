import { useSearchParams } from 'react-router-dom'
import { FileBrowser } from './file-browser'

export function FilesPage() {
  const [params, setParams] = useSearchParams()
  const parentId = params.get('folder') || null
  // `owner`: absent = own store, `all` = account list (admins), otherwise another account's store key.
  const owner = params.get('owner') || null
  const update = (next: { owner: string | null; folder: string | null }) => {
    const search: Record<string, string> = {}
    if (next.owner) search.owner = next.owner
    if (next.folder) search.folder = next.folder
    setParams(search)
  }
  return (
    <FileBrowser
      key={`${owner ?? 'self'}:${parentId ?? 'root'}`}
      parentId={parentId}
      owner={owner}
      onNavigate={(id) => update({ owner, folder: id })}
      onOwnerChange={(next) => update({ owner: next, folder: null })}
    />
  )
}
