import { NAI_ACTION_IDS, NAI_MODEL_IDS, NAI_NOISE_SCHEDULE_IDS, NAI_SAMPLER_IDS, NAI_UC_PRESET_IDS } from '@conai/shared'

/**
 * A NovelAI payload the server refuses. NovelAI answers a malformed request (no prompt, an unknown sampler) with a bare
 * 500 that may still be billed, and repeated bad requests put the account at risk, so nothing reaches it unchecked.
 */
export class NaiRequestValidationError extends Error {
  readonly statusCode = 400

  constructor(readonly problems: string[]) {
    super(`Invalid NovelAI request, nothing was sent to NovelAI: ${problems.join('; ')}`)
    this.name = 'NaiRequestValidationError'
  }
}

/** Graph number fields store '' for "use the default", like MCP callers send null. */
const isSet = (value: unknown) => value !== undefined && value !== null && value !== ''

/**
 * Checks a NovelAI payload when it is queued (enqueueGenerationJobs) and again right before it is sent
 * (preprocessMetadata). Unset fields (undefined/null/'') pass: preprocessMetadata fills their defaults.
 */
export function assertValidNaiRequest(payload: Record<string, unknown>): void {
  const problems: string[] = []
  const oneOf = (field: string, allowed: readonly string[], value = payload[field]) => {
    if (isSet(value) && !(typeof value === 'string' && allowed.includes(value))) {
      problems.push(`${field} must be one of ${allowed.join(', ')} (got ${JSON.stringify(value)})`)
    }
  }
  const numberIn = (field: string, min: number, max: number, options: { integer?: boolean; step?: number } = {}) => {
    const value = payload[field]
    if (!isSet(value)) return
    const valid = typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
      && (!options.integer || Number.isInteger(value)) && (!options.step || value % options.step === 0)
    if (!valid) {
      problems.push(`${field} must be ${options.integer ? 'an integer' : 'a number'} from ${min} to ${max}${options.step ? ` in multiples of ${options.step}` : ''} (got ${JSON.stringify(value)})`)
    }
  }

  if (typeof payload.prompt !== 'string' || !payload.prompt.trim()) {
    problems.push('prompt is required: comma-separated tags describing the image')
  }
  oneOf('model', NAI_MODEL_IDS, typeof payload.model === 'string' ? payload.model.replace(/-inpainting$/, '') : payload.model)
  oneOf('action', NAI_ACTION_IDS)
  oneOf('sampler', NAI_SAMPLER_IDS)
  oneOf('noise_schedule', NAI_NOISE_SCHEDULE_IDS)
  oneOf('uc_preset', NAI_UC_PRESET_IDS)
  if (isSet(payload.quality_toggle) && typeof payload.quality_toggle !== 'boolean') problems.push('quality_toggle must be a boolean')
  numberIn('width', 64, 4096, { integer: true, step: 64 })
  numberIn('height', 64, 4096, { integer: true, step: 64 })
  numberIn('steps', 1, 50, { integer: true })
  numberIn('scale', 0, 30)
  numberIn('n_samples', 1, 4, { integer: true })
  numberIn('seed', 0, 4294967295, { integer: true })
  if ((payload.action === 'img2img' || payload.action === 'infill') && !isSet(payload.image)) problems.push(`action "${payload.action}" requires image`)
  if (payload.action === 'infill' && !isSet(payload.mask)) problems.push('action "infill" requires mask')

  if (problems.length > 0) throw new NaiRequestValidationError(problems)
}
