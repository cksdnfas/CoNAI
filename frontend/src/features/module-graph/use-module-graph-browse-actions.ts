import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import {
  createGraphWorkflowFolder,
  deleteGraphWorkflow,
  deleteGraphWorkflowFolder,
  updateGraphWorkflow,
  updateGraphWorkflowFolder,
  type GraphWorkflowExposedInput,
  type GraphWorkflowFolderDeleteMode,
  type GraphWorkflowFolderRecord,
  type GraphWorkflowRecord,
  type ModuleDefinitionRecord,
} from '@/lib/api'
import { buildFlowFromGraphRecord, buildGraphEditorSnapshot, type ModuleGraphEdge, type ModuleGraphNode } from './module-graph-shared'
import { deriveWorkflowExposedInputsFromNodes } from './module-graph-workflow-inputs'
import type { EditorSupportSectionKey } from './components/module-workflow-editor-support-panel'
import { clearPersistedWorkflowRunnerDraft, loadPersistedWorkflowRunnerDraft } from './workflow-runner-draft-storage'

/** Own workflow/folder browse-management actions for the module-graph page. */
export function useModuleGraphBrowseActions({
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
}: {
  isDirty: boolean
  selectedFolderId: number | null
  selectedFolderRecord: GraphWorkflowFolderRecord | null
  selectedGraphRecord: GraphWorkflowRecord | null
  folderDeleteTarget: GraphWorkflowFolderRecord | null
  workflowView: 'browse' | 'edit'
  modules: ModuleDefinitionRecord[]
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
  confirmDiscardUnsavedChanges: () => boolean
  resetWorkflowDraft: () => void
  enterWorkflowEditor: (section?: EditorSupportSectionKey) => void
  showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void
}) {
  /** Apply one saved workflow record into the current editor state. */
  const applyGraphRecordToEditor = useCallback((graph: GraphWorkflowRecord) => {
    const { nodes: nextNodes, edges: nextEdges } = buildFlowFromGraphRecord(graph, modules)
    const exposedInputs = deriveWorkflowExposedInputsFromNodes(nextNodes)
    const defaultInputValues = buildWorkflowRunInputDefaults(exposedInputs)
    const persistedInputValues = loadPersistedWorkflowRunnerDraft(graph.id, exposedInputs)

    setNodes(nextNodes)
    setEdges(nextEdges)
    setSelectedGraphId(graph.id)
    setSelectedExecutionId(null)
    setSelectedEdgeId(null)
    setSelectedNodeId(nextNodes[0]?.id ?? null)
    setWorkflowName(graph.name)
    setWorkflowDescription(graph.description || '')
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
        },
      }),
    )
  }, [modules, setDraftWorkflowFolderId, setEdges, setLastSavedSnapshot, setNodes, setSelectedEdgeId, setSelectedExecutionId, setSelectedFolderId, setSelectedGraphId, setSelectedNodeId, setWorkflowDescription, setWorkflowExposedInputs, setWorkflowName, setWorkflowRunInputValues])

  /** Load one saved workflow into the editor, optionally opening editor mode immediately. */
  const handleLoadGraph = useCallback((graph: GraphWorkflowRecord, options?: { openEditor?: boolean; silent?: boolean }) => {
    if (!confirmDiscardUnsavedChanges()) {
      return false
    }

    applyGraphRecordToEditor(graph)
    if (options?.openEditor) {
      enterWorkflowEditor('setup')
    }
    if (!options?.silent) {
      showSnackbar({ message: '저장된 워크플로우를 불러왔어.', tone: 'info' })
    }

    return true
  }, [applyGraphRecordToEditor, confirmDiscardUnsavedChanges, enterWorkflowEditor, showSnackbar])

  /** Start one fresh workflow draft from the current folder context. */
  const handleCreateWorkflow = useCallback(() => {
    if (!confirmDiscardUnsavedChanges()) {
      return
    }

    resetWorkflowDraft()
    setDraftWorkflowFolderId(selectedFolderId)
    enterWorkflowEditor('setup')
    showSnackbar({ message: '새 워크플로우 초안을 열었어.', tone: 'info' })
  }, [confirmDiscardUnsavedChanges, enterWorkflowEditor, resetWorkflowDraft, selectedFolderId, setDraftWorkflowFolderId, showSnackbar])

  /** Create one workflow folder and optionally assign the selected workflow into it. */
  const handleCreateWorkflowFolder = useCallback(async (input?: { name?: string; description?: string; parent_id?: number | null; assignToWorkflow?: boolean }) => {
    const nextName = input?.name?.trim()
    if (!nextName) {
      showSnackbar({ message: '폴더 이름을 먼저 입력해줘.', tone: 'error' })
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

      showSnackbar({ message: `폴더 "${nextName}"을(를) 만들었어.`, tone: 'info' })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '폴더 생성에 실패했어.', tone: 'error' })
    }
  }, [refetchGraphWorkflowFolders, refetchGraphWorkflows, selectedFolderId, selectedGraphRecord, setDraftWorkflowFolderId, setSelectedFolderId, showSnackbar])

  /** Update one existing workflow folder. */
  const handleUpdateSelectedFolder = useCallback(async (folderId: number, input: { name?: string; description?: string | null; parent_id?: number | null }) => {
    try {
      await updateGraphWorkflowFolder(folderId, input)
      await refetchGraphWorkflowFolders()
      showSnackbar({ message: '폴더 설정을 저장했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '폴더 저장에 실패했어.', tone: 'error' })
    }
  }, [refetchGraphWorkflowFolders, showSnackbar])

  /** Open delete confirmation for one chosen folder. */
  const handleDeleteSelectedFolder = useCallback(async (folderId?: number) => {
    const targetFolder = folderId != null
      ? graphWorkflowFolders.find((folder) => folder.id === folderId) ?? null
      : selectedFolderRecord

    if (!targetFolder) {
      showSnackbar({ message: '먼저 폴더를 하나 선택해줘.', tone: 'error' })
      return
    }

    setIsBrowseManageModalOpen(false)
    setFolderDeleteTarget(targetFolder)
  }, [graphWorkflowFolders, selectedFolderRecord, setFolderDeleteTarget, setIsBrowseManageModalOpen, showSnackbar])

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
          ? '폴더와 내부 항목을 모두 삭제했어.'
          : '폴더만 삭제하고 내부 항목은 상위 폴더로 올렸어.',
        tone: 'info',
      })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '폴더 삭제에 실패했어.', tone: 'error' })
    }
  }, [folderDeleteTarget, refetchGraphWorkflowFolders, refetchGraphWorkflows, setFolderDeleteTarget, setSelectedFolderId, setSelectedGraphId, showSnackbar])

  /** Reassign the selected workflow into another folder or back to root. */
  const handleAssignSelectedWorkflowFolder = useCallback(async (folderId: number | null) => {
    if (!selectedGraphRecord) {
      showSnackbar({ message: '먼저 워크플로우를 하나 선택해줘.', tone: 'error' })
      return
    }

    try {
      await updateGraphWorkflow(selectedGraphRecord.id, { folder_id: folderId })
      setSelectedFolderId(folderId)
      await refetchGraphWorkflows()
      showSnackbar({ message: folderId === null ? '워크플로우를 Root에 할당했어.' : '워크플로우 폴더 할당을 바꿨어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '워크플로우 폴더 할당에 실패했어.', tone: 'error' })
    }
  }, [refetchGraphWorkflows, selectedGraphRecord, setSelectedFolderId, showSnackbar])

  /** Open the currently selected workflow inside editor mode. */
  const handleEditSelectedWorkflow = useCallback(() => {
    if (!selectedGraphRecord) {
      showSnackbar({ message: '먼저 워크플로우를 하나 선택해줘.', tone: 'error' })
      return
    }

    handleLoadGraph(selectedGraphRecord, { openEditor: true, silent: true })
  }, [handleLoadGraph, selectedGraphRecord, showSnackbar])

  /** Delete the selected workflow after confirmation and reset browse/editor state. */
  const handleDeleteSelectedWorkflow = useCallback(async () => {
    if (!selectedGraphRecord) {
      showSnackbar({ message: '먼저 워크플로우를 하나 선택해줘.', tone: 'error' })
      return
    }

    const confirmed = window.confirm(`워크플로우 "${selectedGraphRecord.name}"을(를) 삭제할까? 이 작업은 되돌릴 수 없어.`)
    if (!confirmed) {
      return
    }

    try {
      await deleteGraphWorkflow(selectedGraphRecord.id)
      clearPersistedWorkflowRunnerDraft(selectedGraphRecord.id)
      resetWorkflowDraft()
      setWorkflowView('browse')
      setIsEditorSupportOpen(false)
      await refetchGraphWorkflows()
      showSnackbar({ message: '워크플로우를 삭제했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '워크플로우 삭제에 실패했어.', tone: 'error' })
    }
  }, [refetchGraphWorkflows, resetWorkflowDraft, selectedGraphRecord, setIsEditorSupportOpen, setWorkflowView, showSnackbar])

  /** Leave editor mode, restoring the selected saved workflow when needed. */
  const handleLeaveWorkflowEditor = useCallback(() => {
    if (workflowView !== 'edit') {
      setWorkflowView('browse')
      setIsEditorSupportOpen(false)
      return
    }

    if (!confirmDiscardUnsavedChanges()) {
      return
    }

    if (selectedGraphRecord) {
      applyGraphRecordToEditor(selectedGraphRecord)
    } else {
      resetWorkflowDraft()
    }

    setWorkflowView('browse')
    setIsEditorSupportOpen(false)
    setActiveEditorSupportSection('setup')
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
