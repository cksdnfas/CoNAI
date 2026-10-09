import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowLeft, Bug, Ellipsis, LayoutGrid, Loader2, Maximize, PanelRight, Play, Plus, Redo2, Save, Undo2, X } from 'lucide-react'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { TextTabs } from '@/components/common/text-tabs'
import { IconButton } from '@/components/ui/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { WorkflowValidationIssue } from '../module-graph-types'
import { WorkflowValidationIndicator } from './workflow-validation-indicator'

export type WorkflowEditorDockTab = 'node' | 'inputs' | 'runs'

const DOCK_STORAGE_KEY = 'conai:workflow-editor-dock-open'

function readDockOpen() {
  try {
    return window.localStorage.getItem(DOCK_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

function writeDockOpen(open: boolean) {
  try {
    window.localStorage.setItem(DOCK_STORAGE_KEY, open ? 'true' : 'false')
  } catch {
    // Storage blocked: the toggle still works for this visit.
  }
}

interface ModuleWorkflowEditorViewProps {
  isWideLayout: boolean
  workflowName: string
  onWorkflowNameChange: (value: string) => void
  isDirty: boolean
  isSavingGraph: boolean
  isExecuting: boolean
  nodesCount: number
  inputsCount: number
  runsCount: number
  /** A node or edge is selected: the dock jumps to the node tab. */
  selectionKey: string | null
  /** Changes when a node asks to be edited in the panel: the dock opens on the node tab. */
  panelFocusNonce: number | null
  graphCanvas: ReactNode
  nodePanel: ReactNode
  inputsPanel: ReactNode
  runsPanel: ReactNode
  /** Description and save folder, under the ⋯ next to the name. */
  settingsPanel: ReactNode
  workflowSaveModal?: ReactNode
  workflowDebugMode: boolean
  validationIssues: WorkflowValidationIssue[]
  canUndo: boolean
  canRedo: boolean
  onValidationIssueSelect: (issue: WorkflowValidationIssue) => void
  onBack: () => void
  onAddNode: () => void
  onAutoLayout: () => void
  onUndo: () => void
  onRedo: () => void
  onFitView: () => void
  onWorkflowDebugModeToggle: () => void
  onTestRun: () => void
  onSave: () => void
}

/**
 * The node editor fills the screen under the app header (like the ComfyUI workflow editor): one bar (back, name,
 * add node, layout, undo/redo, debug, checks, test run, save), the canvas, and a dock on the right (a bottom sheet on
 * narrow screens) with node / inputs / runs tabs.
 */
export function ModuleWorkflowEditorView({
  isWideLayout,
  workflowName,
  onWorkflowNameChange,
  isDirty,
  isSavingGraph,
  isExecuting,
  nodesCount,
  inputsCount,
  runsCount,
  selectionKey,
  panelFocusNonce,
  graphCanvas,
  nodePanel,
  inputsPanel,
  runsPanel,
  settingsPanel,
  workflowSaveModal,
  workflowDebugMode,
  validationIssues,
  canUndo,
  canRedo,
  onValidationIssueSelect,
  onBack,
  onAddNode,
  onAutoLayout,
  onUndo,
  onRedo,
  onFitView,
  onWorkflowDebugModeToggle,
  onTestRun,
  onSave,
}: ModuleWorkflowEditorViewProps) {
  const { canUpdateWorkflows, canExecuteGeneration } = useFeaturePermissions()
  const { t } = useI18n()
  const [dockTab, setDockTab] = useState<WorkflowEditorDockTab>(selectionKey ? 'node' : 'inputs')
  const [isDockOpen, setIsDockOpen] = useState(() => (isWideLayout ? readDockOpen() : false))

  // Picking a node or edge shows its properties (the node a workflow opens with does not pop the phone sheet open);
  // clearing the selection falls back to the run inputs.
  const initialSelectionKeyRef = useRef(selectionKey)
  useEffect(() => {
    if (!selectionKey) {
      setDockTab((current) => (current === 'node' ? 'inputs' : current))
      return
    }
    if (selectionKey === initialSelectionKeyRef.current) {
      setDockTab('node')
      return
    }
    initialSelectionKeyRef.current = null
    setDockTab('node')
    if (!isWideLayout) setIsDockOpen(true)
  }, [isWideLayout, selectionKey])

  useEffect(() => {
    if (panelFocusNonce === null) return
    setDockTab('node')
    setIsDockOpen(true)
  }, [panelFocusNonce])

  const toggleDock = () => {
    setIsDockOpen((open) => {
      if (isWideLayout) writeDockOpen(!open)
      return !open
    })
  }

  const dockTabs = (
    <TextTabs
      value={dockTab}
      onChange={setDockTab}
      ariaLabel={t({ ko: '편집기 패널', en: 'Editor panel' })}
      items={[
        ...(selectionKey ? [{ value: 'node' as const, label: t({ ko: '노드', en: 'Node' }) }] : []),
        { value: 'inputs', label: t({ ko: '입력', en: 'Inputs' }), count: inputsCount || null },
        { value: 'runs', label: t({ ko: '실행', en: 'Runs' }), count: runsCount || null },
      ]}
      actions={(
        <IconButton size="icon-xs" variant="ghost" onClick={toggleDock} label={t({ ko: '패널 닫기', en: 'Close panel' })}>
          {isWideLayout ? <PanelRight /> : <X />}
        </IconButton>
      )}
      className="px-4 pt-2"
    />
  )
  const dockBody = (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
      {dockTab === 'node' && selectionKey ? nodePanel : dockTab === 'runs' ? runsPanel : inputsPanel}
    </div>
  )

  const separator = <span className="mx-1 h-4 w-px shrink-0 bg-line" aria-hidden />
  const bar = (
    <div className="flex h-11 shrink-0 items-center gap-0.5 border-b border-line px-2">
      <IconButton size="icon-sm" variant="ghost" onClick={onBack} label={t({ ko: '편집 끝내기', en: 'Leave editor' })}>
        <ArrowLeft />
      </IconButton>
      <div className="relative flex min-w-0 items-center gap-1">
        <input
          value={workflowName}
          onChange={(event) => onWorkflowNameChange(event.target.value)}
          aria-label={t({ ko: '워크플로 이름', en: 'Workflow name' })}
          placeholder={t({ ko: '이름 없음', en: 'Untitled' })}
          className="h-8 max-w-72 min-w-0 rounded-sm bg-transparent px-1.5 text-sm font-bold sm:min-w-20 text-foreground outline-none [field-sizing:content] hover:bg-fill focus:bg-field"
        />
        {isDirty ? (
          <Tip content={t({ ko: '저장 안 한 변경 있음', en: 'Unsaved changes' })}>
            <span role="img" aria-label={t({ ko: '저장 안 한 변경 있음', en: 'Unsaved changes' })} className="size-1.5 shrink-0 rounded-full bg-warning" />
          </Tip>
        ) : null}
        <Popover>
          <PopoverTrigger asChild>
            <IconButton size="icon-xs" variant="ghost" label={t({ ko: '설명 · 저장 폴더', en: 'Description · folder' })}>
              <Ellipsis />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-3">
            {settingsPanel}
          </PopoverContent>
        </Popover>
      </div>
      {separator}
      <IconButton size="icon-sm" variant="ghost" onClick={onAddNode} disabled={!canUpdateWorkflows} label={t({ ko: '노드 추가 (더블클릭)', en: 'Add node (double-click)' })}>
        <Plus />
      </IconButton>
      <IconButton size="icon-sm" variant="ghost" onClick={onAutoLayout} disabled={nodesCount === 0} label={t({ ko: '자동 정렬', en: 'Auto layout' })}>
        <LayoutGrid />
      </IconButton>
      <IconButton size="icon-sm" variant="ghost" onClick={onFitView} disabled={nodesCount === 0} label={t({ ko: '화면에 맞추기', en: 'Fit to view' })}>
        <Maximize />
      </IconButton>
      {separator}
      <IconButton size="icon-sm" variant="ghost" onClick={onUndo} disabled={!canUndo} label={t({ ko: '되돌리기 (Ctrl+Z)', en: 'Undo (Ctrl+Z)' })}>
        <Undo2 />
      </IconButton>
      <IconButton size="icon-sm" variant="ghost" onClick={onRedo} disabled={!canRedo} label={t({ ko: '다시 하기 (Ctrl+Shift+Z)', en: 'Redo (Ctrl+Shift+Z)' })}>
        <Redo2 />
      </IconButton>
      <span className={cn('contents', !isWideLayout && 'max-sm:hidden')}>
        {separator}
        <IconButton
          size="icon-sm"
          variant="ghost"
          onClick={onWorkflowDebugModeToggle}
          active={workflowDebugMode}
          label={workflowDebugMode ? t({ ko: '디버그 모드 끄기', en: 'Turn off debug mode' }) : t({ ko: '디버그 모드 켜기', en: 'Turn on debug mode' })}
        >
          <Bug />
        </IconButton>
      </span>
      <WorkflowValidationIndicator issues={validationIssues} onIssueSelect={onValidationIssueSelect} />
      <span className="min-w-2 flex-1" />
      <IconButton size="icon-sm" variant="ghost" onClick={onTestRun} disabled={!canExecuteGeneration || isExecuting || nodesCount === 0} label={t({ ko: '시험 실행', en: 'Test run' })}>
        {isExecuting ? <Loader2 className="animate-spin" /> : <Play />}
      </IconButton>
      {!isDockOpen ? (
        <IconButton size="icon-sm" variant="ghost" onClick={toggleDock} label={t({ ko: '패널 열기', en: 'Open panel' })}>
          <PanelRight />
        </IconButton>
      ) : null}
      <IconButton size="icon-sm" variant="default" onClick={onSave} disabled={!canUpdateWorkflows || isSavingGraph || nodesCount === 0} aria-busy={isSavingGraph || undefined} label={isSavingGraph ? t({ ko: '저장 중', en: 'Saving' }) : t({ ko: '저장 (Ctrl+S)', en: 'Save (Ctrl+S)' })}>
        {isSavingGraph ? <Loader2 className="animate-spin" /> : <Save />}
      </IconButton>
    </div>
  )

  // Ctrl+S saves from anywhere in the editor.
  const onSaveRef = useRef(onSave)
  useEffect(() => {
    onSaveRef.current = onSave
  })
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        onSaveRef.current()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  if (!isWideLayout) {
    // Phone: the editor takes the whole screen under the app header; the dock is a bottom sheet.
    return (
      <div className="fixed inset-x-0 bottom-0 top-(--theme-shell-header-height) z-[45] flex flex-col bg-background">
        {bar}
        <div className="relative min-h-0 flex-1">
          {graphCanvas}
          {isDockOpen ? (
            <div className="absolute inset-x-0 bottom-0 flex max-h-[55%] min-h-[40%] flex-col rounded-t-lg bg-surface-container shadow-elevation-2 pb-[env(safe-area-inset-bottom)]">
              <div className="mx-auto mt-1.5 h-1 w-9 shrink-0 rounded-full bg-foreground/20" aria-hidden />
              {dockTabs}
              {dockBody}
            </div>
          ) : null}
        </div>
        {workflowSaveModal}
      </div>
    )
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 top-(--theme-shell-header-height) z-[45] flex flex-col bg-background lg:right-(--editor-side-inset)"
      style={{ '--editor-side-inset': 'var(--chat-dock-width, 0px)' } as CSSProperties}
    >
      {bar}
      <div className={cn('grid min-h-0 flex-1', isDockOpen ? 'grid-cols-[minmax(0,1fr)_minmax(300px,360px)]' : 'grid-cols-1')}>
        <div className="relative min-h-0 min-w-0">{graphCanvas}</div>
        {isDockOpen ? (
          <aside aria-label={t({ ko: '편집기 패널', en: 'Editor panel' })} className="flex min-h-0 flex-col border-l border-line">
            {dockTabs}
            {dockBody}
          </aside>
        ) : null}
      </div>
      {workflowSaveModal}
    </div>
  )
}
