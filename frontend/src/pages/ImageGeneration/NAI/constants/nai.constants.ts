// 프리셋 해상도 목록 (키: "width×height" 형태)
export const RESOLUTIONS = {
  '512×768': { width: 512, height: 768 },
  '768×512': { width: 768, height: 512 },
  '640×640': { width: 640, height: 640 },
  '832×1216': { width: 832, height: 1216 },
  '1216×832': { width: 1216, height: 832 },
  '1024×1024': { width: 1024, height: 1024 },
  '1024×1536': { width: 1024, height: 1536 },
  '1536×1024': { width: 1536, height: 1024 },
  '1088×1920': { width: 1088, height: 1920 },
  '1920×1088': { width: 1920, height: 1088 }
} as const;

// 해상도 키 배열 (UI에서 순서대로 표시)
export const RESOLUTION_KEYS = Object.keys(RESOLUTIONS) as Array<keyof typeof RESOLUTIONS>;

export const MODELS = [
  { value: 'nai-diffusion-4-5-curated', label: 'V4.5 Curated (권장)' },
  { value: 'nai-diffusion-4-5-full', label: 'V4.5 Full' },
  { value: 'nai-diffusion-4-curated-preview', label: 'V4 Curated' },
  { value: 'nai-diffusion-4-full', label: 'V4 Full' },
  { value: 'nai-diffusion-3', label: 'V3 (구버전)' },
  { value: 'nai-diffusion-3-furry', label: 'V3 Furry' }
] as const;

export const SAMPLERS = [
  { value: 'k_euler', label: 'Euler' },
  { value: 'k_euler_ancestral', label: 'Euler Ancestral' },
  { value: 'k_dpmpp_2s_ancestral', label: 'DPM++ 2S Ancestral' },
  { value: 'k_dpmpp_2m', label: 'DPM++ 2M' },
  { value: 'k_dpmpp_sde', label: 'DPM++ SDE' },
  { value: 'ddim_v3', label: 'DDIM' }
] as const;

export const NOISE_SCHEDULES = [
  { value: 'native', label: 'Native' },
  { value: 'karras', label: 'Karras (권장)' },
  { value: 'exponential', label: 'Exponential' },
  { value: 'polyexponential', label: 'Polyexponential' }
] as const;

export const PARAMS_STORAGE_KEY = 'nai_generation_params';
export const GROUP_STORAGE_KEY = 'nai_selected_group_id';

export const DEFAULT_RESOLUTION_CONFIG = {
  mode: 'fixed' as const,
  fixed: '832×1216',
  random: [],
  customResolutions: [],
  swapDimensions: false
};

export const DEFAULT_PARAMS = {
  model: 'nai-diffusion-4-5-curated',
  prompt: '',
  negative_prompt: '',
  resolution: '832×1216',  // 하위 호환성
  resolutionConfig: DEFAULT_RESOLUTION_CONFIG,
  steps: 28,
  scale: 6.0,
  sampler: 'k_euler',
  n_samples: 1,
  variety_plus: false,
  cfg_rescale: 0.7,
  noise_schedule: 'karras',
  uncond_scale: 1.0
} as const;
