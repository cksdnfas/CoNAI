import { useSearchParams } from 'react-router-dom'
import { FileBrowser } from './file-browser'

export function FilesPage() {
  const [params, setParams] = useSearchParams()
  const parentId = params.get('folder') || null
  return <FileBrowser key={parentId ?? 'root'} parentId={parentId} onNavigate={(id) => setParams(id ? { folder: id } : {})} />
}
