import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { WorkflowModel } from '../../models/Workflow';
import { ComfyUIServerModel, WorkflowServerModel } from '../../models/ComfyUIServer';
import { ComfyUIService, ParallelGenerationService } from '../../services/comfyuiService';
import { GenerationHistoryService } from '../../services/generationHistoryService';
import { GenerationHistoryModel } from '../../models/GenerationHistory';
import { ComfyUIWorkflowParser } from '../../utils/comfyuiWorkflowParser';
import { ImageSimilarityService } from '../../services/imageSimilarity';
import { runtimePaths } from '../../config/runtimePaths';
import { getToken } from '../../utils/nai/auth';
import { preprocessMetadata } from '../../utils/nai/metadata';
import axios from 'axios';
// @ts-ignore - no types available
import AdmZip from 'adm-zip';

export function registerGenerationTools(server: McpServer): void {
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

        // temp → 영구 저장소로 이동 (웹 UI execution.routes.ts와 동일한 처리)
        const savedPaths: string[] = [];
        for (const tempPath of result.imagePaths) {
          try {
            const imageBuffer = await fs.promises.readFile(tempPath);

            // 날짜 기반 디렉토리 생성
            const dateDir = new Date().toISOString().split('T')[0];
            const targetDir = path.join(runtimePaths.uploadsDir, 'API', 'images', dateDir);
            if (!fs.existsSync(targetDir)) {
              fs.mkdirSync(targetDir, { recursive: true });
            }

            // 고유 파일명 생성
            const ext = path.extname(tempPath);
            const filename = `comfyui_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${ext}`;
            const targetPath = path.join(targetDir, filename);

            // 파일 저장
            fs.writeFileSync(targetPath, imageBuffer);

            // temp 파일 삭제
            fs.unlinkSync(tempPath);

            const relativePath = `API/images/${dateDir}/${filename}`;
            savedPaths.push(relativePath);

            // 히스토리 업데이트 (첫 번째 이미지만)
            if (result.imagePaths.indexOf(tempPath) === 0) {
              const { hashes } = await ImageSimilarityService.generateHashAndHistogram(targetPath);
              GenerationHistoryModel.updateImagePaths(historyId, {
                compositeHash: hashes.compositeHash
              });
            }
          } catch (fileError) {
            console.error(`[MCP ComfyUI] Failed to save image ${tempPath}:`, fileError);
          }
        }

        // 완료 상태 업데이트
        GenerationHistoryModel.updateStatus(historyId, 'completed');

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              historyId,
              promptId: result.promptId,
              imageCount: savedPaths.length,
              imagePaths: savedPaths,
              server: serverRecord.name,
              workflow: workflow.name,
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
          imagePaths?: string[];
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
            });

            GenerationHistoryModel.update(historyId, {
              generation_status: 'processing' as const
            });
          } catch (historyError) {
            console.error(`[MCP ComfyUI Parallel] Failed to create history for server ${result.serverName}:`, historyError);
          }

          // temp → 영구 저장소로 이동
          const savedPaths: string[] = [];
          for (const tempPath of result.imagePaths) {
            try {
              const imageBuffer = await fs.promises.readFile(tempPath);

              const dateDir = new Date().toISOString().split('T')[0];
              const targetDir = path.join(runtimePaths.uploadsDir, 'API', 'images', dateDir);
              if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
              }

              const ext = path.extname(tempPath);
              const filename = `comfyui_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${ext}`;
              const targetPath = path.join(targetDir, filename);

              fs.writeFileSync(targetPath, imageBuffer);
              fs.unlinkSync(tempPath);

              const relativePath = `API/images/${dateDir}/${filename}`;
              savedPaths.push(relativePath);

              // 히스토리 업데이트 (첫 번째 이미지만)
              if (historyId && result.imagePaths.indexOf(tempPath) === 0) {
                const { hashes } = await ImageSimilarityService.generateHashAndHistogram(targetPath);
                GenerationHistoryModel.updateImagePaths(historyId, {
                  compositeHash: hashes.compositeHash
                });
              }
            } catch (fileError) {
              console.error(`[MCP ComfyUI Parallel] Failed to save image ${tempPath}:`, fileError);
            }
          }

          if (historyId) {
            GenerationHistoryModel.updateStatus(historyId, 'completed');
          }

          serverResults.push({
            serverId: result.serverId,
            serverName: result.serverName,
            success: true,
            historyId,
            imagePaths: savedPaths,
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

  // NovelAI 이미지 생성
  server.tool(
    'generate_nai',
    'Generate images using NovelAI. Requires a valid NAI token to be configured in the system (via login).',
    {
      prompt: z.string().describe('Positive prompt for image generation'),
      negative_prompt: z.string().default('').describe('Negative prompt'),
      model: z.enum(['nai-diffusion', 'nai-diffusion-4', 'nai-diffusion-4-5']).default('nai-diffusion-4-5').describe('NAI model to use'),
      width: z.number().int().default(1024).describe('Image width in pixels'),
      height: z.number().int().default(1024).describe('Image height in pixels'),
      steps: z.number().int().min(1).max(50).default(28).describe('Number of diffusion steps'),
      scale: z.number().min(0).max(30).default(5.0).describe('CFG scale'),
      sampler: z.string().default('k_euler_ancestral').describe('Sampler name'),
      seed: z.number().int().optional().describe('Random seed (auto-generated if not provided)'),
      n_samples: z.number().int().min(1).max(4).default(1).describe('Number of images to generate'),
      group_id: z.number().int().optional().describe('Optional group ID to assign generated images to'),
    },
    async ({ prompt, negative_prompt, model, width, height, steps, scale, sampler, seed, n_samples, group_id }) => {
      try {
        const token = getToken();
        if (!token) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'NovelAI token not configured. Please login via the web UI first (/api/nai/auth/login or /api/nai/auth/login-with-token).' }],
          };
        }

        const actualSeed = seed ?? Math.floor(Math.random() * 4294967295);

        // 메타데이터 전처리 (기존 유틸리티 사용)
        const metadata = preprocessMetadata({
          prompt,
          negative_prompt,
          model,
          width,
          height,
          steps,
          scale,
          sampler,
          seed: actualSeed,
          n_samples,
          action: 'generate',
          noise_schedule: 'karras',
        });

        // V4/V4.5 파라미터 구성
        const isV4_5 = model.includes('nai-diffusion-4-5');
        const isV4 = model.includes('nai-diffusion-4');

        const baseParams: any = {
          params_version: (isV4_5 || isV4) ? 3 : 1,
          width: metadata.width,
          height: metadata.height,
          scale: metadata.scale,
          sampler: metadata.sampler,
          steps: metadata.steps,
          n_samples: metadata.n_samples,
          seed: metadata.seed,
          noise_schedule: metadata.noise_schedule,
          legacy: false,
        };

        if (isV4_5 || isV4) {
          baseParams.autoSmea = false;
          baseParams.variety_plus = false;
          baseParams.uncond_scale = 1.0;
          baseParams.cfg_rescale = 0.7;
          baseParams.dynamic_thresholding = false;
          baseParams.controlnet_strength = 1.0;
          baseParams.ucPreset = 0;
          baseParams.add_original_image = true;
          baseParams.legacy_v3_extend = false;
          baseParams.skip_cfg_above_sigma = null;
          baseParams.use_coords = false;
          baseParams.normalize_reference_strength_multiple = true;
          baseParams.inpaintImg2ImgStrength = 1;
          baseParams.legacy_uc = false;
          baseParams.characterPrompts = [];
          baseParams.deliberate_euler_ancestral_bug = false;
          baseParams.prefer_brownian = true;
          baseParams.stream = 'msgpack';
          baseParams.negative_prompt = metadata.negative_prompt || '';

          baseParams.v4_prompt = {
            caption: { base_caption: metadata.prompt, char_captions: [] },
            use_coords: false,
            use_order: true,
          };
          baseParams.v4_negative_prompt = {
            caption: { base_caption: metadata.negative_prompt || '', char_captions: [] },
            legacy_uc: false,
          };
        } else {
          baseParams.ucPreset = 0;
          baseParams.negative_prompt = metadata.negative_prompt || '';
        }

        const requestBody = {
          input: metadata.prompt,
          model: metadata.model,
          action: 'generate',
          parameters: baseParams,
          use_new_shared_trial: true,
        };

        // NovelAI API 호출
        const response = await axios.post(
          'https://image.novelai.net/ai/generate-image',
          requestBody,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
              'Origin': 'https://novelai.net',
              'Referer': 'https://novelai.net',
            },
            responseType: 'arraybuffer',
            timeout: 120000,
          }
        );

        // ZIP 파일 파싱
        const zip = new AdmZip(Buffer.from(response.data));
        const zipEntries = zip.getEntries();
        const images = zipEntries.map((entry: any, index: number) => ({
          filename: `nai_${Date.now()}_${index}.png`,
          data: entry.getData().toString('base64'),
        }));

        // 히스토리 저장
        const historyIds: number[] = [];
        for (let i = 0; i < images.length; i++) {
          const historyId = await GenerationHistoryService.createNAIHistory({
            model: metadata.model || 'unknown',
            groupId: group_id,
          });
          historyIds.push(historyId);

          // 백그라운드 업로드
          const imageBuffer = Buffer.from(images[i].data, 'base64');
          GenerationHistoryService.processAndUploadImage(historyId, imageBuffer, 'novelai')
            .catch(err => console.error(`[MCP NAI] Background upload failed for history ${historyId}:`, err));
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              historyIds,
              count: historyIds.length,
              metadata: {
                prompt: metadata.prompt,
                negative_prompt: metadata.negative_prompt,
                seed: metadata.seed,
                resolution: `${metadata.width}x${metadata.height}`,
                steps: metadata.steps,
                scale: metadata.scale,
                sampler: metadata.sampler,
                model: metadata.model,
              },
            }, null, 2),
          }],
        };
      } catch (error: any) {
        let errorMessage = error.message;

        if (error.response?.status === 401) {
          errorMessage = 'Invalid or expired NAI token. Please re-login via the web UI.';
        } else if (error.response?.status === 402) {
          errorMessage = 'Active NovelAI subscription required.';
        } else if (error.code === 'ECONNABORTED') {
          errorMessage = 'Request timeout. Please try again.';
        }

        return {
          isError: true,
          content: [{ type: 'text' as const, text: `NAI generation error: ${errorMessage}` }],
        };
      }
    }
  );
}
