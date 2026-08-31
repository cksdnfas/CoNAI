import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WorkflowModel } from '../../models/Workflow';
import { ComfyUIServerModel } from '../../models/ComfyUIServer';
import { GenerationHistoryService } from '../../services/generationHistoryService';
import { HistoryCommandService } from '../../services/historyCommandService';
import type { ComfyUIServerRecord } from '../../types/comfyuiServer';
import type { WorkflowRecord } from '../../types/workflow';
import { registerNovelAiGenerationTools } from './generationNovelAiTools';
import { cleanupMcpComfyTempFile, processMcpComfyOutput } from './mcpComfyOutputService';
import {
  createMcpWorkflowInputTemplate,
  describeMcpMarkedField,
  parseMcpMarkedFields,
  prepareMcpComfyWorkflow,
  resolveMcpComfyServer,
} from './mcpComfyWorkflowService';
import type { McpRequestContext } from '../context';
import { registerGenerationJobTools } from './generationJobTools';
import { McpArtifactService } from '../../services/mcpArtifactService';
import { HistoryQueryRepository } from '../../repositories/history/HistoryQueryRepository';

export function registerGenerationTools(server: McpServer, context: McpRequestContext): void {
  registerWorkflowListTools(server);
  registerComfyGenerationTools(server, context);
  registerWorkflowDetailTools(server);
  registerNovelAiGenerationTools(server);
  registerGenerationJobTools(server, context);
}

function resolveUsableWorkflow(workflowId: number): WorkflowRecord {
  const workflow = WorkflowModel.findByIdIncludingDeleted(workflowId);
  if (!workflow) {
    const reference = HistoryQueryRepository.findWorkflowReference(workflowId);
    if (reference) throw new Error(`삭제된 워크플로우(사용 불가): ${reference.workflow_name ?? `ID ${workflowId}`}`);
    throw new Error(`Workflow with ID ${workflowId} not found`);
  }
  if (workflow.deleted_at) {
    throw new Error(`삭제된 워크플로우(사용 불가): ${workflow.name}`);
  }
  return workflow;
}

async function replaceOutputPathsWithArtifacts(result: Awaited<ReturnType<typeof saveMcpComfyOutputs>>, context: McpRequestContext) {
  if (!context.baseUrl) {
    return result;
  }
  const { outputPaths: _internalPaths, ...safeResult } = result;
  const artifacts = (await Promise.all(result.historyIds.map((id) => McpArtifactService.createHistoryDescriptor(id, context.baseUrl as string)))).filter(Boolean);
  return { ...safeResult, artifacts };
}

function registerWorkflowListTools(server: McpServer): void {
  // 워크플로우 목록 조회
  server.tool(
    'list_workflows',
    'List all ComfyUI workflows registered in the system.',
    {
      active_only: z.boolean().default(false).describe('Show only active workflows'),
    },
    async ({ active_only }) => {
      try {
        const workflows = WorkflowModel.findAll(active_only);

        const summary = workflows.map(w => {
          const markedFields = parseMcpMarkedFields(w);
          return {
            id: w.id,
            name: w.name,
            description: w.description,
            is_active: w.is_active,
            api_endpoint: w.api_endpoint,
            input_fields: markedFields.map(field => ({
              id: field.id,
              label: field.label,
              type: field.type,
              required: field.required === true,
              node_editor: field.node_editor,
            })),
            created_date: w.created_date,
          };
        });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(summary, null, 2),
          }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }],
        };
      }
    }
  );

  // ComfyUI 서버 목록 조회
  server.tool(
    'list_comfyui_servers',
    'List all ComfyUI servers configured in the system.',
    {
      active_only: z.boolean().default(false).describe('Show only active servers'),
    },
    async ({ active_only }) => {
      try {
        const servers = ComfyUIServerModel.findAll(active_only);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(servers, null, 2),
          }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }],
        };
      }
    }
  );
}

async function saveMcpComfyOutputs(params: {
  workflow: WorkflowRecord;
  server: ComfyUIServerRecord;
  suppliedInputs: Record<string, unknown>;
  groupId?: number;
}) {
  const { comfyService, substitutedWorkflow } = await prepareMcpComfyWorkflow({
    workflow: params.workflow,
    server: params.server,
    suppliedInputs: params.suppliedInputs,
  });

  const historyId = await GenerationHistoryService.createComfyUIHistory({
    workflowId: params.workflow.id,
    workflowName: params.workflow.name,
    groupId: params.groupId,
    serverId: params.server.id,
  });

  try {
    const result = await comfyService.generateImages(params.workflow, substitutedWorkflow);
    HistoryCommandService.update(historyId, { generation_status: 'processing' as const });

    const historyIds: number[] = [historyId];
    const savedPaths: string[] = [];
    let failedSaveCount = 0;
    for (let index = 0; index < result.imagePaths.length; index += 1) {
      const tempPath = result.imagePaths[index];
      let outputHistoryId = historyId;

      if (index > 0) {
        try {
          outputHistoryId = await GenerationHistoryService.createComfyUIHistory({
            workflowId: params.workflow.id,
            workflowName: params.workflow.name,
            groupId: params.groupId,
            serverId: params.server.id,
          });
          historyIds.push(outputHistoryId);
        } catch (historyError) {
          failedSaveCount += 1;
          console.error(`[MCP ComfyUI] Failed to create history for extra output ${tempPath}:`, historyError);
          await cleanupMcpComfyTempFile(tempPath);
          continue;
        }
      }

      const savedPath = await processMcpComfyOutput(outputHistoryId, tempPath);
      if (savedPath) savedPaths.push(savedPath);
      else failedSaveCount += 1;
    }

    if (savedPaths.length === 0) {
      HistoryCommandService.recordError(historyId, 'ComfyUI generation finished but no output file was returned');
    }

    return {
      success: savedPaths.length > 0,
      historyId,
      historyIds,
      promptId: result.promptId,
      outputCount: savedPaths.length,
      failedSaveCount,
      outputPaths: savedPaths,
      serverId: params.server.id,
      server: params.server.name,
      workflow: params.workflow.name,
      error: savedPaths.length > 0 ? undefined : 'No generated output could be saved',
    };
  } catch (error) {
    HistoryCommandService.recordError(historyId, error instanceof Error ? error.message : 'Unknown ComfyUI generation error');
    throw error;
  }
}

function registerComfyGenerationTools(server: McpServer, context: McpRequestContext): void {
  const inputSchema = {
    workflow_id: z.number().int().describe('Workflow ID to use'),
    server_id: z.number().int().optional().describe('Optional ComfyUI server ID. If omitted, an enabled workflow-linked server, the active default, or the first active server is selected.'),
    inputs: z.record(z.string(), z.unknown()).optional().describe('Workflow inputs keyed by marked field ID. Partial MiniMax H3 Director objects and media data URLs are supported.'),
    prompt_data: z.record(z.string(), z.unknown()).optional().describe('Legacy alias for inputs.'),
    group_id: z.number().int().optional().describe('Optional group ID to assign generated outputs to'),
  };

  server.tool(
    'generate_comfyui',
    'Compatibility synchronous ComfyUI generation. Prefer submit_generation_job for durable work that may exceed the HTTP connection lifetime.',
    inputSchema,
    async ({ workflow_id, server_id, inputs, prompt_data, group_id }) => {
      try {
        const workflow = resolveUsableWorkflow(workflow_id);
        if (!workflow.is_active) throw new Error(`Workflow with ID ${workflow_id} is inactive`);
        const serverRecord = resolveMcpComfyServer(workflow_id, server_id);
        const result = await saveMcpComfyOutputs({
          workflow,
          server: serverRecord,
          suppliedInputs: (inputs ?? prompt_data ?? {}) as Record<string, unknown>,
          groupId: group_id,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(await replaceOutputPathsWithArtifacts(result, context), null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `ComfyUI generation error: ${(error as Error).message}` }],
        };
      }
    },
  );

  server.tool(
    'generate_comfyui_all_servers',
    'Compatibility synchronous generation on all active ComfyUI servers. Prefer submit_generation_job for durable work.',
    {
      workflow_id: z.number().int().describe('Workflow ID to use'),
      inputs: z.record(z.string(), z.unknown()).optional().describe('Workflow inputs keyed by marked field ID.'),
      prompt_data: z.record(z.string(), z.unknown()).optional().describe('Legacy alias for inputs.'),
      group_id: z.number().int().optional().describe('Optional group ID to assign generated outputs to'),
    },
    async ({ workflow_id, inputs, prompt_data, group_id }) => {
      try {
        const workflow = resolveUsableWorkflow(workflow_id);
        if (!workflow.is_active) throw new Error(`Workflow with ID ${workflow_id} is inactive`);
        const activeServers = ComfyUIServerModel.findAll(true);
        if (activeServers.length === 0) throw new Error('No active ComfyUI servers found');
        const suppliedInputs = (inputs ?? prompt_data ?? {}) as Record<string, unknown>;
        const settled = await Promise.all(activeServers.map(async (serverRecord) => {
          try {
            const result = await saveMcpComfyOutputs({
              workflow,
              server: serverRecord,
              suppliedInputs,
              groupId: group_id,
            });
            return await replaceOutputPathsWithArtifacts(result, context);
          } catch (error) {
            return {
              success: false,
              serverId: serverRecord.id,
              server: serverRecord.name,
              workflow: workflow.name,
              error: error instanceof Error ? error.message : 'Unknown generation error',
            };
          }
        }));
        const successCount = settled.filter(result => result.success).length;
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: successCount > 0,
              totalServers: activeServers.length,
              successCount,
              failCount: activeServers.length - successCount,
              workflow: workflow.name,
              results: settled,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `ComfyUI parallel generation error: ${(error as Error).message}` }],
        };
      }
    },
  );
}

function registerWorkflowDetailTools(server: McpServer): void {
  // 워크플로우 상세 조회
  server.tool(
    'get_workflow_details',
    'Get detailed information about a specific ComfyUI workflow, including its marked fields (parameters required for generation).',
    {
      workflow_id: z.number().int().describe('Workflow ID to get details for'),
    },
    async ({ workflow_id }) => {
      try {
        const workflow = WorkflowModel.findByIdIncludingDeleted(workflow_id);
        if (!workflow || workflow.deleted_at) {
          const reference = HistoryQueryRepository.findWorkflowReference(workflow_id);
          return {
            isError: true,
            content: [{ type: 'text' as const, text: !workflow && !reference
              ? `Workflow with ID ${workflow_id} not found`
              : `삭제된 워크플로우(사용 불가): ${workflow?.name ?? reference?.workflow_name ?? `ID ${workflow_id}`}` }],
          };
        }

        const markedFields = parseMcpMarkedFields(workflow);
        const selectedServer = (() => {
          try {
            return resolveMcpComfyServer(workflow_id);
          } catch {
            return null;
          }
        })();

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              id: workflow.id,
              name: workflow.name,
              description: workflow.description,
              is_active: workflow.is_active,
              api_endpoint: workflow.api_endpoint,
              color: workflow.color,
              input_schema: markedFields.map(describeMcpMarkedField),
              input_values_template: createMcpWorkflowInputTemplate(markedFields),
              invocation: {
                tool: 'generate_comfyui',
                arguments: {
                  workflow_id: workflow.id,
                  inputs: createMcpWorkflowInputTemplate(markedFields),
                },
                notes: [
                  'Every input key is a marked field ID.',
                  'Any omitted field uses its saved workflow default.',
                  'server_id is optional and auto-resolved when omitted.',
                ],
              },
              auto_selected_server: selectedServer ? { id: selectedServer.id, name: selectedServer.name } : null,
              created_date: workflow.created_date,
              updated_date: workflow.updated_date,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }],
        };
      }
    }
  );
}
