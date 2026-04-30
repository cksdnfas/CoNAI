import { Folder, FolderOpen, Plus, Save, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { HierarchyPicker } from '@/components/common/hierarchy-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import type { GraphWorkflowFolderRecord, GraphWorkflowRecord } from '@/lib/api'

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
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-base font-semibold text-foreground">{selectedWorkflow ? t({ ko: '워크플로우', en: 'Workflow' }) : t({ ko: '폴더', en: 'Folder' })}</div>
          </div>
          <Badge variant="outline">{selectedWorkflow ? t({ ko: '워크플로우', en: 'Workflow' }) : isRootSelected ? t({ ko: '루트', en: 'Root' }) : t({ ko: '폴더', en: 'Folder' })}</Badge>
        </div>
      ) : null}

      {selectedWorkflow ? (
        <div className="space-y-4">
          <div className="space-y-1">
            <div className="text-base font-semibold text-foreground">{selectedWorkflow.name}</div>
            {selectedWorkflow.description ? <div className="text-sm text-muted-foreground">{selectedWorkflow.description}</div> : null}
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium text-foreground">{t({ ko: '폴더 위치', en: 'Folder location' })}</div>
            <HierarchyPicker
              items={sortedFolders}
              selectedId={workflowFolderId}
              onSelectRoot={() => setWorkflowFolderId(null)}
              onSelect={(folder) => setWorkflowFolderId(folder.id)}
              getId={(folder) => folder.id}
              getParentId={(folder) => folder.parent_id}
              getLabel={(folder) => folder.name}
              sortItems={(left, right) => compareFolderNames(left.name, right.name, locale)}
              renderIcon={(_, state) => (state.hasChildren ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />)}
              rootLabel={t({ ko: '루트', en: 'Root' })}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void onAssignWorkflowFolder(workflowFolderId)}>
              <Save className="h-4 w-4" />
              {t({ ko: '할당 저장', en: 'Save assignment' })}
            </Button>
            {onEditWorkflow ? (
              <Button type="button" variant="secondary" onClick={onEditWorkflow}>
                {t({ ko: '편집 열기', en: 'Open editor' })}
              </Button>
            ) : null}
            {onDeleteWorkflow ? (
              <Button type="button" variant="destructive" onClick={() => void onDeleteWorkflow()}>
                <Trash2 className="h-4 w-4" />
                {t({ ko: '워크플로우 삭제', en: 'Delete workflow' })}
              </Button>
            ) : null}
          </div>

          <div className="space-y-3 rounded-sm border border-border/70 bg-surface-low/50 p-3">
            <div className="text-sm font-medium text-foreground">{t({ ko: '폴더 생성', en: 'Create folder' })}</div>
            <Input value={childFolderName} onChange={(event) => setChildFolderName(event.target.value)} placeholder={t({ ko: '새 폴더 이름', en: 'New folder name' })} />
            <Textarea rows={3} value={childFolderDescription} onChange={(event) => setChildFolderDescription(event.target.value)} placeholder={t({ ko: '설명 (선택)', en: 'Description (optional)' })} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void handleCreateChildFolder(false)} disabled={!childFolderName.trim()}>
                <Plus className="h-4 w-4" />
                {t({ ko: '폴더 생성', en: 'Create folder' })}
              </Button>
              <Button type="button" onClick={() => void handleCreateChildFolder(true)} disabled={!childFolderName.trim()}>
                <Plus className="h-4 w-4" />
                {t({ ko: '생성 후 할당', en: 'Create and assign' })}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1">
            <div className="text-base font-semibold text-foreground">{currentFolderTitle}</div>
            {isRootSelected ? (
              <div className="text-sm text-muted-foreground">{t({ ko: '기본 위치', en: 'Default location' })}</div>
            ) : selectedFolder?.description ? (
              <div className="text-sm text-muted-foreground">{selectedFolder.description}</div>
            ) : null}
          </div>

          {!isRootSelected ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="text-sm font-medium text-foreground">{t({ ko: '폴더 이름', en: 'Folder name' })}</div>
                <Input value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder={t({ ko: '폴더 이름', en: 'Folder name' })} />
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium text-foreground">{t({ ko: '설명', en: 'Description' })}</div>
                <Textarea rows={3} value={folderDescription} onChange={(event) => setFolderDescription(event.target.value)} placeholder={t({ ko: '설명 (선택)', en: 'Description (optional)' })} />
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium text-foreground">{t({ ko: '부모 폴더', en: 'Parent folder' })}</div>
                <HierarchyPicker
                  items={sortedParentCandidateFolders}
                  selectedId={folderParentId}
                  onSelectRoot={() => setFolderParentId(null)}
                  onSelect={(folder) => setFolderParentId(folder.id)}
                  getId={(folder) => folder.id}
                  getParentId={(folder) => folder.parent_id}
                  getLabel={(folder) => folder.name}
                  sortItems={(left, right) => compareFolderNames(left.name, right.name, locale)}
                  renderIcon={(_, state) => (state.hasChildren ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />)}
                  rootLabel={t({ ko: '루트', en: 'Root' })}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => selectedFolder && void onUpdateFolder(selectedFolder.id, { name: folderName.trim(), description: folderDescription.trim() || null, parent_id: folderParentId })} disabled={!selectedFolder || !folderName.trim()}>
                  <Save className="h-4 w-4" />
                  {t({ ko: '폴더 저장', en: 'Save folder' })}
                </Button>
                <Button type="button" variant="destructive" onClick={() => selectedFolder && void onDeleteFolder(selectedFolder.id)} disabled={!selectedFolder}>
                  <Trash2 className="h-4 w-4" />
                  {t({ ko: '폴더 삭제', en: 'Delete folder' })}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="space-y-3 rounded-sm border border-border/70 bg-surface-low/50 p-3">
            <div className="text-sm font-medium text-foreground">{t({ ko: '폴더 생성', en: 'Create folder' })}</div>
            <Input value={childFolderName} onChange={(event) => setChildFolderName(event.target.value)} placeholder={t({ ko: '새 폴더 이름', en: 'New folder name' })} />
            <Textarea rows={3} value={childFolderDescription} onChange={(event) => setChildFolderDescription(event.target.value)} placeholder={t({ ko: '설명 (선택)', en: 'Description (optional)' })} />
            <Button type="button" onClick={() => void handleCreateChildFolder(false)} disabled={!childFolderName.trim()}>
              <Plus className="h-4 w-4" />
              {t({ ko: '폴더 생성', en: 'Create folder' })}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
