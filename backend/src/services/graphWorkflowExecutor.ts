import { GraphExecutionArtifactModel } from '../models/GraphExecutionArtifact'
import { GraphExecutionLogModel } from '../models/GraphExecutionLog'
import { GraphExecutionModel } from '../models/GraphExecution'
import { GraphWorkflowModel } from '../models/GraphWorkflow'
import { ModuleDefinitionModel } from '../models/ModuleDefinition'
import { getIncomingArtifacts, loadRuntimeArtifactsByNode, resolveNodeInputs } from './graph-workflow-executor/artifacts'
import { executeComfyModule } from './graph-workflow-executor/execute-comfy'
import { executeNaiModule } from './graph-workflow-executor/execute-nai'
import { executeSystemModule } from './graph-workflow-executor/execute-system'
import {
  applyWorkflowRuntimeInputs,
  buildRuntimeInputSignature,
  parseGraphWorkflowRecord,
  parseModuleDefinition,
  parseJson,
  writeExecutionLog,
  type ExecutionContext,
  type RuntimeArtifact,
} from './graph-workflow-executor/shared'
import { buildExecutionOrder, validateGraphTypes, validateRequiredInputs } from './graph-workflow-executor/validate'

/** Execute a saved module graph workflow from validation through node engines. */
const GRAPH_EXECUTION_CANCELLED_MESSAGE = '__GRAPH_EXECUTION_CANCELLED__'

type GraphExecutionPlan = {
  orderedNodeIds: string[]
  targetNodeId?: string | null
  runtimeInputSignature?: string | null
  runtimeInputValues?: Record<string, unknown>
  forceRerun?: boolean
  reusedFromExecutionId?: number | null
  reusedNodeIds?: string[]
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
    }

    try {
      for (const nodeId of orderedNodeIds) {
        if (options?.shouldCancel?.()) {
          throw new Error(GRAPH_EXECUTION_CANCELLED_MESSAGE)
        }

        const node = workflow.graph.nodes.find((item) => item.id === nodeId)
        if (!node) {
          throw new Error(`Node ${nodeId} not found during execution`)
        }

        const moduleDefinition = modulesById.get(node.module_id)
        if (!moduleDefinition) {
          throw new Error(`Module ${node.module_id} not found during execution`)
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
          continue
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

        const incomingArtifacts = getIncomingArtifacts(context, node.id)
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
        } else if (moduleDefinition.engine_type === 'comfyui') {
          await executeComfyModule(context, node, moduleDefinition, resolvedInputs)
        } else if (moduleDefinition.engine_type === 'system') {
          await executeSystemModule(context, node, moduleDefinition, resolvedInputs)
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
      }

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
        logs: GraphExecutionLogModel.findByExecution(executionId),
      }
    } catch (error) {
      const failedNodeId = GraphExecutionLogModel.findByExecution(executionId)
        .filter((log) => log.node_id)
        .at(-1)?.node_id ?? null

      const errorMessage = error instanceof Error ? error.message : 'Unknown execution error'
      if (errorMessage === GRAPH_EXECUTION_CANCELLED_MESSAGE) {
        writeExecutionLog({
          executionId,
          nodeId: failedNodeId,
          level: 'warn',
          eventType: 'execution_cancelled',
          message: 'Execution cancelled',
        })
        GraphExecutionModel.updateStatus(executionId, 'cancelled', null, failedNodeId)
        return {
          executionId,
          status: 'cancelled' as const,
          orderedNodeIds,
          targetNodeId: targetNodeId ?? null,
          artifacts: GraphExecutionArtifactModel.findByExecution(executionId),
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

