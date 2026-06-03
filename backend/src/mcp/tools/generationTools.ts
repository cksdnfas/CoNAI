import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WorkflowModel } from '../../models/Workflow';
import { ComfyUIServerModel, WorkflowServerModel } from '../../models/ComfyUIServer';
import { ComfyUIService, ParallelGenerationService } from '../../services/comfyuiService';
import { GenerationHistoryService } from '../../services/generationHistoryService';
import { GenerationHistoryModel } from '../../models/GenerationHistory';
import { ComfyUIWorkflowParser } from '../../utils/comfyuiWorkflowParser';
import { registerNovelAiGenerationTools } from './generationNovelAiTools';
import { cleanupMcpComfyTempFile, processMcpComfyOutput } from './mcpComfyOutputService';

export function registerGenerationTools(server: McpServer): void {
  registerWorkflowListTools(server);
  registerComfyGenerationTools(server);
  registerWorkflowDetailTools(server);
  registerNovelAiGenerationTools(server);
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

        const summary = workflows.map(w => ({
          id: w.id,
          name: w.name,
          description: w.description,
          is_active: w.is_active,
          api_endpoint: w.api_endpoint,
          marked_fields: w.marked_fields ? JSON.parse(w.marked_fields) : [],
          created_date: w.created_date,
        }));

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

function registerComfyGenerationTools(server: McpServer): void {
  // ComfyUI 이미지 생성
  server.tool(
    'generate_comfyui',
    'Generate images using ComfyUI. Requires a workflow ID and server ID. The workflow must have marked fields for prompt substitution.',
    {
      workflow_id: z.number().int().describe('Workflow ID to use'),
      server_id: z.number().int().describe('ComfyUI server ID to use'),
      prompt_data: z.record(z.string(), z.any()).describe('Key-value pairs for workflow field substitution. Keys should match the marked field IDs in the workflow.'),
      group_id: z.number().int().optional().describe('Optional group ID to assign generated images to'),
    },
    async ({ workflow_id, server_id, prompt_data, group_id }) => {
      try {
        const data = prompt_data as Record<string, any>;

        const workflow = WorkflowModel.findById(workflow_id);
        if (!workflow) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Workflow with ID ${workflow_id} not found` }],
          };
        }

        const serverRecord = ComfyUIServerModel.findById(server_id);
        if (!serverRecord) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Server with ID ${server_id} not found` }],
          };
        }

        const comfyService = new ComfyUIService(serverRecord.endpoint);

        // 워크플로우 JSON 파싱 및 프롬프트 치환
        const markedFields = workflow.marked_fields ? JSON.parse(workflow.marked_fields) : [];
        const substitutedWorkflow = comfyService.substitutePromptData(
          workflow.workflow_json,
          markedFields,
          data
        );

        // 히스토리 생성 (생성 전에 먼저 생성 - 웹 UI와 동일)
        const historyId = await GenerationHistoryService.createComfyUIHistory({
          workflowId: workflow_id,
          workflowName: workflow.name,
          groupId: group_id,
          serverId: server_id,
        });

        // 이미지 생성 (temp 폴더에 다운로드)
        const result = await comfyService.generateImages(workflow, substitutedWorkflow);

        // submit 이후에는 history에 promptId를 쓰지 않고 상태만 올린다
        try {
          GenerationHistoryModel.update(historyId, {
            generation_status: 'processing' as const
          });
        } catch (e) {
          console.error('[MCP ComfyUI] Failed to update history processing status:', e);
        }

        // temp → 영구 저장소로 이동하고 메인 이미지 DB까지 즉시 등록
        const historyIds: number[] = [historyId];
        const savedPaths: string[] = [];
        let failedSaveCount = 0;
        for (let index = 0; index < result.imagePaths.length; index += 1) {
          const tempPath = result.imagePaths[index];
          let outputHistoryId = historyId;

          if (index > 0) {
            try {
              outputHistoryId = await GenerationHistoryService.createComfyUIHistory({
                workflowId: workflow_id,
                workflowName: workflow.name,
                groupId: group_id,
                serverId: server_id,
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
          if (savedPath) {
            savedPaths.push(savedPath);
          } else {
            failedSaveCount += 1;
          }
        }
        if (savedPaths.length === 0 && failedSaveCount === 0) {
          failedSaveCount = 1;
          GenerationHistoryModel.recordError(historyId, 'ComfyUI generation finished but no output file was returned');
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: savedPaths.length > 0,
              historyId,
              historyIds,
              promptId: result.promptId,
              imageCount: savedPaths.length,
              failedSaveCount,
              imagePaths: savedPaths,
              server: serverRecord.name,
              workflow: workflow.name,
              error: savedPaths.length > 0 ? undefined : 'No generated output could be saved',
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `ComfyUI generation error: ${(error as Error).message}` }],
        };
      }
    }
  );

  // ComfyUI 모든 활성 서버에 병렬 이미지 생성
  server.tool(
    'generate_comfyui_all_servers',
    'Generate images on ALL active ComfyUI servers simultaneously. Each active server will receive the same workflow and produce images in parallel.',
    {
      workflow_id: z.number().int().describe('Workflow ID to use'),
      prompt_data: z.record(z.string(), z.any()).describe('Key-value pairs for workflow field substitution. Keys should match the marked field IDs in the workflow.'),
      group_id: z.number().int().optional().describe('Optional group ID to assign generated images to'),
    },
    async ({ workflow_id, prompt_data, group_id }) => {
      try {
        const data = prompt_data as Record<string, any>;

        const workflow = WorkflowModel.findById(workflow_id);
        if (!workflow) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Workflow with ID ${workflow_id} not found` }],
          };
        }

        // 활성 서버 목록 조회
        const activeServers = ComfyUIServerModel.findAll(true);
        if (activeServers.length === 0) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'No active ComfyUI servers found. Please configure servers via the web UI.' }],
          };
        }

        const comfyService = new ComfyUIService(activeServers[0].endpoint);

        // 워크플로우 JSON 파싱 및 프롬프트 치환
        const markedFields = workflow.marked_fields ? JSON.parse(workflow.marked_fields) : [];
        const substitutedWorkflow = comfyService.substitutePromptData(
          workflow.workflow_json,
          markedFields,
          data
        );

        // 모든 활성 서버에 병렬 생성 요청
        const servers = activeServers.map(s => ({ id: s.id!, name: s.name, endpoint: s.endpoint }));
        const parallelResults = await ParallelGenerationService.generateOnMultipleServers(
          servers,
          workflow,
          substitutedWorkflow
        );

        // 각 서버 결과를 후처리 (temp → 영구 저장소, 히스토리, 해시)
        const serverResults: Array<{
          serverId: number;
          serverName: string;
          success: boolean;
          historyId?: number;
          historyIds?: number[];
          imagePaths?: string[];
          failedSaveCount?: number;
          error?: string;
        }> = [];

        for (const result of parallelResults) {
          if (!result.success || !result.imagePaths || result.imagePaths.length === 0) {
            serverResults.push({
              serverId: result.serverId,
              serverName: result.serverName,
              success: false,
              error: result.error || 'No images generated',
            });
            continue;
          }

          // 히스토리 생성
          let historyId: number | undefined;
          try {
            historyId = await GenerationHistoryService.createComfyUIHistory({
              workflowId: workflow_id,
              workflowName: workflow.name,
              groupId: group_id,
              serverId: result.serverId,
            });

            GenerationHistoryModel.update(historyId, {
              generation_status: 'processing' as const
            });
          } catch (historyError) {
            console.error(`[MCP ComfyUI Parallel] Failed to create history for server ${result.serverName}:`, historyError);
          }

          // temp → 영구 저장소로 이동하고 메인 이미지 DB까지 즉시 등록
          const historyIds: number[] = historyId ? [historyId] : [];
          const savedPaths: string[] = [];
          let failedSaveCount = 0;
          for (let index = 0; index < result.imagePaths.length; index += 1) {
            const tempPath = result.imagePaths[index];
            let outputHistoryId = historyId;

            if (!outputHistoryId || index > 0) {
              try {
                outputHistoryId = await GenerationHistoryService.createComfyUIHistory({
                  workflowId: workflow_id,
                  workflowName: workflow.name,
                  groupId: group_id,
                  serverId: result.serverId,
                });
                historyIds.push(outputHistoryId);
              } catch (historyError) {
                failedSaveCount += 1;
                console.error(`[MCP ComfyUI Parallel] Failed to create history for output ${tempPath}:`, historyError);
                await cleanupMcpComfyTempFile(tempPath);
                continue;
              }
            }

            const savedPath = await processMcpComfyOutput(outputHistoryId, tempPath);
            if (savedPath) {
              savedPaths.push(savedPath);
            } else {
              failedSaveCount += 1;
            }
          }

          serverResults.push({
            serverId: result.serverId,
            serverName: result.serverName,
            success: savedPaths.length > 0,
            historyId,
            historyIds,
            imagePaths: savedPaths,
            failedSaveCount,
            error: savedPaths.length > 0 ? undefined : 'No generated output could be saved',
          });
        }

        const successCount = serverResults.filter(r => r.success).length;

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: successCount > 0,
              totalServers: activeServers.length,
              successCount,
              failCount: activeServers.length - successCount,
              workflow: workflow.name,
              results: serverResults,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `ComfyUI parallel generation error: ${(error as Error).message}` }],
        };
      }
    }
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
        const workflow = WorkflowModel.findById(workflow_id);
        if (!workflow) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Workflow with ID ${workflow_id} not found` }],
          };
        }

        const markedFields = workflow.marked_fields ? JSON.parse(workflow.marked_fields) : [];

        // marked_fields에서 생성에 필요한 정보만 추출
        const fields = markedFields.map((f: any) => ({
          id: f.id,
          label: f.label,
          description: f.description,
          type: f.type,
          default_value: f.default_value,
          placeholder: f.placeholder,
          required: f.required,
          options: f.options,
          dropdown_list_name: f.dropdown_list_name,
          min: f.min,
          max: f.max,
        }));

        // 연결된 서버 목록 조회
        const workflowServers = WorkflowServerModel.findServersByWorkflow(workflow_id);

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
              marked_fields: fields,
              server_ids: workflowServers.map((ws: any) => ws.server_id),
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
