/**
 * NovelAI 메타데이터 전처리 유틸리티
 */

interface NAICharacterPrompt {
  prompt: string;
  uc?: string;
  center_x?: number;
  center_y?: number;
}

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
  // Character Prompts (V4+)
  characters?: NAICharacterPrompt[];
  // Group Assignment
  groupId?: number;
}

interface NAIMetadataInputParams extends Omit<NAIMetadataParams, 'characters'> {
  characters?: NAICharacterPrompt[] | string;
}

function normalizeCharacters(value: NAIMetadataInputParams['characters']): NAICharacterPrompt[] {
  if (!value) {
    return [];
  }

  let source: unknown = value;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    try {
      source = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(source)) {
    return [];
  }

  const normalized: NAICharacterPrompt[] = [];

  for (const entry of source) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const rawEntry = entry as Record<string, unknown>;
    const prompt = typeof rawEntry.prompt === 'string' ? rawEntry.prompt.trim() : '';
    if (!prompt) {
      continue;
    }

    const uc = typeof rawEntry.uc === 'string' ? rawEntry.uc.trim() : undefined;
    const centerX = typeof rawEntry.center_x === 'number'
      ? rawEntry.center_x
      : typeof rawEntry.center_x === 'string'
        ? Number(rawEntry.center_x)
        : 0.5;
    const centerY = typeof rawEntry.center_y === 'number'
      ? rawEntry.center_y
      : typeof rawEntry.center_y === 'string'
        ? Number(rawEntry.center_y)
        : 0.5;

    normalized.push({
      prompt,
      uc,
      center_x: Number.isFinite(centerX) ? centerX : 0.5,
      center_y: Number.isFinite(centerY) ? centerY : 0.5,
    });
  }

  return normalized;
}

/**
 * 메타데이터 전처리
 */
export function preprocessMetadata(params: NAIMetadataInputParams): NAIMetadataParams {
  const metadata: NAIMetadataParams = {
    ...params,
    characters: normalizeCharacters(params.characters),
  };

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

export type { NAICharacterPrompt, NAIMetadataInputParams, NAIMetadataParams };
