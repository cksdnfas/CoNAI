import type { Edge, Node } from '@xyflow/react'
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

export type ModuleGraphConditionalOutputState = 'active' | 'inactive'
export type ModuleGraphExecutionStatus = 'idle' | 'running' | 'completed' | 'failed' | 'blocked' | 'skipped'
export type ModuleGraphExecutionSkipReason = 'disabled' | 'inactive-branch' | 'source-node-skipped' | 'source-output-disabled' | 'unknown'

export type ModuleGraphNodeData = {
  module: ModuleDefinitionRecord
  label?: string
  disabled?: boolean
  inputValues: Record<string, unknown>
  plannedExecutionOrder?: number | null
  activationHint?: 'conditional-input' | null
  executionStatus?: ModuleGraphExecutionStatus
  executionSkipReason?: ModuleGraphExecutionSkipReason | null
  executionArtifactCount?: number
  executionReuseState?: 'reused' | null
  conditionalOutputStates?: Record<string, ModuleGraphConditionalOutputState> | null
  latestArtifactLabel?: string | null
  latestArtifactPreviewUrl?: string | null
  latestArtifactTextPreview?: string | null
  latestArtifactTextValue?: string | null
  executionOutputGroups?: NodeArtifactGroupPreview[]
  connectedInputKeys?: string[]
  connectedOutputKeys?: string[]
}

export type ModuleGraphNode = Node<ModuleGraphNodeData, 'module'>
export type ModuleGraphEdge = Edge

export type WorkflowValidationIssue = {
  id: string
  nodeId?: string
  portKey?: string
  nodeLabel: string
  severity: 'error' | 'warning'
  activationState?: 'definition-missing' | 'final-result-required' | 'missing-required-input' | 'runtime-input-waiting' | 'system-capability-disabled'
  title: string
  detail: string
}

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

/** Legacy editor-support section keys still threaded through the page state and actions. */
export type EditorSupportSectionKey = 'setup' | 'inspector' | 'inputs' | 'validation' | 'results'
