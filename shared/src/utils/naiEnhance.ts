/**
 * NovelAI image Enhance, the web UI "Upscale Amount" (1x / 1.5x / Max), planned from the source image size.
 *
 * Read from NovelAI web UI requests and result metadata (V5):
 * - 1x: img2img at the source size, snapped to the 64-pixel grid (rounded down when rounding up would pass the cap).
 * - 1.5x: the source is first resized to NovelAI's fixed enhance resolution for that standard size and img2img runs
 *   there. The web UI appends `, -2::upscaled, blurry::,` to the prompt to suppress the blur of the enlarged input.
 *   Sizes outside the table are refused rather than guessed, since the cost depends on the size.
 * - Max: img2img at the source size with `upscaled_enhance: true`; the server enlarges the result up to the pixel
 *   cap (aspect kept, each side floored, e.g. 832×1216 → 1467×2144). The request carries no target size. V5 only.
 * Every enhance result is capped at 1536×2048 pixels, which is why Large and Wallpaper sizes do not offer 1.5x.
 */

export const NAI_ENHANCE_AMOUNTS = ['1x', '1.5x', 'max'] as const
export type NaiEnhanceAmount = (typeof NAI_ENHANCE_AMOUNTS)[number]

export const NAI_ENHANCE_MAX_PIXELS = 1536 * 2048
export const NAI_ENHANCE_UPSCALE_PROMPT_SUFFIX = ', -2::upscaled, blurry::,'
/** Web UI "Magnitude 2", its default. */
export const NAI_ENHANCE_DEFAULT_STRENGTH = 0.5
export const NAI_ENHANCE_DEFAULT_NOISE = 0

const NAI_ENHANCE_GRID = 64

/** Standard size → 1.5x enhance resolution. Not a plain ×1.5 (832×1216 becomes 1280×1856). */
const NAI_ENHANCED_RESOLUTIONS: Record<string, readonly [number, number]> = {
  '1024x1024': [1536, 1536],
  '832x1216': [1280, 1856],
  '1216x832': [1856, 1280],
  '1472x1472': [2208, 2208],
  '1024x1536': [1536, 2304],
  '1536x1024': [2304, 1536],
  '1088x1920': [1632, 2880],
  '1920x1088': [2880, 1632],
  '640x640': [960, 960],
  '512x768': [768, 1152],
  '768x512': [1152, 768],
}

/**
 * Why an amount cannot be used:
 * - `model`: Max needs a V5 model
 * - `custom_size`: 1.5x is only defined for NovelAI's standard sizes
 * - `over_cap`: the result would exceed the pixel cap (1.5x on Large/Wallpaper, 1x on a source far above the cap)
 * - `already_max`: the source is already at the cap, so nothing would grow
 */
export type NaiEnhanceUnavailableReason = 'model' | 'custom_size' | 'over_cap' | 'already_max'

export interface NaiEnhancePlan {
  amount: NaiEnhanceAmount
  /** Diffusion size, sent as the request width/height. */
  width: number
  height: number
  /** Max: the request sets `upscaled_enhance` and the server enlarges the result. */
  serverUpscale: boolean
  /** Final image size; for Max this is the server's result predicted from the cap. */
  outputWidth: number
  outputHeight: number
  /** Appended to the positive prompt (1.5x only). */
  promptSuffix: string
}

export type NaiEnhancePlanResult =
  | { ok: true; plan: NaiEnhancePlan }
  | { ok: false; reason: NaiEnhanceUnavailableReason }

export function isNaiEnhanceAmount(value: unknown): value is NaiEnhanceAmount {
  return typeof value === 'string' && (NAI_ENHANCE_AMOUNTS as readonly string[]).includes(value)
}

/** Max (server upscale) exists for V5 models only. */
export function supportsNaiEnhanceMax(model: string | null | undefined) {
  return (model ?? '').trim().startsWith('nai-diffusion-5')
}

function snapToEnhanceGrid(value: number) {
  return Math.max(NAI_ENHANCE_GRID, Math.round(value / NAI_ENHANCE_GRID) * NAI_ENHANCE_GRID)
}

/** 1x size: the source on the 64 grid, rounded down where rounding up would pass the pixel cap (e.g. a Max result). */
function fitEnhanceGridUnderCap(width: number, height: number): readonly [number, number] | null {
  const rounded = [snapToEnhanceGrid(width), snapToEnhanceGrid(height)] as const
  if (rounded[0] * rounded[1] <= NAI_ENHANCE_MAX_PIXELS) return rounded
  const floored = [
    Math.max(NAI_ENHANCE_GRID, Math.floor(width / NAI_ENHANCE_GRID) * NAI_ENHANCE_GRID),
    Math.max(NAI_ENHANCE_GRID, Math.floor(height / NAI_ENHANCE_GRID) * NAI_ENHANCE_GRID),
  ] as const
  return floored[0] * floored[1] <= NAI_ENHANCE_MAX_PIXELS ? floored : null
}

/** Plan one enhance request. Throws for a non-positive source size. */
export function planNaiEnhance(
  source: { width: number; height: number },
  amount: NaiEnhanceAmount,
  model: string | null | undefined,
): NaiEnhancePlanResult {
  const sourceWidth = Math.trunc(source.width)
  const sourceHeight = Math.trunc(source.height)
  if (!(sourceWidth > 0 && sourceHeight > 0)) {
    throw new Error(`Invalid enhance source size: ${source.width}x${source.height}`)
  }

  const width = snapToEnhanceGrid(sourceWidth)
  const height = snapToEnhanceGrid(sourceHeight)

  if (amount === '1x') {
    const size = fitEnhanceGridUnderCap(sourceWidth, sourceHeight)
    if (!size) return { ok: false, reason: 'over_cap' }
    const [planWidth, planHeight] = size
    return { ok: true, plan: { amount, width: planWidth, height: planHeight, serverUpscale: false, outputWidth: planWidth, outputHeight: planHeight, promptSuffix: '' } }
  }

  if (amount === '1.5x') {
    const target = NAI_ENHANCED_RESOLUTIONS[`${sourceWidth}x${sourceHeight}`]
    if (!target) return { ok: false, reason: 'custom_size' }
    const [targetWidth, targetHeight] = target
    if (targetWidth * targetHeight > NAI_ENHANCE_MAX_PIXELS) return { ok: false, reason: 'over_cap' }
    if (targetWidth * targetHeight <= width * height) return { ok: false, reason: 'already_max' }
    return {
      ok: true,
      plan: {
        amount,
        width: targetWidth,
        height: targetHeight,
        serverUpscale: false,
        outputWidth: targetWidth,
        outputHeight: targetHeight,
        promptSuffix: NAI_ENHANCE_UPSCALE_PROMPT_SUFFIX,
      },
    }
  }

  if (!supportsNaiEnhanceMax(model)) return { ok: false, reason: 'model' }
  const scale = Math.sqrt(NAI_ENHANCE_MAX_PIXELS / (width * height))
  const outputWidth = Math.max(1, Math.floor(width * scale))
  const outputHeight = Math.max(1, Math.floor(height * scale))
  if (outputWidth <= width || outputHeight <= height) return { ok: false, reason: 'already_max' }
  return { ok: true, plan: { amount, width, height, serverUpscale: true, outputWidth, outputHeight, promptSuffix: '' } }
}
