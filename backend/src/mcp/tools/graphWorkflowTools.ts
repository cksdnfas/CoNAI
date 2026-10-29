import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { GraphExecutionModel } from '../../models/GraphExecution'
import { GraphExecutionArtifactModel } from '../../models/GraphExecutionArtifact'
import { GraphExecutionFinalResultModel } from '../../models/GraphExecutionFinalResult'
import { GraphWorkflowModel } from '../../models/GraphWorkflow'
import { GraphWorkflowExecutor } from '../../services/graphWorkflowExecutor'
import { decorateGraphExecutionRecord } from '../../services/graphWorkflowViewService'
import type { GraphWorkflowDocument, GraphWorkflowExposedInput } from '../../types/moduleGraph'
import type { McpRequestContext } from '../context'
import { McpArtifactService } from '../../services/mcpArtifactService'
import { mcpGroupPathSchema, resolveMcpTargetGroup } from './mcpTargetGroup'
import { errorResult, textResult } from '../toolResults'
import { GRAPH_IMAGE_AUTHORITY_INPUT, withMcpGraphImageAuthority } from '../../services/graph-workflow-executor/graphImageAuthority'

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
    // Run inputs keep library images by reference; the executor loads the bytes.
    ...(input.data_type === 'image' || input.data_type === 'mask' ? { value_format: '{ "composite_hash": "<library image hash from search_images>" }' } : {}),
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
  if (Object.prototype.hasOwnProperty.call(supplied, GRAPH_IMAGE_AUTHORITY_INPUT)) throw new Error('Graph image authority is server-issued')
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

async function compactGraphExecution(executionId: number, context: McpRequestContext) {
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
    final_results: GraphExecutionFinalResultModel.findByExecution(executionId).map((result) => ({
      id: result.id,
      execution_id: result.execution_id,
      final_node_id: result.final_node_id,
      source_artifact_id: result.source_artifact_id,
      source_node_id: result.source_node_id,
      source_port_key: result.source_port_key,
      artifact_type: result.artifact_type,
      created_date: result.created_date,
    })),
    artifacts: context.baseUrl && !context.requester
      ? (await Promise.all(GraphExecutionArtifactModel.findByExecution(executionId)
          .map((artifact) => McpArtifactService.createGraphDescriptor(artifact.id, context.baseUrl as string))))
          .filter(Boolean)
      : [],
  }
}

export function registerGraphWorkflowTools(server: McpServer, context: McpRequestContext): void {
  server.registerTool(
    'list_graph_workflows',
    { description: 'List user-built workflows from the /generation?tab=workflows workspace.', inputSchema: z.object({ active_only: z.boolean().default(false).describe('Show only active graph workflows') }) },
    async ({ active_only }) => {
      try {
        return textResult(GraphWorkflowModel.findAllSummaries(active_only))
      } catch (error) {
        return errorResult(`Error: ${(error as Error).message}`)
      }
    },
  )

  server.registerTool(
    'get_graph_workflow_details',
    { description: 'Get the explicit MCP input schema for a user-built workflow from /generation?tab=workflows. Image and mask inputs take a library image ref { "composite_hash": "…" } (see value_format), never a file or data URL.', inputSchema: z.object({ workflow_id: z.number().int().describe('Graph workflow ID') }) },
    async ({ workflow_id }) => {
      try {
        const workflow = GraphWorkflowModel.findById(workflow_id)
        if (!workflow) throw new Error(`Graph workflow ${workflow_id} not found`)
        const graph = parseGraphDocument(workflow.graph_json)
        const exposedInputs = graph.metadata?.exposed_inputs ?? []
        const inputSchema = exposedInputs.map(describeGraphInput)
        const inputTemplate = createGraphInputTemplate(exposedInputs)
        return textResult({
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          version: workflow.version,
          is_active: workflow.is_active,
          input_schema: inputSchema,
          input_values_template: inputTemplate,
          invocation: {
            tool: 'execute_graph_workflow',
            arguments: { workflow_id: workflow.id, input_values: inputTemplate },
          },
        })
      } catch (error) {
        return errorResult(`Error: ${(error as Error).message}`)
      }
    },
  )

  server.registerTool(
    'execute_graph_workflow',
    { description: 'Execute a user-built workflow synchronously. Works over both stateless HTTP MCP and standalone stdio MCP.', inputSchema: z.object({
      workflow_id: z.number().int().describe('Graph workflow ID'),
      input_values: z.record(z.string(), z.unknown()).default({}).describe('Values keyed by exposed input ID. Omitted inputs use workflow defaults.'),
      group_id: z.number().int().positive().optional().describe('Default image group for final results. A final-result node with its own group path overrides it.'),
      group_path: mcpGroupPathSchema,
    }) },
    async ({ workflow_id, input_values, group_id, group_path }) => {
      try {
        const workflow = GraphWorkflowModel.findById(workflow_id)
        if (!workflow) throw new Error(`Graph workflow ${workflow_id} not found`)
        if (!workflow.is_active) throw new Error(`Graph workflow ${workflow_id} is inactive`)
        const graph = parseGraphDocument(workflow.graph_json)
        const runtimeInputs = validateGraphInputs(graph.metadata?.exposed_inputs ?? [], input_values as Record<string, unknown>)
        const outputGroupId = resolveMcpTargetGroup(group_id, group_path)
        const result = await withMcpGraphImageAuthority(context, () => GraphWorkflowExecutor.execute(workflow_id, { runtimeInputValues: runtimeInputs, outputGroupId: outputGroupId ?? null, requestedByAccountId: context.requester?.accountId ?? null }))
        const compactResult = await compactGraphExecution(result.executionId, context)
        return textResult(compactResult)
      } catch (error) {
        return errorResult(`Graph workflow execution error: ${(error as Error).message}`)
      }
    },
  )

  server.registerTool(
    'get_graph_workflow_execution',
    { description: 'Get status, final results, and artifacts for a graph workflow execution.', inputSchema: z.object({ execution_id: z.number().int().describe('Graph workflow execution ID') }) },
    async ({ execution_id }) => {
      try {
        const result = await compactGraphExecution(execution_id, context)
        if (!result) throw new Error(`Graph workflow execution ${execution_id} not found`)
        return textResult(result)
      } catch (error) {
        return errorResult(`Error: ${(error as Error).message}`)
      }
    },
  )
}
