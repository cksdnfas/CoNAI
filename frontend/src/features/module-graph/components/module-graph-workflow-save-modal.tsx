import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Inset } from '@/components/ui/inset'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { ToggleRow } from '@/components/ui/toggle-row'
import { useI18n } from '@/i18n'
import { EmptyState } from '@/components/ui/empty-state'

interface ModuleGraphWorkflowSaveModalProps {
  open: boolean
  workflowName: string
  workflowDescription: string
  workflowDebugMode: boolean
  selectedGraphName: string | null
  selectedGraphVersion: number | null
  isDirty: boolean
  isSavingGraph: boolean
  hasNodes: boolean
  folderPanel?: ReactNode
  onClose: () => void
  onWorkflowNameChange: (value: string) => void
  onWorkflowDescriptionChange: (value: string) => void
  onWorkflowDebugModeChange: (value: boolean) => void
  onSave: () => Promise<boolean>
}

/** Render the workflow save modal used from the editor top bar. */
export function ModuleGraphWorkflowSaveModal({
  open,
  workflowName,
  workflowDescription,
  workflowDebugMode,
  selectedGraphName,
  selectedGraphVersion,
  isDirty,
  isSavingGraph,
  hasNodes,
  folderPanel,
  onClose,
  onWorkflowNameChange,
  onWorkflowDescriptionChange,
  onWorkflowDebugModeChange,
  onSave,
}: ModuleGraphWorkflowSaveModalProps) {
  const { t } = useI18n()

  const handleSave = async () => {
    const saved = await onSave()
    if (saved) {
      onClose()
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={selectedGraphVersion !== null ? t({ ko: '워크플로우 저장', en: 'Save workflow' }) : t({ ko: '워크플로우 등록', en: 'Register workflow' })}
      widthClassName="max-w-3xl"
    >
      <div className="space-y-5">
        <Inset className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
          <span className="font-medium text-foreground">{selectedGraphName || workflowName.trim() || t({ ko: '워크플로우 초안', en: 'Workflow Draft' })}</span>
          {selectedGraphVersion !== null ? <Badge variant="outline">v{selectedGraphVersion}</Badge> : <Badge variant="outline">{t({ ko: '초안', en: 'Draft' })}</Badge>}
          {isDirty ? <Badge variant="outline">{t({ ko: '미저장', en: 'Unsaved' })}</Badge> : null}
        </Inset>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">{t({ ko: '워크플로우 이름', en: 'Workflow name' })}</span>
            <Input value={workflowName} onChange={(event) => onWorkflowNameChange(event.target.value)} placeholder={t({ ko: '워크플로우 이름', en: 'Workflow name' })} />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">{t({ ko: '설명', en: 'Description' })}</span>
            <Input value={workflowDescription} onChange={(event) => onWorkflowDescriptionChange(event.target.value)} placeholder={t({ ko: '설명 (선택)', en: 'Description (optional)' })} />
          </label>
        </div>

        <ToggleRow variant="detail" className="cursor-pointer">
          <Checkbox
            checked={workflowDebugMode}
            onCheckedChange={(checked) => onWorkflowDebugModeChange(checked === true)}
          />
          <span className="font-medium text-foreground">{t({ ko: '디버그 모드', en: 'Debug mode' })}</span>
        </ToggleRow>

        {folderPanel}

        {!hasNodes ? (
          <EmptyState size="compact" title={t({ ko: '저장하려면 먼저 노드를 하나 이상 배치해줘.', en: 'Place at least one node before saving.' })} />
        ) : null}

        <ModalFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSavingGraph}>
            {t({ ko: '취소', en: 'Cancel' })}
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={isSavingGraph || !hasNodes}>
            {isSavingGraph ? t({ ko: '저장 중…', en: 'Saving…' }) : t({ ko: '저장', en: 'Save' })}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  )
}
