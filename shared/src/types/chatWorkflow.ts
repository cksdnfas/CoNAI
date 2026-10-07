import type { ChatPageSnapshot } from './chatPage'

export type ChatWorkflowValue = string | number | boolean | null | ChatWorkflowValue[] | { [key: string]: ChatWorkflowValue }
export type ChatWorkflowDataType = 'text' | 'prompt' | 'number' | 'boolean' | 'json' | 'any' | 'image' | 'video' | 'audio' | 'mask'
export type ChatWorkflowPort = { key: string; label: string; dataType: ChatWorkflowDataType; required: boolean; multiple: boolean; connectable: boolean }
export type ChatWorkflowField = { key: string; label: string; type: ChatWorkflowDataType | 'select'; editable: boolean; hasDefault: boolean; min?: number; max?: number; options?: string[] }
/** Public editor interface only: module templates, code, paths and credentials are never included. */
export type ChatWorkflowModule = { id: number; name: string; description: string; engine: string; version: number; operation: string | null; inputs: ChatWorkflowPort[]; outputs: ChatWorkflowPort[]; fields: ChatWorkflowField[]; runInputCapable: boolean }
export type ChatWorkflowNode = {
  id: string; module_id: number; label: string; disabled: boolean; position: { x: number; y: number }
  input_values: Record<string, ChatWorkflowValue>
  run_input?: { enabled: boolean; label: string; description: string }
}
export type ChatWorkflowEdge = { id: string; source_node_id: string; source_port_key: string; target_node_id: string; target_port_key: string }
export type ChatWorkflowSnapshot = { revision: string; name: string; description: string; nodes: ChatWorkflowNode[]; edges: ChatWorkflowEdge[] }
export type ChatWorkflowOperation =
  | { type: 'add_node'; nodeId: string; moduleId: number; label?: string; position?: { x: number; y: number } }
  | { type: 'remove_node'; nodeId: string }
  | { type: 'set_node'; nodeId: string; label?: string; disabled?: boolean; position?: { x: number; y: number } }
  | { type: 'set_input'; nodeId: string; key: string; value: ChatWorkflowValue }
  | { type: 'clear_input'; nodeId: string; key: string }
  | { type: 'connect'; edgeId: string; sourceNodeId: string; sourcePort: string; targetNodeId: string; targetPort: string }
  | { type: 'disconnect'; edgeId: string }
  | { type: 'set_workflow'; name?: string; description?: string }
  | { type: 'set_run_input'; nodeId: string; enabled: boolean; label?: string; description?: string }
export type ChatWorkflowChange = { title: string; before: string; after: string }
export type ChatWorkflowProposal = {
  kind: 'workflow_graph'; page: Omit<ChatPageSnapshot, 'fields' | 'workflow'>; revision: string
  operations: ChatWorkflowOperation[]; modules: ChatWorkflowModule[]; changes: ChatWorkflowChange[]; issues: string[]
  nodeCount: number; edgeCount: number; expiresAt: number; saved?: boolean
}
