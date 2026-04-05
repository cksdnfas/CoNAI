import { Folder, FolderOpen, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { HierarchyPicker } from '@/components/common/hierarchy-picker'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
  const [workflowFolderId, setWorkflowFolderId] = useState<number | null>(null)
  const [folderName, setFolderName] = useState('')
  const [folderDescription, setFolderDescription] = useState('')
  const [folderParentId, setFolderParentId] = useState<number | null>(null)
  const [childFolderName, setChildFolderName] = useState('')
  const [childFolderDescription, setChildFolderDescription] = useState('')

  useEffect(() => {
    setWorkflowFolderId(selectedWorkflow?.folder_id ?? null)
  }, [selectedWorkflow?.folder_id])

  useEffect(() => {
    if (selectedFolder) {
      setFolderName(selectedFolder.name)
      setFolderDescription(selectedFolder.description ?? '')
      setFolderParentId(selectedFolder.parent_id ?? null)
      return
    }

    setFolderName('Root')
    setFolderDescription('')
    setFolderParentId(null)
  }, [selectedFolder])

  useEffect(() => {
    setChildFolderName('')
    setChildFolderDescription('')
  }, [selectedFolder?.id, selectedWorkflow?.id])

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
    <Card>
      <CardContent className="space-y-4">
        {showHeader ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-foreground">{selectedWorkflow ? 'Workflow Settings' : 'Folder Settings'}</div>
              <div className="text-sm text-muted-foreground">{selectedWorkflow ? '워크플로우 저장 위치와 폴더 할당을 관리해.' : '선택한 폴더를 관리하거나 하위 폴더를 만들어.'}</div>
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
                sortItems={(left, right) => left.name.localeCompare(right.name, 'ko')}
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
              <div className="text-sm font-medium text-foreground">현재 위치에 새 자식 폴더</div>
              <Input value={childFolderName} onChange={(event) => setChildFolderName(event.target.value)} placeholder="새 폴더 이름" />
              <Textarea rows={3} value={childFolderDescription} onChange={(event) => setChildFolderDescription(event.target.value)} placeholder="설명 (선택)" />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => void handleCreateChildFolder(false)} disabled={!childFolderName.trim()}>
                  <Plus className="h-4 w-4" />
                  폴더 만들기
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
                <div className="text-sm text-muted-foreground">루트 폴더는 기본 위치야. 이름 변경이나 삭제는 할 수 없어.</div>
              ) : selectedFolder?.description ? (
                <div className="text-sm text-muted-foreground">{selectedFolder.description}</div>
              ) : (
                <div className="text-sm text-muted-foreground">폴더 설명이 아직 없어.</div>
              )}
            </div>

            {isRootSelected ? (
              <Alert>
                <AlertTitle>Root 폴더</AlertTitle>
                <AlertDescription>폴더에 할당되지 않은 워크플로우는 모두 Root에 속한 것으로 취급해.</AlertDescription>
              </Alert>
            ) : null}

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
                    sortItems={(left, right) => left.name.localeCompare(right.name, 'ko')}
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
              <div className="text-sm font-medium text-foreground">새 자식 폴더</div>
              <Input value={childFolderName} onChange={(event) => setChildFolderName(event.target.value)} placeholder="새 폴더 이름" />
              <Textarea rows={3} value={childFolderDescription} onChange={(event) => setChildFolderDescription(event.target.value)} placeholder="설명 (선택)" />
              <Button type="button" onClick={() => void handleCreateChildFolder(false)} disabled={!childFolderName.trim()}>
                <Plus className="h-4 w-4" />
                자식 폴더 만들기
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
