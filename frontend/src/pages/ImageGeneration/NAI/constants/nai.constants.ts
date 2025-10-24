export const RESOLUTIONS = {
  'Small Portrait': { width: 512, height: 768 },
  'Small Landscape': { width: 768, height: 512 },
  'Small Square': { width: 640, height: 640 },
  'Normal Portrait': { width: 832, height: 1216 },
  'Normal Landscape': { width: 1216, height: 832 },
  'Normal Square': { width: 1024, height: 1024 },
  'Large Portrait': { width: 1024, height: 1536 },
  'Large Landscape': { width: 1536, height: 1024 },
  'Wallpaper Portrait': { width: 1088, height: 1920 },
  'Wallpaper Landscape': { width: 1920, height: 1088 }
} as const;

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

export const DEFAULT_PARAMS = {
  model: 'nai-diffusion-4-5-curated',
  prompt: '',
  negative_prompt: '',
  resolution: 'Normal Portrait',
  steps: 28,
  scale: 6.0,
  sampler: 'k_euler',
  n_samples: 1,
  variety_plus: false,
  cfg_rescale: 0.7,
  noise_schedule: 'karras',
  uncond_scale: 1.0
} as const;
