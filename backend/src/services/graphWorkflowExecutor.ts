import { GraphExecutionArtifactModel } from '../models/GraphExecutionArtifact'
import { GraphExecutionLogModel } from '../models/GraphExecutionLog'
import { GraphExecutionModel } from '../models/GraphExecution'
import { GraphWorkflowModel } from '../models/GraphWorkflow'
import { ModuleDefinitionModel } from '../models/ModuleDefinition'
import { getIncomingArtifacts, resolveNodeInputs } from './graph-workflow-executor/artifacts'
import { executeComfyModule } from './graph-workflow-executor/execute-comfy'
import { executeNaiModule } from './graph-workflow-executor/execute-nai'
import { executeSystemModule } from './graph-workflow-executor/execute-system'
import {
  applyWorkflowRuntimeInputs,
  parseGraphWorkflowRecord,
  parseModuleDefinition,
  writeExecutionLog,
  type ExecutionContext,
} from './graph-workflow-executor/shared'
import { buildExecutionOrder, validateGraphTypes, validateRequiredInputs } from './graph-workflow-executor/validate'

/** Execute a saved module graph workflow from validation through node engines. */
const GRAPH_EXECUTION_CANCELLED_MESSAGE = '__GRAPH_EXECUTION_CANCELLED__'

export class GraphWorkflowExecutor {
  static async execute(workflowId: number, options?: {
    executionId?: number
    runtimeInputValues?: Record<string, unknown>
    targetNodeId?: string
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
    const orderedNodeIds = buildExecutionOrder(workflow.graph, targetNodeId)

    const executionId = options?.executionId ?? GraphExecutionModel.create({
      graph_workflow_id: workflow.id,
      graph_version: workflow.version,
      status: 'running',
      execution_plan: JSON.stringify({ orderedNodeIds, targetNodeId: targetNodeId ?? null }),
    })

    if (options?.executionId) {
      GraphExecutionModel.update(executionId, {
        execution_plan: JSON.stringify({ orderedNodeIds, targetNodeId: targetNodeId ?? null }),
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
      },
    })

    const context: ExecutionContext = {
      executionId,
      workflow,
      modulesById,
      artifactsByNode: new Map(),
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

