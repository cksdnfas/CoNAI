import { Folder, FolderOpen } from 'lucide-react'
import { HierarchyPicker } from '@/components/common/hierarchy-picker'
import { useI18n } from '@/i18n'
import type { GraphWorkflowFolderRecord } from '@/lib/api-module-graph'

function compareFolderNamesKo(left: GraphWorkflowFolderRecord, right: GraphWorkflowFolderRecord) {
  return left.name.localeCompare(right.name, 'ko')
}

/** The workflow folder tree picker; `null` is the root row. */
export function WorkflowFolderPicker({
  folders,
  selectedId,
  onChange,
  rootLabel,
  sortItems = compareFolderNamesKo,
}: {
  folders: GraphWorkflowFolderRecord[]
  selectedId: number | null
  onChange: (folderId: number | null) => void
  /** Root row text; defaults to "폴더 없음". */
  rootLabel?: string
  sortItems?: (left: GraphWorkflowFolderRecord, right: GraphWorkflowFolderRecord) => number
}) {
  const { t } = useI18n()

  return (
    <HierarchyPicker
      items={folders}
      selectedId={selectedId}
      onSelectRoot={() => onChange(null)}
      onSelect={(folder) => onChange(folder.id)}
      getId={(folder) => folder.id}
      getParentId={(folder) => folder.parent_id}
      getLabel={(folder) => folder.name}
      sortItems={sortItems}
      renderIcon={(_, state) => (state.hasChildren ? <FolderOpen className="size-4 shrink-0" /> : <Folder className="size-4 shrink-0" />)}
      rootLabel={rootLabel ?? t({ ko: '폴더 없음', en: 'No folder' })}
    />
  )
}
