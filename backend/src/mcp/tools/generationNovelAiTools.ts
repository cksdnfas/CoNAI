import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { NAI_SAMPLER_IDS, NAI_UC_PRESET_IDS } from '@conai/shared';
import { getToken } from '../../utils/nai/auth';
import { mcpGroupPathSchema } from './mcpTargetGroup';
import { enqueueMcpGenerationJob, waitForMcpGenerationJob } from './generationJobTools';
import { assertChatNaiSampleCount, type McpRequestContext } from '../context';
import { canRequesterViewImages } from '../../middleware/imageAccess';
import { errorResult, textResult } from '../toolResults';

/** generate_nai answers synchronously; a job still running after this returns its id to wait on. */
const GENERATE_NAI_WAIT_MS = 180_000;

export function registerNovelAiGenerationTools(server: McpServer, context: McpRequestContext): void {
  // NovelAI 이미지 생성
  server.registerTool(
    'generate_nai',
    { description: 'Generate with NovelAI and wait up to 3 minutes for the result. It queues the same job as submit_generation_job(service_type="novelai"); prefer that with wait_generation_job.', inputSchema: z.object({
      prompt: z.string().describe('Positive prompt for image generation'),
      negative_prompt: z.string().default('').describe('Negative prompt'),
      quality_toggle: z.boolean().default(false).describe('Append the selected model quality tags to the positive prompt'),
      uc_preset: z.enum(NAI_UC_PRESET_IDS).default('none').describe('Prepend the selected model Undesired Content preset to the negative prompt'),
      model: z.enum([
        'nai-diffusion-5-curated',
        'nai-diffusion-5-full',
        'nai-diffusion-5-full-medium',
        'nai-diffusion-4-5-curated',
        'nai-diffusion-4-5-full',
        'nai-diffusion-4-curated-preview',
        'nai-diffusion-3',
      ]).default('nai-diffusion-4-5-curated').describe('NAI model to use'),
      width: z.number().int().default(1024).describe('Image width in pixels'),
      height: z.number().int().default(1024).describe('Image height in pixels'),
      steps: z.number().int().min(1).max(50).default(28).describe('Number of diffusion steps'),
      scale: z.number().min(0).max(30).default(5.0).describe('CFG scale'),
      sampler: z.enum(NAI_SAMPLER_IDS).default('k_euler_ancestral').describe('Sampler name'),
      seed: z.number().int().optional().describe('Random seed (auto-generated if not provided)'),
      n_samples: z.number().int().min(1).max(4).default(1).describe('Number of images to generate'),
      transparent_background: z.boolean().default(false).describe('Add the NAI V5 prompt tags that request an alpha channel'),
      group_id: z.number().int().optional().describe('Optional group ID to assign generated images to'),
      group_path: mcpGroupPathSchema,
    }) },
    async ({ prompt, negative_prompt, quality_toggle, uc_preset, model, width, height, steps, scale, sampler, seed, n_samples, transparent_background, group_id, group_path }) => {
      try {
        assertChatNaiSampleCount(context, n_samples);
        if (!getToken()) {
          return errorResult('NovelAI token not configured. Please connect a persistent API token via the web UI first (/api/nai/auth/login-with-token).');
        }

        // The same durable queue job submit_generation_job creates, waited on here for the synchronous answer.
        const request = {
          prompt,
          negative_prompt,
          quality_toggle,
          uc_preset,
          model,
          width,
          height,
          steps,
          scale,
          sampler,
          seed: seed ?? Math.floor(Math.random() * 4294967295),
          n_samples,
          transparent_background,
          action: 'generate',
          noise_schedule: 'karras',
        };
        const submitted = await enqueueMcpGenerationJob(context, {
          service_type: 'novelai',
          request_payload: request,
          group_id,
          group_path,
          request_summary: 'MCP generate_nai',
        }, 'generate_nai');
        const jobId = submitted?.id;
        if (typeof jobId !== 'number') throw new Error('The NovelAI job could not be queued.');
        const job = await waitForMcpGenerationJob(context, jobId, GENERATE_NAI_WAIT_MS);
        if (!job) throw new Error(`Queue job ${jobId} no longer exists`);
        if (job.status === 'failed' || job.status === 'cancelled') {
          return errorResult(`NAI generation ${job.status}: ${job.failure_message ?? 'no details'} (job ${job.id})`);
        }
        const canView = !context.requester || canRequesterViewImages(context.requester);

        return textResult({
          success: job.finished,
          job_id: job.id,
          status: job.status,
          ...(job.finished ? {} : { note: 'Still running: call wait_generation_job with this job_id.' }),
          ...(canView ? { historyIds: job.history_ids } : {}),
          count: job.history_ids.length,
          ...(canView ? { metadata: {
            prompt,
            negative_prompt,
            seed: request.seed,
            resolution: `${width}x${height}`,
            steps,
            scale,
            sampler,
            model,
          } } : {}),
        });
      } catch (error: any) {
        let errorMessage = error.message;

        if (error.response?.status === 401) {
          errorMessage = 'Invalid or expired NAI token. Please re-login via the web UI.';
        } else if (error.response?.status === 402) {
          errorMessage = 'Active NovelAI subscription required.';
        } else if (error.code === 'ECONNABORTED') {
          errorMessage = 'Request timeout. Please try again.';
        }

        return errorResult(`NAI generation error: ${errorMessage}`);
      }
    }
  );
}
