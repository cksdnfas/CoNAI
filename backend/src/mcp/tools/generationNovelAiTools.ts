import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GenerationHistoryService } from '../../services/generationHistoryService';
import { executeNaiGeneration } from '../../services/naiGenerationExecutor';
import { getToken } from '../../utils/nai/auth';

export function registerNovelAiGenerationTools(server: McpServer): void {
  // NovelAI 이미지 생성
  server.tool(
    'generate_nai',
    'Generate images using NovelAI. Requires a valid NAI token to be configured in the system (via login).',
    {
      prompt: z.string().describe('Positive prompt for image generation'),
      negative_prompt: z.string().default('').describe('Negative prompt'),
      model: z.enum([
        'nai-diffusion-5-curated',
        'nai-diffusion-5-full',
        'nai-diffusion-4-5-curated',
        'nai-diffusion-4-5-full',
        'nai-diffusion-4-curated-preview',
        'nai-diffusion-3',
      ]).default('nai-diffusion-4-5-curated').describe('NAI model to use'),
      width: z.number().int().default(1024).describe('Image width in pixels'),
      height: z.number().int().default(1024).describe('Image height in pixels'),
      steps: z.number().int().min(1).max(50).default(28).describe('Number of diffusion steps'),
      scale: z.number().min(0).max(30).default(5.0).describe('CFG scale'),
      sampler: z.string().default('k_euler_ancestral').describe('Sampler name'),
      seed: z.number().int().optional().describe('Random seed (auto-generated if not provided)'),
      n_samples: z.number().int().min(1).max(4).default(1).describe('Number of images to generate'),
      transparent_background: z.boolean().default(false).describe('Add the NAI V5 prompt tags that request an alpha channel'),
      group_id: z.number().int().optional().describe('Optional group ID to assign generated images to'),
    },
    async ({ prompt, negative_prompt, model, width, height, steps, scale, sampler, seed, n_samples, transparent_background, group_id }) => {
      try {
        const token = getToken();
        if (!token) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'NovelAI token not configured. Please connect a persistent API token via the web UI first (/api/nai/auth/login-with-token).' }],
          };
        }

        const actualSeed = seed ?? Math.floor(Math.random() * 4294967295);

        const result = await executeNaiGeneration({
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
          transparent_background,
          action: 'generate',
          noise_schedule: 'karras',
        }, token);
        const metadata = result.metadata;
        const images = result.imageBuffers.map((imageBuffer, index) => ({
          filename: `nai_${Date.now()}_${index}.png`,
          data: imageBuffer.toString('base64'),
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
