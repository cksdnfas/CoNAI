import { Suspense, lazy, type ReactNode } from 'react'
import { getGraphExecution, type GraphExecutionRecord, type GraphWorkflowBrowseContentRecord, type GraphWorkflowFolderRecord, type GraphWorkflowRecord } from '@/lib/api'
import type { ModuleGraphEdge, ModuleGraphNode } from '../module-graph-shared'
import { ModuleWorkflowBrowseView } from './module-workflow-browse-view'
import { ModuleWorkflowEditorView } from './module-workflow-editor-view'

const GraphExecutionPanelLazy = lazy(async () => {
  const module = await import('./graph-execution-panel')
  return { default: module.GraphExecutionPanel }
})

const ModuleWorkflowOutputManagementPanelLazy = lazy(async () => {
  const module = await import('./module-workflow-output-management-panel')
  return { default: module.ModuleWorkflowOutputManagementPanel }
})

type GraphExecutionDetailRecord = Awaited<ReturnType<typeof getGraphExecution>>

function WorkflowContentFallback() {
  return <div className="min-h-[16rem] rounded-sm border border-border bg-surface-low animate-pulse" />
}

/** Render the browse-mode content block for the module-graph workspace. */
export function ModuleGraphWorkflowBrowseContent({
  isDesktopPageLayout,
  workflowListSidebar,
  workflowBrowseSidePanel,
  selectedGraphRecord,
  selectedFolderRecord,
  selectedGraphId,
  selectedExecutionId,
  selectedExecutionStatus,
  executionList,
  executionListError,
  executionListIsError,
  executionDetail,
  executionDetailError,
  executionDetailIsError,
  browseContent,
  browseContentError,
  browseContentIsError,
  onRefreshBrowseContent,
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
  selectedFolderRecord: GraphWorkflowFolderRecord | null
  selectedGraphId: number | null
  selectedExecutionId: number | null
  selectedExecutionStatus: GraphExecutionRecord['status'] | null
  executionList: GraphExecutionRecord[]
  executionListError: string
  executionListIsError: boolean
  executionDetail?: GraphExecutionDetailRecord
  executionDetailError: string
  executionDetailIsError: boolean
  browseContent?: GraphWorkflowBrowseContentRecord
  browseContentError: string
  browseContentIsError: boolean
  onRefreshBrowseContent?: () => Promise<unknown> | unknown
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
        <Suspense fallback={<WorkflowContentFallback />}>
          <GraphExecutionPanelLazy
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
        </Suspense>
      ) : null}
      browseContentPanel={selectedGraphRecord ? null : browseContentIsError ? (
        <div className="rounded-sm border border-dashed border-destructive/40 px-4 py-10 text-sm text-muted-foreground">
          {browseContentError}
        </div>
      ) : browseContent ? (
        <Suspense fallback={<WorkflowContentFallback />}>
          <ModuleWorkflowOutputManagementPanelLazy
            selectedFolderRecord={selectedFolderRecord}
            browseContent={browseContent}
            onRefresh={onRefreshBrowseContent}
          />
        </Suspense>
      ) : (
        <div className="rounded-sm border border-dashed border-border px-4 py-10 text-sm text-muted-foreground">
          생성물 관리 콘텐츠를 불러오는 중이야…
        </div>
      )}
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
