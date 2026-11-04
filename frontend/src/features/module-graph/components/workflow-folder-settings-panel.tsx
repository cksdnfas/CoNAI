import { PenSquare } from 'lucide-react'
import { useMemo, useState } from 'react'
import { IconButton } from '@/components/ui/icon-button'
import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { Inset } from '@/components/ui/inset'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import type { GraphWorkflowFolderRecord, GraphWorkflowRecord } from '@/lib/api-module-graph'
import { WorkflowFolderPicker } from './workflow-folder-picker'

type WorkflowFolderSettingsPanelProps = {
  folders: GraphWorkflowFolderRecord[]
  selectedFolder: GraphWorkflowFolderRecord | null
  selectedWorkflow: GraphWorkflowRecord | null
  showHeader?: boolean
  onAssignWorkflowFolder: (folderId: number | null) => Promise<void> | void
  onCreateFolder: (input: { name: string; description?: string; parent_id?: number | null; assignToWorkflow?: boolean }) => Promise<void> | void
  onUpdateFolder: (folderId: number, input: { name?: string; description?: string | null; parent_id?: number | null }) => Promise<void> | void
  onDeleteFolder: (folderId: number) => Promise<void> | void
  onEditWorkflow?: () => void
  onDeleteWorkflow?: () => Promise<void> | void
}

function compareFolderNames(left: string, right: string, locale: string) {
  return left.localeCompare(right, locale, { numeric: true, sensitivity: 'base' })
}

function collectDescendantFolderIds(folders: GraphWorkflowFolderRecord[], folderId: number) {
  const descendants = new Set<number>()
  const queue = [folderId]

  while (queue.length > 0) {
    const currentId = queue.shift()!
    for (const folder of folders) {
      if (folder.parent_id !== currentId || descendants.has(folder.id)) {
        continue
      }
      descendants.add(folder.id)
      queue.push(folder.id)
    }
  }

  return descendants
}

/** Render folder assignment/settings UI for workflow browsing and organization. */
export function WorkflowFolderSettingsPanel({
  folders,
  selectedFolder,
  selectedWorkflow,
  showHeader = true,
  onAssignWorkflowFolder,
  onCreateFolder,
  onUpdateFolder,
  onDeleteFolder,
  onEditWorkflow,
  onDeleteWorkflow,
}: WorkflowFolderSettingsPanelProps) {
  const { locale, t } = useI18n()
  const [workflowFolderId, setWorkflowFolderId] = useState<number | null>(() => selectedWorkflow?.folder_id ?? null)
  const [folderName, setFolderName] = useState(() => selectedFolder?.name ?? t({ ko: '루트', en: 'Root' }))
  const [folderDescription, setFolderDescription] = useState(() => selectedFolder?.description ?? '')
  const [folderParentId, setFolderParentId] = useState<number | null>(() => selectedFolder?.parent_id ?? null)
  const [childFolderName, setChildFolderName] = useState('')
  const [childFolderDescription, setChildFolderDescription] = useState('')

  const selectedFolderDescendantIds = useMemo(
    () => (selectedFolder ? collectDescendantFolderIds(folders, selectedFolder.id) : new Set<number>()),
    [folders, selectedFolder],
  )

  const parentCandidateFolders = useMemo(
    () => folders.filter((folder) => !selectedFolder || (folder.id !== selectedFolder.id && !selectedFolderDescendantIds.has(folder.id))),
    [folders, selectedFolder, selectedFolderDescendantIds],
  )

  const sortedFolders = useMemo(
    () => [...folders].sort((left, right) => compareFolderNames(left.name, right.name, locale)),
    [folders, locale],
  )

  const sortedParentCandidateFolders = useMemo(
    () => [...parentCandidateFolders].sort((left, right) => compareFolderNames(left.name, right.name, locale)),
    [locale, parentCandidateFolders],
  )

  const currentFolderTitle = selectedFolder?.name ?? t({ ko: '루트', en: 'Root' })
  const isRootSelected = selectedFolder == null

  const handleCreateChildFolder = async (assignToWorkflow = false) => {
    const nextName = childFolderName.trim()
    if (!nextName) {
      return
    }

    await onCreateFolder({
      name: nextName,
      description: childFolderDescription.trim() || undefined,
      parent_id: selectedFolder?.id ?? null,
      assignToWorkflow,
    })
    setChildFolderName('')
    setChildFolderDescription('')
  }

  return (
    <div className="space-y-4">
      {showHeader ? (
        <Heading level={3}>{selectedWorkflow ? t({ ko: '워크플로우', en: 'Workflow' }) : t({ ko: '폴더', en: 'Folder' })}</Heading>
      ) : null}

      {selectedWorkflow ? (
        <div className="space-y-4">
          <div className="space-y-1">
            <Heading level={3}>{selectedWorkflow.name}</Heading>
            {selectedWorkflow.description ? <div className="text-sm text-muted-foreground">{selectedWorkflow.description}</div> : null}
          </div>

          <div className="space-y-2">
            <Text as="div" variant="label">{t({ ko: '폴더 위치', en: 'Folder location' })}</Text>
            <WorkflowFolderPicker
              folders={sortedFolders}
              selectedId={workflowFolderId}
              onChange={setWorkflowFolderId}
              sortItems={(left, right) => compareFolderNames(left.name, right.name, locale)}
              rootLabel={t({ ko: '루트', en: 'Root' })}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onDeleteWorkflow ? (
              <Button size="sm" variant="destructive-ghost" onClick={() => void onDeleteWorkflow()}>{t({ ko: '삭제', en: 'Delete' })}</Button>
            ) : null}
            {onEditWorkflow ? (
              <IconButton variant="secondary" onClick={onEditWorkflow} label={t({ ko: '편집 열기', en: 'Open editor' })}>
                <PenSquare className="h-4 w-4" />
              </IconButton>
            ) : null}
            <span className="flex-1" />
            <Button type="button" size="xs" variant="default" onClick={() => void onAssignWorkflowFolder(workflowFolderId)}>{t({ ko: '저장', en: 'Save' })}</Button>
          </div>

          <Inset padding="sm" className="space-y-3">
            <Text as="div" variant="label">{t({ ko: '폴더 생성', en: 'Create folder' })}</Text>
            <Input value={childFolderName} onChange={(event) => setChildFolderName(event.target.value)} placeholder={t({ ko: '새 폴더 이름', en: 'New folder name' })} />
            <Textarea rows={3} value={childFolderDescription} onChange={(event) => setChildFolderDescription(event.target.value)} placeholder={t({ ko: '설명 (선택)', en: 'Description (optional)' })} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => void handleCreateChildFolder(true)} disabled={!childFolderName.trim()}>{t({ ko: '만들고 할당', en: 'Create and assign' })}</Button>
              <Button size="sm" variant="default" onClick={() => void handleCreateChildFolder(false)} disabled={!childFolderName.trim()}>{t({ ko: '만들기', en: 'Create' })}</Button>
            </div>
          </Inset>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1">
            <Heading level={3}>{currentFolderTitle}</Heading>
            {!isRootSelected && selectedFolder?.description ? (
              <div className="text-sm text-muted-foreground">{selectedFolder.description}</div>
            ) : null}
          </div>

          {!isRootSelected ? (
            <div className="space-y-3">
              <Input value={folderName} onChange={(event) => setFolderName(event.target.value)} aria-label={t({ ko: '폴더 이름', en: 'Folder name' })} placeholder={t({ ko: '폴더 이름', en: 'Folder name' })} />
              <Textarea rows={3} value={folderDescription} onChange={(event) => setFolderDescription(event.target.value)} aria-label={t({ ko: '설명', en: 'Description' })} placeholder={t({ ko: '설명 (선택)', en: 'Description (optional)' })} />

              <div className="space-y-2">
                <Text as="div" variant="label">{t({ ko: '부모 폴더', en: 'Parent folder' })}</Text>
                <WorkflowFolderPicker
                  folders={sortedParentCandidateFolders}
                  selectedId={folderParentId}
                  onChange={setFolderParentId}
                  sortItems={(left, right) => compareFolderNames(left.name, right.name, locale)}
                  rootLabel={t({ ko: '루트', en: 'Root' })}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="destructive-ghost" onClick={() => selectedFolder && void onDeleteFolder(selectedFolder.id)} disabled={!selectedFolder}>{t({ ko: '삭제', en: 'Delete' })}</Button>
                <span className="flex-1" />
                <Button type="button" size="xs" variant="default" onClick={() => selectedFolder && void onUpdateFolder(selectedFolder.id, { name: folderName.trim(), description: folderDescription.trim() || null, parent_id: folderParentId })} disabled={!selectedFolder || !folderName.trim()}>{t({ ko: '저장', en: 'Save' })}</Button>
              </div>
            </div>
          ) : null}

          <Inset padding="sm" className="space-y-3">
            <Text as="div" variant="label">{t({ ko: '폴더 생성', en: 'Create folder' })}</Text>
            <Input value={childFolderName} onChange={(event) => setChildFolderName(event.target.value)} placeholder={t({ ko: '새 폴더 이름', en: 'New folder name' })} />
            <Textarea rows={3} value={childFolderDescription} onChange={(event) => setChildFolderDescription(event.target.value)} placeholder={t({ ko: '설명 (선택)', en: 'Description (optional)' })} />
            <Button size="sm" variant="default" onClick={() => void handleCreateChildFolder(false)} disabled={!childFolderName.trim()}>{t({ ko: '만들기', en: 'Create' })}</Button>
          </Inset>
        </div>
      )}
    </div>
  )
}
