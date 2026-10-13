import { FolderInput, FolderPlus, PenSquare, Save, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
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
            <Button type="button" onClick={() => void onAssignWorkflowFolder(workflowFolderId)}>
              <Save className="h-4 w-4" />
              {t({ ko: '할당 저장', en: 'Save assignment' })}
            </Button>
            {onEditWorkflow ? (
              <IconButton variant="secondary" onClick={onEditWorkflow} label={t({ ko: '편집 열기', en: 'Open editor' })}>
                <PenSquare className="h-4 w-4" />
              </IconButton>
            ) : null}
            {onDeleteWorkflow ? (
              <IconButton variant="destructive" onClick={() => void onDeleteWorkflow()} label={t({ ko: '워크플로우 삭제', en: 'Delete workflow' })}>
                <Trash2 className="h-4 w-4" />
              </IconButton>
            ) : null}
          </div>

          <Inset className="space-y-3 p-3">
            <Text as="div" variant="label">{t({ ko: '폴더 생성', en: 'Create folder' })}</Text>
            <Input value={childFolderName} onChange={(event) => setChildFolderName(event.target.value)} placeholder={t({ ko: '새 폴더 이름', en: 'New folder name' })} />
            <Textarea rows={3} value={childFolderDescription} onChange={(event) => setChildFolderDescription(event.target.value)} placeholder={t({ ko: '설명 (선택)', en: 'Description (optional)' })} />
            <div className="flex flex-wrap gap-2">
              <IconButton variant="secondary" onClick={() => void handleCreateChildFolder(false)} disabled={!childFolderName.trim()} label={t({ ko: '폴더 생성', en: 'Create folder' })}>
                <FolderPlus className="h-4 w-4" />
              </IconButton>
              <IconButton variant="secondary" onClick={() => void handleCreateChildFolder(true)} disabled={!childFolderName.trim()} label={t({ ko: '폴더 만들고 이 워크플로 할당', en: 'Create folder and assign this workflow' })}>
                <FolderInput className="h-4 w-4" />
              </IconButton>
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
                <Button type="button" onClick={() => selectedFolder && void onUpdateFolder(selectedFolder.id, { name: folderName.trim(), description: folderDescription.trim() || null, parent_id: folderParentId })} disabled={!selectedFolder || !folderName.trim()}>
                  <Save className="h-4 w-4" />
                  {t({ ko: '폴더 저장', en: 'Save folder' })}
                </Button>
                <IconButton variant="destructive" onClick={() => selectedFolder && void onDeleteFolder(selectedFolder.id)} disabled={!selectedFolder} label={t({ ko: '폴더 삭제', en: 'Delete folder' })}>
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              </div>
            </div>
          ) : null}

          <Inset className="space-y-3 p-3">
            <Text as="div" variant="label">{t({ ko: '폴더 생성', en: 'Create folder' })}</Text>
            <Input value={childFolderName} onChange={(event) => setChildFolderName(event.target.value)} placeholder={t({ ko: '새 폴더 이름', en: 'New folder name' })} />
            <Textarea rows={3} value={childFolderDescription} onChange={(event) => setChildFolderDescription(event.target.value)} placeholder={t({ ko: '설명 (선택)', en: 'Description (optional)' })} />
            <IconButton variant="secondary" onClick={() => void handleCreateChildFolder(false)} disabled={!childFolderName.trim()} label={t({ ko: '폴더 생성', en: 'Create folder' })}>
              <FolderPlus className="h-4 w-4" />
            </IconButton>
          </Inset>
        </div>
      )}
    </div>
  )
}
