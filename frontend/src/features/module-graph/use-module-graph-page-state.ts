import { useEffect, useState } from 'react'
import { useEdgesState, useNodesState } from '@xyflow/react'
import type { GraphWorkflowExposedInput, GraphWorkflowFolderRecord } from '@/lib/api'
import type { EditorSupportSectionKey } from './components/module-workflow-editor-support-panel'
import { buildGraphEditorSnapshot, type ModuleGraphEdge, type ModuleGraphNode } from './module-graph-shared'
import { persistWorkflowRunnerDraft } from './workflow-runner-draft-storage'

/** Own local page state for the module-graph workspace screen. */
export function useModuleGraphPageState() {
  const [workflowName, setWorkflowName] = useState('Workflow Draft')
  const [workflowDescription, setWorkflowDescription] = useState('')
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null)
  const [draftWorkflowFolderId, setDraftWorkflowFolderId] = useState<number | null>(null)
  const [draftChildFolderName, setDraftChildFolderName] = useState('')
  const [draftChildFolderDescription, setDraftChildFolderDescription] = useState('')
  const [selectedGraphId, setSelectedGraphId] = useState<number | null>(null)
  const [selectedExecutionId, setSelectedExecutionId] = useState<number | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [selectedValidationPortKey, setSelectedValidationPortKey] = useState<string | null>(null)
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState(() =>
    buildGraphEditorSnapshot({
      name: 'Workflow Draft',
      description: '',
      nodes: [],
      edges: [],
      workflowMetadata: {
        exposed_inputs: [],
      },
    }),
  )
  const [workflowView, setWorkflowView] = useState<'browse' | 'edit'>('browse')
  const [isModuleLibraryOpen, setIsModuleLibraryOpen] = useState(false)
  const [isCustomNodeManagerOpen, setIsCustomNodeManagerOpen] = useState(false)
  const [isBrowseManageModalOpen, setIsBrowseManageModalOpen] = useState(false)
  const [folderDeleteTarget, setFolderDeleteTarget] = useState<GraphWorkflowFolderRecord | null>(null)
  const [isEditorSupportOpen, setIsEditorSupportOpen] = useState(false)
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
    if (selectedGraphId === null) {
      return
    }

    const timeout = window.setTimeout(() => {
      persistWorkflowRunnerDraft(selectedGraphId, workflowExposedInputs, workflowRunInputValues)
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [selectedGraphId, workflowExposedInputs, workflowRunInputValues])

  return {
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
  }
}
