import type { Dispatch, SetStateAction } from 'react'
import type { GraphExecutionRecord, GraphWorkflowExposedInput, GraphWorkflowFolderRecord, GraphWorkflowRecord, ModuleDefinitionRecord } from '@/lib/api'
import type { EditorSupportSectionKey } from './components/module-workflow-editor-support-panel'
import type { WorkflowValidationIssue } from './components/workflow-validation-panel'
import type { ModuleGraphEdge, ModuleGraphNode } from './module-graph-shared'
import { useModuleGraphBrowseActions } from './use-module-graph-browse-actions'
import { useModuleGraphEditorInteractions } from './use-module-graph-editor-interactions'
import { useModuleGraphExecutionActions } from './use-module-graph-execution-actions'

/** Own the browse/editor/execution action-hook wiring for the module-graph page. */
export function useModuleGraphPageActions({
  confirmMessage,
  reactFlow,
  isDirty,
  workflowView,
  nodes,
  edges,
  modules,
  graphWorkflowFolders,
  selectedFolderId,
  selectedFolderRecord,
  selectedGraphRecord,
  folderDeleteTarget,
  selectedNode,
  selectedNodeId,
  selectedEdgeId,
  workflowName,
  workflowDescription,
  draftWorkflowFolderId,
  selectedGraphId,
  selectedExecution,
  selectedWorkflowValidationIssues,
  workflowRunInputValues,
  setNodes,
  setEdges,
  setSelectedFolderId,
  setDraftWorkflowFolderId,
  setSelectedGraphId,
  setSelectedExecutionId,
  setSelectedNodeId,
  setSelectedEdgeId,
  setWorkflowName,
  setWorkflowDescription,
  setWorkflowExposedInputs,
  setWorkflowRunInputValues,
  setLastSavedSnapshot,
  setWorkflowView,
  setIsModuleLibraryOpen,
  setIsEditorSupportOpen,
  setActiveEditorSupportSection,
  setIsBrowseManageModalOpen,
  setFolderDeleteTarget,
  refetchModules,
  refetchGraphWorkflowFolders,
  refetchGraphWorkflows,
  refetchGraphExecutions,
  refetchExecutionDetail,
  enterWorkflowEditor,
  showSnackbar,
}: {
  confirmMessage: string
  reactFlow: {
    fitView: (options?: { padding?: number; duration?: number }) => Promise<unknown> | unknown
  }
  isDirty: boolean
  workflowView: 'browse' | 'edit'
  nodes: ModuleGraphNode[]
  edges: ModuleGraphEdge[]
  modules: ModuleDefinitionRecord[]
  graphWorkflowFolders: GraphWorkflowFolderRecord[]
  selectedFolderId: number | null
  selectedFolderRecord: GraphWorkflowFolderRecord | null
  selectedGraphRecord: GraphWorkflowRecord | null
  folderDeleteTarget: GraphWorkflowFolderRecord | null
  selectedNode: ModuleGraphNode | null
  selectedNodeId: string | null
  selectedEdgeId: string | null
  workflowName: string
  workflowDescription: string
  draftWorkflowFolderId: number | null
  selectedGraphId: number | null
  selectedExecution: GraphExecutionRecord | null
  selectedWorkflowValidationIssues: WorkflowValidationIssue[]
  workflowRunInputValues: Record<string, unknown>
  setNodes: Dispatch<SetStateAction<ModuleGraphNode[]>>
  setEdges: Dispatch<SetStateAction<ModuleGraphEdge[]>>
  setSelectedFolderId: Dispatch<SetStateAction<number | null>>
  setDraftWorkflowFolderId: Dispatch<SetStateAction<number | null>>
  setSelectedGraphId: Dispatch<SetStateAction<number | null>>
  setSelectedExecutionId: Dispatch<SetStateAction<number | null>>
  setSelectedNodeId: Dispatch<SetStateAction<string | null>>
  setSelectedEdgeId: Dispatch<SetStateAction<string | null>>
  setWorkflowName: Dispatch<SetStateAction<string>>
  setWorkflowDescription: Dispatch<SetStateAction<string>>
  setWorkflowExposedInputs: Dispatch<SetStateAction<GraphWorkflowExposedInput[]>>
  setWorkflowRunInputValues: Dispatch<SetStateAction<Record<string, unknown>>>
  setLastSavedSnapshot: Dispatch<SetStateAction<string>>
  setWorkflowView: Dispatch<SetStateAction<'browse' | 'edit'>>
  setIsModuleLibraryOpen: Dispatch<SetStateAction<boolean>>
  setIsEditorSupportOpen: Dispatch<SetStateAction<boolean>>
  setActiveEditorSupportSection: Dispatch<SetStateAction<EditorSupportSectionKey>>
  setIsBrowseManageModalOpen: Dispatch<SetStateAction<boolean>>
  setFolderDeleteTarget: Dispatch<SetStateAction<GraphWorkflowFolderRecord | null>>
  refetchModules: () => Promise<unknown>
  refetchGraphWorkflowFolders: () => Promise<unknown>
  refetchGraphWorkflows: () => Promise<unknown>
  refetchGraphExecutions: () => Promise<unknown>
  refetchExecutionDetail: () => Promise<unknown>
  enterWorkflowEditor: (section?: EditorSupportSectionKey) => void
  showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void
}) {
  const confirmDiscardUnsavedChanges = () => {
    if (!isDirty) {
      return true
    }

    return window.confirm(confirmMessage)
  }

  const {
    isValidConnection,
    handleConnect,
    handleAddModuleFromLibrary,
    handleDuplicateSelectedNode,
    handleNodeValueChange,
    handleNodeValueClear,
    handleNodeImageChange,
    handleWorkflowRunInputChange,
    handleWorkflowRunInputClear,
    handleWorkflowRunInputImageChange,
    handleAutoLayout,
    handleRemoveSelectedNode,
    handleRemoveSelectedEdge,
    handleResetCanvas,
    resetEmptyWorkflowDraft: resetWorkflowDraft,
  } = useModuleGraphEditorInteractions({
    nodes,
    edges,
    selectedNode,
    selectedNodeId,
    selectedEdgeId,
    selectedFolderId,
    setNodes,
    setEdges,
    setSelectedGraphId,
    setDraftWorkflowFolderId,
    setSelectedExecutionId,
    setSelectedNodeId,
    setSelectedEdgeId,
    setWorkflowName,
    setWorkflowDescription,
    setWorkflowExposedInputs,
    setWorkflowRunInputValues,
    setLastSavedSnapshot,
    setIsModuleLibraryOpen,
    confirmDiscardUnsavedChanges,
    fitViewAfterAutoLayout: () => {
      requestAnimationFrame(() => {
        void reactFlow.fitView({ padding: 0.2, duration: 200 })
      })
    },
    showSnackbar,
  })

  const {
    handleLoadGraph,
    handleCreateWorkflow,
    handleCreateWorkflowFolder,
    handleUpdateSelectedFolder,
    handleDeleteSelectedFolder,
    handleConfirmDeleteFolder,
    handleAssignSelectedWorkflowFolder,
    handleEditSelectedWorkflow,
    handleDeleteSelectedWorkflow,
    handleLeaveWorkflowEditor,
    handleRefreshWorkspace: handleRefreshBrowseWorkspace,
  } = useModuleGraphBrowseActions({
    isDirty,
    selectedFolderId,
    selectedFolderRecord,
    selectedGraphRecord,
    folderDeleteTarget,
    workflowView,
    modules,
    graphWorkflowFolders,
    setNodes,
    setEdges,
    setSelectedFolderId,
    setDraftWorkflowFolderId,
    setSelectedGraphId,
    setSelectedExecutionId,
    setSelectedNodeId,
    setSelectedEdgeId,
    setWorkflowName,
    setWorkflowDescription,
    setWorkflowExposedInputs,
    setWorkflowRunInputValues,
    setLastSavedSnapshot,
    setWorkflowView,
    setIsEditorSupportOpen,
    setActiveEditorSupportSection,
    setIsBrowseManageModalOpen,
    setFolderDeleteTarget,
    refetchGraphWorkflowFolders,
    refetchGraphWorkflows,
    confirmDiscardUnsavedChanges,
    resetWorkflowDraft,
    enterWorkflowEditor,
    showSnackbar,
  })

  const {
    isSavingGraph,
    executingGraphId,
    cancellingExecutionId,
    handleSaveGraph,
    handleExecuteNodeById,
    handleExecuteSelectedNode,
    handleRunSelectedWorkflow,
    handleRerunSelectedGraph,
    handleCancelSelectedExecution,
    handleRetrySelectedExecution,
  } = useModuleGraphExecutionActions({
    nodes,
    edges,
    workflowName,
    workflowDescription,
    draftWorkflowFolderId,
    selectedGraphId,
    selectedGraphRecord,
    selectedNode,
    selectedExecution,
    selectedWorkflowValidationIssues,
    workflowRunInputValues,
    isDirty,
    onWorkflowNameResolved: setWorkflowName,
    onGraphSelected: setSelectedGraphId,
    onExecutionSelected: setSelectedExecutionId,
    onNodeSelected: setSelectedNodeId,
    onEdgeCleared: () => setSelectedEdgeId(null),
    onSnapshotSaved: setLastSavedSnapshot,
    refetchGraphWorkflows,
    refetchGraphExecutions,
    refetchExecutionDetail,
    showSnackbar,
  })

  const handleRefreshWorkspace = () =>
    Promise.all([
      refetchModules(),
      handleRefreshBrowseWorkspace(selectedGraphId !== null ? refetchGraphExecutions : undefined),
    ])

  return {
    isValidConnection,
    handleConnect,
    handleAddModuleFromLibrary,
    handleDuplicateSelectedNode,
    handleNodeValueChange,
    handleNodeValueClear,
    handleNodeImageChange,
    handleWorkflowRunInputChange,
    handleWorkflowRunInputClear,
    handleWorkflowRunInputImageChange,
    handleAutoLayout,
    handleRemoveSelectedNode,
    handleRemoveSelectedEdge,
    handleResetCanvas,
    handleLoadGraph,
    handleCreateWorkflow,
    handleCreateWorkflowFolder,
    handleUpdateSelectedFolder,
    handleDeleteSelectedFolder,
    handleConfirmDeleteFolder,
    handleAssignSelectedWorkflowFolder,
    handleEditSelectedWorkflow,
    handleDeleteSelectedWorkflow,
    handleLeaveWorkflowEditor,
    handleRefreshWorkspace,
    isSavingGraph,
    executingGraphId,
    cancellingExecutionId,
    handleSaveGraph,
    handleExecuteNodeById,
    handleExecuteSelectedNode,
    handleRunSelectedWorkflow,
    handleRerunSelectedGraph,
    handleCancelSelectedExecution,
    handleRetrySelectedExecution,
  }
}
