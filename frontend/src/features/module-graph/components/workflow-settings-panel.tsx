import { Folder, FolderOpen } from 'lucide-react'
import { HierarchyPicker } from '@/components/common/hierarchy-picker'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import type { GraphWorkflowFolderRecord } from '@/lib/api-module-graph'

/** The editor dock's node tab when nothing is selected: the workflow's own name, description and save folder. */
export function WorkflowSettingsPanel({
  workflowName,
  workflowDescription,
  folders,
  folderId,
  onWorkflowNameChange,
  onWorkflowDescriptionChange,
  onFolderChange,
}: {
  workflowName: string
  workflowDescription: string
  folders: GraphWorkflowFolderRecord[]
  folderId: number | null
  onWorkflowNameChange: (value: string) => void
  onWorkflowDescriptionChange: (value: string) => void
  onFolderChange: (folderId: number | null) => void
}) {
  const { t } = useI18n()

  return (
    <div className="space-y-4">
      <Field label={t({ ko: '이름', en: 'Name' })} className="gap-1.5">
        <Input value={workflowName} onChange={(event) => onWorkflowNameChange(event.target.value)} />
      </Field>
      <Field label={t({ ko: '설명', en: 'Description' })} className="gap-1.5">
        <Textarea value={workflowDescription} rows={3} onChange={(event) => onWorkflowDescriptionChange(event.target.value)} />
      </Field>
      <div className="space-y-1.5">
        <div className="text-2xs font-semibold tracking-overline text-muted-foreground uppercase">{t({ ko: '저장 폴더', en: 'Folder' })}</div>
        <HierarchyPicker
          items={folders}
          selectedId={folderId}
          onSelectRoot={() => onFolderChange(null)}
          onSelect={(folder) => onFolderChange(folder.id)}
          getId={(folder) => folder.id}
          getParentId={(folder) => folder.parent_id}
          getLabel={(folder) => folder.name}
          sortItems={(left, right) => left.name.localeCompare(right.name, 'ko')}
          renderIcon={(_, state) => (state.hasChildren ? <FolderOpen className="size-4 shrink-0" /> : <Folder className="size-4 shrink-0" />)}
          rootLabel={t({ ko: '폴더 없음', en: 'No folder' })}
        />
      </div>
    </div>
  )
}
