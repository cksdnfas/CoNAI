import { Folder, FolderOpen, Plus, Save, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { HierarchyPicker } from '@/components/common/hierarchy-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
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

function compareFolderNames(left: string, right: string) {
  return left.localeCompare(right, 'ko-KR', { numeric: true, sensitivity: 'base' })
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
  const [workflowFolderId, setWorkflowFolderId] = useState<number | null>(() => selectedWorkflow?.folder_id ?? null)
  const [folderName, setFolderName] = useState(() => selectedFolder?.name ?? 'Root')
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

  const currentFolderTitle = selectedFolder?.name ?? 'Root'
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
            <div className="text-base font-semibold text-foreground">{selectedWorkflow ? 'Workflow' : 'Folder'}</div>
          </div>
          <Badge variant="outline">{selectedWorkflow ? 'workflow' : isRootSelected ? 'root' : 'folder'}</Badge>
        </div>
      ) : null}

      {selectedWorkflow ? (
        <div className="space-y-4">
          <div className="space-y-1">
            <div className="text-base font-semibold text-foreground">{selectedWorkflow.name}</div>
            {selectedWorkflow.description ? <div className="text-sm text-muted-foreground">{selectedWorkflow.description}</div> : null}
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium text-foreground">폴더 위치</div>
            <HierarchyPicker
              items={folders}
              selectedId={workflowFolderId}
              onSelectRoot={() => setWorkflowFolderId(null)}
              onSelect={(folder) => setWorkflowFolderId(folder.id)}
              getId={(folder) => folder.id}
              getParentId={(folder) => folder.parent_id}
              getLabel={(folder) => folder.name}
              sortItems={(left, right) => compareFolderNames(left.name, right.name)}
              renderIcon={(_, state) => (state.hasChildren ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />)}
              rootLabel="Root"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void onAssignWorkflowFolder(workflowFolderId)}>
              <Save className="h-4 w-4" />
              할당 저장
            </Button>
            {onEditWorkflow ? (
              <Button type="button" variant="secondary" onClick={onEditWorkflow}>
                편집 열기
              </Button>
            ) : null}
            {onDeleteWorkflow ? (
              <Button type="button" variant="destructive" onClick={() => void onDeleteWorkflow()}>
                <Trash2 className="h-4 w-4" />
                워크플로우 삭제
              </Button>
            ) : null}
          </div>

          <div className="space-y-3 rounded-sm border border-border/70 bg-surface-low/50 p-3">
            <div className="text-sm font-medium text-foreground">폴더 생성</div>
            <Input value={childFolderName} onChange={(event) => setChildFolderName(event.target.value)} placeholder="새 폴더 이름" />
            <Textarea rows={3} value={childFolderDescription} onChange={(event) => setChildFolderDescription(event.target.value)} placeholder="설명 (선택)" />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void handleCreateChildFolder(false)} disabled={!childFolderName.trim()}>
                <Plus className="h-4 w-4" />
                폴더 생성
              </Button>
              <Button type="button" onClick={() => void handleCreateChildFolder(true)} disabled={!childFolderName.trim()}>
                <Plus className="h-4 w-4" />
                생성 후 할당
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1">
            <div className="text-base font-semibold text-foreground">{currentFolderTitle}</div>
            {isRootSelected ? (
              <div className="text-sm text-muted-foreground">기본 위치</div>
            ) : selectedFolder?.description ? (
              <div className="text-sm text-muted-foreground">{selectedFolder.description}</div>
            ) : null}
          </div>

          {!isRootSelected ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="text-sm font-medium text-foreground">폴더 이름</div>
                <Input value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder="폴더 이름" />
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium text-foreground">설명</div>
                <Textarea rows={3} value={folderDescription} onChange={(event) => setFolderDescription(event.target.value)} placeholder="설명 (선택)" />
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium text-foreground">부모 폴더</div>
                <HierarchyPicker
                  items={parentCandidateFolders}
                  selectedId={folderParentId}
                  onSelectRoot={() => setFolderParentId(null)}
                  onSelect={(folder) => setFolderParentId(folder.id)}
                  getId={(folder) => folder.id}
                  getParentId={(folder) => folder.parent_id}
                  getLabel={(folder) => folder.name}
                  sortItems={(left, right) => compareFolderNames(left.name, right.name)}
                  renderIcon={(_, state) => (state.hasChildren ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />)}
                  rootLabel="Root"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => selectedFolder && void onUpdateFolder(selectedFolder.id, { name: folderName.trim(), description: folderDescription.trim() || null, parent_id: folderParentId })} disabled={!selectedFolder || !folderName.trim()}>
                  <Save className="h-4 w-4" />
                  폴더 저장
                </Button>
                <Button type="button" variant="destructive" onClick={() => selectedFolder && void onDeleteFolder(selectedFolder.id)} disabled={!selectedFolder}>
                  <Trash2 className="h-4 w-4" />
                  폴더 삭제
                </Button>
              </div>
            </div>
          ) : null}

          <div className="space-y-3 rounded-sm border border-border/70 bg-surface-low/50 p-3">
            <div className="text-sm font-medium text-foreground">폴더 생성</div>
            <Input value={childFolderName} onChange={(event) => setChildFolderName(event.target.value)} placeholder="새 폴더 이름" />
            <Textarea rows={3} value={childFolderDescription} onChange={(event) => setChildFolderDescription(event.target.value)} placeholder="설명 (선택)" />
            <Button type="button" onClick={() => void handleCreateChildFolder(false)} disabled={!childFolderName.trim()}>
              <Plus className="h-4 w-4" />
              폴더 생성
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
