import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FieldGroup } from '@/components/ui/field'
import { useI18n } from '@/i18n'
import type { GraphWorkflowFolderRecord } from '@/lib/api-module-graph'
import { WorkflowFolderPicker } from './workflow-folder-picker'

/** The save modal's folder picker, with a row to create a child folder in place. */
export function ModuleGraphWorkflowSetupFolderPanel({
  folders,
  draftWorkflowFolderId,
  draftChildFolderName,
  draftChildFolderDescription,
  onSelectFolder,
  onSelectRoot,
  onDraftChildFolderNameChange,
  onDraftChildFolderDescriptionChange,
  onCreateChildFolder,
}: {
  folders: GraphWorkflowFolderRecord[]
  draftWorkflowFolderId: number | null
  draftChildFolderName: string
  draftChildFolderDescription: string
  onSelectFolder: (folderId: number) => void
  onSelectRoot: () => void
  onDraftChildFolderNameChange: (value: string) => void
  onDraftChildFolderDescriptionChange: (value: string) => void
  onCreateChildFolder: () => void
}) {
  const { t } = useI18n()

  return (
    <FieldGroup label={t({ ko: '저장 폴더', en: 'Save folder' })}>

      <WorkflowFolderPicker
        folders={folders}
        selectedId={draftWorkflowFolderId}
        onChange={(folderId) => (folderId === null ? onSelectRoot() : onSelectFolder(folderId))}
      />

      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <Input value={draftChildFolderName} onChange={(event) => onDraftChildFolderNameChange(event.target.value)} placeholder={t({ ko: '새 폴더 이름', en: 'New folder name' })} />
        <Input value={draftChildFolderDescription} onChange={(event) => onDraftChildFolderDescriptionChange(event.target.value)} placeholder={t({ ko: '설명 (선택)', en: 'Description (optional)' })} />
        <Button type="button" variant="secondary" onClick={onCreateChildFolder} disabled={!draftChildFolderName.trim()}>
          <Plus className="h-4 w-4" />
          {t({ ko: '폴더 생성', en: 'Create folder' })}
        </Button>
      </div>
    </FieldGroup>
  )
}
