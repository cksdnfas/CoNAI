import path from 'path'
import { spawn } from 'child_process'
import { GraphExecutionArtifactModel } from '../../models/GraphExecutionArtifact'
import { type GraphWorkflowNode, type ModulePortDefinition, type ModulePortDataType } from '../../types/moduleGraph'
import {
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
  type RuntimeArtifact,
} from './shared'

const CUSTOM_NODE_TIMEOUT_MS = 30_000

const CUSTOM_NODE_CHILD_RUNNER_SOURCE = String.raw`
const { pathToFileURL } = require('url')

function readStdin() {
  return new Promise((resolve, reject) => {
    let buffer = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      buffer += chunk
    })
    process.stdin.on('end', () => resolve(buffer))
    process.stdin.on('error', reject)
  })
}

function resolveHandler(loadedModule) {
  if (typeof loadedModule === 'function') {
    return loadedModule
  }

  if (loadedModule && typeof loadedModule.default === 'function') {
    return loadedModule.default
  }

  if (loadedModule && typeof loadedModule.run === 'function') {
    return loadedModule.run
  }

  if (loadedModule && loadedModule.default && typeof loadedModule.default.run === 'function') {
    return loadedModule.default.run
  }

  return null
}

async function loadCustomNodeModule(entryPath) {
  try {
    return require(entryPath)
  } catch (requireError) {
    return await import(pathToFileURL(entryPath).href)
  }
}

;(async () => {
  const rawInput = await readStdin()
  const payload = JSON.parse(rawInput || '{}')
  const loadedModule = await loadCustomNodeModule(payload.entryPath)
  const handler = resolveHandler(loadedModule)

  if (!handler) {
    throw new Error('Custom node entry must export a function via module.exports, exports.run, export default, or export async function run')
  }

  const logs = []
  const appendLog = (level, message) => {
    logs.push({
      level: typeof level === 'string' && level.length > 0 ? level : 'info',
      message: typeof message === 'string' ? message : String(message),
    })
  }

  const ctx = {
    inputs: payload.inputs ?? {},
    node: payload.node ?? {},
    workflow: payload.workflow ?? {},
    log: (message, level = 'info') => appendLog(level, message),
    helpers: {
      log: (message, level = 'info') => appendLog(level, message),
      fetchJson: async (url, init) => {
        const response = await fetch(url, init)
        return await response.json()
      },
      fetchText: async (url, init) => {
        const response = await fetch(url, init)
        return await response.text()
      },
    },
  }

  const result = await handler(ctx)
  process.stdout.write(JSON.stringify({ success: true, result, logs }))
})().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined
  if (stack) {
    process.stderr.write(stack)
  }
  process.stdout.write(JSON.stringify({ success: false, error: message, stack }))
  process.exit(1)
})
`

type CustomNodeProcessPayload = {
  entryPath: string
  inputs: Record<string, unknown>
  node: {
    id: string
    moduleId: number
    moduleName: string
  }
  workflow: {
    id: number
    name: string
    executionId: number
  }
}

type CustomNodeProcessResponse = {
  success: boolean
  result?: unknown
  logs?: Array<{ level?: 'info' | 'warn' | 'error'; message: string }>
  error?: string
  stack?: string
}

export type CustomNodeExecutionResult = {
  outputs: Record<string, unknown>
  metadata?: Record<string, unknown>
  logs: Array<{ level?: 'info' | 'warn' | 'error'; message: string }>
}

/** Persist one custom-node value artifact so downstream nodes can consume it. */
function buildCustomValueArtifact(
  executionId: number,
  nodeId: string,
  portKey: string,
  artifactType: ModulePortDataType,
  value: unknown,
  metadata?: Record<string, unknown>,
): RuntimeArtifact {
  const artifactRecordId = GraphExecutionArtifactModel.create({
    execution_id: executionId,
    node_id: nodeId,
    port_key: portKey,
    artifact_type: artifactType,
    metadata: JSON.stringify({ value, ...(metadata ?? {}) }),
  })

  return {
    type: artifactType,
    value,
    artifactRecordId,
    metadata,
  }
}

/** Ensure one custom-node output can be represented inside the existing artifact model. */
function validateCustomNodeOutputValue(port: ModulePortDefinition, value: unknown) {
  if (port.data_type === 'text' || port.data_type === 'prompt') {
    if (typeof value !== 'string') {
      throw new Error(`Custom node output ${port.key} must be a string for ${port.data_type}`)
    }
    return
  }

  if (port.data_type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Custom node output ${port.key} must be a finite number`)
    }
    return
  }

  if (port.data_type === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new Error(`Custom node output ${port.key} must be a boolean`)
    }
    return
  }

  if (port.data_type === 'image' || port.data_type === 'mask') {
    throw new Error(`Custom node output ${port.key} with type ${port.data_type} is not supported yet in MVP`)
  }

  try {
    JSON.stringify(value)
  } catch (error) {
    throw new Error(`Custom node output ${port.key} must be JSON-serializable`)
  }
}

/** Normalize the raw child-process result into the execution contract used by the graph executor. */
function normalizeCustomNodeExecutionResult(processResponse: CustomNodeProcessResponse): CustomNodeExecutionResult {
  const rawResult = processResponse.result
  const rawLogs = Array.isArray(processResponse.logs) ? processResponse.logs : []

  if (!rawResult || typeof rawResult !== 'object' || Array.isArray(rawResult)) {
    return {
      outputs: {},
      logs: rawLogs,
    }
  }

  const resultRecord = rawResult as Record<string, unknown>
  const rawOutputs = 'outputs' in resultRecord && resultRecord.outputs && typeof resultRecord.outputs === 'object' && !Array.isArray(resultRecord.outputs)
    ? resultRecord.outputs as Record<string, unknown>
    : resultRecord

  const metadata = 'metadata' in resultRecord && resultRecord.metadata && typeof resultRecord.metadata === 'object' && !Array.isArray(resultRecord.metadata)
    ? resultRecord.metadata as Record<string, unknown>
    : undefined

  const resultLogs = Array.isArray(resultRecord.logs)
    ? resultRecord.logs
      .filter((item): item is { level?: 'info' | 'warn' | 'error'; message: string } => !!item && typeof item === 'object' && 'message' in item && typeof item.message === 'string')
    : []

  return {
    outputs: rawOutputs,
    metadata,
    logs: [...rawLogs, ...resultLogs],
  }
}

/** Run one custom JS entry in a separate Node.js child process for stability. */
async function runCustomNodeProcess(payload: CustomNodeProcessPayload): Promise<CustomNodeProcessResponse> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', CUSTOM_NODE_CHILD_RUNNER_SOURCE], {
      cwd: path.dirname(payload.entryPath),
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) {
        return
      }

      settled = true
      child.kill()
      reject(new Error(`Custom node timed out after ${CUSTOM_NODE_TIMEOUT_MS}ms`))
    }, CUSTOM_NODE_TIMEOUT_MS)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      reject(error)
    })

    child.on('close', () => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)

      try {
        const parsed = JSON.parse(stdout || '{}') as CustomNodeProcessResponse
        if (!parsed.success && stderr && !parsed.stack) {
          parsed.stack = stderr
        }
        resolve(parsed)
      } catch (error) {
        reject(new Error(stderr || `Failed to parse custom node result: ${stdout}`))
      }
    })

    child.stdin.write(JSON.stringify(payload))
    child.stdin.end()
  })
}

/** Execute one custom JS module once and validate its declared outputs without persisting artifacts. */
export async function runCustomJsModuleOnce(params: {
  moduleDefinition: ParsedModuleDefinition
  resolvedInputs: Record<string, unknown>
  node: {
    id: string
    moduleId: number
    moduleName: string
  }
  workflow: {
    id: number
    name: string
    executionId: number
  }
}) {
  const entry = typeof params.moduleDefinition.template_defaults?.entry === 'string' ? params.moduleDefinition.template_defaults.entry : null
  const folderPath = typeof params.moduleDefinition.source_path === 'string' ? params.moduleDefinition.source_path : null
  const entryPath = entry && folderPath ? path.resolve(folderPath, entry) : null

  if (!folderPath || !entryPath) {
    throw new Error(`Custom JS module ${params.moduleDefinition.name} is missing source_path or entry`)
  }

  const processResponse = await runCustomNodeProcess({
    entryPath,
    inputs: params.resolvedInputs,
    node: params.node,
    workflow: params.workflow,
  })

  if (!processResponse.success) {
    throw new Error(processResponse.error || `Custom JS module failed: ${params.moduleDefinition.name}`)
  }

  const executionResult = normalizeCustomNodeExecutionResult(processResponse)
  const declaredOutputPorts = new Map(params.moduleDefinition.output_ports.map((port) => [port.key, port]))
  const outputKeys = Object.keys(executionResult.outputs)
  const unknownOutputKeys = outputKeys.filter((key) => !declaredOutputPorts.has(key))
  if (unknownOutputKeys.length > 0) {
    throw new Error(`Custom node returned undeclared outputs: ${unknownOutputKeys.join(', ')}`)
  }

  for (const port of params.moduleDefinition.output_ports) {
    if (!(port.key in executionResult.outputs)) {
      if (port.required) {
        throw new Error(`Custom node did not return required output: ${port.key}`)
      }
      continue
    }

    validateCustomNodeOutputValue(port, executionResult.outputs[port.key])
  }

  return {
    executionResult,
    entry,
    folderPath,
  }
}

/** Execute a file-backed local custom JS node and persist its declared outputs. */
export async function executeCustomJsModule(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, unknown>,
) {
  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_start',
    message: `Custom JS module start: ${moduleDefinition.name}`,
    details: {
      engine: 'custom_js',
      sourcePath: moduleDefinition.source_path ?? null,
      entry: typeof moduleDefinition.template_defaults?.entry === 'string' ? moduleDefinition.template_defaults.entry : null,
    },
  })

  const { executionResult } = await runCustomJsModuleOnce({
    moduleDefinition,
    resolvedInputs,
    node: {
      id: node.id,
      moduleId: moduleDefinition.id,
      moduleName: moduleDefinition.name,
    },
    workflow: {
      id: context.workflow.id,
      name: context.workflow.name,
      executionId: context.executionId,
    },
  })

  const nodeArtifacts: Record<string, RuntimeArtifact> = {}

  for (const port of moduleDefinition.output_ports) {
    if (!(port.key in executionResult.outputs)) {
      continue
    }

    const value = executionResult.outputs[port.key]
    nodeArtifacts[port.key] = buildCustomValueArtifact(context.executionId, node.id, port.key, port.data_type, value, {
      kind: 'custom-js-output',
      module: moduleDefinition.name,
    })
  }

  context.artifactsByNode.set(node.id, nodeArtifacts)

  for (const logItem of executionResult.logs) {
    writeExecutionLog({
      executionId: context.executionId,
      nodeId: node.id,
      level: logItem.level ?? 'info',
      eventType: 'custom_node_log',
      message: logItem.message,
    })
  }

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_complete',
    message: `Custom JS module completed: ${moduleDefinition.name}`,
    details: {
      artifact_ports: Object.keys(nodeArtifacts),
      metadata: executionResult.metadata ?? null,
    },
  })
}
