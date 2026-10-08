import { Suspense, lazy, useMemo } from 'react'
import type { Connection, OnEdgesChange, OnNodesChange } from '@xyflow/react'
import type { GraphWorkflowFolderRecord, GraphWorkflowRecord, ModuleDefinitionRecord } from '@/lib/api-module-graph'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import { ModuleGraphWorkflowSaveModal } from './components/module-graph-workflow-save-modal'
import { ModuleGraphWorkflowSetupFolderPanel } from './components/module-graph-workflow-setup-folder-panel'
import type { ModuleGraphEdge, ModuleGraphNode } from './module-graph-shared'

const ModuleGraphCanvasLazy = lazy(async () => {
  const module = await import('./components/module-graph-canvas')
  return { default: module.ModuleGraphCanvas }
})

function GraphCanvasFallback() {
  return <div className="h-full min-h-[20rem] animate-pulse bg-fill" />
}

/** Build the node editor's canvas and its first-save modal. */
export function useModuleGraphPageEditorPanels({
  workflowView,
  modules,
  graphWorkflowFolders,
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
  fitViewKey,
  quickCreateRequest,
  onOpenModuleLibrary,
  onCloseWorkflowSaveModal,
  onNodesChange,
  onEdgesChange,
  onDraftWorkflowFolderIdChange,
  onDraftChildFolderNameChange,
  onDraftChildFolderDescriptionChange,
  onCreateWorkflowFolder,
  onDuplicateNodeById,
  onDisconnectNodeInput,
  onDisconnectAllNodeConnections,
  onToggleNodeDisabled,
  onRemoveNodeById,
  onWorkflowNameChange,
  onWorkflowDescriptionChange,
  onWorkflowDebugModeChange,
  onSaveGraph,
  onNodeLabelChange,
  onNodeValueChange,
  onNodeValueClear,
  onNodeImageChange,
  onExecuteNodeById,
  onNodeSelect,
  onEdgeSelect,
  onPaneSelect,
  onSelectionChange,
  onConnect,
  onAddModuleNode,
  onCopySelection,
  onPasteSelection,
  isValidConnection,
}: {
  workflowView: 'browse' | 'edit'
  modules: ModuleDefinitionRecord[]
  graphWorkflowFolders: GraphWorkflowFolderRecord[]
  draftWorkflowFolderId: number | null
  draftChildFolderName: string
  draftChildFolderDescription: string
  selectedGraphRecord: GraphWorkflowRecord | null
  executingGraphId: number | null
  nodes: ModuleGraphNode[]
  edges: ModuleGraphEdge[]
  workflowName: string
  workflowDescription: string
  workflowDebugMode: boolean
  isDirty: boolean
  isSavingGraph: boolean
  reactFlowColorMode: 'light' | 'dark' | 'system'
  isWorkflowSaveModalOpen: boolean
  fitViewKey: string | number | null
  quickCreateRequest: number
  onOpenModuleLibrary: () => void
  onCloseWorkflowSaveModal: () => void
  onNodesChange: OnNodesChange<ModuleGraphNode>
  onEdgesChange: OnEdgesChange<ModuleGraphEdge>
  onDraftWorkflowFolderIdChange: (folderId: number | null) => void
  onDraftChildFolderNameChange: (value: string) => void
  onDraftChildFolderDescriptionChange: (value: string) => void
  onCreateWorkflowFolder: (input: { name: string; description?: string; parent_id?: number | null }) => Promise<unknown>
  onDuplicateNodeById: (nodeId: string) => void
  onDisconnectNodeInput: (nodeId: string, portKey: string) => void
  onDisconnectAllNodeConnections: (nodeId: string) => void
  onToggleNodeDisabled: (nodeId: string) => void
  onRemoveNodeById: (nodeId: string) => void
  onWorkflowNameChange: (value: string) => void
  onWorkflowDescriptionChange: (value: string) => void
  onWorkflowDebugModeChange: (value: boolean) => void
  onSaveGraph: () => Promise<boolean>
  onNodeLabelChange: (nodeId: string, label: string) => void
  onNodeValueChange: (nodeId: string, portKey: string, value: unknown) => void
  onNodeValueClear: (nodeId: string, portKey: string) => void
  onNodeImageChange: (nodeId: string, portKey: string, image?: SelectedImageDraft) => void
  onExecuteNodeById: (nodeId: string, force: boolean) => void
  onNodeSelect: (nodeId: string) => void
  onEdgeSelect: (edgeId: string) => void
  onPaneSelect: () => void
  onSelectionChange: (selection: { nodes: ModuleGraphNode[]; edges: ModuleGraphEdge[] }) => void
  onConnect: (connection: Connection) => void
  onAddModuleNode: (module: ModuleDefinitionRecord, options?: { position?: { x: number; y: number }; connectionStart?: { nodeId: string; handleId: string; handleType: 'source' | 'target' } }) => void
  onCopySelection: () => Promise<boolean>
  onPasteSelection: (options?: { position?: { x: number; y: number } }) => Promise<boolean>
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
          onDisconnectNodeInput,
          onNodeLabelChange,
          onNodeValueChange,
          onNodeValueClear,
          onNodeImageChange,
        },
      })),
    [executingGraphId, nodes, onDisconnectNodeInput, onExecuteNodeById, onNodeImageChange, onNodeLabelChange, onNodeValueChange, onNodeValueClear],
  )

  const workflowSaveModal = workflowView === 'edit' ? (
    <ModuleGraphWorkflowSaveModal
      open={isWorkflowSaveModalOpen}
      workflowName={workflowName}
      workflowDescription={workflowDescription}
      workflowDebugMode={workflowDebugMode}
      selectedGraphName={selectedGraphRecord?.name ?? null}
      selectedGraphVersion={selectedGraphRecord?.version ?? null}
      isDirty={isDirty}
      isSavingGraph={isSavingGraph}
      hasNodes={nodes.length > 0}
      folderPanel={(
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
      )}
      onClose={onCloseWorkflowSaveModal}
      onWorkflowNameChange={onWorkflowNameChange}
      onWorkflowDescriptionChange={onWorkflowDescriptionChange}
      onWorkflowDebugModeChange={onWorkflowDebugModeChange}
      onSave={onSaveGraph}
    />
  ) : null

  const graphCanvas = workflowView === 'edit' ? (
    <Suspense fallback={<GraphCanvasFallback />}>
      <ModuleGraphCanvasLazy
        nodes={graphCanvasNodes}
        edges={edges}
        modules={modules}
        reactFlowColorMode={reactFlowColorMode}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeSelect={onNodeSelect}
        onEdgeSelect={onEdgeSelect}
        onPaneSelect={onPaneSelect}
        onSelectionChange={onSelectionChange}
        onConnect={onConnect}
        onAddModuleNode={onAddModuleNode}
        onCopySelection={onCopySelection}
        onPasteSelection={onPasteSelection}
        onDuplicateNodeById={onDuplicateNodeById}
        onDisconnectAllNodeConnections={onDisconnectAllNodeConnections}
        onToggleNodeDisabled={onToggleNodeDisabled}
        onRemoveNodeById={onRemoveNodeById}
        isValidConnection={isValidConnection}
        fitViewKey={fitViewKey}
        quickCreateRequest={quickCreateRequest}
        onOpenModuleLibrary={onOpenModuleLibrary}
      />
    </Suspense>
  ) : null

  return {
    workflowSaveModal,
    graphCanvas,
  }
}
