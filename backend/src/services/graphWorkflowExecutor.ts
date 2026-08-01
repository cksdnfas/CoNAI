import { GraphExecutionArtifactModel } from '../models/GraphExecutionArtifact'
import { GraphExecutionFinalResultModel } from '../models/GraphExecutionFinalResult'
import { GraphExecutionLogModel } from '../models/GraphExecutionLog'
import { GraphExecutionModel } from '../models/GraphExecution'
import { GraphExecutionNodeIoModel } from '../models/GraphExecutionNodeIo'
import { GraphWorkflowModel } from '../models/GraphWorkflow'
import { ModuleDefinitionModel } from '../models/ModuleDefinition'
import { getIncomingArtifacts, loadRuntimeArtifactsByNode, resolveNodeInputs } from './graph-workflow-executor/artifacts'
import { executeComfyModule } from './graph-workflow-executor/execute-comfy'
import { executeCustomJsModule } from './graph-workflow-executor/execute-custom-js'
import { executeNaiModule } from './graph-workflow-executor/execute-nai'
import { executeCodexImageGenerationNode } from './graph-workflow-executor/system-codex-operations'
import { executeSystemModule } from './graph-workflow-executor/execute-system'
import { compactCompletedGraphExecutionArtifacts, persistCompactGraphExecutionNodeIo } from './graphWorkflowExecutionCompactor'
import { requestGraphWorkflowOutputRetentionPrune } from './graphWorkflowOutputRetentionService'
import {
  applyWorkflowRuntimeInputs,
  buildRuntimeInputSignature,
  parseGraphWorkflowRecord,
  parseModuleDefinition,
  parseJson,
  GraphWorkflowStoppedError,
  getExecutionGraphIndex,
  isWorkflowDebugModeEnabled,
  resolveSystemOperationKey,
  setExecutionDebugMode,
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
  type RuntimeArtifact,
} from './graph-workflow-executor/shared'
import { buildExecutionOrder, validateGraphTypes, validateRequiredInputs } from './graph-workflow-executor/validate'
import {
  createExecutionAbortHandle,
  isGraphCancellationError,
  registerExecutionAbortHandle,
  unregisterExecutionAbortHandle,
  GraphAbortError,
} from './graph-workflow-executor/execution-abort'
import {
  runReadyGraphNodes,
  GraphExecutionNoRunnableNodesError,
  type GraphNodeThrottleLane,
} from './graph-workflow-executor/node-scheduler'

/** Execute a saved module graph workflow from validation through node engines. */
type GraphExecutionPlan = {
  orderedNodeIds: string[]
  targetNodeId?: string | null
  runtimeInputSignature?: string | null
  runtimeInputValues?: Record<string, unknown>
  forceRerun?: boolean
  reusedFromExecutionId?: number | null
  reusedNodeIds?: string[]
}

const VOLATILE_SYSTEM_OPERATION_KEYS = new Set([
  'system.random_text_choice',
  'system.apply_wildcards',
  'system.random_prompt_from_group',
  'system.random_image_from_library',
  'system.random_video_from_library',
])

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

function isVolatileSystemModule(moduleDefinition: { engine_type: string; internal_fixed_values?: Record<string, any>; template_defaults?: Record<string, any> }) {
  if (moduleDefinition.engine_type !== 'system') {
    return false
  }

  const operationKey = resolveSystemOperationKey(moduleDefinition)
  return Boolean(operationKey && VOLATILE_SYSTEM_OPERATION_KEYS.has(operationKey))
}

/** Collect volatile nodes and their downstream dependents so partial runs do not reuse stale random outputs. */
function collectVolatileAffectedNodeIds(params: {
  graph: { edges: Array<{ source_node_id: string; target_node_id: string }> }
  orderedNodeIds: string[]
  moduleByNodeId: ReadonlyMap<string, ParsedModuleDefinition>
}) {
  const orderedNodeIdSet = new Set(params.orderedNodeIds)
  const adjacency = new Map<string, string[]>()
  const affectedNodeIds = new Set<string>()

  for (const nodeId of params.orderedNodeIds) {
    adjacency.set(nodeId, [])
    const moduleDefinition = params.moduleByNodeId.get(nodeId)
    if (moduleDefinition && isVolatileSystemModule(moduleDefinition)) {
      affectedNodeIds.add(nodeId)
    }
  }

  for (const edge of params.graph.edges) {
    if (orderedNodeIdSet.has(edge.source_node_id) && orderedNodeIdSet.has(edge.target_node_id)) {
      adjacency.get(edge.source_node_id)?.push(edge.target_node_id)
    }
  }

  const pendingNodeIds = Array.from(affectedNodeIds)
  while (pendingNodeIds.length > 0) {
    const nodeId = pendingNodeIds.pop() as string
    for (const nextNodeId of adjacency.get(nodeId) ?? []) {
      if (!affectedNodeIds.has(nextNodeId)) {
        affectedNodeIds.add(nextNodeId)
        pendingNodeIds.push(nextNodeId)
      }
    }
  }

  return affectedNodeIds
}

function isExternalGenerationModule(moduleDefinition: { engine_type: string; internal_fixed_values?: Record<string, any>; template_defaults?: Record<string, any> }) {
  if (moduleDefinition.engine_type === 'comfyui' || moduleDefinition.engine_type === 'codex' || moduleDefinition.engine_type === 'nai') {
    return true
  }

  if (moduleDefinition.engine_type !== 'system') {
    return false
  }

  const operationKey = resolveSystemOperationKey(moduleDefinition)
  return operationKey === 'system.generate_image_nai' || operationKey === 'system.generate_image_codex'
}

function getNodeThrottleLane(moduleDefinition: { engine_type: string; internal_fixed_values?: Record<string, any>; template_defaults?: Record<string, any> }): GraphNodeThrottleLane | null {
  return isExternalGenerationModule(moduleDefinition) ? 'external_generation' : null
}

function isIfBranchModule(moduleDefinition: { internal_fixed_values?: Record<string, any>; template_defaults?: Record<string, any> }) {
  return resolveSystemOperationKey(moduleDefinition) === 'system.logic_if_branch'
}

function findInactiveBranchInputReasons(context: ExecutionContext, nodeId: string) {
  const { nodeById, edgesByTarget } = getExecutionGraphIndex(context)
  return (edgesByTarget.get(nodeId) ?? [])
    .flatMap((edge) => {
      if (context.skippedNodeIds?.has(edge.source_node_id)) {
        return [{ ...edge, reason: 'source_node_skipped' }]
      }

      if (context.disabledOutputPorts?.has(buildNodeOutputKey(edge.source_node_id, edge.source_port_key))) {
        return [{ ...edge, reason: 'source_output_disabled' }]
      }

      const sourceNode = nodeById.get(edge.source_node_id)
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
    // The frontend derives skip/branch UI state from this row, so persist it outside debug mode too.
    always: true,
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
    const moduleByNodeId = new Map(workflow.graph.nodes.map((node) => {
      const moduleDefinition = modulesById.get(node.module_id)
      if (!moduleDefinition) {
        throw new Error(`Module definition ${node.module_id} not found`)
      }
      return [node.id, moduleDefinition] as const
    }))
    const targetNodeId = options?.targetNodeId
    const forceRerun = options?.forceRerun === true
    const orderedNodeIds = buildExecutionOrder(workflow.graph, targetNodeId)
    const runtimeInputSignature = buildRuntimeInputSignature(runtimeInputValues)
    const volatileAffectedNodeIds = targetNodeId
      ? collectVolatileAffectedNodeIds({ graph: workflow.graph, orderedNodeIds, moduleByNodeId })
      : new Set<string>()
    const reusableNodeIds = targetNodeId ? orderedNodeIds.filter((nodeId) => nodeId !== targetNodeId && !volatileAffectedNodeIds.has(nodeId)) : []
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

    const executionPlanJson = JSON.stringify(executionPlan)
    let executionId: number
    if (options?.executionId !== undefined) {
      executionId = options.executionId
      GraphExecutionModel.update(executionId, {
        execution_plan: executionPlanJson,
      })
    } else {
      executionId = GraphExecutionModel.create({
        graph_workflow_id: workflow.id,
        graph_version: workflow.version,
        status: 'running',
        execution_plan: executionPlanJson,
      })
    }

    const debugMode = isWorkflowDebugModeEnabled(workflow)
    let failedNodeIdHint: string | null = null
    let terminalStatusWritten = false
    const abortHandle = createExecutionAbortHandle(executionId)

    // 종료 상태는 실행당 한 번만 쓴다. 드레인을 넘긴 고아 노드나 큐 백스톱이 확정된 결과를 되돌리지 못하게 한다.
    const finalizeExecutionStatus = (
      status: 'completed' | 'cancelled' | 'failed',
      errorMessage?: string | null,
      failedNodeId?: string | null,
    ) => {
      if (terminalStatusWritten) {
        console.warn(`⚠️ Ignored duplicate terminal status write for graph execution ${executionId}: ${status}`)
        return false
      }

      terminalStatusWritten = true
      return GraphExecutionModel.updateStatusIfActive(executionId, status, errorMessage ?? null, failedNodeId ?? null)
    }

    try {
      // Register the debug flag as the first statement inside the try, so the finally below always
      // releases it even when the execution_start log write or the graph index build throws.
      setExecutionDebugMode(executionId, debugMode)
      // 실행 컨텍스트는 지역 변수라 외부에서 도달할 수 없다. abort 핸들만 레지스트리에 올려 두고 finally 에서 해제한다.
      registerExecutionAbortHandle(abortHandle)

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
        signal: abortHandle.signal,
        abort: abortHandle.abort,
        getAbortReason: abortHandle.getReason,
        // 기존 폴링 소비처(queue-wait, codexMessageService)를 그대로 살리려고 signal 과 OR 로 합성한다.
        shouldCancel: () => abortHandle.signal.aborted || options?.shouldCancel?.() === true,
      }

      const { nodeById } = getExecutionGraphIndex(context)
      const dependenciesByNode = buildNodeDependencies(workflow.graph, orderedNodeIds)
      await runReadyGraphNodes({
        orderedNodeIds,
        dependenciesByNode,
        signal: abortHandle.signal,
        abort: abortHandle.abort,
        shouldCancel: options?.shouldCancel,
        getNodeThrottleLane: (nodeId) => {
          const moduleDefinition = moduleByNodeId.get(nodeId)
          return moduleDefinition ? getNodeThrottleLane(moduleDefinition) : null
        },
        onNodeSettled: (nodeId, error) => {
          if (!(error instanceof GraphAbortError)) {
            return
          }

          writeExecutionLog({
            executionId,
            nodeId,
            level: 'warn',
            eventType: 'node_aborted',
            message: `Node aborted: ${nodeId}`,
            details: {
              abortKind: error.reason.kind,
              abortSourceNodeId: error.reason.nodeId ?? null,
            },
            // The frontend shows an "aborted" node badge from this row, so persist it outside debug mode too.
            always: true,
          })
        },
        onDrainTimeout: (drainingNodeIds) => {
          writeExecutionLog({
            executionId,
            level: 'warn',
            eventType: 'execution_abort_drain_timeout',
            message: `Aborted graph nodes did not settle before the drain timeout: ${drainingNodeIds.join(', ')}`,
            details: { drainingNodeIds },
            always: true,
          })
        },
        executeNode: async (nodeId) => {
          try {
            const node = nodeById.get(nodeId)
            if (!node) {
              throw new Error(`Node ${nodeId} not found during execution`)
            }

            const moduleDefinition = moduleByNodeId.get(nodeId)
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
                // The frontend derives skip UI state from this row, so persist it outside debug mode too.
                always: true,
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
            // With parallel nodes, the first failure's message is what gets persisted; keep its hint.
            // Siblings killed by that first failure raise GraphAbortError, so they must not steal the hint.
            if (failedNodeIdHint === null && !(error instanceof GraphAbortError)) {
              failedNodeIdHint = nodeId
            }
            throw error
          }
        },
      })

      persistCompactGraphExecutionNodeIo(context)
      const compactionResult = await compactCompletedGraphExecutionArtifacts(context)
      finalizeExecutionStatus('completed')
      writeExecutionLog({
        executionId,
        eventType: 'execution_complete',
        message: targetNodeId ? `Node execution completed: ${workflow.name} -> ${targetNodeId}` : `Graph execution completed: ${workflow.name}`,
        details: {
          orderedNodeIds,
          targetNodeId: targetNodeId ?? null,
          reusedFromExecutionId: reusedArtifacts.reusedFromExecutionId,
          reusedNodeIds: reusedArtifacts.reusedNodeIds,
          compaction: compactionResult,
        },
      })
      requestGraphWorkflowOutputRetentionPrune(workflow.id)

      return {
        executionId,
        status: 'completed' as const,
        orderedNodeIds,
        targetNodeId: targetNodeId ?? null,
        artifacts: GraphExecutionArtifactModel.findByExecution(executionId),
        final_results: GraphExecutionFinalResultModel.findByExecution(executionId),
        node_io: GraphExecutionNodeIoModel.findByExecution(executionId),
        logs: GraphExecutionLogModel.findByExecution(executionId),
      }
    } catch (error) {
      const failedNodeId = failedNodeIdHint ?? GraphExecutionLogModel.findByExecution(executionId)
        .filter((log) => log.node_id)
        .at(-1)?.node_id ?? null

      const errorMessage = error instanceof Error ? error.message : 'Unknown execution error'
      if (isGraphCancellationError(error) || error instanceof GraphWorkflowStoppedError) {
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
        finalizeExecutionStatus('cancelled', stoppedReason, failedNodeId)
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
        details: error instanceof GraphExecutionNoRunnableNodesError
          ? { noRunnableNodes: error.diagnostic }
          : undefined,
        always: error instanceof GraphExecutionNoRunnableNodesError,
      })
      finalizeExecutionStatus('failed', errorMessage, failedNodeId)
      throw error
    } finally {
      // The debug flag lives in a module-level set; clear it so finished execution ids do not leak.
      setExecutionDebugMode(executionId, false)
      // The abort registry is module-level too; release it in the same place so no execution id leaks.
      unregisterExecutionAbortHandle(executionId)
    }
  }
}

