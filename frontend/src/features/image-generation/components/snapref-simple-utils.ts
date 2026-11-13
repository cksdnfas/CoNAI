import {
  isSnapRefSimplePictureSet,
  SNAPREF_SIMPLE_MAX_REFERENCES,
  SNAPREF_SIMPLE_STRENGTH,
  SNAPREF_SIMPLE_UNUSED,
  snapRefSimpleReferenceKey,
  snapRefSimpleStrengthKey,
} from '@conai/shared'
import { buildWorkflowInputAssetUrl, type WorkflowInputAssetRef } from '@/lib/api-workflow-input-assets'
import { isWorkflowInputAssetRef } from './minimax-h3-director-dasiwa-utils'

/** Authoring-graph input key of the whole-node SnapRef field. */
export const SNAPREF_SIMPLE_NODE_INPUT_KEY = '__snapref_simple_node__'

/** One used picture slot; `picture` is a ComfyUI input file name, a CoNAI workflow input asset, or another image value. */
export type SnapRefSimpleSlot = { picture: unknown; strength: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Used picture slots in node order; picture 1 is always listed because the node requires it. */
export function readSnapRefSimpleSlots(value: Record<string, unknown>): SnapRefSimpleSlot[] {
  const slots: SnapRefSimpleSlot[] = []
  for (let slot = 1; slot <= SNAPREF_SIMPLE_MAX_REFERENCES; slot++) {
    const picture = value[snapRefSimpleReferenceKey(slot)]
    if (slot > 1 && !isSnapRefSimplePictureSet(picture)) continue
    const strength = value[snapRefSimpleStrengthKey(slot)]
    slots.push({ picture, strength: typeof strength === 'number' && Number.isFinite(strength) ? strength : SNAPREF_SIMPLE_STRENGTH.default })
  }
  return slots
}

/** Write the pictures back without gaps: slot N holds the Nth picture and every later slot is "none". */
export function writeSnapRefSimpleSlots(value: Record<string, unknown>, slots: SnapRefSimpleSlot[]): Record<string, unknown> {
  const next = { ...value }
  for (let slot = 1; slot <= SNAPREF_SIMPLE_MAX_REFERENCES; slot++) {
    const entry = slots[slot - 1]
    if (!entry && slot === 1) continue
    next[snapRefSimpleReferenceKey(slot)] = entry ? entry.picture : SNAPREF_SIMPLE_UNUSED
    next[snapRefSimpleStrengthKey(slot)] = entry ? entry.strength : SNAPREF_SIMPLE_STRENGTH.default
  }
  return next
}

/** CoNAI-stored pictures of a SnapRef value, for cleanup when they leave the draft. */
export function getSnapRefSimpleAssets(value: Record<string, unknown>): WorkflowInputAssetRef[] {
  return readSnapRefSimpleSlots(value).flatMap((slot) => isWorkflowInputAssetRef(slot.picture) ? [slot.picture] : [])
}

/** Pictures a stored request still carries: ComfyUI input file names, CoNAI workflow input assets and library images. */
function isRestorableSnapRefSimplePicture(picture: unknown) {
  if (typeof picture === 'string') return isSnapRefSimplePictureSet(picture)
  return isWorkflowInputAssetRef(picture) || (isRecord(picture) && typeof picture.composite_hash === 'string' && picture.composite_hash !== '')
}

/**
 * A SnapRef value loaded from generation history. Stored requests drop inline image data, so, as image fields keep the
 * current image, such a picture 1 keeps the current draft's picture and a later one leaves its slot unused.
 */
export function restoreSnapRefSimpleHistoryValue(value: Record<string, unknown>, current: unknown) {
  const restored = { ...value }
  let hasDroppedPictures = false
  for (let slot = 1; slot <= SNAPREF_SIMPLE_MAX_REFERENCES; slot++) {
    const key = snapRefSimpleReferenceKey(slot)
    if (restored[key] === undefined || restored[key] === SNAPREF_SIMPLE_UNUSED || isRestorableSnapRefSimplePicture(restored[key])) continue
    hasDroppedPictures = true
    restored[key] = slot === 1 ? (isRecord(current) ? current.reference : undefined) : SNAPREF_SIMPLE_UNUSED
  }
  return { value: restored, hasDroppedPictures }
}

/** Display name and preview URL of one picture value; ComfyUI input files have no CoNAI preview. */
export function describeSnapRefSimplePicture(picture: unknown): { name: string; previewUrl?: string } {
  if (isWorkflowInputAssetRef(picture)) return { name: picture.fileName, previewUrl: buildWorkflowInputAssetUrl(picture) }
  if (typeof picture === 'string') return { name: /^data:/i.test(picture) ? 'image' : isSnapRefSimplePictureSet(picture) ? picture : '' }
  if (isRecord(picture)) {
    const name = picture.fileName ?? picture.composite_hash
    return { name: typeof name === 'string' ? name : '' }
  }
  return { name: '' }
}
