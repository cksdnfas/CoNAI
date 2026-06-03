import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import axios from 'axios';
import { GenerationHistoryService } from '../../services/generationHistoryService';
import { getToken } from '../../utils/nai/auth';
import { preprocessMetadata } from '../../utils/nai/metadata';
// @ts-ignore - no types available
import AdmZip from 'adm-zip';

export function registerNovelAiGenerationTools(server: McpServer): void {
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
