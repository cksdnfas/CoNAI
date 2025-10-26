/**
 * Metadata extraction types
 */

export interface AIMetadata {
  ai_tool?: string;
  model?: string;
  prompt?: string;
  positive_prompt?: string;
  negative_prompt?: string;
  steps?: number;
  cfg_scale?: number;
  sampler?: string;
  seed?: number;  // Changed to number for compatibility with existing type
  scheduler?: string;
  width?: number;
  height?: number;
  lora_models?: string[];  // Array of LoRA names for compatibility with existing types
  lora_hashes?: string;
  model_hash?: string;
  denoising_strength?: number;
  clip_skip?: number;
  version?: string;

  // NovelAI specific
  cfg_rescale?: number;
  uncond_scale?: number;
  use_order?: boolean;
  scale?: number;  // NAI uses 'scale' instead of 'cfg_scale'
  uc?: string;     // NAI negative prompt field
  sm?: boolean;    // SMEA
  sm_dyn?: boolean;  // SMEA DYN
  dynamic_thresholding?: boolean;
  controlnet_strength?: number;
  legacy?: boolean;
  add_original_image?: boolean;
  skip_cfg_above_sigma?: number;

  // v4 prompt fields
  v4_prompt?: any;
  v4_negative_prompt?: any;

  // Additional metadata fields
  title?: string;
  description?: string;
  software?: string;

  // Raw data fields (for intermediate processing)
  Comment?: string;
  Source?: string;
  parameters?: string;
  comfyui_workflow?: string;
  textChunks?: any;
  rawStrings?: any;
  stealthData?: string;

  [key: string]: any;
}

export interface LoRAModel {
  name: string;
  weight: number;
}

export interface ImageMetadata {
  extractedAt: string;
  ai_info: AIMetadata;
  error?: string;
}

export interface RawPngMetadata {
  textChunks: { [key: string]: string };
  rawStrings: string[];
}

export interface StealthPngSignature {
  type: 'alpha' | 'rgb';
  compressed: boolean;
}

export interface ExtractionResult {
  success: boolean;
  data: AIMetadata;
  source: 'primary' | 'secondary' | 'failed';
  method?: string;
}
