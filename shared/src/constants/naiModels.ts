/**
 * NovelAI models whose settings the web UI fixes.
 *
 * V5 Full Medium Effort (economy mode, NovelAI journal 2026-10-08): the web UI Effort toggle switches the model to
 * `nai-diffusion-5-full-medium` (inpainting: `nai-diffusion-5-full-medium-inpainting`). It is a 14-step distillation:
 * steps and sampler are fixed, custom Undesired Content and the UC preset cannot be changed (Heavy), and Prompt
 * Guidance Rescale is not offered. Verified live: the model name is accepted and its results carry their own Source
 * hash (70AB5786, Full is 0ADF9AB7).
 */

export const NAI_V5_FULL_MEDIUM_MODEL = 'nai-diffusion-5-full-medium'

/** Inpainting strength the web UI starts from: the masked area is redrawn fully (img2img keeps its own lower default). */
export const NAI_INFILL_DEFAULT_STRENGTH = 1

/** V5 family (Full, Curated, economy mode), including their inpainting variants. */
export function isNaiV5Model(model: string | null | undefined): boolean {
  return (model ?? '').includes('nai-diffusion-5')
}

/**
 * API model a request is actually sent to: infill uses the model's inpainting variant, and V5 Curated, which has no
 * inpainting model, uses V4.5 Curated inpainting. Cost and free-generation checks must use this, not the selected model.
 */
export function resolveNaiRequestModel(model: string | undefined, action: string | undefined): string | undefined {
  if (action !== 'infill' || !model || model.endsWith('-inpainting')) return model
  return model === 'nai-diffusion-5-curated' ? 'nai-diffusion-4-5-curated-inpainting' : `${model}-inpainting`
}

export interface NaiFixedModelSettings {
  steps: number
  sampler: string
  /** Sent in place of the user's negative prompt; character negatives are dropped as well. */
  ucPreset: 'heavy'
  /** Prompt Guidance Rescale is not offered; it is sent as 0. */
  cfgRescale: 0
}

const NAI_V5_FULL_MEDIUM_SETTINGS: NaiFixedModelSettings = { steps: 14, sampler: 'k_euler_ancestral', ucPreset: 'heavy', cfgRescale: 0 }

/** Settings the model fixes, or null when the model leaves them to the user. */
export function getNaiFixedModelSettings(model: string | null | undefined): NaiFixedModelSettings | null {
  return (model ?? '').trim().startsWith(NAI_V5_FULL_MEDIUM_MODEL) ? NAI_V5_FULL_MEDIUM_SETTINGS : null
}
