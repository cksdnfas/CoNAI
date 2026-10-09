import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { EditorFooter } from '@/components/ui/editor-footer'
import { EmptyState } from '@/components/ui/empty-state'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'
import { useI18n } from '@/i18n'

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

/**
 * Render the workflow save modal used from the editor top bar. Its fields edit the page's own workflow draft, so
 * closing loses nothing and needs no discard check; `isDirty` is the graph's unsaved state, shown in the summary line.
 */
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
  const canSave = hasNodes && !isSavingGraph

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
      size="normal"
      height="medium"
      onSave={canSave ? () => void handleSave() : undefined}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="min-w-0 truncate font-medium text-foreground">{selectedGraphName || workflowName.trim() || t({ ko: '워크플로우 초안', en: 'Workflow Draft' })}</span>
          <Badge variant="outline">{selectedGraphVersion !== null ? `v${selectedGraphVersion}` : t({ ko: '초안', en: 'Draft' })}</Badge>
          {isDirty ? <span className="text-xs text-muted-foreground">{t({ ko: '미저장', en: 'Unsaved' })}</span> : null}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t({ ko: '워크플로우 이름', en: 'Workflow name' })}>
            <Input variant="settings" value={workflowName} onChange={(event) => onWorkflowNameChange(event.target.value)} />
          </Field>
          <Field label={t({ ko: '설명', en: 'Description' })}>
            <Input variant="settings" value={workflowDescription} onChange={(event) => onWorkflowDescriptionChange(event.target.value)} placeholder={t({ ko: '선택', en: 'Optional' })} />
          </Field>
        </div>

        <div className="border-y border-line">
          <SettingsSwitchRow label={t({ ko: '디버그 모드', en: 'Debug mode' })} checked={workflowDebugMode} onCheckedChange={onWorkflowDebugModeChange} />
        </div>

        {folderPanel}

        {!hasNodes ? (
          <EmptyState size="compact" title={t({ ko: '저장하려면 먼저 노드를 하나 이상 배치해줘.', en: 'Place at least one node before saving.' })} />
        ) : null}
      </div>
      <EditorFooter onSave={() => void handleSave()} canSave={canSave} saving={isSavingGraph} />
    </Modal>
  )
}
