import { fetchJson } from '@/lib/api-client'
import type { ApiResponse } from '@/types/image'

export type CustomNodePortDataType = 'image' | 'mask' | 'prompt' | 'text' | 'number' | 'boolean' | 'json' | 'any'
export type CustomNodeUiDataType = CustomNodePortDataType | 'select'
export type CustomNodeScaffoldTemplate = 'empty' | 'http_json' | 'image_file'

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
  sourceHash: string
  manifest: CustomNodeManifest
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
  const response = await fetchJson<ApiResponse<CustomNodeScanResult>>('/api/custom-nodes')
  if (!response.success) {
    throw new Error(response.error || '커스텀 노드 목록을 불러오지 못했어.')
  }
  return response.data
}

export async function rescanCustomNodes() {
  const response = await fetchJson<ApiResponse<CustomNodeSyncResult>>('/api/custom-nodes/rescan', {
    method: 'POST',
  })
  if (!response.success) {
    throw new Error(response.error || '커스텀 노드를 다시 스캔하지 못했어.')
  }
  return response.data
}

export async function scaffoldCustomNode(input: CustomNodeScaffoldInput) {
  const response = await fetchJson<ApiResponse<CustomNodeScaffoldResult>>('/api/custom-nodes/scaffold', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })
  if (!response.success) {
    throw new Error(response.error || '커스텀 노드 스캐폴드를 만들지 못했어.')
  }
  return response.data
}

export async function getCustomNodeSource(key: string) {
  const response = await fetchJson<ApiResponse<CustomNodeSourceResult>>(`/api/custom-nodes/${encodeURIComponent(key)}/source`)
  if (!response.success) {
    throw new Error(response.error || '커스텀 노드 소스를 불러오지 못했어.')
  }
  return response.data
}

export async function openCustomNodeFolder(key: string) {
  const response = await fetchJson<ApiResponse<{ key: string; folderPath: string }>>(`/api/custom-nodes/${encodeURIComponent(key)}/open-folder`, {
    method: 'POST',
  })
  if (!response.success) {
    throw new Error(response.error || '커스텀 노드 폴더를 열지 못했어.')
  }
  return response.data
}

export async function testCustomNode(key: string, inputs?: Record<string, unknown>) {
  const response = await fetchJson<ApiResponse<CustomNodeTestResult>>(`/api/custom-nodes/${encodeURIComponent(key)}/test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inputs: inputs ?? {} }),
  })
  if (!response.success) {
    throw new Error(response.error || '커스텀 노드 테스트 실행에 실패했어.')
  }
  return response.data
}
