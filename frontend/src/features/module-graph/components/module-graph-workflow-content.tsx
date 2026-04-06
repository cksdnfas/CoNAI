import type { ReactNode } from 'react'
import { getGraphExecution, type GraphExecutionRecord, type GraphWorkflowRecord } from '@/lib/api'
import type { ModuleGraphEdge, ModuleGraphNode } from '../module-graph-shared'
import { GraphExecutionPanel } from './graph-execution-panel'
import { ModuleWorkflowBrowseView } from './module-workflow-browse-view'
import { ModuleWorkflowEditorView } from './module-workflow-editor-view'

type GraphExecutionDetailRecord = Awaited<ReturnType<typeof getGraphExecution>>

/** Render the browse-mode content block for the module-graph workspace. */
export function ModuleGraphWorkflowBrowseContent({
  isDesktopPageLayout,
  workflowListSidebar,
  workflowBrowseSidePanel,
  selectedGraphRecord,
  selectedGraphId,
  selectedExecutionId,
  selectedExecutionStatus,
  executionList,
  executionListError,
  executionListIsError,
  executionDetail,
  executionDetailError,
  executionDetailIsError,
  executingGraphId,
  cancellingExecutionId,
  onSelectExecution,
  onRerunGraph,
  onRetryExecution,
  onCancelExecution,
}: {
  isDesktopPageLayout: boolean
  workflowListSidebar: ReactNode
  workflowBrowseSidePanel: ReactNode
  selectedGraphRecord: GraphWorkflowRecord | null
  selectedGraphId: number | null
  selectedExecutionId: number | null
  selectedExecutionStatus: GraphExecutionRecord['status'] | null
  executionList: GraphExecutionRecord[]
  executionListError: string
  executionListIsError: boolean
  executionDetail?: GraphExecutionDetailRecord
  executionDetailError: string
  executionDetailIsError: boolean
  executingGraphId: number | null
  cancellingExecutionId: number | null
  onSelectExecution: (executionId: number | null) => void
  onRerunGraph: () => void
  onRetryExecution: () => void
  onCancelExecution: () => void
}) {
  return (
    <ModuleWorkflowBrowseView
      isDesktopPageLayout={isDesktopPageLayout}
      workflowListSidebar={workflowListSidebar}
      workflowRunnerPanel={workflowBrowseSidePanel}
      graphExecutionPanel={selectedGraphRecord ? (
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
      ) : null}
    />
  )
}

/** Render the edit-mode content block for the module-graph workspace. */
export function ModuleGraphWorkflowEditorContent({
  isDesktopPageLayout,
  workflowListSidebar,
  nodesCount,
  edgesCount,
  selectedNode,
  selectedEdge,
  selectedExecutionId,
  selectedGraphRecord,
  workflowName,
  isEditorSupportOpen,
  editorSupportSubtitle,
  workflowEditorSupportPanels,
  graphCanvas,
  onOpenModuleLibrary,
  onAutoLayout,
  onDuplicateSelectedNode,
  onRemoveSelectedNode,
  onRemoveSelectedEdge,
  onResetCanvas,
  onOpenEditorSupport,
  onCloseEditorSupport,
}: {
  isDesktopPageLayout: boolean
  workflowListSidebar: ReactNode
  nodesCount: number
  edgesCount: number
  selectedNode: ModuleGraphNode | null
  selectedEdge: ModuleGraphEdge | null
  selectedExecutionId: number | null
  selectedGraphRecord: GraphWorkflowRecord | null
  workflowName: string
  isEditorSupportOpen: boolean
  editorSupportSubtitle: ReactNode
  workflowEditorSupportPanels: ReactNode
  graphCanvas: ReactNode
  onOpenModuleLibrary: () => void
  onAutoLayout: () => void
  onDuplicateSelectedNode: () => void
  onRemoveSelectedNode: () => void
  onRemoveSelectedEdge: () => void
  onResetCanvas: () => void
  onOpenEditorSupport: () => void
  onCloseEditorSupport: () => void
}) {
  return (
    <ModuleWorkflowEditorView
      isDesktopPageLayout={isDesktopPageLayout}
      workflowListSidebar={workflowListSidebar}
      nodesCount={nodesCount}
      edgesCount={edgesCount}
      hasSelectedNode={Boolean(selectedNode)}
      hasSelectedEdge={Boolean(selectedEdge)}
      onOpenModuleLibrary={onOpenModuleLibrary}
      onAutoLayout={onAutoLayout}
      onDuplicateSelectedNode={onDuplicateSelectedNode}
      onRemoveSelectedNode={onRemoveSelectedNode}
      onRemoveSelectedEdge={onRemoveSelectedEdge}
      onResetCanvas={onResetCanvas}
      onOpenEditorSupport={onOpenEditorSupport}
      onCloseEditorSupport={onCloseEditorSupport}
      isEditorSupportOpen={isEditorSupportOpen}
      editorSupportTitle={selectedGraphRecord?.name || workflowName || 'Workflow Draft'}
      editorSupportSubtitle={editorSupportSubtitle}
      workflowEditorSupportPanels={workflowEditorSupportPanels}
      graphCanvas={graphCanvas}
    />
  )
}
