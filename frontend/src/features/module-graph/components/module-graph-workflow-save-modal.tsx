import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SettingsModal } from '@/features/settings/components/settings-modal'

interface ModuleGraphWorkflowSaveModalProps {
  open: boolean
  workflowName: string
  workflowDescription: string
  selectedGraphName: string | null
  selectedGraphVersion: number | null
  isDirty: boolean
  nodesCount: number
  edgesCount: number
  selectedExecutionId: number | null
  isSavingGraph: boolean
  hasNodes: boolean
  folderPanel?: ReactNode
  onClose: () => void
  onWorkflowNameChange: (value: string) => void
  onWorkflowDescriptionChange: (value: string) => void
  onSave: () => Promise<boolean>
}

/** Render the workflow save modal used from the editor top bar. */
export function ModuleGraphWorkflowSaveModal({
  open,
  workflowName,
  workflowDescription,
  selectedGraphName,
  selectedGraphVersion,
  isDirty,
  nodesCount,
  edgesCount,
  selectedExecutionId,
  isSavingGraph,
  hasNodes,
  folderPanel,
  onClose,
  onWorkflowNameChange,
  onWorkflowDescriptionChange,
  onSave,
}: ModuleGraphWorkflowSaveModalProps) {
  const handleSave = async () => {
    const saved = await onSave()
    if (saved) {
      onClose()
    }
  }

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title={selectedGraphVersion !== null ? '워크플로우 저장' : '워크플로우 등록'}
      description="저장할 이름과 설명, 폴더를 확인해줘."
      widthClassName="max-w-3xl"
      closeOnBack={false}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 rounded-sm border border-border bg-surface-low px-3 py-2 text-sm">
          <span className="font-medium text-foreground">{selectedGraphName || workflowName.trim() || 'Workflow Draft'}</span>
          {selectedGraphVersion !== null ? <Badge variant="outline">v{selectedGraphVersion}</Badge> : <Badge variant="outline">draft</Badge>}
          {isDirty ? <Badge variant="outline">미저장</Badge> : <Badge variant="secondary">저장됨</Badge>}
          <Badge variant="outline">N {nodesCount}</Badge>
          <Badge variant="outline">E {edgesCount}</Badge>
          {selectedExecutionId ? <Badge variant="secondary">실행 #{selectedExecutionId}</Badge> : null}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">워크플로우 이름</span>
            <Input value={workflowName} onChange={(event) => onWorkflowNameChange(event.target.value)} placeholder="Workflow name" />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">설명</span>
            <Input value={workflowDescription} onChange={(event) => onWorkflowDescriptionChange(event.target.value)} placeholder="설명 (선택)" />
          </label>
        </div>

        {folderPanel}

        {!hasNodes ? (
          <div className="rounded-sm border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
            저장하려면 먼저 노드를 하나 이상 배치해줘.
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 border-t border-border/70 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSavingGraph}>
            취소
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={isSavingGraph || !hasNodes}>
            {isSavingGraph ? '저장 중…' : '저장'}
          </Button>
        </div>
      </div>
    </SettingsModal>
  )
}
