import { useCallback, useEffect, useState } from 'react'
import { useEdgesState, useNodesState } from '@xyflow/react'
import type { GraphWorkflowExposedInput, GraphWorkflowFolderRecord } from '@/lib/api-module-graph'
import { createRandomUuid } from '@/lib/random-uuid'
import type { EditorSupportSectionKey } from './module-graph-types'
import { buildGraphEditorSnapshot, type ModuleGraphEdge, type ModuleGraphNode } from './module-graph-shared'
import { persistWorkflowRunnerDraft } from './workflow-runner-draft-storage'
import { resolveAccountDraftOwner } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'

/** Own local page state for the module-graph workspace screen. */
export function useModuleGraphPageState() {
  const draftStorageOwner = resolveAccountDraftOwner(useAuthStatusQuery().data)
  const [workflowName, setWorkflowName] = useState('Workflow Draft')
  const [workflowDescription, setWorkflowDescription] = useState('')
  const [workflowDebugMode, setWorkflowDebugMode] = useState(false)
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null)
  const [draftWorkflowFolderId, setDraftWorkflowFolderId] = useState<number | null>(null)
  const [draftChildFolderName, setDraftChildFolderName] = useState('')
  const [draftChildFolderDescription, setDraftChildFolderDescription] = useState('')
  const [selectedGraphId, setSelectedGraphId] = useState<number | null>(null)
  const [selectedExecutionId, setSelectedExecutionId] = useState<number | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [selectedValidationPortKey, setSelectedValidationPortKey] = useState<string | null>(null)
  const [editorSessionId, setEditorSessionId] = useState(() => createRandomUuid())
  const [lastSavedSnapshot, storeLastSavedSnapshot] = useState(() =>
    buildGraphEditorSnapshot({
      name: 'Workflow Draft',
      description: '',
      nodes: [],
      edges: [],
      workflowMetadata: {
        exposed_inputs: [],
        debug_mode: false,
      },
    }),
  )
  // Load, reset, creation and save invalidate earlier chat proposals, even if their graph text is identical.
  const setLastSavedSnapshot = useCallback<typeof storeLastSavedSnapshot>((next) => {
    storeLastSavedSnapshot(next)
    setEditorSessionId(createRandomUuid())
  }, [])
  // Bumped when another workflow or a fresh draft replaces the editor graph: undo history starts over.
  const [historyEpoch, setHistoryEpoch] = useState(0)
  const bumpHistoryEpoch = useCallback(() => setHistoryEpoch((value) => value + 1), [])
  const [workflowView, setWorkflowView] = useState<'browse' | 'edit'>('browse')
  const [isCustomNodeManagerOpen, setIsCustomNodeManagerOpen] = useState(false)
  const [isBrowseManageModalOpen, setIsBrowseManageModalOpen] = useState(false)
  const [folderDeleteTarget, setFolderDeleteTarget] = useState<GraphWorkflowFolderRecord | null>(null)
  const [isEditorSupportOpen, setIsEditorSupportOpen] = useState(false)
  const [isWorkflowSaveModalOpen, setIsWorkflowSaveModalOpen] = useState(false)
  const [activeEditorSupportSection, setActiveEditorSupportSection] = useState<EditorSupportSectionKey>('setup')
  const [workflowExposedInputs, setWorkflowExposedInputs] = useState<GraphWorkflowExposedInput[]>([])
  const [workflowRunInputValues, setWorkflowRunInputValues] = useState<Record<string, unknown>>({})
  const [nodes, setNodes, onNodesChange] = useNodesState<ModuleGraphNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<ModuleGraphEdge>([])

  useEffect(() => {
    if (selectedGraphId === null) {
      setDraftWorkflowFolderId(selectedFolderId)
    }
  }, [selectedFolderId, selectedGraphId])

  useEffect(() => {
    if (workflowView !== 'edit') {
      setIsWorkflowSaveModalOpen(false)
    }
  }, [workflowView])

  useEffect(() => {
    if (selectedGraphId === null) {
      return
    }

    const timeout = window.setTimeout(() => {
      persistWorkflowRunnerDraft(draftStorageOwner, selectedGraphId, workflowExposedInputs, workflowRunInputValues)
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [draftStorageOwner, selectedGraphId, workflowExposedInputs, workflowRunInputValues])

  return {
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
    historyEpoch,
    bumpHistoryEpoch,
    workflowView,
    setWorkflowView,
    isCustomNodeManagerOpen,
    setIsCustomNodeManagerOpen,
    isBrowseManageModalOpen,
    setIsBrowseManageModalOpen,
    folderDeleteTarget,
    setFolderDeleteTarget,
    isEditorSupportOpen,
    setIsEditorSupportOpen,
    isWorkflowSaveModalOpen,
    setIsWorkflowSaveModalOpen,
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
  }
}
