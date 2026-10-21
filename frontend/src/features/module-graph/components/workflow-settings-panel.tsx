import { Field, FieldGroup } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import type { GraphWorkflowFolderRecord } from '@/lib/api-module-graph'
import { WorkflowFolderPicker } from './workflow-folder-picker'

/** The workflow's own name, description and save folder (the editor bar keeps the name, so it can leave it out). */
export function WorkflowSettingsPanel({
  showName = true,
  workflowName,
  workflowDescription,
  folders,
  folderId,
  onWorkflowNameChange,
  onWorkflowDescriptionChange,
  onFolderChange,
}: {
  showName?: boolean
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
      {showName ? (
        <Field label={t({ ko: '이름', en: 'Name' })}>
          <Input value={workflowName} onChange={(event) => onWorkflowNameChange(event.target.value)} />
        </Field>
      ) : null}
      <Field label={t({ ko: '설명', en: 'Description' })}>
        <Textarea value={workflowDescription} rows={3} onChange={(event) => onWorkflowDescriptionChange(event.target.value)} />
      </Field>
      <FieldGroup label={t({ ko: '저장 폴더', en: 'Folder' })}>
        <WorkflowFolderPicker folders={folders} selectedId={folderId} onChange={onFolderChange} />
      </FieldGroup>
    </div>
  )
}
