import type { ReactNode } from 'react'
import { Folder, FolderOpen, Plus } from 'lucide-react'
import { HierarchyPicker } from '@/components/common/hierarchy-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getGraphExecution, type GraphExecutionRecord, type GraphWorkflowExposedInput, type GraphWorkflowFolderRecord, type GraphWorkflowRecord } from '@/lib/api'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import type { ModuleGraphEdge, ModuleGraphNode } from '../module-graph-shared'
import { GraphExecutionPanel } from './graph-execution-panel'
import { ModuleWorkflowEditorSupportPanel, type EditorSupportSectionKey } from './module-workflow-editor-support-panel'
import { NodeInspectorPanel } from './node-inspector-panel'
import { WorkflowExposedInputEditor } from './workflow-exposed-input-editor'
import { WorkflowRunnerPanel } from './workflow-runner-panel'
import { WorkflowValidationPanel, type WorkflowValidationIssue } from './workflow-validation-panel'

export { ModuleGraphWorkflowListSidebar } from './module-graph-workflow-list-sidebar'
export { ModuleGraphWorkflowBrowseContent, ModuleGraphWorkflowEditorContent } from './module-graph-workflow-content'
export { ModuleGraphWorkspaceModals } from './module-graph-workspace-modals'

type GraphExecutionDetailRecord = Awaited<ReturnType<typeof getGraphExecution>>

/** Render the editor-support section tabs used by the workflow editor drawer. */
export function ModuleGraphEditorSupportSubtitle({
  activeSection,
  onSelectSection,
}: {
  activeSection: EditorSupportSectionKey
  onSelectSection: (section: EditorSupportSectionKey) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {([
        ['setup', '설정'],
        ['inspector', '검사'],
        ['inputs', '입력'],
        ['validation', '검증'],
        ['results', '결과'],
      ] as const).map(([sectionKey, label]) => (
        <Button
          key={sectionKey}
          type="button"
          size="sm"
          variant={activeSection === sectionKey ? 'default' : 'outline'}
          onClick={() => onSelectSection(sectionKey)}
        >
          {label}
        </Button>
      ))}
    </div>
  )
}

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
      inputDefinitions={selectedGraphRecord.graph.metadata?.exposed_inputs ?? []}
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

/** Render the full editor-support drawer content for setup, inspector, inputs, validation, and results. */
export function ModuleGraphWorkflowEditorSupportPanels({
  nodes,
  edges,
  selectedGraphId,
  selectedGraphRecord,
  workflowName,
  workflowDescription,
  isDirty,
  selectedNode,
  selectedEdge,
  selectedExecutionId,
  isSavingGraph,
  executingGraphId,
  cancellingExecutionId,
  workflowInputCandidates,
  workflowExposedInputs,
  editorValidationIssues,
  executionList,
  executionListError,
  executionListIsError,
  executionDetail,
  executionDetailError,
  executionDetailIsError,
  selectedExecutionStatus,
  highlightedPortKey,
  folderPanel,
  onWorkflowNameChange,
  onWorkflowDescriptionChange,
  onSaveGraph,
  setSectionRef,
  onNodeValueChange,
  onNodeValueClear,
  onNodeImageChange,
  onExecuteSelectedNode,
  onForceExecuteSelectedNode,
  onToggleInput,
  onUpdateInput,
  onMoveInput,
  onChangeDefaultImage,
  onValidationIssueSelect,
  onSelectExecution,
  onRerunGraph,
  onRetryExecution,
  onCancelExecution,
}: {
  nodes: ModuleGraphNode[]
  edges: ModuleGraphEdge[]
  selectedGraphId: number | null
  selectedGraphRecord: GraphWorkflowRecord | null
  workflowName: string
  workflowDescription: string
  isDirty: boolean
  selectedNode: ModuleGraphNode | null
  selectedEdge: ModuleGraphEdge | null
  selectedExecutionId: number | null
  isSavingGraph: boolean
  executingGraphId: number | null
  cancellingExecutionId: number | null
  workflowInputCandidates: GraphWorkflowExposedInput[]
  workflowExposedInputs: GraphWorkflowExposedInput[]
  editorValidationIssues: WorkflowValidationIssue[]
  executionList: GraphExecutionRecord[]
  executionListError: string
  executionListIsError: boolean
  executionDetail?: GraphExecutionDetailRecord
  executionDetailError: string
  executionDetailIsError: boolean
  selectedExecutionStatus: GraphExecutionRecord['status'] | null
  highlightedPortKey: string | null
  folderPanel: ReactNode
  onWorkflowNameChange: (value: string) => void
  onWorkflowDescriptionChange: (value: string) => void
  onSaveGraph: () => void
  setSectionRef: (section: EditorSupportSectionKey, node: HTMLDivElement | null) => void
  onNodeValueChange: (nodeId: string, portKey: string, value: unknown) => void
  onNodeValueClear: (nodeId: string, portKey: string) => void
  onNodeImageChange: (nodeId: string, portKey: string, image?: SelectedImageDraft) => void
  onExecuteSelectedNode: () => void
  onForceExecuteSelectedNode: () => void
  onToggleInput: (inputDefinition: GraphWorkflowExposedInput) => void
  onUpdateInput: (inputId: string, patch: Partial<GraphWorkflowExposedInput>) => void
  onMoveInput: (inputId: string, direction: 'up' | 'down') => void
  onChangeDefaultImage: (inputId: string, image?: SelectedImageDraft) => void
  onValidationIssueSelect: (issue: WorkflowValidationIssue) => void
  onSelectExecution: (executionId: number) => void
  onRerunGraph: () => void
  onRetryExecution: () => void
  onCancelExecution: () => void
}) {
  return (
    <ModuleWorkflowEditorSupportPanel
      nodesCount={nodes.length}
      edgesCount={edges.length}
      selectedGraphName={selectedGraphRecord?.name ?? null}
      selectedGraphVersion={selectedGraphRecord?.version ?? null}
      workflowName={workflowName}
      workflowDescription={workflowDescription}
      isDirty={isDirty}
      selectedNodeLabel={selectedNode?.data.module.name ?? null}
      selectedExecutionId={selectedExecutionId}
      isSavingGraph={isSavingGraph}
      hasNodes={nodes.length > 0}
      onWorkflowNameChange={onWorkflowNameChange}
      onWorkflowDescriptionChange={onWorkflowDescriptionChange}
      onSaveGraph={onSaveGraph}
      setSectionRef={setSectionRef}
      folderPanel={folderPanel}
      inspectorPanel={
        <NodeInspectorPanel
          nodes={nodes}
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          selectedExecutionId={selectedExecutionId}
          selectedExecutionArtifacts={executionDetail?.artifacts}
          onNodeValueChange={onNodeValueChange}
          onNodeValueClear={onNodeValueClear}
          onNodeImageChange={onNodeImageChange}
          onExecuteSelectedNode={onExecuteSelectedNode}
          onForceExecuteSelectedNode={onForceExecuteSelectedNode}
          executeSelectedNodeDisabled={!selectedNode || executingGraphId !== null}
          executeSelectedNodeLabel={executingGraphId !== null ? '실행 요청 중…' : '선택 노드 실행'}
          forceExecuteSelectedNodeLabel={executingGraphId !== null ? '실행 요청 중…' : '강제 재실행'}
          highlightedPortKey={highlightedPortKey}
        />
      }
      inputsPanel={
        <WorkflowExposedInputEditor
          candidates={workflowInputCandidates}
          selectedInputs={workflowExposedInputs}
          onToggleInput={onToggleInput}
          onUpdateInput={onUpdateInput}
          onMoveInput={onMoveInput}
          onChangeDefaultImage={onChangeDefaultImage}
        />
      }
      validationPanel={
        <WorkflowValidationPanel
          issues={editorValidationIssues}
          title="편집기 검증"
          description="실행 전 확인"
          onIssueSelect={onValidationIssueSelect}
        />
      }
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
        />
      }
    />
  )
}
