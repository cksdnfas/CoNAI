import { Folder, FolderOpen, Plus } from 'lucide-react'
import { HierarchyPicker } from '@/components/common/hierarchy-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import type { GraphWorkflowFolderRecord } from '@/lib/api-module-graph'

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
    <div className="space-y-3">
      <div className="text-2xs font-semibold tracking-overline text-muted-foreground uppercase">{t({ ko: '저장 폴더', en: 'Save folder' })}</div>

      <HierarchyPicker
        items={folders}
        selectedId={draftWorkflowFolderId}
        onSelectRoot={onSelectRoot}
        onSelect={(folder) => onSelectFolder(folder.id)}
        getId={(folder) => folder.id}
        getParentId={(folder) => folder.parent_id}
        getLabel={(folder) => folder.name}
        sortItems={(left, right) => left.name.localeCompare(right.name, 'ko')}
        renderIcon={(_, state) => (state.hasChildren ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />)}
        rootLabel={t({ ko: '폴더 없음', en: 'No folder' })}
      />

      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <Input value={draftChildFolderName} onChange={(event) => onDraftChildFolderNameChange(event.target.value)} placeholder={t({ ko: '새 폴더 이름', en: 'New folder name' })} />
        <Input value={draftChildFolderDescription} onChange={(event) => onDraftChildFolderDescriptionChange(event.target.value)} placeholder={t({ ko: '설명 (선택)', en: 'Description (optional)' })} />
        <Button type="button" variant="secondary" onClick={onCreateChildFolder} disabled={!draftChildFolderName.trim()}>
          <Plus className="h-4 w-4" />
          {t({ ko: '폴더 생성', en: 'Create folder' })}
        </Button>
      </div>
    </div>
  )
}
