import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { GraphExecutionModel } from '../../models/GraphExecution'
import { GraphExecutionArtifactModel } from '../../models/GraphExecutionArtifact'
import { GraphExecutionFinalResultModel } from '../../models/GraphExecutionFinalResult'
import { GraphWorkflowModel } from '../../models/GraphWorkflow'
import { GraphWorkflowExecutor } from '../../services/graphWorkflowExecutor'
import { decorateGraphExecutionRecord } from '../../services/graphWorkflowViewService'
import type { GraphWorkflowDocument, GraphWorkflowExposedInput } from '../../types/moduleGraph'

function parseGraphDocument(graphJson: string): GraphWorkflowDocument {
  const parsed = JSON.parse(graphJson)
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
    throw new Error('Graph workflow has invalid graph_json')
  }
  return parsed as GraphWorkflowDocument
}

function hasMeaningfulValue(value: unknown) {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

function describeGraphInput(input: GraphWorkflowExposedInput) {
  return {
    id: input.id,
    label: input.label,
    description: input.description,
    data_type: input.data_type,
    ui_data_type: input.ui_data_type,
    required: input.required === true,
    placeholder: input.placeholder,
    has_default: input.default_value !== undefined,
    default_value: input.default_value,
    options: input.options,
    source: {
      node_id: input.node_id,
      port_key: input.port_key,
      module_id: input.module_id,
      module_name: input.module_name,
    },
  }
}

function createGraphInputTemplate(inputs: GraphWorkflowExposedInput[]) {
  return Object.fromEntries(inputs.map(input => [input.id, input.default_value ?? null]))
}

function validateGraphInputs(exposedInputs: GraphWorkflowExposedInput[], supplied: Record<string, unknown>) {
  const inputById = new Map(exposedInputs.map(input => [input.id, input]))
  const unknownIds = Object.keys(supplied).filter(id => !inputById.has(id))
  if (unknownIds.length > 0) throw new Error(`Unknown graph workflow input(s): ${unknownIds.join(', ')}`)

  const runtimeInputs: Record<string, unknown> = {}
  for (const input of exposedInputs) {
    const suppliedValue = Object.prototype.hasOwnProperty.call(supplied, input.id) ? supplied[input.id] : undefined
    const value = suppliedValue !== undefined ? suppliedValue : input.default_value
    if (input.required && !hasMeaningfulValue(value)) {
      throw new Error(`Required graph workflow input is missing: ${input.label || input.id} (${input.id})`)
    }
    if (value === undefined) continue
    if (input.options?.length && typeof value === 'string' && !input.options.includes(value)) {
      throw new Error(`${input.label || input.id} must be one of: ${input.options.join(', ')}`)
    }
    if (input.data_type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error(`${input.label || input.id} must be a finite number`)
    }
    if (input.data_type === 'boolean' && typeof value !== 'boolean') {
      throw new Error(`${input.label || input.id} must be a boolean`)
    }
    runtimeInputs[input.id] = value
  }
  return runtimeInputs
}

function compactGraphExecution(executionId: number) {
  const execution = GraphExecutionModel.findById(executionId)
  if (!execution) return null
  const decorated = decorateGraphExecutionRecord(execution)
  return {
    execution: {
      id: decorated.id,
      graph_workflow_id: decorated.graph_workflow_id,
      graph_version: decorated.graph_version,
      status: decorated.status,
      trigger_type: decorated.trigger_type,
      started_at: decorated.started_at,
      completed_at: decorated.completed_at,
      failed_node_id: decorated.failed_node_id,
      error_message: decorated.error_message,
      queue_position: decorated.queue_position,
      cancel_requested: decorated.cancel_requested,
      created_date: decorated.created_date,
      updated_date: decorated.updated_date,
    },
    final_results: GraphExecutionFinalResultModel.findByExecution(executionId),
    artifacts: GraphExecutionArtifactModel.findByExecution(executionId),
  }
}

export function registerGraphWorkflowTools(server: McpServer): void {
  server.tool(
    'list_graph_workflows',
    'List user-built workflows from the /generation?tab=workflows workspace.',
    { active_only: z.boolean().default(false).describe('Show only active graph workflows') },
    async ({ active_only }) => {
      try {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(GraphWorkflowModel.findAllSummaries(active_only), null, 2) }],
        }
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }] }
      }
    },
  )

  server.tool(
    'get_graph_workflow_details',
    'Get the explicit MCP input schema for a user-built workflow from /generation?tab=workflows.',
    { workflow_id: z.number().int().describe('Graph workflow ID') },
    async ({ workflow_id }) => {
      try {
        const workflow = GraphWorkflowModel.findById(workflow_id)
        if (!workflow) throw new Error(`Graph workflow ${workflow_id} not found`)
        const graph = parseGraphDocument(workflow.graph_json)
        const exposedInputs = graph.metadata?.exposed_inputs ?? []
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              id: workflow.id,
              name: workflow.name,
              description: workflow.description,
              version: workflow.version,
              is_active: workflow.is_active,
              input_schema: exposedInputs.map(describeGraphInput),
              input_values_template: createGraphInputTemplate(exposedInputs),
              invocation: {
                tool: 'execute_graph_workflow',
                arguments: { workflow_id: workflow.id, input_values: createGraphInputTemplate(exposedInputs) },
              },
            }, null, 2),
          }],
        }
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }] }
      }
    },
  )

  server.tool(
    'execute_graph_workflow',
    'Execute a user-built workflow synchronously. Works over both stateless HTTP MCP and standalone stdio MCP.',
    {
      workflow_id: z.number().int().describe('Graph workflow ID'),
      input_values: z.record(z.string(), z.unknown()).default({}).describe('Values keyed by exposed input ID. Omitted inputs use workflow defaults.'),
    },
    async ({ workflow_id, input_values }) => {
      try {
        const workflow = GraphWorkflowModel.findById(workflow_id)
        if (!workflow) throw new Error(`Graph workflow ${workflow_id} not found`)
        if (!workflow.is_active) throw new Error(`Graph workflow ${workflow_id} is inactive`)
        const graph = parseGraphDocument(workflow.graph_json)
        const runtimeInputs = validateGraphInputs(graph.metadata?.exposed_inputs ?? [], input_values as Record<string, unknown>)
        const result = await GraphWorkflowExecutor.execute(workflow_id, { runtimeInputValues: runtimeInputs })
        const compactResult = compactGraphExecution(result.executionId)
        return { content: [{ type: 'text' as const, text: JSON.stringify(compactResult, null, 2) }] }
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: `Graph workflow execution error: ${(error as Error).message}` }] }
      }
    },
  )

  server.tool(
    'get_graph_workflow_execution',
    'Get status, final results, and artifacts for a graph workflow execution.',
    { execution_id: z.number().int().describe('Graph workflow execution ID') },
    async ({ execution_id }) => {
      try {
        const result = compactGraphExecution(execution_id)
        if (!result) throw new Error(`Graph workflow execution ${execution_id} not found`)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }] }
      }
    },
  )
}
