import type { Edge, Node } from '@xyflow/react'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import type {
  ModuleDefinitionRecord,
  ModulePortDataType,
} from '@/lib/api-module-graph'

export type NodeArtifactGroupPreview = {
  portKey: string
  portLabel: string
  portType: ModulePortDataType | null
  artifactCount: number
  latestArtifactLabel: string | null
  latestArtifactPreviewUrl: string | null
  latestArtifactTextPreview: string | null
  latestArtifactTextValue: string | null
}

export type ModuleGraphNodeData = {
  module: ModuleDefinitionRecord
  label?: string
  disabled?: boolean
  inputValues: Record<string, unknown>
  plannedExecutionOrder?: number | null
  activationHint?: 'conditional-input' | null
  executionStatus?: 'idle' | 'completed' | 'failed' | 'blocked'
  executionArtifactCount?: number
  executionReuseState?: 'reused' | null
  latestArtifactLabel?: string | null
  latestArtifactPreviewUrl?: string | null
  latestArtifactTextPreview?: string | null
  latestArtifactTextValue?: string | null
  executionOutputGroups?: NodeArtifactGroupPreview[]
  executeNodeDisabled?: boolean
  onExecuteNode?: () => void
  onForceExecuteNode?: () => void
  onDisconnectNodeInput?: (nodeId: string, portKey: string) => void
  onNodeValueChange?: (nodeId: string, portKey: string, value: unknown) => void
  onNodeValueClear?: (nodeId: string, portKey: string) => void
  onNodeLabelChange?: (nodeId: string, label: string) => void
  onNodeImageChange?: (nodeId: string, portKey: string, image?: SelectedImageDraft) => Promise<void> | void
  connectedInputKeys?: string[]
  connectedOutputKeys?: string[]
}

export type ModuleGraphNode = Node<ModuleGraphNodeData, 'module'>
export type ModuleGraphEdge = Edge

export type ModuleGraphClipboardNode = {
  id: string
  moduleId: number
  position: { x: number; y: number }
  label?: string
  disabled?: boolean
  inputValues: Record<string, unknown>
}

export type ModuleGraphClipboardEdge = {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

export type ModuleGraphClipboardPayload = {
  kind: 'conai/module-graph-selection'
  version: 1
  nodes: ModuleGraphClipboardNode[]
  edges: ModuleGraphClipboardEdge[]
}
