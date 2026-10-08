import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useI18n } from '@/i18n'
import { resolveAccountDraftOwner } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import type { Dispatch, SetStateAction } from 'react'
import {
  createGraphWorkflow,
  createGraphWorkflowFolder,
  deleteGraphWorkflow,
  deleteGraphWorkflowFolder,
  exportGraphWorkflow,
  getGraphWorkflow,
  importGraphWorkflow,
  updateGraphWorkflow,
  updateGraphWorkflowFolder,
  type GraphWorkflowExportPayload,
  type GraphWorkflowExposedInput,
  type GraphWorkflowFolderDeleteMode,
  type GraphWorkflowFolderRecord,
  type GraphWorkflowRecord,
  type GraphWorkflowSummaryRecord,
  type ModuleDefinitionRecord,
} from '@/lib/api-module-graph'
import { buildFlowFromGraphRecord, buildGraphEditorSnapshot, type ModuleGraphEdge, type ModuleGraphNode } from './module-graph-shared'
import { deriveWorkflowExposedInputsFromNodes } from './module-graph-workflow-inputs'
import type { EditorSupportSectionKey } from './module-graph-types'
import { clearPersistedWorkflowRunnerDraft, loadPersistedWorkflowRunnerDraft } from './workflow-runner-draft-storage'

/** Own workflow/folder browse-management actions for the module-graph page. */
export function useModuleGraphBrowseActions({
  selectedFolderId,
  selectedFolderRecord,
  selectedGraphRecord,
  folderDeleteTarget,
  workflowView,
  modules,
  graphWorkflows,
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
  setWorkflowDebugMode,
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
  refetchModules,
  confirmDiscardUnsavedChanges,
  resetWorkflowDraft,
  enterWorkflowEditor,
  showSnackbar,
}: {
  isDirty: boolean
  selectedFolderId: number | null
  selectedFolderRecord: GraphWorkflowFolderRecord | null
  selectedGraphRecord: GraphWorkflowRecord | null
  folderDeleteTarget: GraphWorkflowFolderRecord | null
  workflowView: 'browse' | 'edit'
  modules: ModuleDefinitionRecord[]
  graphWorkflows: GraphWorkflowSummaryRecord[]
  graphWorkflowFolders: GraphWorkflowFolderRecord[]
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
  setWorkflowDebugMode: Dispatch<SetStateAction<boolean>>
  setWorkflowExposedInputs: Dispatch<SetStateAction<GraphWorkflowExposedInput[]>>
  setWorkflowRunInputValues: Dispatch<SetStateAction<Record<string, unknown>>>
  setLastSavedSnapshot: Dispatch<SetStateAction<string>>
  setWorkflowView: Dispatch<SetStateAction<'browse' | 'edit'>>
  setIsEditorSupportOpen: Dispatch<SetStateAction<boolean>>
  setActiveEditorSupportSection: Dispatch<SetStateAction<EditorSupportSectionKey>>
  setIsBrowseManageModalOpen: Dispatch<SetStateAction<boolean>>
  setFolderDeleteTarget: Dispatch<SetStateAction<GraphWorkflowFolderRecord | null>>
  refetchGraphWorkflowFolders: () => Promise<unknown>
  refetchGraphWorkflows: () => Promise<unknown>
  refetchModules: () => Promise<unknown>
  confirmDiscardUnsavedChanges: () => Promise<boolean>
  resetWorkflowDraft: () => void
  enterWorkflowEditor: (section?: EditorSupportSectionKey) => void
  showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void
}) {
  const { t, formatNumber } = useI18n()
  const draftStorageOwner = resolveAccountDraftOwner(useAuthStatusQuery().data)
  const queryClient = useQueryClient()
  const confirm = useConfirm()

  /** Resolve the full record of a list row (or the selected workflow when no row is given). */
  const resolveTargetGraph = useCallback(async (target?: GraphWorkflowSummaryRecord | GraphWorkflowRecord | null): Promise<GraphWorkflowRecord | null> => {
    if (!target) {
      return selectedGraphRecord
    }
    if ('graph' in target) {
      return target
    }
    if (selectedGraphRecord?.id === target.id) {
      return selectedGraphRecord
    }
    try {
      return await queryClient.fetchQuery({
        queryKey: ['module-graph-workflow-detail', target.id],
        queryFn: () => getGraphWorkflow(target.id),
      })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '워크플로우를 불러오지 못했어.', en: 'Failed to load the workflow.' }), tone: 'error' })
      return null
    }
  }, [queryClient, selectedGraphRecord, showSnackbar, t])

  /** Apply one saved workflow record into the current editor state. */
  const applyGraphRecordToEditor = useCallback((graph: GraphWorkflowRecord) => {
    const { nodes: nextNodes, edges: nextEdges } = buildFlowFromGraphRecord(graph, modules)
    const exposedInputs = deriveWorkflowExposedInputsFromNodes(nextNodes)
    const defaultInputValues = buildWorkflowRunInputDefaults(exposedInputs)
    const persistedInputValues = loadPersistedWorkflowRunnerDraft(draftStorageOwner, graph.id, exposedInputs)

    setNodes(nextNodes)
    setEdges(nextEdges)
    setSelectedGraphId(graph.id)
    setSelectedExecutionId(null)
    setSelectedEdgeId(null)
    setSelectedNodeId(nextNodes[0]?.id ?? null)
    setWorkflowName(graph.name)
    setWorkflowDescription(graph.description || '')
    setWorkflowDebugMode(graph.graph.metadata?.debug_mode === true)
    setSelectedFolderId(graph.folder_id ?? null)
    setDraftWorkflowFolderId(graph.folder_id ?? null)
    setWorkflowExposedInputs(exposedInputs)
    setWorkflowRunInputValues({
      ...defaultInputValues,
      ...persistedInputValues,
    })
    setLastSavedSnapshot(
      buildGraphEditorSnapshot({
        name: graph.name,
        description: graph.description || '',
        nodes: nextNodes,
        edges: nextEdges,
        workflowMetadata: {
          exposed_inputs: exposedInputs,
          debug_mode: graph.graph.metadata?.debug_mode === true,
        },
      }),
    )
  }, [draftStorageOwner, modules, setDraftWorkflowFolderId, setEdges, setLastSavedSnapshot, setNodes, setSelectedEdgeId, setSelectedExecutionId, setSelectedFolderId, setSelectedGraphId, setSelectedNodeId, setWorkflowDebugMode, setWorkflowDescription, setWorkflowExposedInputs, setWorkflowName, setWorkflowRunInputValues])

  /**
   * Load one saved workflow into the editor, optionally opening editor mode immediately.
   *
   * WF-1: 탐색기 목록 항목에는 그래프 문서가 없다. 요약만 넘어오면 여기서 by-id 로 전체 그래프를
   * 받아 편집기에 반영한다(이미 전체 레코드를 들고 있는 호출자는 추가 요청 없이 그대로 쓴다).
   */
  const handleLoadGraph = useCallback(async (
    graph: GraphWorkflowSummaryRecord | GraphWorkflowRecord,
    options?: { openEditor?: boolean; silent?: boolean },
  ) => {
    if (!(await confirmDiscardUnsavedChanges())) {
      return false
    }

    let fullGraph: GraphWorkflowRecord
    if ('graph' in graph) {
      fullGraph = graph
    } else {
      try {
        // 선택 상세 쿼리와 같은 키로 받아 두면 선택 직후의 by-id 재조회가 캐시에 흡수된다.
        fullGraph = await queryClient.fetchQuery({
          queryKey: ['module-graph-workflow-detail', graph.id],
          queryFn: () => getGraphWorkflow(graph.id),
        })
      } catch (error) {
        showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '워크플로우를 불러오지 못했어.', en: 'Failed to load the workflow.' }), tone: 'error' })
        return false
      }
    }

    applyGraphRecordToEditor(fullGraph)
    if (options?.openEditor) {
      enterWorkflowEditor('setup')
    }
    if (!options?.silent) {
      showSnackbar({ message: t({ ko: '저장된 워크플로우를 불러왔어.', en: 'Loaded the saved workflow.' }), tone: 'info' })
    }

    return true
  }, [applyGraphRecordToEditor, confirmDiscardUnsavedChanges, enterWorkflowEditor, queryClient, showSnackbar, t])

  /** Start one fresh workflow draft from the current folder context. */
  const handleCreateWorkflow = useCallback(async () => {
    if (!(await confirmDiscardUnsavedChanges())) {
      return
    }

    resetWorkflowDraft()
    setDraftWorkflowFolderId(selectedFolderId)
    enterWorkflowEditor('setup')
    showSnackbar({ message: t({ ko: '새 워크플로우 초안을 열었어.', en: 'Opened a new workflow draft.' }), tone: 'info' })
  }, [confirmDiscardUnsavedChanges, enterWorkflowEditor, resetWorkflowDraft, selectedFolderId, setDraftWorkflowFolderId, showSnackbar, t])

  /** Create one workflow folder and optionally assign the selected workflow into it. */
  const handleCreateWorkflowFolder = useCallback(async (input?: { name?: string; description?: string; parent_id?: number | null; assignToWorkflow?: boolean }) => {
    const nextName = input?.name?.trim()
    if (!nextName) {
      showSnackbar({ message: t({ ko: '폴더 이름을 먼저 입력해줘.', en: 'Enter a folder name first.' }), tone: 'error' })
      return
    }

    try {
      const resolvedParentId = input && Object.prototype.hasOwnProperty.call(input, 'parent_id')
        ? (input.parent_id ?? null)
        : selectedFolderId

      const result = await createGraphWorkflowFolder({
        name: nextName,
        description: input?.description?.trim() || undefined,
        parent_id: resolvedParentId,
      })
      await refetchGraphWorkflowFolders()
      setSelectedFolderId(result.id)
      setDraftWorkflowFolderId(result.id)

      if (input?.assignToWorkflow && selectedGraphRecord) {
        await updateGraphWorkflow(selectedGraphRecord.id, { folder_id: result.id })
        await refetchGraphWorkflows()
      }

      showSnackbar({ message: t({ ko: '폴더 "{name}"을(를) 만들었어.', en: 'Created folder "{name}".' }, { name: nextName }), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '폴더 생성에 실패했어.', en: 'Failed to create the folder.' }), tone: 'error' })
    }
  }, [refetchGraphWorkflowFolders, refetchGraphWorkflows, selectedFolderId, selectedGraphRecord, setDraftWorkflowFolderId, setSelectedFolderId, showSnackbar, t])

  /** Update one existing workflow folder. */
  const handleUpdateSelectedFolder = useCallback(async (folderId: number, input: { name?: string; description?: string | null; parent_id?: number | null }) => {
    try {
      await updateGraphWorkflowFolder(folderId, input)
      await refetchGraphWorkflowFolders()
      showSnackbar({ message: t({ ko: '폴더 설정을 저장했어.', en: 'Saved folder settings.' }), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '폴더 저장에 실패했어.', en: 'Failed to save the folder.' }), tone: 'error' })
    }
  }, [refetchGraphWorkflowFolders, showSnackbar, t])

  /** Open delete confirmation for one chosen folder. */
  const handleDeleteSelectedFolder = useCallback(async (folderId?: number) => {
    const targetFolder = folderId != null
      ? graphWorkflowFolders.find((folder) => folder.id === folderId) ?? null
      : selectedFolderRecord

    if (!targetFolder) {
      showSnackbar({ message: t({ ko: '먼저 폴더를 하나 선택해줘.', en: 'Select a folder first.' }), tone: 'error' })
      return
    }

    setIsBrowseManageModalOpen(false)
    setFolderDeleteTarget(targetFolder)
  }, [graphWorkflowFolders, selectedFolderRecord, setFolderDeleteTarget, setIsBrowseManageModalOpen, showSnackbar, t])

  /** Confirm one folder deletion mode and refresh browse data afterwards. */
  const handleConfirmDeleteFolder = useCallback(async (mode: GraphWorkflowFolderDeleteMode) => {
    if (!folderDeleteTarget) {
      return
    }

    try {
      await deleteGraphWorkflowFolder(folderDeleteTarget.id, mode)
      setSelectedFolderId(folderDeleteTarget.parent_id ?? null)
      setSelectedGraphId(null)
      setFolderDeleteTarget(null)
      await Promise.all([refetchGraphWorkflowFolders(), refetchGraphWorkflows()])
      showSnackbar({
        message: mode === 'delete_tree'
          ? t({ ko: '폴더와 내부 항목을 모두 삭제했어.', en: 'Deleted the folder and everything inside it.' })
          : t({ ko: '폴더만 삭제하고 내부 항목은 상위 폴더로 올렸어.', en: 'Deleted the folder and moved its contents up to the parent folder.' }),
        tone: 'info',
      })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '폴더 삭제에 실패했어.', en: 'Failed to delete the folder.' }), tone: 'error' })
    }
  }, [folderDeleteTarget, refetchGraphWorkflowFolders, refetchGraphWorkflows, setFolderDeleteTarget, setSelectedFolderId, setSelectedGraphId, showSnackbar, t])

  /** Reassign the selected workflow into another folder or back to root. */
  const handleAssignSelectedWorkflowFolder = useCallback(async (folderId: number | null) => {
    if (!selectedGraphRecord) {
      showSnackbar({ message: t({ ko: '먼저 워크플로우를 하나 선택해줘.', en: 'Select a workflow first.' }), tone: 'error' })
      return
    }

    try {
      await updateGraphWorkflow(selectedGraphRecord.id, { folder_id: folderId })
      setSelectedFolderId(folderId)
      await refetchGraphWorkflows()
      showSnackbar({ message: folderId === null ? t({ ko: '워크플로우를 Root에 할당했어.', en: 'Moved the workflow to Root.' }) : t({ ko: '워크플로우 폴더 할당을 바꿨어.', en: 'Changed the workflow folder.' }), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '워크플로우 폴더 할당에 실패했어.', en: 'Failed to change the workflow folder.' }), tone: 'error' })
    }
  }, [refetchGraphWorkflows, selectedGraphRecord, setSelectedFolderId, showSnackbar, t])

  /** Open the currently selected workflow inside editor mode. */
  const handleEditSelectedWorkflow = useCallback((target?: GraphWorkflowSummaryRecord | GraphWorkflowRecord) => {
    const graph = target ?? selectedGraphRecord
    if (!graph) {
      showSnackbar({ message: t({ ko: '먼저 워크플로우를 하나 선택해줘.', en: 'Select a workflow first.' }), tone: 'error' })
      return
    }

    void handleLoadGraph(graph, { openEditor: true, silent: true })
  }, [handleLoadGraph, selectedGraphRecord, showSnackbar, t])

  /** Duplicate the selected saved workflow while preserving its folder and graph document. */
  const handleDuplicateSelectedWorkflow = useCallback(async (target?: GraphWorkflowSummaryRecord) => {
    const sourceGraph = await resolveTargetGraph(target)
    if (!sourceGraph) {
      if (!target) showSnackbar({ message: t({ ko: '먼저 워크플로우를 하나 선택해줘.', en: 'Select a workflow first.' }), tone: 'error' })
      return
    }

    const currentNames = new Set(graphWorkflows.map((workflow) => workflow.name))
    const baseName = t({ ko: '{name} 복사본', en: '{name} copy' }, { name: sourceGraph.name })
    let nextName = baseName
    let suffix = 2
    while (currentNames.has(nextName)) {
      nextName = `${baseName} ${suffix}`
      suffix += 1
    }

    try {
      const result = await createGraphWorkflow({
        name: nextName,
        description: sourceGraph.description || undefined,
        graph: JSON.parse(JSON.stringify(sourceGraph.graph)) as GraphWorkflowRecord['graph'],
        folder_id: sourceGraph.folder_id ?? null,
        version: sourceGraph.version,
        is_active: sourceGraph.is_active,
      })
      await refetchGraphWorkflows()
      setSelectedGraphId(result.id)
      setSelectedExecutionId(null)
      setWorkflowView('browse')
      showSnackbar({ message: t({ ko: '워크플로우를 복제했어.', en: 'Duplicated the workflow.' }), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '워크플로우 복제에 실패했어.', en: 'Failed to duplicate the workflow.' }), tone: 'error' })
    }
  }, [graphWorkflows, refetchGraphWorkflows, resolveTargetGraph, setSelectedExecutionId, setSelectedGraphId, setWorkflowView, showSnackbar, t])

  /** Download the selected saved workflow as a portable JSON export. */
  const handleExportSelectedWorkflow = useCallback(async (target?: GraphWorkflowSummaryRecord) => {
    const exportTarget = target ?? selectedGraphRecord
    if (!exportTarget) {
      showSnackbar({ message: t({ ko: '먼저 워크플로우를 하나 선택해줘.', en: 'Select a workflow first.' }), tone: 'error' })
      return
    }

    try {
      const exportPayload = await exportGraphWorkflow(exportTarget.id)
      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      const safeName = exportTarget.name
        .trim()
        .replace(/[^a-zA-Z0-9가-힣_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        || `workflow-${exportTarget.id}`
      link.href = url
      link.download = `${safeName}.conai-workflow.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      showSnackbar({ message: t({ ko: '워크플로우 내보내기 파일을 만들었어.', en: 'Created the workflow export file.' }), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '워크플로우 내보내기에 실패했어.', en: 'Failed to export the workflow.' }), tone: 'error' })
    }
  }, [selectedGraphRecord, showSnackbar, t])

  /** Import one workflow export file, creating placeholder modules when definitions are missing. */
  const handleImportWorkflowFile = useCallback(async (file: File) => {
    try {
      const text = await file.text()
      const payload = JSON.parse(text) as GraphWorkflowExportPayload
      const result = await importGraphWorkflow({
        payload,
        folder_id: selectedFolderId,
      })

      await Promise.all([refetchModules(), refetchGraphWorkflows()])
      setSelectedGraphId(result.id)
      setSelectedExecutionId(null)
      setWorkflowView('browse')
      showSnackbar({
        message: result.placeholder_module_count > 0
          ? t({ ko: '워크플로우를 가져왔어. 없는 모듈 {count}개는 빈 노드로 만들었어.', en: 'Imported the workflow. {count} missing modules became placeholder nodes.' }, { count: formatNumber(result.placeholder_module_count) })
          : t({ ko: '워크플로우를 가져왔어.', en: 'Imported the workflow.' }),
        tone: 'info',
      })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '워크플로우 가져오기에 실패했어.', en: 'Failed to import the workflow.' }), tone: 'error' })
    }
  }, [formatNumber, refetchGraphWorkflows, refetchModules, selectedFolderId, setSelectedExecutionId, setSelectedGraphId, setWorkflowView, showSnackbar, t])

  /** Delete the selected workflow after confirmation and reset browse/editor state. */
  const handleDeleteSelectedWorkflow = useCallback(async (target?: GraphWorkflowSummaryRecord) => {
    const deleteTarget = target ?? selectedGraphRecord
    if (!deleteTarget) {
      showSnackbar({ message: t({ ko: '먼저 워크플로우를 하나 선택해줘.', en: 'Select a workflow first.' }), tone: 'error' })
      return
    }
    const isOpenWorkflow = selectedGraphRecord?.id === deleteTarget.id

    const confirmed = await confirm({
      title: t({ ko: '워크플로우 삭제', en: 'Delete workflow' }),
      description: t(
        { ko: '워크플로우 "{name}"을(를) 삭제할까? 이 작업은 되돌릴 수 없어.', en: 'Delete the workflow "{name}"? This cannot be undone.' },
        { name: deleteTarget.name },
      ),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (!confirmed) {
      return
    }

    try {
      const result = await deleteGraphWorkflow(deleteTarget.id)
      clearPersistedWorkflowRunnerDraft(draftStorageOwner, deleteTarget.id)
      if (isOpenWorkflow) {
        resetWorkflowDraft()
        setWorkflowView('browse')
        setIsEditorSupportOpen(false)
      }
      await refetchGraphWorkflows()
      const deletedScheduleCount = result.schedule_maintenance?.deletedScheduleCount ?? 0
      const cancelledQueuedCount = result.schedule_maintenance?.cancelled ?? 0
      const runningCancelRequestCount = result.schedule_maintenance?.runningCancellationRequested ?? 0
      showSnackbar({
        message: deletedScheduleCount > 0 || cancelledQueuedCount > 0 || runningCancelRequestCount > 0
          ? (runningCancelRequestCount > 0
            ? t({ ko: '워크플로우를 삭제했고, 연결된 자동 실행 {schedules}개와 예약 {queued}개를 정리했어. 실행 중 {running}개에는 취소 요청도 넣었어.', en: 'Deleted the workflow, removed {schedules} linked autoruns and {queued} queued runs, and requested cancel for {running} running runs.' }, { schedules: formatNumber(deletedScheduleCount), queued: formatNumber(cancelledQueuedCount), running: formatNumber(runningCancelRequestCount) })
            : t({ ko: '워크플로우를 삭제했고, 연결된 자동 실행 {schedules}개와 예약 {queued}개를 정리했어.', en: 'Deleted the workflow and removed {schedules} linked autoruns and {queued} queued runs.' }, { schedules: formatNumber(deletedScheduleCount), queued: formatNumber(cancelledQueuedCount) }))
          : t({ ko: '워크플로우를 삭제했어.', en: 'Deleted the workflow.' }),
        tone: 'info',
      })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '워크플로우 삭제에 실패했어.', en: 'Failed to delete the workflow.' }), tone: 'error' })
    }
  }, [confirm, draftStorageOwner, formatNumber, refetchGraphWorkflows, resetWorkflowDraft, selectedGraphRecord, setIsEditorSupportOpen, setWorkflowView, showSnackbar, t])

  /** Leave editor mode, restoring the selected saved workflow when needed. */
  const handleLeaveWorkflowEditor = useCallback(async () => {
    if (workflowView !== 'edit') {
      setWorkflowView('browse')
      setIsEditorSupportOpen(false)
      return true
    }

    if (!(await confirmDiscardUnsavedChanges())) {
      return false
    }

    if (selectedGraphRecord) {
      applyGraphRecordToEditor(selectedGraphRecord)
    } else {
      resetWorkflowDraft()
    }

    setWorkflowView('browse')
    setIsEditorSupportOpen(false)
    setActiveEditorSupportSection('setup')
    return true
  }, [applyGraphRecordToEditor, confirmDiscardUnsavedChanges, resetWorkflowDraft, selectedGraphRecord, setActiveEditorSupportSection, setIsEditorSupportOpen, setWorkflowView, workflowView])

  /** Refresh browse data sources and selected execution list when available. */
  const handleRefreshWorkspace = useCallback(async (refetchGraphExecutions?: () => Promise<unknown>) => {
    return Promise.all([
      refetchGraphWorkflowFolders(),
      refetchGraphWorkflows(),
      ...(typeof refetchGraphExecutions === 'function' ? [refetchGraphExecutions()] : []),
    ])
  }, [refetchGraphWorkflowFolders, refetchGraphWorkflows])

  return {
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
    handleRefreshWorkspace,
  }
}

/** Build runtime input defaults from one saved exposed-input definition list. */
function buildWorkflowRunInputDefaults(exposedInputs: GraphWorkflowExposedInput[]) {
  return exposedInputs.reduce<Record<string, unknown>>((acc, inputDefinition) => {
    if (inputDefinition.default_value !== undefined) {
      acc[inputDefinition.id] = inputDefinition.default_value
    }
    return acc
  }, {})
}
