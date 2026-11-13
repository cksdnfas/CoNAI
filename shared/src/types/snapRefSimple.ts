// SnapRef (`SnapRefSimple`, ComfyUI package custom_nodes.snapref) node-editor contract shared by the generation
// screen editor, the page assistant, the backend workflow-input normalizer and MCP. Input names and ranges mirror the
// node's /object_info. The `model`, `clip` and `vae` links, and any input the editor does not own, keep the workflow's
// saved value.

export const SNAPREF_SIMPLE_CLASS_TYPE = 'SnapRefSimple'
export const SNAPREF_SIMPLE_NODE_EDITOR = 'snapref_simple'
export const SNAPREF_SIMPLE_MAX_REFERENCES = 8
export const SNAPREF_SIMPLE_MODES = ['Character & Style', 'Character'] as const
/** The node's value for an unused optional picture slot (reference_2 … reference_8). */
export const SNAPREF_SIMPLE_UNUSED = 'none'
export const SNAPREF_SIMPLE_STRENGTH = { min: 0, max: 2, step: 0.05, default: 1 } as const
export const SNAPREF_SIMPLE_FIDELITY = { min: 0, max: 1, step: 0.05, default: 1 } as const

export type SnapRefSimpleMode = typeof SNAPREF_SIMPLE_MODES[number]

/** Picture 1 is `reference`; pictures 2–8 are `reference_2` … `reference_8`. */
export function snapRefSimpleReferenceKey(slot: number) {
  return slot === 1 ? 'reference' : `reference_${slot}`
}

/** Weight of picture 1 is `strength`; pictures 2–8 use `strength_2` … `strength_8`. */
export function snapRefSimpleStrengthKey(slot: number) {
  return slot === 1 ? 'strength' : `strength_${slot}`
}

const SNAPREF_SIMPLE_SLOTS = Array.from({ length: SNAPREF_SIMPLE_MAX_REFERENCES }, (_, index) => index + 1)

/** Widget inputs the editor owns. */
export const SNAPREF_SIMPLE_EDITABLE_KEYS: readonly string[] = [
  'adapter',
  'mode',
  'fidelity',
  ...SNAPREF_SIMPLE_SLOTS.flatMap((slot) => [snapRefSimpleReferenceKey(slot), snapRefSimpleStrengthKey(slot)]),
]

/** Whether a picture slot is used: a ComfyUI input file name, or an image value CoNAI uploads before the run. */
export function isSnapRefSimplePictureSet(value: unknown) {
  if (typeof value === 'string') return value.trim() !== '' && value !== SNAPREF_SIMPLE_UNUSED
  return Boolean(value) && typeof value === 'object'
}

function checkRange(issues: string[], key: string, value: unknown, range: { min: number; max: number }) {
  // Arrays are ComfyUI links; the workflow's link is kept.
  if (value === undefined || Array.isArray(value)) return
  if (typeof value !== 'number' || !Number.isFinite(value) || value < range.min || value > range.max) {
    issues.push(`${key} must be a number from ${range.min} to ${range.max} (received ${JSON.stringify(value)})`)
  }
}

/**
 * What the node would reject or CoNAI cannot send, checked on the effective node value (the workflow's saved inputs
 * with the supplied value over them). One English message per problem; empty when the value is usable.
 */
export function findSnapRefSimpleValueIssues(value: Record<string, unknown>): string[] {
  const issues: string[] = []
  for (const key of Object.keys(value)) {
    const match = /^(?:reference|strength)_(\d+)$/.exec(key)
    if (match && (Number(match[1]) < 2 || Number(match[1]) > SNAPREF_SIMPLE_MAX_REFERENCES)) {
      issues.push(`${key} is not a SnapRef input: pictures go in reference, reference_2 … reference_${SNAPREF_SIMPLE_MAX_REFERENCES} (at most ${SNAPREF_SIMPLE_MAX_REFERENCES})`)
    }
  }
  if (value.adapter !== undefined && !Array.isArray(value.adapter) && (typeof value.adapter !== 'string' || !value.adapter.trim())) {
    issues.push('adapter must be a SnapRef weights file name from models/loras')
  }
  if (value.mode !== undefined && !Array.isArray(value.mode) && !(SNAPREF_SIMPLE_MODES as readonly unknown[]).includes(value.mode)) {
    issues.push(`mode must be one of ${SNAPREF_SIMPLE_MODES.map((mode) => JSON.stringify(mode)).join(', ')}`)
  }
  checkRange(issues, 'fidelity', value.fidelity, SNAPREF_SIMPLE_FIDELITY)
  for (const slot of SNAPREF_SIMPLE_SLOTS) {
    const key = snapRefSimpleReferenceKey(slot)
    const picture = value[key]
    if (slot === 1) {
      if (!isSnapRefSimplePictureSet(picture)) issues.push('reference (picture 1) is required')
    } else if (picture !== undefined && !isSnapRefSimplePictureSet(picture) && picture !== SNAPREF_SIMPLE_UNUSED) {
      issues.push(`${key} must be a picture or "${SNAPREF_SIMPLE_UNUSED}" (received ${JSON.stringify(picture)})`)
    }
    checkRange(issues, snapRefSimpleStrengthKey(slot), value[snapRefSimpleStrengthKey(slot)], SNAPREF_SIMPLE_STRENGTH)
  }
  return issues
}
