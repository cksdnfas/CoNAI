import { createApiFallbackError } from '@/i18n/api-error-fallbacks'
import { fetchJson } from '@/lib/api-client'
import type { ApiResponse } from '@/types/image'

async function requestCustomNodeData<T>(path: string, fallbackKey: Parameters<typeof createApiFallbackError>[1], init?: RequestInit) {
  const response = await fetchJson<ApiResponse<T>>(path, init)
  if (!response.success) {
    throw createApiFallbackError(response.error, fallbackKey)
  }
  return response.data
}

export type CustomNodePortDataType = 'image' | 'mask' | 'prompt' | 'text' | 'number' | 'boolean' | 'json' | 'any'
export type CustomNodeUiDataType = CustomNodePortDataType | 'select'
export type CustomNodeScaffoldTemplate = 'empty' | 'hello_world' | 'http_json' | 'image_file'

export interface CustomNodePortDefinition {
  key: string
  label?: string
  data_type: CustomNodePortDataType
  description?: string
  required?: boolean
  multiple?: boolean
  default_value?: unknown
  ui_hint?: string
  source_path?: string
}

export interface CustomNodeUiFieldDefinition {
  key: string
  label?: string
  data_type: CustomNodeUiDataType
  description?: string
  default_value?: unknown
  options?: string[]
  min?: number
  max?: number
  placeholder?: string
  ui_hint?: string
}

export interface CustomNodeManifest {
  schemaVersion: number
  key: string
  name: string
  description?: string
  version?: string
  runtime: 'javascript'
  entry: string
  category?: string
  color?: string
  inputs: CustomNodePortDefinition[]
  outputs: CustomNodePortDefinition[]
  ui_schema?: CustomNodeUiFieldDefinition[]
}

export interface CustomNodeScanError {
  folderName: string
  folderPath: string
  message: string
}

export interface CustomNodeRecord {
  folderName: string
  folderPath: string
  manifestPath: string
  entryPath: string
  packageJsonPath: string | null
  readmePath: string | null
  sourceHash: string
  manifest: CustomNodeManifest
}

export interface CustomNodeScanResult {
  customNodesDir: string
  nodes: CustomNodeRecord[]
  errors: CustomNodeScanError[]
}

export interface CustomNodeSyncResult extends CustomNodeScanResult {
  createdCount: number
  updatedCount: number
  deactivatedCount: number
}

export interface CustomNodeScaffoldInput {
  folderName: string
  key: string
  name: string
  description?: string
  category?: string
  color?: string
  template?: CustomNodeScaffoldTemplate
}

export interface CustomNodeScaffoldResult {
  folderPath: string
  manifestPath: string
  entryPath: string
  template: CustomNodeScaffoldTemplate
  sync: CustomNodeSyncResult
}

export interface CustomNodeSourceResult {
  key: string
  folderName: string
  folderPath: string
  manifestPath: string
  entryPath: string
  packageJsonPath: string | null
  readmePath: string | null
  sourceHash: string
  manifest: CustomNodeManifest
}

export interface CustomNodeInstallResult {
  key: string
  folderPath: string
  packageJsonPath: string
  stdout: string
  stderr: string
}

export interface CustomNodeTestResult {
  key: string
  name: string
  entry: string | null
  folderPath: string | null
  outputs: Record<string, unknown>
  metadata: Record<string, unknown> | null
  logs: Array<{ level?: 'info' | 'warn' | 'error'; message: string }>
}

export async function listCustomNodes() {
  return requestCustomNodeData<CustomNodeScanResult>('/api/custom-nodes', 'customNodes.list.load')
}

export async function rescanCustomNodes() {
  return requestCustomNodeData<CustomNodeSyncResult>('/api/custom-nodes/rescan', 'customNodes.rescan', {
    method: 'POST',
  })
}

export async function scaffoldCustomNode(input: CustomNodeScaffoldInput) {
  return requestCustomNodeData<CustomNodeScaffoldResult>('/api/custom-nodes/scaffold', 'customNodes.scaffold', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })
}

export async function getCustomNodeSource(key: string) {
  return requestCustomNodeData<CustomNodeSourceResult>(`/api/custom-nodes/${encodeURIComponent(key)}/source`, 'customNodes.source.load')
}

export async function openCustomNodeFolder(key: string) {
  return requestCustomNodeData<{ key: string; folderPath: string }>(`/api/custom-nodes/${encodeURIComponent(key)}/open-folder`, 'customNodes.folder.open', {
    method: 'POST',
  })
}

export async function installCustomNodeDependencies(key: string) {
  return requestCustomNodeData<CustomNodeInstallResult>(`/api/custom-nodes/${encodeURIComponent(key)}/install`, 'customNodes.dependencies.install', {
    method: 'POST',
  })
}

export async function testCustomNode(key: string, inputs?: Record<string, unknown>) {
  return requestCustomNodeData<CustomNodeTestResult>(`/api/custom-nodes/${encodeURIComponent(key)}/test`, 'customNodes.test.run', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inputs: inputs ?? {} }),
  })
}
