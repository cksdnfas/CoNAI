import { Router, Request, Response } from 'express';
import axios from 'axios';
// @ts-ignore - no types available
import AdmZip from 'adm-zip';
import { preprocessMetadata, NAIMetadataParams } from '../../utils/nai/metadata';

const router = Router();

/**
 * POST /api/nai/generate/image
 * Headers: { Authorization: Bearer <token> }
 * Body: { prompt, negative_prompt, width, height, ... }
 * Response: { images: [{ filename, data }], cost, metadata }
 */
router.post('/image', async (req: Request<{}, {}, NAIMetadataParams>, res: Response): Promise<void> => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    // 메타데이터 전처리
    const metadata = preprocessMetadata(req.body);

    // v4.5 모델 여부 확인
    const isV4_5 = metadata.model?.includes('nai-diffusion-4-5');

    // V4.5 최소 필수 파라미터로 시작
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
      qualityToggle: metadata.qualityToggle ?? true
    };

    // V4/V4.5 전용 파라미터 - v4_prompt 구조 사용
    if (isV4_5 || metadata.model?.includes('nai-diffusion-4')) {
      // SMEA 설정
      baseParams.autoSmea = metadata.sm ?? true;

      // 기타 V4 파라미터
      baseParams.uncond_scale = metadata.uncond_scale ?? 1.0;
      baseParams.cfg_rescale = metadata.cfg_rescale ?? 0.7;
      baseParams.dynamic_thresholding = false;
      baseParams.controlnet_strength = 1.0;
      baseParams.ucPreset = metadata.ucPreset || 0;
      baseParams.add_original_image = true;

      // 추가 필수 파라미터
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

      // V4 프롬프트 구조
      baseParams.v4_prompt = {
        caption: {
          base_caption: metadata.prompt,
          char_captions: []
        },
        use_coords: false,
        use_order: true
      };

      // V4 네거티브 프롬프트 구조
      baseParams.v4_negative_prompt = {
        caption: {
          base_caption: metadata.negative_prompt || '',
          char_captions: []
        },
        legacy_uc: false
      };
    } else {
      // V3 파라미터
      baseParams.params_version = 1;
      baseParams.ucPreset = metadata.ucPreset || 0;
      baseParams.negative_prompt = metadata.negative_prompt || '';
    }

    // 요청 body 구성
    const requestBody: any = {
      input: metadata.prompt, // V4도 input에 프롬프트 필요
      model: metadata.model,
      action: metadata.action,
      parameters: baseParams,
      use_new_shared_trial: true
    };

    // img2img/inpaint 추가 파라미터
    if (metadata.image) {
      requestBody.parameters.image = metadata.image;
      requestBody.parameters.strength = metadata.strength;
      requestBody.parameters.noise = metadata.noise;
      requestBody.parameters.extra_noise_seed = metadata.extra_noise_seed;
    }

    if (metadata.mask) {
      requestBody.parameters.add_original_image = metadata.add_original_image ?? true;
      requestBody.parameters.mask = metadata.mask;
    }

    // Vibe Transfer
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
      tokenLength: token.length,
      tokenPrefix: token.substring(0, 10) + '...'
    });

    console.log('[NAI Generate] Full request body:', JSON.stringify(requestBody, null, 2));

    // NovelAI API 호출
    const response = await axios.post(
      'https://image.novelai.net/ai/generate-image',
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Origin': 'https://novelai.net',
          'Referer': 'https://novelai.net'
        },
        responseType: 'arraybuffer',
        timeout: 120000 // 2분 타임아웃
      }
    );

    // ZIP 파일 파싱
    const zip = new AdmZip(Buffer.from(response.data));
    const zipEntries = zip.getEntries();

    const images = zipEntries.map((entry: any, index: number) => ({
      filename: `nai_${Date.now()}_${index}.png`,
      data: entry.getData().toString('base64') // Base64 인코딩
    }));

    res.json({
      images: images,
      metadata: {
        prompt: metadata.prompt,
        negative_prompt: metadata.negative_prompt,
        seed: metadata.seed,
        resolution: `${metadata.width}x${metadata.height}`,
        steps: metadata.steps,
        scale: metadata.scale,
        sampler: metadata.sampler,
        model: metadata.model
      }
    });

  } catch (error: any) {
    // 에러 응답 파싱 (Buffer일 경우 JSON으로 변환)
    let errorMessage = error.message;

    console.error('[NAI Generate] Full error:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      hasData: !!error.response?.data,
      code: error.code
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
      details: errorMessage
    });
    return;
  }
});

export default router;
