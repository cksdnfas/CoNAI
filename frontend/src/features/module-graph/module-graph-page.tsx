import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { FeaturePermissionNotice } from '@/features/auth/feature-permission-notice'
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ReactFlowProvider, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { SegmentedControl } from '@/components/common/segmented-control'
import { TextTabs } from '@/components/common/text-tabs'
import { ErrorState } from '@/components/ui/error-state'
import { LoadingState } from '@/components/ui/loading-state'
import { Text } from '@/components/ui/text'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { GenerationHistoryPanelView } from '@/features/image-generation/components/generation-history-panel'
import { useGenerationHistoryFeed } from '@/features/image-generation/components/use-generation-history-feed'
import { IMAGE_GENERATION_GRAPH_EDIT_PARAM, IMAGE_GENERATION_GRAPH_PARAM, parseImageGenerationWorkflowId } from '@/features/image-generation/image-generation-tabs'
import { useI18n } from '@/i18n'
import type { GraphWorkflowSummaryRecord } from '@/lib/api-module-graph'
import { cn } from '@/lib/utils'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageChoice, pageObject } from '@/features/codex-chat/page-action-helpers'
import { WorkflowListPanel } from './components/workflow-list-panel'
import { WorkflowRunnerPanel } from './components/workflow-runner-panel'
import { WorkflowActiveRunCard, WorkflowRunHistory, isActiveGraphExecution } from './components/workflow-run-history'
import { ModuleWorkflowEditorView } from './components/module-workflow-editor-view'
import { NodeInspectorPanel } from './components/node-inspector-panel'
import { WorkflowSettingsPanel } from './components/workflow-settings-panel'
import { WorkflowInputFields } from './components/workflow-input-fields'
import { getModuleNodeDisplayLabel } from './module-graph-shared'
import { deriveWorkflowExposedInputsFromNodes } from './module-graph-workflow-inputs'
import { GRAPH_FIT_VIEW_OPTIONS } from './module-graph-viewport'
import { useModuleGraphPageState } from './use-module-graph-page-state'
import { useModuleGraphPageQueries } from './use-module-graph-page-queries'
import { useModuleGraphPageViewModel } from './use-module-graph-page-view-model'
import { useModuleGraphWorkspaceSync } from './use-module-graph-workspace-sync'
import { useModuleGraphEditorShell } from './use-module-graph-editor-shell'
import { useModuleGraphPageEditorPanels } from './use-module-graph-page-editor-panels'
import { useModuleGraphPageActions } from './use-module-graph-page-actions'
import { useWorkflowChatPage } from './use-workflow-chat-page'

const ModuleWorkflowOutputManagementPanelLazy = lazy(async () => {
  const module = await import('./components/module-workflow-output-management-panel')
  return { default: module.ModuleWorkflowOutputManagementPanel }
})

const ModuleGraphWorkspaceModalsLazy = lazy(async () => {
  const module = await import('./components/module-graph-workspace-modals')
  return { default: module.ModuleGraphWorkspaceModals }
})

/** Fixed bottom slot the runner's Run bar is portalled into on narrow screens (like the provider tabs' sticky bar). */
const WORKFLOW_STICKY_RUN_BAR_SLOT_ID = 'workflow-sticky-run-bar'

type ModuleWorkflowWorkspaceProps = {
  /** Wide layout: the host gives this workspace the remaining height; columns and the editor scroll inside it. */
  isWideLayout: boolean
}

type NarrowView = 'edit' | 'result'
type ResultsTab = 'results' | 'runs'

function WorkflowPageFallback() {
  return <div className="min-h-[16rem] animate-pulse rounded-sm bg-fill" />
}

function ModuleWorkflowWorkspaceInner({ isWideLayout }: ModuleWorkflowWorkspaceProps) {
  const { t, formatNumber } = useI18n()
  const { showSnackbar } = useSnackbar()
  const reactFlow = useReactFlow()
  const [searchParams, setSearchParams] = useSearchParams()
  const [narrowView, setNarrowView] = useState<NarrowView>('edit')
  const [resultsTab, setResultsTab] = useState<ResultsTab>('results')
  const [quickCreateRequest, setQuickCreateRequest] = useState(0)
  const unsavedChangesConfirmMessage = t('module-graph.module.graph.page.you.have.unsaved.changes.continuing.may.discard')
  const {
    editorSessionId,
    workflowName,
    setWorkflowName,
    workflowDescription,
    setWorkflowDescription,
    workflowDebugMode,
    setWorkflowDebugMode,
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
    setIsEditorSupportOpen,
    isWorkflowSaveModalOpen,
    setIsWorkflowSaveModalOpen,
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
    executionListMeta,
    isLoadingMoreExecutions,
    loadMoreExecutions,
    selectedGraphWorkflow,
    refreshGraphWorkflows,
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
    latestArtifactPreviewByNode,
    previewArtifactsByExecution,
    selectedExecution,
    selectedNode,
    selectedEdge,
    editorValidationIssues,
    selectedWorkflowValidationIssues,
    selectedWorkflowCanExecute,
  } = useModuleGraphPageViewModel({
    workflowName,
    workflowDescription,
    workflowDebugMode,
    nodes,
    edges,
    workflowView,
    lastSavedSnapshot,
    selectedGraphId,
    selectedGraphWorkflow,
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
    enterWorkflowEditor,
    focusValidationIssue,
  } = useModuleGraphEditorShell({
    nodes,
    workflowView,
    shouldBlockGraphExit,
    reactFlow,
    confirmMessage: unsavedChangesConfirmMessage,
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
    handleCopySelectedNodesToClipboard,
    handlePasteNodesFromClipboard,
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
    handleToggleNodeDisabled,
    handleRemoveNodeById,
    handleLoadGraph,
    handleCreateWorkflow,
    handleCreateWorkflowFolder,
    handleUpdateSelectedFolder,
    handleDeleteSelectedFolder,
    handleConfirmDeleteFolder,
    handleAssignSelectedWorkflowFolder,
    handleEditSelectedWorkflow,
    handleDuplicateSelectedWorkflow,
    handleExportSelectedWorkflow,
    handleImportWorkflowFile,
    handleDeleteSelectedWorkflow,
    handleLeaveWorkflowEditor,
    isSavingGraph,
    executingGraphId,
    cancellingExecutionId,
    handleSaveGraph,
    handleExecuteNodeById,
    handleRunSelectedWorkflow,
    handleTestRunCurrentGraph,
    handleCancelSelectedExecution,
    handleRetrySelectedExecution,
  } = useModuleGraphPageActions({
    confirmMessage: unsavedChangesConfirmMessage,
    reactFlow,
    isDirty,
    workflowView,
    nodes,
    edges,
    modules,
    graphWorkflows: graphWorkflowsQuery.data ?? [],
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
    workflowDebugMode,
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
    setWorkflowDebugMode,
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
    refetchGraphWorkflows: refreshGraphWorkflows,
    refetchGraphExecutions: graphExecutionsQuery.refetch,
    refetchExecutionDetail: executionDetailQuery.refetch,
    enterWorkflowEditor,
    showSnackbar,
  })

  useWorkflowChatPage({
    enabled: workflowView === 'edit' && !modulesQuery.isLoading && !isSavingGraph && executingGraphId === null && !isWorkflowSaveModalOpen && executionList[0]?.status !== 'running' && executionList[0]?.status !== 'queued',
    dirty: isDirty, editorSessionId, selectedGraphId, name: workflowName, description: workflowDescription, debugMode: workflowDebugMode,
    nodes, edges, modules, runInputs: workflowRunInputValues, setNodes, setEdges,
    setName: setWorkflowName, setDescription: setWorkflowDescription, setRunInputs: setWorkflowRunInputValues, setExposedInputs: setWorkflowExposedInputs, setSelectedNodeId, setSelectedEdgeId,
  })

  useChatPageRegistration(workflowView === 'browse' ? {
    kind: 'workflow_runner', title: t({ ko: '워크플로 목록', en: 'Workflow browser' }), resourceId: 'workflow-browser', fields: [],
    data: { workflows: (graphWorkflowsQuery.data ?? []).slice(0, 512).map((graph) => ({ id: graph.id, name: graph.name, description: graph.description ?? '' })) },
    actions: graphWorkflowsQuery.data?.length ? [pageAction('workflow.select', t({ ko: '워크플로 선택·편집', en: 'Select or edit workflow' }), t({ ko: '저장된 워크플로를 선택하거나 노드 편집기를 열어.', en: 'Select a saved workflow or open its node editor.' }), pageObject({ id: pageChoice(graphWorkflowsQuery.data.slice(0, 512).map((graph) => graph.id)), mode: pageChoice(['select', 'edit']) }, ['id', 'mode']))] : [],
    apply: () => {}, applyAction: async (_id, args, assertCurrent) => { assertCurrent(); const graph = graphWorkflowsQuery.data?.find((graph) => graph.id === args.id); if (!graph || !(await handleLoadGraph(graph, { openEditor: args.mode === 'edit' }))) throw new Error('워크플로를 불러오지 못했어.') },
  } : null)

  // ------------------------------------------------------------------ URL ⇄ state (?graph=<id>&edit=1)
  const urlGraphId = parseImageGenerationWorkflowId(searchParams.get(IMAGE_GENERATION_GRAPH_PARAM))
  const urlEdit = searchParams.get(IMAGE_GENERATION_GRAPH_EDIT_PARAM) === '1'
  const isHydratedRef = useRef(false)
  const lastWrittenUrlRef = useRef<{ graph: number | null; edit: boolean } | null>(null)
  const isApplyingUrlRef = useRef(false)

  const writeUrl = useCallback((graph: number | null, edit: boolean, replace: boolean) => {
    lastWrittenUrlRef.current = { graph, edit }
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (graph === null) next.delete(IMAGE_GENERATION_GRAPH_PARAM)
      else next.set(IMAGE_GENERATION_GRAPH_PARAM, String(graph))
      if (edit) next.set(IMAGE_GENERATION_GRAPH_EDIT_PARAM, '1')
      else next.delete(IMAGE_GENERATION_GRAPH_EDIT_PARAM)
      return next
    }, { replace })
  }, [setSearchParams])

  // Apply a URL that this workspace did not write (first load, back/forward). Discard confirmations happen inside the
  // handlers; a cancelled one puts the current state back into the URL.
  const applyUrlState = useCallback(async (graph: number | null, edit: boolean) => {
    isApplyingUrlRef.current = true
    try {
      const isEditing = workflowView === 'edit'
      if (graph === null) {
        if (isEditing && !edit) {
          if (!(await handleLeaveWorkflowEditor())) {
            writeUrl(selectedGraphId, true, true)
            return
          }
        } else if (!isEditing && edit) {
          await handleCreateWorkflow()
          return
        }
        if (!edit) {
          setSelectedGraphId(null)
          setSelectedExecutionId(null)
        }
        return
      }

      if (graph !== selectedGraphId) {
        const loaded = await handleLoadGraph({ id: graph } as GraphWorkflowSummaryRecord, { silent: true, openEditor: edit })
        if (!loaded) {
          writeUrl(selectedGraphId, isEditing, true)
          return
        }
        if (!edit && isEditing) setWorkflowView('browse')
        return
      }

      if (edit && !isEditing) {
        enterWorkflowEditor('setup')
      } else if (!edit && isEditing && !(await handleLeaveWorkflowEditor())) {
        writeUrl(selectedGraphId, true, true)
      }
    } finally {
      isApplyingUrlRef.current = false
    }
  }, [enterWorkflowEditor, handleCreateWorkflow, handleLeaveWorkflowEditor, handleLoadGraph, selectedGraphId, setSelectedExecutionId, setSelectedGraphId, setWorkflowView, workflowView, writeUrl])

  useEffect(() => {
    if (isHydratedRef.current || modulesQuery.isLoading) return
    isHydratedRef.current = true
    lastWrittenUrlRef.current = { graph: urlGraphId, edit: urlEdit }
    if (urlGraphId !== null || urlEdit) void applyUrlState(urlGraphId, urlEdit)
  }, [applyUrlState, modulesQuery.isLoading, urlEdit, urlGraphId])

  // Only a URL change (back/forward, a pasted link) reaches the state, never a re-render with the old URL: the URL this
  // workspace pushes lands a render later than the state that caused it.
  const applyUrlStateRef = useRef(applyUrlState)
  useEffect(() => {
    applyUrlStateRef.current = applyUrlState
  })
  useEffect(() => {
    if (!isHydratedRef.current) return
    const last = lastWrittenUrlRef.current
    if (last && last.graph === urlGraphId && last.edit === urlEdit) return
    lastWrittenUrlRef.current = { graph: urlGraphId, edit: urlEdit }
    void applyUrlStateRef.current(urlGraphId, urlEdit)
  }, [urlEdit, urlGraphId])

  const isEditing = workflowView === 'edit'
  useEffect(() => {
    if (!isHydratedRef.current || isApplyingUrlRef.current) return
    const last = lastWrittenUrlRef.current
    if (last && last.graph === selectedGraphId && last.edit === isEditing) return
    // Opening a workflow or the editor is a step back can return from; saving a new draft only names it.
    writeUrl(selectedGraphId, isEditing, Boolean(last && last.edit && isEditing))
  }, [isEditing, selectedGraphId, writeUrl])

  // ------------------------------------------------------------------ derived bits
  const nodeLabelOverrides = useMemo(() => Object.fromEntries(nodes.map((node) => [node.id, getModuleNodeDisplayLabel(node)])), [nodes])
  const executionListPaging = useMemo(() => ({
    meta: executionListMeta,
    isLoadingMore: isLoadingMoreExecutions,
    onLoadMore: loadMoreExecutions,
  }), [executionListMeta, isLoadingMoreExecutions, loadMoreExecutions])
  const activeExecution = useMemo(() => executionList.find((execution) => isActiveGraphExecution(execution.status)) ?? null, [executionList])
  const editorExposedInputs = useMemo(() => deriveWorkflowExposedInputsFromNodes(nodes), [nodes])
  const graphs = graphWorkflowsQuery.data ?? []
  const folders = graphWorkflowFoldersQuery.data ?? []
  const runCount = executionListMeta?.total ?? executionList.length

  const resultsFeed = useGenerationHistoryFeed({
    refreshNonce: 0,
    serviceType: 'comfyui',
    graphWorkflowId: selectedGraphId,
    enabled: workflowView === 'browse' && selectedGraphId !== null,
  })
  const resultsTotal = resultsFeed.historyQuery.data?.pages[0]?.total

  // A finished run lands in the results list: refresh it when the active run goes away.
  const previousActiveExecutionIdRef = useRef<number | null>(null)
  const refreshResults = resultsFeed.refreshHistory
  useEffect(() => {
    const previous = previousActiveExecutionIdRef.current
    previousActiveExecutionIdRef.current = activeExecution?.id ?? null
    if (previous !== null && previous !== activeExecution?.id) void refreshResults()
  }, [activeExecution?.id, refreshResults])

  const browseManageModalTitle = selectedGraphRecord
    ? t('module-graph.module.graph.page.workflow.settings')
    : selectedFolderRecord
      ? t('module-graph.module.graph.page.folder.settings')
      : t('module-graph.module.graph.page.create.folder')

  const { workflowSaveModal, graphCanvas } = useModuleGraphPageEditorPanels({
    workflowView,
    modules,
    graphWorkflowFolders: folders,
    draftWorkflowFolderId,
    draftChildFolderName,
    draftChildFolderDescription,
    selectedGraphRecord,
    executingGraphId,
    nodes,
    edges,
    workflowName,
    workflowDescription,
    workflowDebugMode,
    isDirty,
    isSavingGraph,
    reactFlowColorMode,
    isWorkflowSaveModalOpen,
    fitViewKey: 1,
    quickCreateRequest,
    onOpenModuleLibrary: () => setIsModuleLibraryOpen(true),
    onCloseWorkflowSaveModal: () => setIsWorkflowSaveModalOpen(false),
    onNodesChange,
    onEdgesChange,
    onDraftWorkflowFolderIdChange: setDraftWorkflowFolderId,
    onDraftChildFolderNameChange: setDraftChildFolderName,
    onDraftChildFolderDescriptionChange: setDraftChildFolderDescription,
    onCreateWorkflowFolder: handleCreateWorkflowFolder,
    onDuplicateNodeById: handleDuplicateNodeById,
    onDisconnectNodeInput: handleDisconnectNodeInput,
    onDisconnectAllNodeConnections: handleDisconnectAllNodeConnections,
    onToggleNodeDisabled: handleToggleNodeDisabled,
    onRemoveNodeById: handleRemoveNodeById,
    onWorkflowNameChange: setWorkflowName,
    onWorkflowDescriptionChange: setWorkflowDescription,
    onWorkflowDebugModeChange: setWorkflowDebugMode,
    onSaveGraph: handleSaveGraph,
    onNodeLabelChange: handleNodeLabelChange,
    onNodeValueChange: handleNodeValueChange,
    onNodeValueClear: handleNodeValueClear,
    onNodeImageChange: handleNodeImageChange,
    onExecuteNodeById: (nodeId, force) => void handleExecuteNodeById(nodeId, force),
    onNodeSelect: (nodeId) => {
      setSelectedNodeId(nodeId)
      setSelectedEdgeId(null)
      setSelectedValidationPortKey(null)
    },
    onSelectionChange: ({ nodes: selectedNodes, edges: selectedEdges }) => {
      if (selectedNodes.length === 1 && selectedEdges.length === 0) {
        setSelectedNodeId(selectedNodes[0].id)
        setSelectedEdgeId(null)
        setSelectedValidationPortKey(null)
        return
      }

      if (selectedNodes.length === 0 && selectedEdges.length === 1) {
        setSelectedEdgeId(selectedEdges[0].id)
        setSelectedNodeId(null)
        setSelectedValidationPortKey(null)
        return
      }

      setSelectedNodeId(null)
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
    onCopySelection: handleCopySelectedNodesToClipboard,
    onPasteSelection: handlePasteNodesFromClipboard,
    isValidConnection,
  })

  const openGraph = (graph: GraphWorkflowSummaryRecord) => {
    setResultsTab('results')
    setNarrowView('edit')
    void handleLoadGraph(graph, { silent: true })
  }

  const runHistory = (
    <WorkflowRunHistory
      selectedGraph={selectedGraphRecord}
      nodeLabelOverrides={nodeLabelOverrides}
      executionList={executionList}
      executionListPaging={executionListPaging}
      executionListIsError={graphExecutionsQuery.isError}
      executionListError={graphExecutionsQuery.error instanceof Error ? graphExecutionsQuery.error.message : t('module-graph.module.graph.page.failed.to.load.the.execution.list')}
      previewArtifactsByExecution={previewArtifactsByExecution}
      selectedExecutionId={selectedExecutionId}
      executionDetail={executionDetailQuery.data}
      executionDetailIsError={executionDetailQuery.isError}
      executionDetailError={executionDetailQuery.error instanceof Error ? executionDetailQuery.error.message : t('module-graph.module.graph.page.failed.to.load.execution.details')}
      cancellingExecutionId={cancellingExecutionId}
      isExecutingGraph={executingGraphId !== null}
      onSelectExecution={setSelectedExecutionId}
      onCancelExecution={(execution) => void handleCancelSelectedExecution(execution)}
      onRetryExecution={(execution) => void handleRetrySelectedExecution(execution)}
    />
  )

  const modals = (
    <Suspense fallback={null}>
      <ModuleGraphWorkspaceModalsLazy
        workflowView={workflowView}
        isBrowseManageModalOpen={isBrowseManageModalOpen}
        browseManageModalTitle={browseManageModalTitle}
        graphWorkflowFolders={folders}
        selectedGraphRecord={selectedGraphRecord}
        selectedFolderRecord={selectedFolderRecord}
        folderDeleteTarget={folderDeleteTarget}
        isModuleLibraryOpen={isModuleLibraryOpen}
        isCustomNodeManagerOpen={isCustomNodeManagerOpen}
        modules={modules}
        modulesErrorMessage={modulesQuery.error instanceof Error ? modulesQuery.error.message : t('module-graph.module.graph.page.failed.to.load.the.module.list')}
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
  )

  // ------------------------------------------------------------------ editor
  if (workflowView === 'edit') {
    const selectionKey = selectedNodeId ?? selectedEdgeId
    return (
      <>
        <ModuleWorkflowEditorView
          isWideLayout={isWideLayout}
          workflowName={workflowName}
          onWorkflowNameChange={setWorkflowName}
          isDirty={isDirty}
          isSavingGraph={isSavingGraph}
          isExecuting={executingGraphId !== null}
          nodesCount={nodes.length}
          inputsCount={editorExposedInputs.length}
          runsCount={selectedGraphId !== null ? runCount : 0}
          selectionKey={selectionKey}
          graphCanvas={graphCanvas}
          nodePanel={selectedNode || selectedEdge ? (
            <NodeInspectorPanel
              nodes={nodes}
              selectedNode={selectedNode}
              selectedEdge={selectedEdge}
              selectedExecutionId={selectedExecutionId}
              selectedExecutionArtifacts={executionDetailQuery.data?.artifacts}
              onNodeLabelChange={handleNodeLabelChange}
              onNodeValueChange={handleNodeValueChange}
              onNodeValueClear={handleNodeValueClear}
              onNodeImageChange={handleNodeImageChange}
              onExecuteSelectedNode={selectedNode ? () => void handleExecuteNodeById(selectedNode.id, false) : undefined}
              onForceExecuteSelectedNode={selectedNode ? () => void handleExecuteNodeById(selectedNode.id, true) : undefined}
              executeSelectedNodeDisabled={executingGraphId !== null || selectedNode === null}
              highlightedPortKey={selectedValidationPortKey}
              showHeader={false}
            />
          ) : (
            <WorkflowSettingsPanel
              workflowName={workflowName}
              workflowDescription={workflowDescription}
              folders={folders}
              folderId={draftWorkflowFolderId}
              onWorkflowNameChange={setWorkflowName}
              onWorkflowDescriptionChange={setWorkflowDescription}
              onFolderChange={setDraftWorkflowFolderId}
            />
          )}
          inputsPanel={editorExposedInputs.length > 0 ? (
            <WorkflowInputFields
              inputDefinitions={editorExposedInputs}
              inputValues={workflowRunInputValues}
              onInputValueChange={handleWorkflowRunInputChange}
              onInputValueClear={handleWorkflowRunInputClear}
              onInputImageChange={handleWorkflowRunInputImageChange}
            />
          ) : (
            <Text variant="caption">{t({ ko: '노드 입력에서 "실행 입력"을 켜면 여기에 나와.', en: 'Inputs marked as run inputs on nodes show up here.' })}</Text>
          )}
          runsPanel={selectedGraphId !== null ? (
            <div className="space-y-3">
              {activeExecution ? (
                <WorkflowActiveRunCard
                  execution={activeExecution}
                  selectedGraph={selectedGraphRecord}
                  nodeLabelOverrides={nodeLabelOverrides}
                  isCancelling={cancellingExecutionId === activeExecution.id}
                  onCancel={(execution) => void handleCancelSelectedExecution(execution)}
                />
              ) : null}
              {runHistory}
            </div>
          ) : (
            <Text variant="caption">{t({ ko: '저장한 뒤 실행하면 여기에 쌓여.', en: 'Runs appear here once the workflow is saved and run.' })}</Text>
          )}
          workflowSaveModal={workflowSaveModal}
          workflowDebugMode={workflowDebugMode}
          validationIssues={editorValidationIssues}
          onValidationIssueSelect={focusValidationIssue}
          onBack={() => void handleLeaveWorkflowEditor()}
          onAddNode={() => setQuickCreateRequest((value) => value + 1)}
          onAutoLayout={handleAutoLayout}
          onFitView={() => void reactFlow.fitView({ ...GRAPH_FIT_VIEW_OPTIONS, duration: 200 })}
          onWorkflowDebugModeToggle={() => setWorkflowDebugMode((enabled) => !enabled)}
          onTestRun={() => void handleTestRunCurrentGraph()}
          onSave={() => {
            if (selectedGraphId === null) {
              setIsWorkflowSaveModalOpen(true)
              return
            }
            void handleSaveGraph()
          }}
        />
        {modals}
      </>
    )
  }

  // ------------------------------------------------------------------ browse: list or runner | results
  const leftColumn = selectedGraphId !== null ? (
    selectedGraphRecord ? (
      <WorkflowRunnerPanel
        selectedGraph={selectedGraphRecord}
        graphs={graphs}
        folders={folders}
        inputDefinitions={workflowExposedInputs}
        inputValues={workflowRunInputValues}
        isExecuting={executingGraphId !== null}
        canExecute={selectedWorkflowCanExecute}
        validationIssues={selectedWorkflowValidationIssues}
        splitPaneScroll={isWideLayout}
        stickyBarTargetId={isWideLayout ? undefined : WORKFLOW_STICKY_RUN_BAR_SLOT_ID}
        onInputValueChange={handleWorkflowRunInputChange}
        onInputValueClear={handleWorkflowRunInputClear}
        onInputImageChange={handleWorkflowRunInputImageChange}
        onExecute={() => {
          setResultsTab('results')
          void handleRunSelectedWorkflow().then(() => {
            if (!isWideLayout) setNarrowView('result')
          })
        }}
        onBack={() => {
          setSelectedGraphId(null)
          setSelectedExecutionId(null)
        }}
        onSwitchGraph={openGraph}
        onEdit={() => handleEditSelectedWorkflow()}
        onDuplicate={() => void handleDuplicateSelectedWorkflow()}
        onExport={() => void handleExportSelectedWorkflow()}
        onMove={() => setIsBrowseManageModalOpen(true)}
        onDelete={() => void handleDeleteSelectedWorkflow()}
        onValidationIssueSelect={focusValidationIssue}
      />
    ) : (
      <LoadingState variant="inline" label={t({ ko: '워크플로를 불러오는 중…', en: 'Loading the workflow…' })} />
    )
  ) : (
    <WorkflowListPanel
      graphs={graphs}
      folders={folders}
      selectedFolderId={selectedFolderId}
      onSelectFolder={setSelectedFolderId}
      onOpenGraph={openGraph}
      onEditGraph={(graph) => handleEditSelectedWorkflow(graph)}
      onDuplicateGraph={(graph) => void handleDuplicateSelectedWorkflow(graph)}
      onExportGraph={(graph) => void handleExportSelectedWorkflow(graph)}
      onMoveGraph={(graph) => {
        void handleLoadGraph(graph, { silent: true }).then((loaded) => {
          if (loaded) setIsBrowseManageModalOpen(true)
        })
      }}
      onDeleteGraph={(graph) => void handleDeleteSelectedWorkflow(graph)}
      onCreateWorkflow={() => void handleCreateWorkflow()}
      onCreateFolder={() => {
        setSelectedFolderId(null)
        setIsBrowseManageModalOpen(true)
      }}
      onImportWorkflow={(file) => void handleImportWorkflowFile(file)}
      onFolderSettings={(folder) => {
        setSelectedFolderId(folder.id)
        setIsBrowseManageModalOpen(true)
      }}
      onDeleteFolder={(folder) => void handleDeleteSelectedFolder(folder.id)}
      className={cn(isWideLayout && 'min-h-0 flex-1')}
    />
  )

  const rightColumn = selectedGraphId !== null ? (
    <div className={cn(isWideLayout ? 'flex min-h-0 flex-1 flex-col gap-3 overflow-hidden' : 'space-y-3')}>
      <TextTabs
        value={resultsTab}
        onChange={setResultsTab}
        ariaLabel={t({ ko: '결과', en: 'Results' })}
        items={[
          { value: 'results', label: t({ ko: '결과', en: 'Results' }), count: resultsTotal !== undefined ? formatNumber(resultsTotal) : null },
          { value: 'runs', label: t({ ko: '실행 기록', en: 'Runs' }), count: runCount ? formatNumber(runCount) : null },
        ]}
        className="shrink-0"
      />
      {activeExecution ? (
        <div className="shrink-0">
          <WorkflowActiveRunCard
            execution={activeExecution}
            selectedGraph={selectedGraphRecord}
            nodeLabelOverrides={nodeLabelOverrides}
            isCancelling={cancellingExecutionId === activeExecution.id}
            onCancel={(execution) => void handleCancelSelectedExecution(execution)}
          />
        </div>
      ) : null}
      {resultsTab === 'results' ? (
        <GenerationHistoryPanelView
          feed={resultsFeed}
          serviceType="comfyui"
          splitPaneScroll={isWideLayout}
          headerLeading={<span />}
          hideScopeActions
        />
      ) : (
        <div className={cn(isWideLayout && 'min-h-0 flex-1 overflow-y-auto pr-1')}>{runHistory}</div>
      )}
    </div>
  ) : (
    <div className={cn(isWideLayout && 'min-h-0 flex-1 overflow-y-auto pr-1')}>
      {browseContentQuery.isError ? (
        <ErrorState title={browseContentQuery.error instanceof Error ? browseContentQuery.error.message : t('module-graph.module.graph.page.failed.to.load.output.management.content')} />
      ) : browseContentQuery.data ? (
        <Suspense fallback={<WorkflowPageFallback />}>
          <ModuleWorkflowOutputManagementPanelLazy
            selectedFolderRecord={selectedFolderRecord}
            browseContent={browseContentQuery.data}
            onRefresh={() => browseContentQuery.refetch()}
            onClearFolder={() => setSelectedFolderId(null)}
          />
        </Suspense>
      ) : (
        <LoadingState variant="inline" label={t({ ko: '생성물을 불러오는 중…', en: 'Loading outputs…' })} />
      )}
    </div>
  )

  if (isWideLayout) {
    return (
      <>
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(360px,4fr)_minmax(0,6fr)] items-stretch gap-8">
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">{leftColumn}</div>
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">{rightColumn}</div>
        </div>
        {modals}
      </>
    )
  }

  const narrowResultLabel = selectedGraphId !== null ? t({ ko: '결과', en: 'Results' }) : t({ ko: '생성물', en: 'Outputs' })
  return (
    <div className="space-y-4">
      <SegmentedControl
        value={narrowView}
        items={[
          { value: 'edit', label: selectedGraphId !== null ? t({ ko: '편집', en: 'Edit' }) : t({ ko: '목록', en: 'List' }) },
          { value: 'result', label: narrowResultLabel },
        ]}
        onChange={(next) => setNarrowView(next as NarrowView)}
        size="sm"
        semantics="tabs"
        fullWidth
        ariaLabel={t({ ko: '편집 또는 결과', en: 'Edit or result' })}
      />
      {/* The runner stays mounted while the results show, so typed inputs survive the switch. */}
      <div className={cn('min-w-0', narrowView !== 'edit' && 'hidden')}>{leftColumn}</div>
      {narrowView === 'result' ? rightColumn : null}
      <div
        className={cn(
          'pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-[86] flex justify-end px-3',
          (narrowView !== 'edit' || selectedGraphId === null) && 'hidden',
        )}
      >
        <div id={WORKFLOW_STICKY_RUN_BAR_SLOT_ID} className="pointer-events-auto flex max-w-full justify-end" />
      </div>
      {modals}
    </div>
  )
}

export function ModuleWorkflowWorkspace({ isWideLayout }: ModuleWorkflowWorkspaceProps) {
  const { canViewWorkflows } = useFeaturePermissions()
  if (!canViewWorkflows) return <FeaturePermissionNotice permission="workflows.view" />
  return (
    <ReactFlowProvider>
      <ModuleWorkflowWorkspaceInner isWideLayout={isWideLayout} />
    </ReactFlowProvider>
  )
}
