import { Suspense, lazy } from 'react'
import { ReactFlowProvider, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { PageHeader } from '@/components/common/page-header'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { ModuleGraphWorkflowListSidebar } from './components/module-graph-page-sections'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { useModuleGraphPageState } from './use-module-graph-page-state'
import { useModuleGraphPageQueries } from './use-module-graph-page-queries'
import { useModuleGraphPageViewModel } from './use-module-graph-page-view-model'
import { useModuleGraphWorkspaceSync } from './use-module-graph-workspace-sync'
import { useModuleGraphEditorShell } from './use-module-graph-editor-shell'
import { useModuleGraphPageEditorPanels } from './use-module-graph-page-editor-panels'
import { useModuleGraphPageActions } from './use-module-graph-page-actions'

const ModuleGraphWorkflowBrowseContentLazy = lazy(async () => {
  const module = await import('./components/module-graph-workflow-content')
  return { default: module.ModuleGraphWorkflowBrowseContent }
})

const ModuleGraphWorkflowEditorContentLazy = lazy(async () => {
  const module = await import('./components/module-graph-workflow-content')
  return { default: module.ModuleGraphWorkflowEditorContent }
})

const ModuleGraphWorkspaceModalsLazy = lazy(async () => {
  const module = await import('./components/module-graph-workspace-modals')
  return { default: module.ModuleGraphWorkspaceModals }
})

type ModuleWorkflowWorkspaceProps = {
  embedded?: boolean
}

const UNSAVED_CHANGES_CONFIRM_MESSAGE = '저장하지 않은 변경사항이 있어. 이 작업을 진행하면 현재 편집 내용이 사라질 수 있어. 계속할까?'

function WorkflowPageFallback() {
  return <div className="min-h-[16rem] rounded-sm border border-border bg-surface-low animate-pulse" />
}

function ModuleWorkflowWorkspaceInner({ embedded = false }: ModuleWorkflowWorkspaceProps) {
  const { showSnackbar } = useSnackbar()
  const reactFlow = useReactFlow()
  const isDesktopPageLayout = useDesktopPageLayout()
  const {
    workflowName,
    setWorkflowName,
    workflowDescription,
    setWorkflowDescription,
    selectedFolderId,
    setSelectedFolderId,
    draftWorkflowFolderId,
    setDraftWorkflowFolderId,
    draftChildFolderName,
    setDraftChildFolderName,
    draftChildFolderDescription,
    setDraftChildFolderDescription,
    selectedGraphId,
    setSelectedGraphId,
    selectedExecutionId,
    setSelectedExecutionId,
    selectedNodeId,
    setSelectedNodeId,
    selectedEdgeId,
    setSelectedEdgeId,
    selectedValidationPortKey,
    setSelectedValidationPortKey,
    lastSavedSnapshot,
    setLastSavedSnapshot,
    workflowView,
    setWorkflowView,
    isModuleLibraryOpen,
    setIsModuleLibraryOpen,
    isCustomNodeManagerOpen,
    setIsCustomNodeManagerOpen,
    isBrowseManageModalOpen,
    setIsBrowseManageModalOpen,
    folderDeleteTarget,
    setFolderDeleteTarget,
    isEditorSupportOpen,
    setIsEditorSupportOpen,
    activeEditorSupportSection,
    setActiveEditorSupportSection,
    workflowExposedInputs,
    setWorkflowExposedInputs,
    workflowRunInputValues,
    setWorkflowRunInputValues,
    nodes,
    setNodes,
    onNodesChange,
    edges,
    setEdges,
    onEdgesChange,
  } = useModuleGraphPageState()

  const {
    modulesQuery,
    settingsQuery,
    graphWorkflowsQuery,
    graphWorkflowFoldersQuery,
    graphExecutionsQuery,
    executionDetailQuery,
    browseContentQuery,
    modules,
    executionList,
    reactFlowColorMode,
  } = useModuleGraphPageQueries({
    selectedGraphId,
    selectedExecutionId,
    selectedFolderId,
    workflowView,
  })

  const {
    isDirty,
    shouldBlockGraphExit,
    selectedGraphRecord,
    selectedFolderRecord,
    moduleDefinitionById,
    latestExecution,
    latestArtifactPreviewByNode,
    latestExecutionDetail,
    selectedExecution,
    selectedNode,
    selectedEdge,
    editorValidationIssues,
    selectedWorkflowValidationIssues,
    selectedWorkflowCanExecute,
  } = useModuleGraphPageViewModel({
    workflowName,
    workflowDescription,
    nodes,
    edges,
    workflowView,
    lastSavedSnapshot,
    graphWorkflows: graphWorkflowsQuery.data ?? [],
    selectedGraphId,
    graphWorkflowFolders: graphWorkflowFoldersQuery.data ?? [],
    selectedFolderId,
    modules,
    executionList,
    selectedExecutionId,
    selectedNodeId,
    selectedEdgeId,
    executionDetail: executionDetailQuery.data,
    settings: settingsQuery.data,
    workflowExposedInputs,
    workflowRunInputValues,
  })

  useModuleGraphWorkspaceSync({
    selectedGraphId,
    nodes,
    executionList,
    selectedExecutionId,
    executionDetail: executionDetailQuery.data,
    latestArtifactPreviewByNode,
    edges,
    setSelectedExecutionId,
    setWorkflowRunInputValues,
    setWorkflowExposedInputs,
    setNodes,
    showSnackbar,
  })

  const {
    closeEditorSupport,
    enterWorkflowEditor,
    focusValidationIssue,
    openEditorSupport,
    scrollToEditorSupportSection,
    setEditorSupportSectionRef,
  } = useModuleGraphEditorShell({
    nodes,
    workflowView,
    shouldBlockGraphExit,
    reactFlow,
    confirmMessage: UNSAVED_CHANGES_CONFIRM_MESSAGE,
    setWorkflowView,
    setIsEditorSupportOpen,
    setActiveEditorSupportSection,
    setSelectedNodeId,
    setSelectedEdgeId,
    setSelectedValidationPortKey,
  })

  const {
    isValidConnection,
    handleConnect,
    handleAddModuleNode,
    handleAddModuleFromLibrary,
    handleDuplicateNodeById,
    handleDuplicateSelectedNode,
    handleNodeLabelChange,
    handleNodeValueChange,
    handleNodeValueClear,
    handleNodeImageChange,
    handleWorkflowRunInputChange,
    handleWorkflowRunInputClear,
    handleWorkflowRunInputImageChange,
    handleAutoLayout,
    handleDisconnectNodeInput,
    handleDisconnectAllNodeConnections,
    handleRemoveNodeById,
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
  } = useModuleGraphPageActions({
    confirmMessage: UNSAVED_CHANGES_CONFIRM_MESSAGE,
    reactFlow,
    isDirty,
    workflowView,
    nodes,
    edges,
    modules,
    graphWorkflowFolders: graphWorkflowFoldersQuery.data ?? [],
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
    refetchModules: modulesQuery.refetch,
    refetchGraphWorkflowFolders: graphWorkflowFoldersQuery.refetch,
    refetchGraphWorkflows: graphWorkflowsQuery.refetch,
    refetchGraphExecutions: graphExecutionsQuery.refetch,
    refetchExecutionDetail: executionDetailQuery.refetch,
    enterWorkflowEditor,
    showSnackbar,
  })

  const browseManageModalTitle = selectedGraphRecord
    ? '워크플로우 설정'
    : selectedFolderRecord
      ? '폴더 설정'
      : '폴더 생성'

  const workflowListSidebar = (
    <ModuleGraphWorkflowListSidebar
      graphs={graphWorkflowsQuery.data ?? []}
      folders={graphWorkflowFoldersQuery.data ?? []}
      selectedGraphId={selectedGraphId}
      selectedFolderId={selectedFolderId}
      moduleDefinitionById={moduleDefinitionById}
      workflowView={workflowView}
      selectedGraphRecord={selectedGraphRecord}
      selectedFolderRecord={selectedFolderRecord}
      browseManageModalTitle={browseManageModalTitle}
      onLoadGraph={(graph) => {
        void handleLoadGraph(graph, { silent: true })
      }}
      onSelectFolder={(folderId) => {
        setSelectedFolderId(folderId)
        if (workflowView === 'browse') {
          setSelectedGraphId(null)
          setSelectedExecutionId(null)
        }
      }}
      onLeaveEditor={handleLeaveWorkflowEditor}
      onRefreshWorkspace={() => {
        void handleRefreshWorkspace()
      }}
      onOpenBrowseManage={() => setIsBrowseManageModalOpen(true)}
      onCreateWorkflow={handleCreateWorkflow}
      onEditWorkflow={handleEditSelectedWorkflow}
      onDeleteWorkflow={() => {
        void handleDeleteSelectedWorkflow()
      }}
      onDeleteFolder={(folderId) => {
        void handleDeleteSelectedFolder(folderId)
      }}
    />
  )

  const {
    editorSupportSubtitle,
    workflowBrowseSidePanel,
    workflowEditorSupportPanels,
    graphCanvas,
  } = useModuleGraphPageEditorPanels({
    workflowView,
    modules,
    graphWorkflowFolders: graphWorkflowFoldersQuery.data ?? [],
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
    selectedNode,
    selectedEdge,
    selectedExecutionId,
    isSavingGraph,
    cancellingExecutionId,
    editorValidationIssues,
    executionList,
    executionListError: graphExecutionsQuery.error instanceof Error ? graphExecutionsQuery.error.message : '실행 목록을 불러오지 못했어.',
    executionListIsError: graphExecutionsQuery.isError,
    executionDetail: executionDetailQuery.data,
    executionDetailError: executionDetailQuery.error instanceof Error ? executionDetailQuery.error.message : '실행 상세를 불러오지 못했어.',
    executionDetailIsError: executionDetailQuery.isError,
    selectedExecutionStatus: selectedExecution?.status ?? null,
    selectedValidationPortKey,
    activeEditorSupportSection,
    reactFlowColorMode,
    onSelectEditorSupportSection: scrollToEditorSupportSection,
    onNodesChange,
    onEdgesChange,
    onDraftWorkflowFolderIdChange: setDraftWorkflowFolderId,
    onDraftChildFolderNameChange: setDraftChildFolderName,
    onDraftChildFolderDescriptionChange: setDraftChildFolderDescription,
    onCreateWorkflowFolder: handleCreateWorkflowFolder,
    onWorkflowRunInputChange: handleWorkflowRunInputChange,
    onWorkflowRunInputClear: handleWorkflowRunInputClear,
    onWorkflowRunInputImageChange: handleWorkflowRunInputImageChange,
    onDuplicateNodeById: handleDuplicateNodeById,
    onDisconnectNodeInput: handleDisconnectNodeInput,
    onDisconnectAllNodeConnections: handleDisconnectAllNodeConnections,
    onRemoveNodeById: handleRemoveNodeById,
    onRunSelectedWorkflow: () => void handleRunSelectedWorkflow(),
    onEditSelectedWorkflow: handleEditSelectedWorkflow,
    onDeleteSelectedWorkflow: () => void handleDeleteSelectedWorkflow(),
    onOpenBrowseManage: () => setIsBrowseManageModalOpen(true),
    onValidationIssueSelect: focusValidationIssue,
    onWorkflowNameChange: setWorkflowName,
    onWorkflowDescriptionChange: setWorkflowDescription,
    onSaveGraph: () => void handleSaveGraph(),
    setEditorSupportSectionRef,
    onNodeLabelChange: handleNodeLabelChange,
    onNodeValueChange: handleNodeValueChange,
    onNodeValueClear: handleNodeValueClear,
    onNodeImageChange: handleNodeImageChange,
    onExecuteSelectedNode: (force) => void handleExecuteSelectedNode(force),
    onSelectExecution: setSelectedExecutionId,
    onOpenEditorSupport: openEditorSupport,
    onRerunSelectedGraph: () => void handleRerunSelectedGraph(),
    onRetrySelectedExecution: () => void handleRetrySelectedExecution(),
    onCancelSelectedExecution: () => void handleCancelSelectedExecution(),
    onExecuteNodeById: (nodeId, force) => void handleExecuteNodeById(nodeId, force),
    onNodeSelect: (nodeId) => {
      setSelectedNodeId(nodeId)
      setSelectedEdgeId(null)
      setSelectedValidationPortKey(null)
    },
    onEdgeSelect: (edgeId) => {
      setSelectedEdgeId(edgeId)
      setSelectedNodeId(null)
      setSelectedValidationPortKey(null)
    },
    onPaneSelect: () => {
      setSelectedNodeId(null)
      setSelectedEdgeId(null)
      setSelectedValidationPortKey(null)
    },
    onConnect: handleConnect,
    onAddModuleNode: handleAddModuleNode,
    isValidConnection,
  })

  return (
    <div className={embedded ? 'space-y-6' : 'space-y-8'}>
      {!embedded ? (
        <PageHeader
          eyebrow="Create"
          title={workflowView === 'browse' ? 'Workflow' : 'Workflow Editor'}
        />
      ) : null}

      {workflowView === 'browse' ? (
        <Suspense fallback={<WorkflowPageFallback />}>
          <ModuleGraphWorkflowBrowseContentLazy
            isDesktopPageLayout={isDesktopPageLayout}
            workflowListSidebar={workflowListSidebar}
            workflowBrowseSidePanel={workflowBrowseSidePanel}
            selectedGraphRecord={selectedGraphRecord}
            selectedFolderRecord={selectedFolderRecord}
            selectedGraphId={selectedGraphId}
            selectedExecutionId={selectedExecutionId}
            selectedExecutionStatus={selectedExecution?.status ?? null}
            executionList={executionList}
            executionListError={graphExecutionsQuery.error instanceof Error ? graphExecutionsQuery.error.message : '실행 목록을 불러오지 못했어.'}
            executionListIsError={graphExecutionsQuery.isError}
            executionDetail={executionDetailQuery.data}
            executionDetailError={executionDetailQuery.error instanceof Error ? executionDetailQuery.error.message : '실행 상세를 불러오지 못했어.'}
            executionDetailIsError={executionDetailQuery.isError}
            browseContent={browseContentQuery.data}
            browseContentError={browseContentQuery.error instanceof Error ? browseContentQuery.error.message : '생성물 관리 콘텐츠를 불러오지 못했어.'}
            browseContentIsError={browseContentQuery.isError}
            onRefreshBrowseContent={() => browseContentQuery.refetch()}
            executingGraphId={executingGraphId}
            cancellingExecutionId={cancellingExecutionId}
            onSelectExecution={setSelectedExecutionId}
            onRerunGraph={() => void handleRerunSelectedGraph()}
            onRetryExecution={() => void handleRetrySelectedExecution()}
            onCancelExecution={() => void handleCancelSelectedExecution()}
          />
        </Suspense>
      ) : (
        <Suspense fallback={<WorkflowPageFallback />}>
          <ModuleGraphWorkflowEditorContentLazy
            isDesktopPageLayout={isDesktopPageLayout}
            workflowListSidebar={workflowListSidebar}
            nodesCount={nodes.length}
            edgesCount={edges.length}
            selectedNode={selectedNode}
            selectedEdge={selectedEdge}
            selectedExecutionId={selectedExecutionId}
            selectedGraphRecord={selectedGraphRecord}
            workflowName={workflowName}
            isEditorSupportOpen={isEditorSupportOpen}
            editorSupportSubtitle={editorSupportSubtitle}
            workflowEditorSupportPanels={workflowEditorSupportPanels}
            graphCanvas={graphCanvas}
            onOpenModuleLibrary={() => setIsModuleLibraryOpen(true)}
            onAutoLayout={handleAutoLayout}
            onDuplicateSelectedNode={handleDuplicateSelectedNode}
            onRemoveSelectedNode={handleRemoveSelectedNode}
            onRemoveSelectedEdge={handleRemoveSelectedEdge}
            onResetCanvas={handleResetCanvas}
            onOpenEditorSupport={() => openEditorSupport(selectedNode ? 'inspector' : selectedExecutionId ? 'results' : 'setup')}
            onCloseEditorSupport={closeEditorSupport}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <ModuleGraphWorkspaceModalsLazy
          workflowView={workflowView}
          isBrowseManageModalOpen={isBrowseManageModalOpen}
          browseManageModalTitle={browseManageModalTitle}
          graphWorkflowFolders={graphWorkflowFoldersQuery.data ?? []}
          selectedGraphRecord={selectedGraphRecord}
          selectedFolderRecord={selectedFolderRecord}
          folderDeleteTarget={folderDeleteTarget}
          isModuleLibraryOpen={isModuleLibraryOpen}
          isCustomNodeManagerOpen={isCustomNodeManagerOpen}
          modules={modules}
          modulesErrorMessage={modulesQuery.error instanceof Error ? modulesQuery.error.message : '모듈 목록을 불러오지 못했어.'}
          modulesIsError={modulesQuery.isError}
          onCloseBrowseManage={() => setIsBrowseManageModalOpen(false)}
          onAssignWorkflowFolder={(folderId) => handleAssignSelectedWorkflowFolder(folderId)}
          onCreateFolder={(input) => handleCreateWorkflowFolder(input)}
          onUpdateFolder={(folderId, input) => handleUpdateSelectedFolder(folderId, input)}
          onDeleteFolder={(folderId) => handleDeleteSelectedFolder(folderId)}
          onEditWorkflow={() => {
            setIsBrowseManageModalOpen(false)
            handleEditSelectedWorkflow()
          }}
          onDeleteWorkflow={async () => {
            await handleDeleteSelectedWorkflow()
            setIsBrowseManageModalOpen(false)
          }}
          onCloseFolderDelete={() => setFolderDeleteTarget(null)}
          onConfirmDeleteFolder={(mode) => {
            void handleConfirmDeleteFolder(mode)
          }}
          onCloseModuleLibrary={() => setIsModuleLibraryOpen(false)}
          onOpenCustomNodeManager={() => setIsCustomNodeManagerOpen(true)}
          onCloseCustomNodeManager={() => setIsCustomNodeManagerOpen(false)}
          onRefreshModules={modulesQuery.refetch}
          onAddModule={handleAddModuleFromLibrary}
        />
      </Suspense>
    </div>
  )
}

export function ModuleWorkflowWorkspace({ embedded = false }: ModuleWorkflowWorkspaceProps) {
  return (
    <ReactFlowProvider>
      <ModuleWorkflowWorkspaceInner embedded={embedded} />
    </ReactFlowProvider>
  )
}

export function ModuleGraphPage() {
  return <ModuleWorkflowWorkspace />
}

