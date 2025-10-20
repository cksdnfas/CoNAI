/**
 * NovelAI 메타데이터 전처리 유틸리티
 */

interface NAIMetadataParams {
  prompt: string;
  negative_prompt?: string;
  model?: string;
  action?: string;
  width?: number;
  height?: number;
  steps?: number;
  scale?: number;
  sampler?: string;
  sm?: boolean;
  sm_dyn?: boolean;
  n_samples?: number;
  seed?: number;
  ucPreset?: number;
  qualityToggle?: boolean;
  uncond_scale?: number;
  cfg_rescale?: number;
  noise_schedule?: string;
  // img2img/inpaint 관련
  image?: string;
  strength?: number;
  noise?: number;
  extra_noise_seed?: number;
  mask?: string;
  add_original_image?: boolean;
  // Vibe Transfer
  reference_image_multiple?: string[];
  reference_information_extracted_multiple?: number[];
  reference_strength_multiple?: number[];
}

const QUALITY_TAGS = {
  positive: 'best quality, amazing quality, very aesthetic, absurdres',

  negative: {
    heavy: 'lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]',

    light: 'lowres, jpeg artifacts, worst quality, watermark, blurry, very displeasing',

    humanFocus: 'lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract], bad anatomy, bad hands, @_@, mismatched pupils, heart-shaped pupils, glowing eyes'
  }
};

/**
 * 메타데이터 전처리 (Python의 model_post_init와 동일)
 */
export function preprocessMetadata(params: NAIMetadataParams): NAIMetadataParams {
  const metadata = { ...params };

  // 기본값 설정 (2025년 최신 모델 및 권장 설정)
  metadata.model = metadata.model || 'nai-diffusion-4-5-curated'; // v3 → v4.5
  metadata.action = metadata.action || 'generate';
  metadata.width = metadata.width || 1024;
  metadata.height = metadata.height || 1024;
  metadata.steps = metadata.steps || 28;
  metadata.scale = metadata.scale || 6.0;
  metadata.sampler = metadata.sampler || 'k_euler';
  metadata.sm = metadata.sm ?? true; // 기본값 true
  metadata.sm_dyn = metadata.sm_dyn || false;
  metadata.n_samples = metadata.n_samples || 1;
  metadata.seed = metadata.seed || Math.floor(Math.random() * 4294967288);
  metadata.qualityToggle = metadata.qualityToggle ?? true; // 기본값 true
  metadata.uncond_scale = metadata.uncond_scale ?? 1.0;
  metadata.cfg_rescale = metadata.cfg_rescale ?? 0.0; // v4.5에서는 0.0 기본값
  metadata.noise_schedule = metadata.noise_schedule || 'karras'; // native → karras (권장값)

  // Positive prompt 강화
  if (metadata.qualityToggle) {
    const prompt = metadata.prompt.trim();
    metadata.prompt = prompt
      ? `${prompt}, ${QUALITY_TAGS.positive}`
      : QUALITY_TAGS.positive;
  }

  // img2img/inpaint 특수 처리
  if (metadata.action === 'img2img' || metadata.action === 'infill') {
    metadata.sm = false;
    metadata.sm_dyn = false;
    metadata.strength = metadata.strength || 0.3;
    metadata.noise = metadata.noise || 0;
    metadata.extra_noise_seed = metadata.extra_noise_seed ||
      Math.floor(Math.random() * 4294967288);
  }

  return metadata;
}

export { QUALITY_TAGS };
export type { NAIMetadataParams };
