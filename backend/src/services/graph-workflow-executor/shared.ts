import crypto from 'crypto'
import { GraphExecutionLogModel } from '../../models/GraphExecutionLog'
import {
  type GraphWorkflowDocument,
  type GraphWorkflowExposedInput,
  type ModuleDefinitionRecord,
  type ModulePortDefinition,
  type ModulePortDataType,
} from '../../types/moduleGraph'

export type ParsedModuleDefinition = Omit<ModuleDefinitionRecord, 'template_defaults' | 'exposed_inputs' | 'output_ports' | 'internal_fixed_values' | 'ui_schema'> & {
  template_defaults: Record<string, any>
  exposed_inputs: ModulePortDefinition[]
  output_ports: ModulePortDefinition[]
  internal_fixed_values: Record<string, any>
  ui_schema: any[]
}

export type ParsedGraphWorkflow = {
  id: number
  name: string
  version: number
  graph: GraphWorkflowDocument
}

export type RuntimeArtifact = {
  type: ModulePortDataType | 'file'
  value: any
  storagePath?: string
  artifactRecordId?: number
  metadata?: Record<string, unknown>
}

export type ExecutionContext = {
  executionId: number
  workflow: ParsedGraphWorkflow
  modulesById: Map<number, ParsedModuleDefinition>
  artifactsByNode: Map<string, Record<string, RuntimeArtifact>>
}

/** Persist a structured execution log row for graph runs. */
export function writeExecutionLog(params: {
  executionId: number
  nodeId?: string | null
  level?: 'info' | 'warn' | 'error'
  eventType: string
  message: string
  details?: Record<string, unknown> | string | null
}) {
  GraphExecutionLogModel.create({
    execution_id: params.executionId,
    node_id: params.nodeId ?? null,
    level: params.level ?? 'info',
    event_type: params.eventType,
    message: params.message,
    details:
      params.details === undefined || params.details === null
        ? null
        : typeof params.details === 'string'
          ? params.details
          : JSON.stringify(params.details),
  })
}

/** Parse a stored JSON string with a safe fallback value. */
export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback
  }

  return JSON.parse(value) as T
}

/** Decode a stored module definition row into executable shapes. */
export function parseModuleDefinition(record: ModuleDefinitionRecord): ParsedModuleDefinition {
  return {
    ...record,
    template_defaults: parseJson(record.template_defaults as unknown as string, {}),
    exposed_inputs: parseJson(record.exposed_inputs as unknown as string, []),
    output_ports: parseJson(record.output_ports as unknown as string, []),
    internal_fixed_values: parseJson(record.internal_fixed_values as unknown as string, {}),
    ui_schema: parseJson(record.ui_schema as unknown as string, []),
  }
}

/** Decode a stored graph workflow row into an executable document. */
export function parseGraphWorkflowRecord(record: any): ParsedGraphWorkflow {
  return {
    id: record.id,
    name: record.name,
    version: record.version,
    graph: parseJson(record.graph_json, { nodes: [], edges: [] }),
  }
}

/** Apply workflow runtime inputs onto node input overrides without mutating stored graph data. */
export function applyWorkflowRuntimeInputs(
  graph: GraphWorkflowDocument,
  exposedInputs: GraphWorkflowExposedInput[],
  runtimeInputValues?: Record<string, unknown>,
) {
  if (!runtimeInputValues || Object.keys(runtimeInputValues).length === 0 || exposedInputs.length === 0) {
    return graph
  }

  const overridesByNode = new Map<string, Record<string, unknown>>()

  for (const exposedInput of exposedInputs) {
    if (!(exposedInput.id in runtimeInputValues)) {
      continue
    }

    const value = runtimeInputValues[exposedInput.id]
    if (value === undefined || value === null || value === '') {
      continue
    }

    const currentNodeOverrides = overridesByNode.get(exposedInput.node_id) ?? {}
    currentNodeOverrides[exposedInput.port_key] = value
    overridesByNode.set(exposedInput.node_id, currentNodeOverrides)
  }

  if (overridesByNode.size === 0) {
    return graph
  }

  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      input_values: {
        ...(node.input_values ?? {}),
        ...(overridesByNode.get(node.id) ?? {}),
      },
    })),
  }
}

/** Build a deterministic JSON string so execution signatures stay stable across key order. */
export function buildStableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => buildStableJson(item)).join(',')}]`
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${buildStableJson(entryValue)}`)

    return `{${entries.join(',')}}`
  }

  return JSON.stringify(value)
}

/** Build one hash signature for workflow runtime inputs. */
export function buildRuntimeInputSignature(runtimeInputValues?: Record<string, unknown>) {
  const stableJson = buildStableJson(runtimeInputValues ?? {})
  return crypto.createHash('sha256').update(stableJson).digest('hex')
}

/** Strip a data URL prefix so image APIs receive raw base64. */
export function normalizeBase64ImageData(value?: string): string | undefined {
  if (!value || typeof value !== 'string') {
    return undefined
  }

  return value.replace(/^data:image\/\w+;base64,/, '')
}

/** Convert an image buffer into a data URL for downstream graph nodes. */
export function bufferToDataUrl(buffer: Buffer, mimeType = 'image/png') {
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

/** Normalize file-name segments for temp artifact writes. */
export function sanitizeFileSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}
