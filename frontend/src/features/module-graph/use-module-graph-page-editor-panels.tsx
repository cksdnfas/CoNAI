/* eslint-disable react-refresh/only-export-components */
import { Suspense, lazy, useMemo } from 'react'
import type { Connection, OnEdgesChange, OnNodesChange } from '@xyflow/react'
import { getGraphExecution, type GraphExecutionRecord, type GraphWorkflowExposedInput, type GraphWorkflowFolderRecord, type GraphWorkflowRecord, type ModuleDefinitionRecord } from '@/lib/api'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import { ModuleGraphWorkflowSaveModal } from './components/module-graph-workflow-save-modal'
const ModuleGraphCanvasLazy = lazy(async () => {
  const module = await import('./components/module-graph-canvas')
  return { default: module.ModuleGraphCanvas }
})
import {
  ModuleGraphWorkflowBrowseSidePanel,
  ModuleGraphWorkflowEditorSupportPanels,
  ModuleGraphWorkflowSetupFolderPanel,
} from './components/module-graph-page-sections'
import type { EditorSupportSectionKey } from './components/module-workflow-editor-support-panel'
import type { WorkflowValidationIssue } from './components/workflow-validation-panel'
import type { ModuleGraphEdge, ModuleGraphNode } from './module-graph-shared'

type GraphExecutionDetailRecord = Awaited<ReturnType<typeof getGraphExecution>>

function GraphCanvasFallback() {
  return <div className="min-h-[28rem] rounded-sm border border-border bg-surface-low animate-pulse" />
}

/** Build the assembled editor-facing panels used by the module-graph page. */
export function useModuleGraphPageEditorPanels({
  workflowView,
  modules,
  graphWorkflowFolders,
  draftWorkflowFolderId,
  draftChildFolderName,
  draftChildFolderDescription,
  selectedGraphRecord,
  workflowExposedInputs,
  workflowRunInputValues,
  executingGraphId,
  latestExecution,
  latestExecutionDetail,
  selectedWorkflowCanExecute,
  selectedWorkflowValidationIssues,
  nodes,
  edges,
  selectedGraphId,
  workflowName,
  workflowDescription,
  isDirty,
  selectedExecutionId,
  isSavingGraph,
  cancellingExecutionId,
  executionList,
  executionListError,
  executionListIsError,
  executionDetail,
  executionDetailError,
  executionDetailIsError,
  selectedExecutionStatus,
  reactFlowColorMode,
  isWorkflowSaveModalOpen,
  onCloseWorkflowSaveModal,
  onNodesChange,
  onEdgesChange,
  onDraftWorkflowFolderIdChange,
  onDraftChildFolderNameChange,
  onDraftChildFolderDescriptionChange,
  onCreateWorkflowFolder,
  onWorkflowRunInputChange,
  onWorkflowRunInputClear,
  onWorkflowRunInputImageChange,
  onDuplicateNodeById,
  onDisconnectNodeInput,
  onDisconnectAllNodeConnections,
  onRemoveNodeById,
  onRunSelectedWorkflow,
  onEditSelectedWorkflow,
  onDeleteSelectedWorkflow,
  onOpenBrowseManage,
  onValidationIssueSelect,
  onWorkflowNameChange,
  onWorkflowDescriptionChange,
  onSaveGraph,
  setEditorSupportSectionRef,
  onNodeLabelChange,
  onNodeValueChange,
  onNodeValueClear,
  onNodeImageChange,
  onSelectExecution,
  onRerunSelectedGraph,
  onRetrySelectedExecution,
  onCancelSelectedExecution,
  onExecuteNodeById,
  onNodeSelect,
  onEdgeSelect,
  onPaneSelect,
  onSelectionChange,
  onConnect,
  onAddModuleNode,
  onCopySelection,
  onPasteSelection,
  isValidConnection,
}: {
  workflowView: 'browse' | 'edit'
  modules: ModuleDefinitionRecord[]
  graphWorkflowFolders: GraphWorkflowFolderRecord[]
  draftWorkflowFolderId: number | null
  draftChildFolderName: string
  draftChildFolderDescription: string
  selectedGraphRecord: GraphWorkflowRecord | null
  workflowExposedInputs: GraphWorkflowExposedInput[]
  workflowRunInputValues: Record<string, unknown>
  executingGraphId: number | null
  latestExecution: GraphExecutionRecord | null
  latestExecutionDetail: GraphExecutionDetailRecord | null
  selectedWorkflowCanExecute: boolean
  selectedWorkflowValidationIssues: WorkflowValidationIssue[]
  nodes: ModuleGraphNode[]
  edges: ModuleGraphEdge[]
  selectedGraphId: number | null
  workflowName: string
  workflowDescription: string
  isDirty: boolean
  selectedExecutionId: number | null
  isSavingGraph: boolean
  cancellingExecutionId: number | null
  executionList: GraphExecutionRecord[]
  executionListError: string
  executionListIsError: boolean
  executionDetail?: GraphExecutionDetailRecord
  executionDetailError: string
  executionDetailIsError: boolean
  selectedExecutionStatus: GraphExecutionRecord['status'] | null
  reactFlowColorMode: 'light' | 'dark' | 'system'
  isWorkflowSaveModalOpen: boolean
  onCloseWorkflowSaveModal: () => void
  onNodesChange: OnNodesChange<ModuleGraphNode>
  onEdgesChange: OnEdgesChange<ModuleGraphEdge>
  onDraftWorkflowFolderIdChange: (folderId: number | null) => void
  onDraftChildFolderNameChange: (value: string) => void
  onDraftChildFolderDescriptionChange: (value: string) => void
  onCreateWorkflowFolder: (input: { name: string; description?: string; parent_id?: number | null }) => Promise<unknown>
  onWorkflowRunInputChange: (inputId: string, value: unknown) => void
  onWorkflowRunInputClear: (inputId: string) => void
  onWorkflowRunInputImageChange: (inputId: string, image?: SelectedImageDraft) => void
  onDuplicateNodeById: (nodeId: string) => void
  onDisconnectNodeInput: (nodeId: string, portKey: string) => void
  onDisconnectAllNodeConnections: (nodeId: string) => void
  onRemoveNodeById: (nodeId: string) => void
  onRunSelectedWorkflow: () => void
  onEditSelectedWorkflow: () => void
  onDeleteSelectedWorkflow: () => void
  onOpenBrowseManage: () => void
  onValidationIssueSelect: (issue: WorkflowValidationIssue) => void
  onWorkflowNameChange: (value: string) => void
  onWorkflowDescriptionChange: (value: string) => void
  onSaveGraph: () => Promise<boolean>
  setEditorSupportSectionRef: (section: EditorSupportSectionKey, node: HTMLDivElement | null) => void
  onNodeLabelChange: (nodeId: string, label: string) => void
  onNodeValueChange: (nodeId: string, portKey: string, value: unknown) => void
  onNodeValueClear: (nodeId: string, portKey: string) => void
  onNodeImageChange: (nodeId: string, portKey: string, image?: SelectedImageDraft) => void
  onSelectExecution: (executionId: number) => void
  onRerunSelectedGraph: () => void
  onRetrySelectedExecution: () => void
  onCancelSelectedExecution: () => void
  onExecuteNodeById: (nodeId: string, force: boolean) => void
  onNodeSelect: (nodeId: string) => void
  onEdgeSelect: (edgeId: string) => void
  onPaneSelect: () => void
  onSelectionChange: (selection: { nodes: ModuleGraphNode[]; edges: ModuleGraphEdge[] }) => void
  onConnect: (connection: Connection) => void
  onAddModuleNode: (module: ModuleDefinitionRecord, options?: { position?: { x: number; y: number }; connectionStart?: { nodeId: string; handleId: string; handleType: 'source' | 'target' } }) => void
  onCopySelection: () => Promise<boolean>
  onPasteSelection: (options?: { position?: { x: number; y: number } }) => Promise<boolean>
  isValidConnection: (connection: Connection | ModuleGraphEdge) => boolean
}) {
  const graphCanvasNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          executeNodeDisabled: executingGraphId !== null,
          onExecuteNode: () => onExecuteNodeById(node.id, false),
          onForceExecuteNode: () => onExecuteNodeById(node.id, true),
          onDisconnectNodeInput,
          onNodeLabelChange,
          onNodeValueChange,
          onNodeValueClear,
          onNodeImageChange,
        },
      })),
    [executingGraphId, nodes, onDisconnectNodeInput, onExecuteNodeById, onNodeImageChange, onNodeLabelChange, onNodeValueChange, onNodeValueClear],
  )

  const editorSupportSubtitle = null

  const workflowSetupFolderPanel = (
    <ModuleGraphWorkflowSetupFolderPanel
      folders={graphWorkflowFolders}
      draftWorkflowFolderId={draftWorkflowFolderId}
      draftChildFolderName={draftChildFolderName}
      draftChildFolderDescription={draftChildFolderDescription}
      onSelectFolder={(folderId) => onDraftWorkflowFolderIdChange(folderId)}
      onSelectRoot={() => onDraftWorkflowFolderIdChange(null)}
      onDraftChildFolderNameChange={onDraftChildFolderNameChange}
      onDraftChildFolderDescriptionChange={onDraftChildFolderDescriptionChange}
      onCreateChildFolder={() => {
        void onCreateWorkflowFolder({
          name: draftChildFolderName,
          description: draftChildFolderDescription,
          parent_id: draftWorkflowFolderId,
        }).then(() => {
          onDraftChildFolderNameChange('')
          onDraftChildFolderDescriptionChange('')
        })
      }}
    />
  )

  const workflowSaveModal = workflowView === 'edit' ? (
    <ModuleGraphWorkflowSaveModal
      open={isWorkflowSaveModalOpen}
      workflowName={workflowName}
      workflowDescription={workflowDescription}
      selectedGraphName={selectedGraphRecord?.name ?? null}
      selectedGraphVersion={selectedGraphRecord?.version ?? null}
      isDirty={isDirty}
      nodesCount={nodes.length}
      edgesCount={edges.length}
      selectedExecutionId={selectedExecutionId}
      isSavingGraph={isSavingGraph}
      hasNodes={nodes.length > 0}
      folderPanel={workflowSetupFolderPanel}
      onClose={onCloseWorkflowSaveModal}
      onWorkflowNameChange={onWorkflowNameChange}
      onWorkflowDescriptionChange={onWorkflowDescriptionChange}
      onSave={onSaveGraph}
    />
  ) : null

  const workflowBrowseSidePanel = workflowView === 'browse' ? (
    <ModuleGraphWorkflowBrowseSidePanel
      selectedGraphRecord={selectedGraphRecord}
      inputDefinitions={workflowExposedInputs}
      workflowRunInputValues={workflowRunInputValues}
      isExecuting={executingGraphId !== null}
      latestExecution={latestExecution}
      latestExecutionDetail={latestExecutionDetail}
      selectedWorkflowCanExecute={selectedWorkflowCanExecute}
      selectedWorkflowValidationIssues={selectedWorkflowValidationIssues}
      onInputValueChange={onWorkflowRunInputChange}
      onInputValueClear={onWorkflowRunInputClear}
      onInputImageChange={onWorkflowRunInputImageChange}
      onExecute={onRunSelectedWorkflow}
      onEdit={onEditSelectedWorkflow}
      onDeleteWorkflow={onDeleteSelectedWorkflow}
      onOpenFolderSettings={onOpenBrowseManage}
      onValidationIssueSelect={onValidationIssueSelect}
    />
  ) : null

  const workflowEditorSupportPanels = workflowView === 'edit' ? (
    <ModuleGraphWorkflowEditorSupportPanels
      selectedGraphId={selectedGraphId}
      selectedGraphRecord={selectedGraphRecord}
      selectedExecutionId={selectedExecutionId}
      executingGraphId={executingGraphId}
      cancellingExecutionId={cancellingExecutionId}
      executionList={executionList}
      executionListError={executionListError}
      executionListIsError={executionListIsError}
      executionDetail={executionDetail}
      executionDetailError={executionDetailError}
      executionDetailIsError={executionDetailIsError}
      selectedExecutionStatus={selectedExecutionStatus}
      setSectionRef={setEditorSupportSectionRef}
      onSelectExecution={onSelectExecution}
      onRerunGraph={onRerunSelectedGraph}
      onRetryExecution={onRetrySelectedExecution}
      onCancelExecution={onCancelSelectedExecution}
    />
  ) : null

  const graphCanvas = workflowView === 'edit' ? (
    <Suspense fallback={<GraphCanvasFallback />}>
      <ModuleGraphCanvasLazy
        nodes={graphCanvasNodes}
        edges={edges}
        modules={modules}
        reactFlowColorMode={reactFlowColorMode}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeSelect={onNodeSelect}
        onEdgeSelect={onEdgeSelect}
        onPaneSelect={onPaneSelect}
        onSelectionChange={onSelectionChange}
        onConnect={onConnect}
        onAddModuleNode={onAddModuleNode}
        onCopySelection={onCopySelection}
        onPasteSelection={onPasteSelection}
        onDuplicateNodeById={onDuplicateNodeById}
        onDisconnectAllNodeConnections={onDisconnectAllNodeConnections}
        onRemoveNodeById={onRemoveNodeById}
        isValidConnection={isValidConnection}
      />
    </Suspense>
  ) : null

  return {
    editorSupportSubtitle,
    workflowBrowseSidePanel,
    workflowEditorSupportPanels,
    workflowSaveModal,
    graphCanvas,
  }
}
