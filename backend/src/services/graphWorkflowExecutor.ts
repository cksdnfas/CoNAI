import { GraphExecutionArtifactModel } from '../models/GraphExecutionArtifact'
import { GraphExecutionFinalResultModel } from '../models/GraphExecutionFinalResult'
import { GraphExecutionLogModel } from '../models/GraphExecutionLog'
import { GraphExecutionModel } from '../models/GraphExecution'
import { GraphWorkflowModel } from '../models/GraphWorkflow'
import { ModuleDefinitionModel } from '../models/ModuleDefinition'
import { getIncomingArtifacts, loadRuntimeArtifactsByNode, resolveNodeInputs } from './graph-workflow-executor/artifacts'
import { executeComfyModule } from './graph-workflow-executor/execute-comfy'
import { executeCustomJsModule } from './graph-workflow-executor/execute-custom-js'
import { executeNaiModule } from './graph-workflow-executor/execute-nai'
import { executeCodexImageGenerationNode } from './graph-workflow-executor/system-codex-operations'
import { executeSystemModule } from './graph-workflow-executor/execute-system'
import {
  applyWorkflowRuntimeInputs,
  buildRuntimeInputSignature,
  parseGraphWorkflowRecord,
  parseModuleDefinition,
  parseJson,
  GraphWorkflowStoppedError,
  isWorkflowDebugModeEnabled,
  setExecutionDebugMode,
  writeExecutionLog,
  type ExecutionContext,
  type RuntimeArtifact,
} from './graph-workflow-executor/shared'
import { buildExecutionOrder, validateGraphTypes, validateRequiredInputs } from './graph-workflow-executor/validate'

/** Execute a saved module graph workflow from validation through node engines. */
const GRAPH_EXECUTION_CANCELLED_MESSAGE = '__GRAPH_EXECUTION_CANCELLED__'
const DEFAULT_MAX_PARALLEL_READY_NODES = 8
const DEFAULT_EXTERNAL_GENERATION_NODE_CONCURRENCY = 4

type GraphNodeThrottleLane = 'external_generation'

const graphNodeThrottleState: Record<GraphNodeThrottleLane, { activeCount: number; waiters: Set<() => void> }> = {
  external_generation: {
    activeCount: 0,
    waiters: new Set<() => void>(),
  },
}

function parsePositiveIntegerEnv(name: string, fallback: number) {
  const rawValue = process.env[name]
  const numericValue = Number(rawValue)
  if (Number.isFinite(numericValue) && numericValue > 0) {
    return Math.floor(numericValue)
  }

  return fallback
}

function getMaxParallelReadyNodes() {
  return parsePositiveIntegerEnv('CONAI_GRAPH_READY_NODE_CONCURRENCY', DEFAULT_MAX_PARALLEL_READY_NODES)
}

function getGraphNodeThrottleLimit(lane: GraphNodeThrottleLane) {
  if (lane === 'external_generation') {
    return parsePositiveIntegerEnv('CONAI_GRAPH_EXTERNAL_GENERATION_NODE_CONCURRENCY', DEFAULT_EXTERNAL_GENERATION_NODE_CONCURRENCY)
  }

  return 1
}

function tryAcquireGraphNodeThrottleSlot(lane: GraphNodeThrottleLane) {
  const state = graphNodeThrottleState[lane]
  if (state.activeCount >= getGraphNodeThrottleLimit(lane)) {
    return false
  }

  state.activeCount += 1
  return true
}

function releaseGraphNodeThrottleSlot(lane: GraphNodeThrottleLane) {
  const state = graphNodeThrottleState[lane]
  state.activeCount = Math.max(0, state.activeCount - 1)
  const waiters = Array.from(state.waiters)
  state.waiters.clear()
  for (const waiter of waiters) {
    waiter()
  }
}

function waitForGraphNodeThrottleAvailability(lane: GraphNodeThrottleLane) {
  const state = graphNodeThrottleState[lane]
  return new Promise<void>((resolve) => {
    let timeout: ReturnType<typeof setTimeout>
    const waiter = () => {
      clearTimeout(timeout)
      resolve()
    }
    timeout = setTimeout(() => {
      state.waiters.delete(waiter)
      resolve()
    }, 250)
    state.waiters.add(waiter)
  })
}

type GraphExecutionPlan = {
  orderedNodeIds: string[]
  targetNodeId?: string | null
  runtimeInputSignature?: string | null
  runtimeInputValues?: Record<string, unknown>
  forceRerun?: boolean
  reusedFromExecutionId?: number | null
  reusedNodeIds?: string[]
}

function buildNodeOutputKey(nodeId: string, portKey: string) {
  return `${nodeId}:${portKey}`
}

function buildNodeDependencies(graph: { edges: Array<{ source_node_id: string; target_node_id: string }> }, orderedNodeIds: string[]) {
  const executableNodeIds = new Set(orderedNodeIds)
  const dependenciesByNode = new Map<string, Set<string>>()

  for (const nodeId of orderedNodeIds) {
    dependenciesByNode.set(nodeId, new Set<string>())
  }

  for (const edge of graph.edges) {
    if (!executableNodeIds.has(edge.source_node_id) || !executableNodeIds.has(edge.target_node_id)) {
      continue
    }

    dependenciesByNode.get(edge.target_node_id)?.add(edge.source_node_id)
  }

  return dependenciesByNode
}

async function runReadyGraphNodes(params: {
  orderedNodeIds: string[]
  dependenciesByNode: Map<string, Set<string>>
  shouldCancel?: () => boolean
  getNodeThrottleLane?: (nodeId: string) => GraphNodeThrottleLane | null
  executeNode: (nodeId: string) => Promise<void>
}) {
  const pendingNodeIds = new Set(params.orderedNodeIds)
  const completedNodeIds = new Set<string>()
  const runningNodes = new Map<string, Promise<void>>()

  while (pendingNodeIds.size > 0 || runningNodes.size > 0) {
    if (params.shouldCancel?.()) {
      throw new Error(GRAPH_EXECUTION_CANCELLED_MESSAGE)
    }

    const readyNodeIds = params.orderedNodeIds.filter((nodeId) => {
      if (!pendingNodeIds.has(nodeId) || runningNodes.has(nodeId)) {
        return false
      }

      const dependencies = params.dependenciesByNode.get(nodeId) ?? new Set<string>()
      for (const dependencyNodeId of dependencies) {
        if (!completedNodeIds.has(dependencyNodeId)) {
          return false
        }
      }

      return true
    })

    let startedNode = false
    let throttleBlockedLane: GraphNodeThrottleLane | null = null
    const maxParallelReadyNodes = getMaxParallelReadyNodes()

    for (const nodeId of readyNodeIds) {
      if (runningNodes.size >= maxParallelReadyNodes) {
        break
      }

      const throttleLane = params.getNodeThrottleLane?.(nodeId) ?? null
      if (throttleLane && !tryAcquireGraphNodeThrottleSlot(throttleLane)) {
        throttleBlockedLane = throttleLane
        continue
      }

      pendingNodeIds.delete(nodeId)
      startedNode = true
      const runPromise = params.executeNode(nodeId)
        .then(() => {
          completedNodeIds.add(nodeId)
        })
        .finally(() => {
          if (throttleLane) {
            releaseGraphNodeThrottleSlot(throttleLane)
          }
          runningNodes.delete(nodeId)
        })
      runningNodes.set(nodeId, runPromise)
    }

    if (runningNodes.size === 0) {
      if (!startedNode && throttleBlockedLane && readyNodeIds.length > 0) {
        await waitForGraphNodeThrottleAvailability(throttleBlockedLane)
        continue
      }

      throw new Error('Graph execution could not make progress because no runnable nodes were available')
    }

    await Promise.race(runningNodes.values())
  }
}

function getSystemOperationKey(moduleDefinition: { internal_fixed_values?: Record<string, any>; template_defaults?: Record<string, any> }) {
  if (typeof moduleDefinition.internal_fixed_values?.operation_key === 'string') {
    return moduleDefinition.internal_fixed_values.operation_key
  }

  if (typeof moduleDefinition.template_defaults?.operation_key === 'string') {
    return moduleDefinition.template_defaults.operation_key
  }

  return null
}

function isExternalGenerationModule(moduleDefinition: { engine_type: string; internal_fixed_values?: Record<string, any>; template_defaults?: Record<string, any> }) {
  if (moduleDefinition.engine_type === 'comfyui' || moduleDefinition.engine_type === 'codex' || moduleDefinition.engine_type === 'nai') {
    return true
  }

  if (moduleDefinition.engine_type !== 'system') {
    return false
  }

  const operationKey = getSystemOperationKey(moduleDefinition)
  return operationKey === 'system.generate_image_nai' || operationKey === 'system.generate_image_codex'
}

function getNodeThrottleLane(moduleDefinition: { engine_type: string; internal_fixed_values?: Record<string, any>; template_defaults?: Record<string, any> }): GraphNodeThrottleLane | null {
  return isExternalGenerationModule(moduleDefinition) ? 'external_generation' : null
}

function isIfBranchModule(moduleDefinition: { internal_fixed_values?: Record<string, any>; template_defaults?: Record<string, any> }) {
  return getSystemOperationKey(moduleDefinition) === 'system.logic_if_branch'
}

function findInactiveBranchInputReasons(context: ExecutionContext, nodeId: string) {
  return context.workflow.graph.edges
    .filter((edge) => edge.target_node_id === nodeId)
    .flatMap((edge) => {
      if (context.skippedNodeIds?.has(edge.source_node_id)) {
        return [{ ...edge, reason: 'source_node_skipped' }]
      }

      if (context.disabledOutputPorts?.has(buildNodeOutputKey(edge.source_node_id, edge.source_port_key))) {
        return [{ ...edge, reason: 'source_output_disabled' }]
      }

      const sourceNode = context.workflow.graph.nodes.find((item) => item.id === edge.source_node_id)
      const sourceModule = sourceNode ? context.modulesById.get(sourceNode.module_id) : null
      const sourceArtifacts = context.artifactsByNode.get(edge.source_node_id)
      if (sourceModule && isIfBranchModule(sourceModule) && sourceArtifacts && !sourceArtifacts[edge.source_port_key]) {
        return [{ ...edge, reason: 'inactive_if_branch' }]
      }

      return []
    })
}

function markNodeOutputsSkipped(
  context: ExecutionContext,
  nodeId: string,
  moduleDefinition: { output_ports: Array<{ key: string }> },
) {
  context.skippedNodeIds?.add(nodeId)
  for (const port of moduleDefinition.output_ports) {
    context.disabledOutputPorts?.add(buildNodeOutputKey(nodeId, port.key))
  }
}

function markNodeSkippedForInactiveBranch(
  context: ExecutionContext,
  nodeId: string,
  moduleDefinition: { output_ports: Array<{ key: string }> },
  reasons: ReturnType<typeof findInactiveBranchInputReasons>,
) {
  markNodeOutputsSkipped(context, nodeId, moduleDefinition)

  writeExecutionLog({
    executionId: context.executionId,
    nodeId,
    eventType: 'node_skipped_inactive_branch',
    message: `Node skipped because an upstream IF branch path is inactive: ${nodeId}`,
    details: {
      disabledInputs: reasons.map((edge) => ({
        sourceNodeId: edge.source_node_id,
        sourcePortKey: edge.source_port_key,
        targetPortKey: edge.target_port_key,
        reason: edge.reason,
      })),
      disabledOutputKeys: moduleDefinition.output_ports.map((port) => port.key),
    },
  })
}

/** Find the latest completed execution whose plan matches the current partial-run reuse requirements. */
async function findReusableExecution(params: {
  workflowId: number
  graphVersion: number
  runtimeInputSignature: string
  targetNodeId?: string
  reusableNodeIds: string[]
  forceRerun?: boolean
}) {
  if (params.forceRerun || !params.targetNodeId || params.reusableNodeIds.length === 0) {
    return { reusedFromExecutionId: null, reusedNodeIds: [] as string[], artifactsByNode: new Map<string, Record<string, RuntimeArtifact>>() }
  }

  const candidateExecutions = GraphExecutionModel.findByWorkflow(params.workflowId, 20)
    .filter((execution) => execution.status === 'completed' && execution.graph_version === params.graphVersion)

  for (const execution of candidateExecutions) {
    const executionPlan = execution.execution_plan
      ? parseJson<GraphExecutionPlan>(execution.execution_plan, { orderedNodeIds: [] })
      : { orderedNodeIds: [] }

    if ((executionPlan.runtimeInputSignature ?? null) !== params.runtimeInputSignature) {
      continue
    }

    const artifacts = GraphExecutionArtifactModel.findByExecution(execution.id)
    const artifactGroups = artifacts.reduce<Record<string, typeof artifacts>>((acc, artifact) => {
      if (!acc[artifact.node_id]) {
        acc[artifact.node_id] = []
      }
      acc[artifact.node_id].push(artifact)
      return acc
    }, {})

    const artifactsByNode = new Map<string, Record<string, RuntimeArtifact>>()
    const reusedNodeIds: string[] = []

    for (const nodeId of params.reusableNodeIds) {
      const nodeArtifacts = artifactGroups[nodeId]
      if (!nodeArtifacts || nodeArtifacts.length === 0) {
        continue
      }

      const hydratedArtifacts = await loadRuntimeArtifactsByNode(nodeArtifacts)
      if (!hydratedArtifacts) {
        continue
      }

      artifactsByNode.set(nodeId, hydratedArtifacts)
      reusedNodeIds.push(nodeId)
    }

    if (reusedNodeIds.length > 0) {
      return {
        reusedFromExecutionId: execution.id,
        reusedNodeIds,
        artifactsByNode,
      }
    }
  }

  return { reusedFromExecutionId: null, reusedNodeIds: [] as string[], artifactsByNode: new Map<string, Record<string, RuntimeArtifact>>() }
}

export class GraphWorkflowExecutor {
  static async execute(workflowId: number, options?: {
    executionId?: number
    runtimeInputValues?: Record<string, unknown>
    targetNodeId?: string
    forceRerun?: boolean
    shouldCancel?: () => boolean
  }) {
    const workflowRecord = GraphWorkflowModel.findById(workflowId)
    if (!workflowRecord) {
      throw new Error('Graph workflow not found')
    }

    const workflow = parseGraphWorkflowRecord(workflowRecord)
    const exposedInputs = workflow.graph.metadata?.exposed_inputs ?? []
    const runtimeInputValues = options?.runtimeInputValues ?? {}
    workflow.graph = applyWorkflowRuntimeInputs(workflow.graph, exposedInputs, runtimeInputValues)

    const modules = workflow.graph.nodes.map((node) => {
      const record = ModuleDefinitionModel.findById(node.module_id)
      if (!record) {
        throw new Error(`Module definition ${node.module_id} not found`)
      }
      return parseModuleDefinition(record)
    })

    const modulesById = new Map(modules.map((module) => [module.id, module]))
    validateGraphTypes(workflow.graph, modulesById)
    const targetNodeId = options?.targetNodeId
    const forceRerun = options?.forceRerun === true
    const orderedNodeIds = buildExecutionOrder(workflow.graph, targetNodeId)
    const runtimeInputSignature = buildRuntimeInputSignature(runtimeInputValues)
    const reusableNodeIds = targetNodeId ? orderedNodeIds.filter((nodeId) => nodeId !== targetNodeId) : []
    const reusedArtifacts = await findReusableExecution({
      workflowId: workflow.id,
      graphVersion: workflow.version,
      runtimeInputSignature,
      targetNodeId,
      reusableNodeIds,
      forceRerun,
    })
    const executionPlan: GraphExecutionPlan = {
      orderedNodeIds,
      targetNodeId: targetNodeId ?? null,
      runtimeInputSignature,
      runtimeInputValues,
      forceRerun,
      reusedFromExecutionId: reusedArtifacts.reusedFromExecutionId,
      reusedNodeIds: reusedArtifacts.reusedNodeIds,
    }

    const executionId = options?.executionId ?? GraphExecutionModel.create({
      graph_workflow_id: workflow.id,
      graph_version: workflow.version,
      status: 'running',
      execution_plan: JSON.stringify(executionPlan),
    })

    if (options?.executionId) {
      GraphExecutionModel.update(executionId, {
        execution_plan: JSON.stringify(executionPlan),
      })
    }

    const debugMode = isWorkflowDebugModeEnabled(workflow)
    setExecutionDebugMode(executionId, debugMode)

    writeExecutionLog({
      executionId,
      eventType: 'execution_start',
      message: targetNodeId ? `Node execution started: ${workflow.name} -> ${targetNodeId}` : `Graph execution started: ${workflow.name}`,
      details: {
        workflowId: workflow.id,
        version: workflow.version,
        orderedNodeIds,
        targetNodeId: targetNodeId ?? null,
        runtimeInputKeys: Object.keys(runtimeInputValues),
        runtimeInputSignature,
        forceRerun,
        reusedFromExecutionId: reusedArtifacts.reusedFromExecutionId,
        reusedNodeIds: reusedArtifacts.reusedNodeIds,
      },
    })

    const context: ExecutionContext = {
      executionId,
      workflow,
      modulesById,
      artifactsByNode: reusedArtifacts.artifactsByNode,
      debugMode,
      disabledOutputPorts: new Set<string>(),
      skippedNodeIds: new Set<string>(),
      shouldCancel: options?.shouldCancel,
    }

    let failedNodeIdHint: string | null = null

    try {
      const dependenciesByNode = buildNodeDependencies(workflow.graph, orderedNodeIds)
      await runReadyGraphNodes({
        orderedNodeIds,
        dependenciesByNode,
        shouldCancel: options?.shouldCancel,
        getNodeThrottleLane: (nodeId) => {
          const node = workflow.graph.nodes.find((item) => item.id === nodeId)
          const moduleDefinition = node ? modulesById.get(node.module_id) : null
          return moduleDefinition ? getNodeThrottleLane(moduleDefinition) : null
        },
        executeNode: async (nodeId) => {
          try {
            const node = workflow.graph.nodes.find((item) => item.id === nodeId)
            if (!node) {
              throw new Error(`Node ${nodeId} not found during execution`)
            }

            const moduleDefinition = modulesById.get(node.module_id)
            if (!moduleDefinition) {
              throw new Error(`Module ${node.module_id} not found during execution`)
            }

            if (node.disabled === true) {
              markNodeOutputsSkipped(context, node.id, moduleDefinition)
              writeExecutionLog({
                executionId,
                nodeId: node.id,
                eventType: 'node_skipped_disabled',
                message: `Node skipped because it is disabled: ${node.id}`,
                details: {
                  disabledOutputKeys: moduleDefinition.output_ports.map((port) => port.key),
                },
              })
              return
            }

            const inactiveBranchInputReasons = findInactiveBranchInputReasons(context, node.id)
            if (inactiveBranchInputReasons.length > 0) {
              markNodeSkippedForInactiveBranch(context, node.id, moduleDefinition, inactiveBranchInputReasons)
              return
            }

            if (reusedArtifacts.artifactsByNode.has(node.id)) {
              writeExecutionLog({
                executionId,
                nodeId: node.id,
                eventType: 'node_reused',
                message: `Node reused cached artifacts: ${node.id}`,
                details: {
                  reusedFromExecutionId: reusedArtifacts.reusedFromExecutionId,
                  artifactPorts: Object.keys(reusedArtifacts.artifactsByNode.get(node.id) || {}),
                },
              })
              return
            }

            writeExecutionLog({
              executionId,
              nodeId: node.id,
              eventType: 'node_start',
              message: `Node start: ${node.id}`,
              details: {
                moduleId: moduleDefinition.id,
                moduleName: moduleDefinition.name,
                engineType: moduleDefinition.engine_type,
              },
            })

            const incomingArtifacts = await getIncomingArtifacts(context, node.id)
            const resolvedInputs = resolveNodeInputs(node, moduleDefinition, incomingArtifacts)

            writeExecutionLog({
              executionId,
              nodeId: node.id,
              eventType: 'node_inputs_resolved',
              message: `Resolved inputs for ${node.id}`,
              details: {
                inputKeys: Object.keys(resolvedInputs),
                upstreamKeys: Object.keys(incomingArtifacts),
              },
            })

            validateRequiredInputs(node, moduleDefinition, resolvedInputs)

            if (moduleDefinition.engine_type === 'nai') {
              await executeNaiModule(context, node, moduleDefinition, resolvedInputs)
            } else if (moduleDefinition.engine_type === 'codex') {
              await executeCodexImageGenerationNode(context, node, moduleDefinition, resolvedInputs)
            } else if (moduleDefinition.engine_type === 'comfyui') {
              await executeComfyModule(context, node, moduleDefinition, resolvedInputs)
            } else if (moduleDefinition.engine_type === 'system') {
              await executeSystemModule(context, node, moduleDefinition, resolvedInputs)
            } else if (moduleDefinition.engine_type === 'custom_js') {
              await executeCustomJsModule(context, node, moduleDefinition, resolvedInputs)
            } else {
              throw new Error(`Unsupported module engine type: ${moduleDefinition.engine_type}`)
            }

            writeExecutionLog({
              executionId,
              nodeId: node.id,
              eventType: 'node_complete',
              message: `Node complete: ${node.id}`,
              details: {
                artifactPorts: Object.keys(context.artifactsByNode.get(node.id) || {}),
              },
            })
          } catch (error) {
            failedNodeIdHint = nodeId
            throw error
          }
        },
      })

      GraphExecutionModel.updateStatus(executionId, 'completed')
      writeExecutionLog({
        executionId,
        eventType: 'execution_complete',
        message: targetNodeId ? `Node execution completed: ${workflow.name} -> ${targetNodeId}` : `Graph execution completed: ${workflow.name}`,
        details: {
          orderedNodeIds,
          targetNodeId: targetNodeId ?? null,
          reusedFromExecutionId: reusedArtifacts.reusedFromExecutionId,
          reusedNodeIds: reusedArtifacts.reusedNodeIds,
        },
      })

      return {
        executionId,
        status: 'completed' as const,
        orderedNodeIds,
        targetNodeId: targetNodeId ?? null,
        artifacts: GraphExecutionArtifactModel.findByExecution(executionId),
        final_results: GraphExecutionFinalResultModel.findByExecution(executionId),
        logs: GraphExecutionLogModel.findByExecution(executionId),
      }
    } catch (error) {
      const failedNodeId = failedNodeIdHint ?? GraphExecutionLogModel.findByExecution(executionId)
        .filter((log) => log.node_id)
        .at(-1)?.node_id ?? null

      const errorMessage = error instanceof Error ? error.message : 'Unknown execution error'
      if (errorMessage === GRAPH_EXECUTION_CANCELLED_MESSAGE || error instanceof GraphWorkflowStoppedError) {
        const stoppedReason = error instanceof GraphWorkflowStoppedError ? error.reason ?? null : null
        writeExecutionLog({
          executionId,
          nodeId: failedNodeId,
          level: 'warn',
          eventType: error instanceof GraphWorkflowStoppedError ? 'execution_stopped' : 'execution_cancelled',
          message: error instanceof GraphWorkflowStoppedError
            ? stoppedReason ? `Execution stopped: ${stoppedReason}` : 'Execution stopped'
            : 'Execution cancelled',
          details: error instanceof GraphWorkflowStoppedError ? { reason: stoppedReason } : undefined,
        })
        GraphExecutionModel.updateStatus(executionId, 'cancelled', stoppedReason, failedNodeId)
        return {
          executionId,
          status: 'cancelled' as const,
          orderedNodeIds,
          targetNodeId: targetNodeId ?? null,
          artifacts: GraphExecutionArtifactModel.findByExecution(executionId),
          final_results: GraphExecutionFinalResultModel.findByExecution(executionId),
          logs: GraphExecutionLogModel.findByExecution(executionId),
        }
      }

      writeExecutionLog({
        executionId,
        nodeId: failedNodeId,
        level: 'error',
        eventType: 'execution_failed',
        message: errorMessage,
      })
      GraphExecutionModel.updateStatus(executionId, 'failed', errorMessage, failedNodeId)
      throw error
    }
  }
}

