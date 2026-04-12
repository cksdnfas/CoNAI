import { Folder, FolderOpen, Plus } from 'lucide-react'
import { HierarchyPicker } from '@/components/common/hierarchy-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getGraphExecution, type GraphExecutionRecord, type GraphWorkflowExposedInput, type GraphWorkflowFolderRecord, type GraphWorkflowRecord } from '@/lib/api'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import type { EditorSupportSectionKey } from './module-workflow-editor-support-panel'
import { GraphExecutionPanel } from './graph-execution-panel'
import { ModuleWorkflowEditorSupportPanel } from './module-workflow-editor-support-panel'
import { WorkflowRunnerPanel } from './workflow-runner-panel'
import { type WorkflowValidationIssue } from './workflow-validation-panel'

export { ModuleGraphWorkflowListSidebar } from './module-graph-workflow-list-sidebar'
export { ModuleGraphWorkflowBrowseContent, ModuleGraphWorkflowEditorContent } from './module-graph-workflow-content'
export { ModuleGraphWorkspaceModals } from './module-graph-workspace-modals'

type GraphExecutionDetailRecord = Awaited<ReturnType<typeof getGraphExecution>>

/** Render the workflow-folder picker and child-folder creation tools for editor setup. */
export function ModuleGraphWorkflowSetupFolderPanel({
  folders,
  draftWorkflowFolderId,
  draftChildFolderName,
  draftChildFolderDescription,
  onSelectFolder,
  onSelectRoot,
  onDraftChildFolderNameChange,
  onDraftChildFolderDescriptionChange,
  onCreateChildFolder,
}: {
  folders: GraphWorkflowFolderRecord[]
  draftWorkflowFolderId: number | null
  draftChildFolderName: string
  draftChildFolderDescription: string
  onSelectFolder: (folderId: number) => void
  onSelectRoot: () => void
  onDraftChildFolderNameChange: (value: string) => void
  onDraftChildFolderDescriptionChange: (value: string) => void
  onCreateChildFolder: () => void
}) {
  return (
    <div className="space-y-3 rounded-sm border border-border/70 bg-background/40 p-3">
      <div className="text-sm font-medium text-foreground">저장 폴더</div>

      <HierarchyPicker
        items={folders}
        selectedId={draftWorkflowFolderId}
        onSelectRoot={onSelectRoot}
        onSelect={(folder) => onSelectFolder(folder.id)}
        getId={(folder) => folder.id}
        getParentId={(folder) => folder.parent_id}
        getLabel={(folder) => folder.name}
        sortItems={(left, right) => left.name.localeCompare(right.name, 'ko')}
        renderIcon={(_, state) => (state.hasChildren ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />)}
        rootLabel="Root"
      />

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <Input value={draftChildFolderName} onChange={(event) => onDraftChildFolderNameChange(event.target.value)} placeholder="새 자식 폴더 이름" />
        <Input value={draftChildFolderDescription} onChange={(event) => onDraftChildFolderDescriptionChange(event.target.value)} placeholder="설명 (선택)" />
        <Button type="button" variant="outline" onClick={onCreateChildFolder} disabled={!draftChildFolderName.trim()}>
          <Plus className="h-4 w-4" />
          폴더 생성
        </Button>
      </div>
    </div>
  )
}

/** Render the browse-mode runner side panel when one workflow is selected. */
export function ModuleGraphWorkflowBrowseSidePanel({
  selectedGraphRecord,
  inputDefinitions,
  workflowRunInputValues,
  isExecuting,
  latestExecution,
  latestExecutionDetail,
  selectedWorkflowCanExecute,
  selectedWorkflowValidationIssues,
  onInputValueChange,
  onInputValueClear,
  onInputImageChange,
  onExecute,
  onEdit,
  onDeleteWorkflow,
  onOpenFolderSettings,
  onValidationIssueSelect,
}: {
  selectedGraphRecord: GraphWorkflowRecord | null
  inputDefinitions: GraphWorkflowExposedInput[]
  workflowRunInputValues: Record<string, unknown>
  isExecuting: boolean
  latestExecution: GraphExecutionRecord | null
  latestExecutionDetail: GraphExecutionDetailRecord | null
  selectedWorkflowCanExecute: boolean
  selectedWorkflowValidationIssues: WorkflowValidationIssue[]
  onInputValueChange: (inputId: string, value: unknown) => void
  onInputValueClear: (inputId: string) => void
  onInputImageChange: (inputId: string, image?: SelectedImageDraft) => void
  onExecute: () => void
  onEdit: () => void
  onDeleteWorkflow: () => void
  onOpenFolderSettings: () => void
  onValidationIssueSelect: (issue: WorkflowValidationIssue) => void
}) {
  if (!selectedGraphRecord) {
    return null
  }

  return (
    <WorkflowRunnerPanel
      showHeader={false}
      selectedGraph={selectedGraphRecord}
      inputDefinitions={inputDefinitions}
      inputValues={workflowRunInputValues}
      isExecuting={isExecuting}
      latestExecution={latestExecution}
      latestExecutionArtifacts={latestExecutionDetail?.artifacts}
      latestExecutionFinalResults={latestExecutionDetail?.final_results}
      onInputValueChange={onInputValueChange}
      onInputValueClear={onInputValueClear}
      onInputImageChange={onInputImageChange}
      onExecute={onExecute}
      onEdit={onEdit}
      onDeleteWorkflow={onDeleteWorkflow}
      onOpenFolderSettings={onOpenFolderSettings}
      canExecute={selectedWorkflowCanExecute}
      validationIssues={selectedWorkflowValidationIssues}
      onValidationIssueSelect={onValidationIssueSelect}
    />
  )
}

/** Render the execution-results-only support content for the workflow editor drawer. */
export function ModuleGraphWorkflowEditorSupportPanels({
  selectedGraphId,
  selectedGraphRecord,
  selectedExecutionId,
  executingGraphId,
  cancellingExecutionId,
  executionList,
  executionListError,
  executionListIsError,
  executionDetail,
  executionDetailError,
  executionDetailIsError,
  selectedExecutionStatus,
  setSectionRef,
  onSelectExecution,
  onRerunGraph,
  onRetryExecution,
  onCancelExecution,
}: {
  selectedGraphId: number | null
  selectedGraphRecord: GraphWorkflowRecord | null
  selectedExecutionId: number | null
  executingGraphId: number | null
  cancellingExecutionId: number | null
  executionList: GraphExecutionRecord[]
  executionListError: string
  executionListIsError: boolean
  executionDetail?: GraphExecutionDetailRecord
  executionDetailError: string
  executionDetailIsError: boolean
  selectedExecutionStatus: GraphExecutionRecord['status'] | null
  setSectionRef: (section: EditorSupportSectionKey, node: HTMLDivElement | null) => void
  onSelectExecution: (executionId: number) => void
  onRerunGraph: () => void
  onRetryExecution: () => void
  onCancelExecution: () => void
}) {
  return (
    <ModuleWorkflowEditorSupportPanel
      setSectionRef={setSectionRef}
      resultsPanel={
        <GraphExecutionPanel
          selectedGraphId={selectedGraphId}
          selectedGraph={selectedGraphRecord}
          selectedExecutionId={selectedExecutionId}
          selectedExecutionStatus={selectedExecutionStatus}
          executionList={executionList}
          executionListError={executionListError}
          executionListIsError={executionListIsError}
          executionDetail={executionDetail}
          executionDetailError={executionDetailError}
          executionDetailIsError={executionDetailIsError}
          isExecutingGraph={executingGraphId !== null}
          isCancellingExecution={cancellingExecutionId === selectedExecutionId}
          onSelectExecution={onSelectExecution}
          onRerunGraph={onRerunGraph}
          onRetryExecution={onRetryExecution}
          onCancelExecution={onCancelExecution}
          showHeader={false}
        />
      }
    />
  )
}
