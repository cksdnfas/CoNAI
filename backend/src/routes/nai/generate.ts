import { Router, Request, Response } from 'express';
import axios from 'axios';
// @ts-ignore - no types available
import AdmZip from 'adm-zip';
import { preprocessMetadata, NAIMetadataParams } from '../../utils/nai/metadata';
import { getToken } from '../../utils/nai/auth';
import { GenerationHistoryService } from '../../services/generationHistoryService';

const router = Router();

/** Accept either raw base64 or a data URL and always return raw base64. */
function normalizeBase64ImageData(value?: string): string | undefined {
  if (!value || typeof value !== 'string') {
    return undefined;
  }

  return value.replace(/^data:image\/\w+;base64,/, '');
}

/**
 * POST /api/nai/generate/image
 * Headers: { Authorization: Bearer <token> }
 * Body: { prompt, negative_prompt, width, height, ... }
 * Response: { images: [{ filename, data }], cost, metadata }
 */
router.post('/image', async (req: Request<{}, {}, NAIMetadataParams>, res: Response): Promise<void> => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || getToken();

    if (!token) {
      res.status(401).json({ error: 'NovelAI 인증이 필요합니다. 먼저 토큰으로 로그인하세요.' });
      return;
    }

    const metadata = preprocessMetadata(req.body);
    const isV4_5 = metadata.model?.includes('nai-diffusion-4-5');

    const baseParams: any = {
      params_version: 3,
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

    if (isV4_5 || metadata.model?.includes('nai-diffusion-4')) {
      baseParams.autoSmea = false;
      baseParams.variety_plus = metadata.variety_plus ?? false;
      baseParams.uncond_scale = metadata.uncond_scale ?? 1.0;
      baseParams.cfg_rescale = metadata.cfg_rescale ?? 0.7;
      baseParams.dynamic_thresholding = false;
      baseParams.controlnet_strength = 1.0;
      baseParams.ucPreset = metadata.ucPreset || 0;
      baseParams.add_original_image = true;
      baseParams.legacy_v3_extend = false;
      baseParams.skip_cfg_above_sigma = null;
      baseParams.use_coords = false;
      baseParams.normalize_reference_strength_multiple = true;
      baseParams.inpaintImg2ImgStrength = 1;
      baseParams.legacy_uc = false;
      baseParams.deliberate_euler_ancestral_bug = false;
      baseParams.prefer_brownian = true;
      baseParams.stream = 'msgpack';
      baseParams.negative_prompt = metadata.negative_prompt || '';

      const characterPrompts: Array<{ prompt: string; uc: string; center: { x: number; y: number } }> = (metadata.characters || [])
        .filter((entry) => typeof entry.prompt === 'string' && entry.prompt.trim().length > 0)
        .map((entry) => {
          const center = {
            x: typeof entry.center_x === 'number' ? entry.center_x : 0.5,
            y: typeof entry.center_y === 'number' ? entry.center_y : 0.5,
          };

          return {
            prompt: entry.prompt.trim(),
            uc: (entry.uc || '').trim(),
            center,
          };
        });

      baseParams.characterPrompts = characterPrompts;
      baseParams.use_coords = characterPrompts.length > 0;

      baseParams.v4_prompt = {
        caption: {
          base_caption: metadata.prompt,
          char_captions: characterPrompts.map((entry) => ({
            char_caption: entry.prompt,
            centers: [entry.center],
          })),
        },
        use_coords: characterPrompts.length > 0,
        use_order: true,
      };

      baseParams.v4_negative_prompt = {
        caption: {
          base_caption: metadata.negative_prompt || '',
          char_captions: characterPrompts.map((entry) => ({
            char_caption: entry.uc,
            centers: [entry.center],
          })),
        },
        legacy_uc: false,
      };
    } else {
      baseParams.params_version = 1;
      baseParams.ucPreset = metadata.ucPreset || 0;
      baseParams.negative_prompt = metadata.negative_prompt || '';
    }

    const requestBody: any = {
      input: metadata.prompt,
      model: metadata.model,
      action: metadata.action,
      parameters: baseParams,
      use_new_shared_trial: true,
    };

    if (metadata.image) {
      requestBody.parameters.image = normalizeBase64ImageData(metadata.image);
      requestBody.parameters.strength = metadata.strength;
      requestBody.parameters.noise = metadata.noise;
      requestBody.parameters.extra_noise_seed = metadata.extra_noise_seed;
    }

    if (metadata.mask) {
      requestBody.parameters.add_original_image = metadata.add_original_image ?? true;
      requestBody.parameters.mask = normalizeBase64ImageData(metadata.mask);
    }

    if (metadata.reference_image_multiple) {
      requestBody.parameters.reference_image_multiple = metadata.reference_image_multiple;
      requestBody.parameters.reference_information_extracted_multiple =
        metadata.reference_information_extracted_multiple || [1];
      requestBody.parameters.reference_strength_multiple =
        metadata.reference_strength_multiple || [0.6];
    }

    console.log('[NAI Generate] Request params:', {
      resolution: `${metadata.width}x${metadata.height}`,
      steps: metadata.steps,
      model: metadata.model,
      sampler: metadata.sampler,
      scale: metadata.scale,
      n_samples: metadata.n_samples,
      characterCount: baseParams.characterPrompts?.length || 0,
      tokenLength: token.length,
      tokenPrefix: token.substring(0, 10) + '...',
    });

    const response = await axios.post(
      'https://image.novelai.net/ai/generate-image',
      requestBody,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Origin: 'https://novelai.net',
          Referer: 'https://novelai.net',
        },
        responseType: 'arraybuffer',
        timeout: 120000,
      },
    );

    const zip = new AdmZip(Buffer.from(response.data));
    const zipEntries = zip.getEntries();

    const images = zipEntries.map((entry: any, index: number) => ({
      filename: `nai_${Date.now()}_${index}.png`,
      data: entry.getData().toString('base64'),
    }));

    const historyIds: number[] = [];

    try {
      const groupId = metadata.groupId;

      for (let i = 0; i < images.length; i++) {
        const historyId = await GenerationHistoryService.createNAIHistory({
          model: metadata.model || 'unknown',
          sampler: metadata.sampler || 'unknown',
          seed: (metadata.seed || 0) + i,
          steps: metadata.steps || 28,
          scale: metadata.scale || 7.0,
          parameters: requestBody.parameters,
          positivePrompt: metadata.prompt,
          negativePrompt: metadata.negative_prompt,
          width: metadata.width || 1024,
          height: metadata.height || 1024,
          groupId,
          metadata: {
            action: metadata.action,
            n_samples: metadata.n_samples,
            batch_index: i,
            noise_schedule: metadata.noise_schedule,
          },
        });

        historyIds.push(historyId);

        const imageBuffer = Buffer.from(images[i].data, 'base64');
        GenerationHistoryService.processAndUploadImage(historyId, imageBuffer, 'novelai')
          .catch((err) => console.error(`[NAI Generate] Background upload failed for history ${historyId}:`, err));

        console.log(`[NAI Generate] History ${historyId} created and queued for background upload (${i + 1}/${images.length})`);
      }
    } catch (historyError) {
      console.error('[NAI Generate] Failed to create history:', historyError);
      res.status(500).json({
        error: 'Failed to create generation history',
        details: historyError instanceof Error ? historyError.message : 'Unknown error',
      });
      return;
    }

    res.json({
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
    });
  } catch (error: any) {
    let errorMessage = error.message;

    console.error('[NAI Generate] Full error:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      hasData: !!error.response?.data,
      code: error.code,
    });

    if (error.response?.data) {
      try {
        const errorData = Buffer.isBuffer(error.response.data)
          ? JSON.parse(error.response.data.toString())
          : error.response.data;
        errorMessage = errorData.message || errorData.statusMessage || errorMessage;
        console.error('[NAI Generate] Parsed error data:', errorData);
      } catch (parseError) {
        const dataStr = Buffer.isBuffer(error.response.data)
          ? error.response.data.toString()
          : JSON.stringify(error.response.data);
        console.error('[NAI Generate] Raw error data (parse failed):', dataStr);
        console.error('[NAI Generate] Parse error:', parseError);
      }
    } else {
      console.error('[NAI Generate] No response data, error message:', error.message);
    }

    if (error.response?.status === 401) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    if (error.response?.status === 402) {
      res.status(402).json({ error: 'Active subscription required' });
      return;
    }

    if (error.code === 'ECONNABORTED') {
      res.status(408).json({ error: 'Request timeout. Try again.' });
      return;
    }

    res.status(500).json({
      error: 'Image generation failed',
      details: errorMessage,
    });
  }
});

export default router;
