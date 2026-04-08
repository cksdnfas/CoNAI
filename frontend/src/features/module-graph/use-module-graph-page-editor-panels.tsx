import { useMemo } from 'react'
import type { Connection, OnEdgesChange, OnNodesChange } from '@xyflow/react'
import { getGraphExecution, type GraphExecutionRecord, type GraphWorkflowFolderRecord, type GraphWorkflowRecord, type ModuleDefinitionRecord } from '@/lib/api'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import { ModuleGraphCanvas } from './components/module-graph-canvas'
import {
  ModuleGraphEditorSupportSubtitle,
  ModuleGraphWorkflowBrowseSidePanel,
  ModuleGraphWorkflowEditorSupportPanels,
  ModuleGraphWorkflowSetupFolderPanel,
} from './components/module-graph-page-sections'
import type { EditorSupportSectionKey } from './components/module-workflow-editor-support-panel'
import type { WorkflowValidationIssue } from './components/workflow-validation-panel'
import type { ModuleGraphEdge, ModuleGraphNode } from './module-graph-shared'

type GraphExecutionDetailRecord = Awaited<ReturnType<typeof getGraphExecution>>

/** Build the assembled editor-facing panels used by the module-graph page. */
export function useModuleGraphPageEditorPanels({
  modules,
  graphWorkflowFolders,
  draftWorkflowFolderId,
  draftChildFolderName,
  draftChildFolderDescription,
  selectedGraphRecord,
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
  selectedNode,
  selectedEdge,
  selectedExecutionId,
  isSavingGraph,
  cancellingExecutionId,
  editorValidationIssues,
  executionList,
  executionListError,
  executionListIsError,
  executionDetail,
  executionDetailError,
  executionDetailIsError,
  selectedExecutionStatus,
  selectedValidationPortKey,
  activeEditorSupportSection,
  reactFlowColorMode,
  onSelectEditorSupportSection,
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
  onNodeValueChange,
  onNodeValueClear,
  onNodeImageChange,
  onExecuteSelectedNode,
  onSelectExecution,
  onOpenEditorSupport,
  onRerunSelectedGraph,
  onRetrySelectedExecution,
  onCancelSelectedExecution,
  onExecuteNodeById,
  onNodeSelect,
  onEdgeSelect,
  onPaneSelect,
  onConnect,
  onAddModuleNode,
  isValidConnection,
}: {
  modules: ModuleDefinitionRecord[]
  graphWorkflowFolders: GraphWorkflowFolderRecord[]
  draftWorkflowFolderId: number | null
  draftChildFolderName: string
  draftChildFolderDescription: string
  selectedGraphRecord: GraphWorkflowRecord | null
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
  selectedNode: ModuleGraphNode | null
  selectedEdge: ModuleGraphEdge | null
  selectedExecutionId: number | null
  isSavingGraph: boolean
  cancellingExecutionId: number | null
  editorValidationIssues: WorkflowValidationIssue[]
  executionList: GraphExecutionRecord[]
  executionListError: string
  executionListIsError: boolean
  executionDetail?: GraphExecutionDetailRecord
  executionDetailError: string
  executionDetailIsError: boolean
  selectedExecutionStatus: GraphExecutionRecord['status'] | null
  selectedValidationPortKey: string | null
  activeEditorSupportSection: EditorSupportSectionKey
  reactFlowColorMode: 'light' | 'dark' | 'system'
  onSelectEditorSupportSection: (section: EditorSupportSectionKey) => void
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
  onRemoveNodeById: (nodeId: string) => void
  onRunSelectedWorkflow: () => void
  onEditSelectedWorkflow: () => void
  onDeleteSelectedWorkflow: () => void
  onOpenBrowseManage: () => void
  onValidationIssueSelect: (issue: WorkflowValidationIssue) => void
  onWorkflowNameChange: (value: string) => void
  onWorkflowDescriptionChange: (value: string) => void
  onSaveGraph: () => void
  setEditorSupportSectionRef: (section: EditorSupportSectionKey, node: HTMLDivElement | null) => void
  onNodeValueChange: (nodeId: string, portKey: string, value: unknown) => void
  onNodeValueClear: (nodeId: string, portKey: string) => void
  onNodeImageChange: (nodeId: string, portKey: string, image?: SelectedImageDraft) => void
  onExecuteSelectedNode: (force: boolean) => void
  onSelectExecution: (executionId: number) => void
  onOpenEditorSupport: (section?: EditorSupportSectionKey) => void
  onRerunSelectedGraph: () => void
  onRetrySelectedExecution: () => void
  onCancelSelectedExecution: () => void
  onExecuteNodeById: (nodeId: string, force: boolean) => void
  onNodeSelect: (nodeId: string) => void
  onEdgeSelect: (edgeId: string) => void
  onPaneSelect: () => void
  onConnect: (connection: Connection) => void
  onAddModuleNode: (module: ModuleDefinitionRecord, options?: { position?: { x: number; y: number }; connectionStart?: { nodeId: string; handleId: string; handleType: 'source' | 'target' } }) => void
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
          onNodeValueChange,
          onNodeValueClear,
          onNodeImageChange,
        },
      })),
    [executingGraphId, nodes, onExecuteNodeById, onNodeImageChange, onNodeValueChange, onNodeValueClear],
  )

  const editorSupportSubtitle = (
    <ModuleGraphEditorSupportSubtitle
      activeSection={activeEditorSupportSection}
      onSelectSection={onSelectEditorSupportSection}
    />
  )

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

  const workflowBrowseSidePanel = (
    <ModuleGraphWorkflowBrowseSidePanel
      selectedGraphRecord={selectedGraphRecord}
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
  )

  const workflowEditorSupportPanels = (
    <ModuleGraphWorkflowEditorSupportPanels
      nodes={nodes}
      edges={edges}
      selectedGraphId={selectedGraphId}
      selectedGraphRecord={selectedGraphRecord}
      workflowName={workflowName}
      workflowDescription={workflowDescription}
      isDirty={isDirty}
      selectedNode={selectedNode}
      selectedEdge={selectedEdge}
      selectedExecutionId={selectedExecutionId}
      isSavingGraph={isSavingGraph}
      executingGraphId={executingGraphId}
      cancellingExecutionId={cancellingExecutionId}
      editorValidationIssues={editorValidationIssues}
      executionList={executionList}
      executionListError={executionListError}
      executionListIsError={executionListIsError}
      executionDetail={executionDetail}
      executionDetailError={executionDetailError}
      executionDetailIsError={executionDetailIsError}
      selectedExecutionStatus={selectedExecutionStatus}
      highlightedPortKey={selectedValidationPortKey}
      folderPanel={workflowSetupFolderPanel}
      onWorkflowNameChange={onWorkflowNameChange}
      onWorkflowDescriptionChange={onWorkflowDescriptionChange}
      onSaveGraph={onSaveGraph}
      setSectionRef={setEditorSupportSectionRef}
      onNodeValueChange={onNodeValueChange}
      onNodeValueClear={onNodeValueClear}
      onNodeImageChange={onNodeImageChange}
      onExecuteSelectedNode={() => onExecuteSelectedNode(false)}
      onForceExecuteSelectedNode={() => onExecuteSelectedNode(true)}
      onValidationIssueSelect={onValidationIssueSelect}
      onSelectExecution={(executionId) => {
        onSelectExecution(executionId)
        onOpenEditorSupport('results')
      }}
      onRerunGraph={onRerunSelectedGraph}
      onRetryExecution={onRetrySelectedExecution}
      onCancelExecution={onCancelSelectedExecution}
    />
  )

  const graphCanvas = (
    <ModuleGraphCanvas
      nodes={graphCanvasNodes}
      edges={edges}
      modules={modules}
      reactFlowColorMode={reactFlowColorMode}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeSelect={onNodeSelect}
      onEdgeSelect={onEdgeSelect}
      onPaneSelect={onPaneSelect}
      onConnect={onConnect}
      onAddModuleNode={onAddModuleNode}
      onDuplicateNodeById={onDuplicateNodeById}
      onRemoveNodeById={onRemoveNodeById}
      isValidConnection={isValidConnection}
    />
  )

  return {
    editorSupportSubtitle,
    workflowBrowseSidePanel,
    workflowEditorSupportPanels,
    graphCanvas,
  }
}
