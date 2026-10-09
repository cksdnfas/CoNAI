import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ChevronDown, Copy, Download, FolderInput, MoreHorizontal, PenSquare, Trash2 } from 'lucide-react'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import { GenerateActionBar, GenerateActionDock } from '@/features/image-generation/components/generate-action-bar'
import { buildGraphWorkflowTargetGroupKey } from '@/features/groups/generation-target-group-store'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import type { GraphWorkflowExposedInput, GraphWorkflowFolderRecord, GraphWorkflowRecord, GraphWorkflowSummaryRecord } from '@/lib/api-module-graph'
import { cn } from '@/lib/utils'
import type { WorkflowValidationIssue } from '../module-graph-types'
import { useWorkflowRunnerChatPage } from '../use-workflow-runner-chat-page'
import { WorkflowInputFields } from './workflow-input-fields'
import { WorkflowListPanel } from './workflow-list-panel'
import { WorkflowValidationIndicator } from './workflow-validation-indicator'

type WorkflowRunnerPanelProps = {
  selectedGraph: GraphWorkflowRecord
  graphs: GraphWorkflowSummaryRecord[]
  folders: GraphWorkflowFolderRecord[]
  inputDefinitions: GraphWorkflowExposedInput[]
  inputValues: Record<string, unknown>
  isExecuting: boolean
  canExecute: boolean
  validationIssues: WorkflowValidationIssue[]
  /** Wide layout: the fields scroll between the fixed header and the docked run bar. */
  splitPaneScroll: boolean
  /** Narrow layout: the run bar is portalled into this fixed bottom slot. */
  stickyBarTargetId?: string
  onInputValueChange: (inputId: string, value: unknown) => void
  onInputValueClear: (inputId: string) => void
  onInputImageChange: (inputId: string, image?: SelectedImageDraft) => Promise<void> | void
  onExecute: () => void
  onBack: () => void
  onSwitchGraph: (graph: GraphWorkflowSummaryRecord) => void
  onEdit: () => void
  onDuplicate: () => void
  onExport: () => void
  onMove: () => void
  onDelete: () => void
  onValidationIssueSelect: (issue: WorkflowValidationIssue) => void
}

/** Left column of the workflows tab once a workflow is picked: header, its exposed inputs and the run bar. */
export function WorkflowRunnerPanel({
  selectedGraph,
  graphs,
  folders,
  inputDefinitions,
  inputValues,
  isExecuting,
  canExecute,
  validationIssues,
  splitPaneScroll,
  stickyBarTargetId,
  onInputValueChange,
  onInputValueClear,
  onInputImageChange,
  onExecute,
  onBack,
  onSwitchGraph,
  onEdit,
  onDuplicate,
  onExport,
  onMove,
  onDelete,
  onValidationIssueSelect,
}: WorkflowRunnerPanelProps) {
  const { canExecuteGeneration, canUpdateWorkflows } = useFeaturePermissions()
  const { t } = useI18n()
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  useWorkflowRunnerChatPage(selectedGraph, inputDefinitions, inputValues, onInputValueChange, !isExecuting)

  const runDisabled = !canExecuteGeneration || !canExecute || isExecuting
  // The slot is rendered by the workspace in the same commit, so look it up after mount.
  const [stickyBarTarget, setStickyBarTarget] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setStickyBarTarget(stickyBarTargetId ? document.getElementById(stickyBarTargetId) : null)
  }, [stickyBarTargetId])
  const runBar = (variant: 'inline' | 'sticky') => (
    <GenerateActionBar
      variant={variant}
      generateLabel={t({ ko: '실행', en: 'Run' })}
      generatingLabel={t({ ko: '실행 요청 중…', en: 'Requesting run…' })}
      onGenerate={onExecute}
      generateDisabled={runDisabled}
      isGenerating={isExecuting}
      leading={validationIssues.length > 0 ? (
        <WorkflowValidationIndicator issues={validationIssues} onIssueSelect={onValidationIssueSelect} size="icon" />
      ) : null}
      targetGroupStorageKey={buildGraphWorkflowTargetGroupKey(selectedGraph.id)}
    />
  )

  return (
    <section className={cn(splitPaneScroll ? 'flex min-h-0 flex-1 flex-col gap-4' : 'space-y-4')}>
      <div className="flex shrink-0 items-center gap-1.5">
        <IconButton variant="ghost" size="icon-sm" onClick={onBack} label={t({ ko: '워크플로 목록으로', en: 'Back to workflows' })}>
          <ArrowLeft />
        </IconButton>
        <Popover open={isPickerOpen} onOpenChange={setIsPickerOpen}>
          <Tip content={selectedGraph.description || t({ ko: '다른 워크플로 고르기', en: 'Pick another workflow' })} className="whitespace-pre-line" align="start">
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="h-auto min-w-0 justify-start gap-1 px-1.5 py-1 text-foreground"
                aria-label={t({ ko: '다른 워크플로 고르기', en: 'Pick another workflow' })}
              >
                <span className="truncate text-base font-semibold tracking-tight text-foreground">{selectedGraph.name}</span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Button>
            </PopoverTrigger>
          </Tip>
          <PopoverContent align="start" className="flex max-h-[min(60vh,480px)] w-[min(360px,calc(100vw-2rem))] flex-col p-2">
            <WorkflowListPanel
              variant="picker"
              graphs={graphs}
              folders={folders}
              selectedFolderId={null}
              selectedGraphId={selectedGraph.id}
              onSelectFolder={() => {}}
              onOpenGraph={(graph) => {
                setIsPickerOpen(false)
                onSwitchGraph(graph)
              }}
              className="min-h-0 flex-1"
            />
          </PopoverContent>
        </Popover>
        <span className="flex-1" />
        <IconButton variant="ghost" size="icon-sm" onClick={onEdit} disabled={!canUpdateWorkflows} label={t({ ko: '노드 편집', en: 'Edit nodes' })}>
          <PenSquare />
        </IconButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton variant="ghost" size="icon-sm" label={t({ ko: '더 보기', en: 'More' })}>
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!canUpdateWorkflows} onSelect={onDuplicate}><Copy />{t({ ko: '복제', en: 'Duplicate' })}</DropdownMenuItem>
            <DropdownMenuItem onSelect={onExport}><Download />{t({ ko: '내보내기', en: 'Export' })}</DropdownMenuItem>
            <DropdownMenuItem disabled={!canUpdateWorkflows} onSelect={onMove}><FolderInput />{t({ ko: '폴더 이동', en: 'Move to folder' })}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={!canUpdateWorkflows} onSelect={onDelete}><Trash2 />{t({ ko: '삭제', en: 'Delete' })}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className={cn(splitPaneScroll && 'min-h-0 flex-1 overflow-y-auto pr-2 pb-1')}>
        {inputDefinitions.length > 0 ? (
          <WorkflowInputFields
            inputDefinitions={inputDefinitions}
            inputValues={inputValues}
            onInputValueChange={onInputValueChange}
            onInputValueClear={onInputValueClear}
            onInputImageChange={onInputImageChange}
          />
        ) : null}
      </div>

      {stickyBarTargetId
        ? (stickyBarTarget ? createPortal(runBar('sticky'), stickyBarTarget) : null)
        : <GenerateActionDock>{runBar('inline')}</GenerateActionDock>}
    </section>
  )
}
