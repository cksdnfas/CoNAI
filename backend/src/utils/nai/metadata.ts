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
  variety_plus?: boolean;
  n_samples?: number;
  seed?: number;
  ucPreset?: number;
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
  // Group Assignment
  groupId?: number;
}

/**
 * 메타데이터 전처리
 */
export function preprocessMetadata(params: NAIMetadataParams): NAIMetadataParams {
  const metadata = { ...params };

  // 기본값 설정 (2025년 최신 모델 및 권장 설정)
  metadata.model = metadata.model || 'nai-diffusion-4-5-curated';
  metadata.action = metadata.action || 'generate';
  metadata.width = metadata.width || 1024;
  metadata.height = metadata.height || 1024;
  metadata.steps = metadata.steps || 28;
  metadata.scale = metadata.scale || 6.0;
  metadata.sampler = metadata.sampler || 'k_euler';
  metadata.variety_plus = metadata.variety_plus ?? false; // 기본값 false
  metadata.n_samples = metadata.n_samples || 1;
  metadata.seed = metadata.seed || Math.floor(Math.random() * 4294967288);
  metadata.uncond_scale = metadata.uncond_scale ?? 1.0;
  metadata.cfg_rescale = metadata.cfg_rescale ?? 0.0;
  metadata.noise_schedule = metadata.noise_schedule || 'karras';

  // img2img/inpaint 특수 처리
  if (metadata.action === 'img2img' || metadata.action === 'infill') {
    metadata.strength = metadata.strength || 0.3;
    metadata.noise = metadata.noise || 0;
    metadata.extra_noise_seed = metadata.extra_noise_seed ||
      Math.floor(Math.random() * 4294967288);
  }

  return metadata;
}

export type { NAIMetadataParams };
