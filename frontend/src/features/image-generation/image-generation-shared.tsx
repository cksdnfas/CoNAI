import type { ReactNode } from 'react'
import { normalizeTextSegmentSpreadsheetText } from './components/prompt-text-segment-helpers'
import type {
  ComfyUIServerConnectionStatus,
} from '@/lib/api-image-generation-types'
import type { ModulePortDataType, ModuleUiFieldDefinition } from '@/lib/api-module-graph'

export { getErrorMessage } from '@/lib/error-message'

export type SelectedImageDraft = {
  fileName: string
  dataUrl: string
  mimeType?: string
}

export type NAICharacterPromptDraft = {
  prompt: string
  uc: string
  centerX: string
  centerY: string
}

export const NAI_CHARACTER_GRID_X_OPTIONS = [
  { value: '0.1', label: 'A · Left' },
  { value: '0.3', label: 'B · Mid-left' },
  { value: '0.5', label: 'C · Center' },
  { value: '0.7', label: 'D · Mid-right' },
  { value: '0.9', label: 'E · Right' },
] as const

export const NAI_CHARACTER_GRID_Y_OPTIONS = [
  { value: '0.1', label: '1 · Top' },
  { value: '0.3', label: '2 · Upper-mid' },
  { value: '0.5', label: '3 · Center' },
  { value: '0.7', label: '4 · Lower-mid' },
  { value: '0.9', label: '5 · Bottom' },
] as const

const NAI_CHARACTER_GRID_VALUES = [0.1, 0.3, 0.5, 0.7, 0.9] as const

export type NAIVibeDraft = {
  image?: SelectedImageDraft
  encoded: string
  strength: string
  informationExtracted: string
}

export type NAICharacterReferenceDraft = {
  image?: SelectedImageDraft
  type: 'character' | 'style' | 'character&style'
  strength: string
  fidelity: string
}

export type NAIResolutionPreset = {
  key: string
  label: string
  width: number
  height: number
}

export const NAI_RESOLUTION_PRESETS: NAIResolutionPreset[] = [
  { key: 'portrait-832', label: 'Portrait 832×1216', width: 832, height: 1216 },
  { key: 'landscape-832', label: 'Landscape 1216×832', width: 1216, height: 832 },
  { key: 'portrait-1024', label: 'Portrait 1024×1536', width: 1024, height: 1536 },
  { key: 'landscape-1024', label: 'Landscape 1536×1024', width: 1536, height: 1024 },
  { key: 'square-1024', label: 'Square 1024×1024', width: 1024, height: 1024 },
]

export type NAIFormDraft = {
  prompt: string
  negativePrompt: string
  model: string
  action: 'generate' | 'img2img' | 'infill'
  sampler: string
  scheduler: string
  width: string
  height: string
  resolutionPreset: string
  steps: string
  scale: string
  samples: string
  seed: string
  characterPositionAiChoice: boolean
  characters: NAICharacterPromptDraft[]
  vibes: NAIVibeDraft[]
  characterReferences: NAICharacterReferenceDraft[]
  varietyPlus: boolean
  strength: string
  noise: string
  addOriginalImage: boolean
  sourceImage?: SelectedImageDraft
  maskImage?: SelectedImageDraft
}

export type WorkflowTextDraftSegments = string[]

export type WorkflowNodeDraftValue = Record<string, unknown>

export type WorkflowFieldDraftValue = string | WorkflowTextDraftSegments | SelectedImageDraft | WorkflowNodeDraftValue

export type ComfyUIServerFormDraft = {
  name: string
  endpoint: string
  backendType: 'comfyui' | 'modal'
  capacity: string
  description: string
  routingTags: string
  isActive: boolean
  isDefault: boolean
}

export type ComfyUIServerTestState = {
  isLoading: boolean
  status?: ComfyUIServerConnectionStatus
  error?: string
}

export type ModuleFieldOption = {
  key: string
  label: string
  dataType: ModulePortDataType
  options?: string[]
}

type TranslateResource = (input: string) => string

const NAI_MODULE_FIELD_LABEL_KEYS = {
  prompt: 'image-generation.image.generation.shared.prompt',
  negativePrompt: 'image-generation.image.generation.shared.negative.prompt',
  model: 'image-generation.image.generation.shared.model',
  action: 'image-generation.image.generation.shared.action',
  sampler: 'image-generation.image.generation.shared.sampler',
  scheduler: 'image-generation.image.generation.shared.scheduler',
  width: 'image-generation.image.generation.shared.width',
  height: 'image-generation.image.generation.shared.height',
  steps: 'image-generation.image.generation.shared.steps',
  scale: 'image-generation.image.generation.shared.cfg.scale',
  samples: 'image-generation.image.generation.shared.sample.count',
  seed: 'image-generation.image.generation.shared.seed',
  varietyPlus: 'image-generation.image.generation.shared.variety',
  characters: 'image-generation.image.generation.shared.character.prompt',
  vibes: 'image-generation.image.generation.shared.send.vibe',
  characterRefs: 'image-generation.image.generation.shared.character.reference',
  image: 'image-generation.image.generation.shared.original.image',
  strength: 'image-generation.image.generation.shared.strength',
  noise: 'image-generation.image.generation.shared.noise',
  mask: 'image-generation.image.generation.shared.mask.image',
  addOriginalImage: 'image-generation.image.generation.shared.add.original.image',
} as const

type NaiModuleFieldLabelKey = keyof typeof NAI_MODULE_FIELD_LABEL_KEYS

export const NAI_MODEL_OPTIONS = [
  { value: 'nai-diffusion-4-5-curated', label: 'NAI Diffusion 4.5 Curated' },
  { value: 'nai-diffusion-4-5-full', label: 'NAI Diffusion 4.5 Full' },
  { value: 'nai-diffusion-4-curated-preview', label: 'NAI Diffusion 4 Curated' },
  { value: 'nai-diffusion-3', label: 'NAI Diffusion 3' },
] as const

export const NAI_ACTION_OPTIONS = [
  { value: 'generate', label: 'generate' },
  { value: 'img2img', label: 'img2img' },
  { value: 'infill', label: 'infill' },
] as const

export const NAI_SAMPLER_OPTIONS = [
  { value: 'k_euler', label: 'k_euler' },
  { value: 'k_euler_ancestral', label: 'k_euler_ancestral' },
  { value: 'k_dpmpp_2s_ancestral', label: 'k_dpmpp_2s_ancestral' },
  { value: 'k_dpmpp_2m', label: 'k_dpmpp_2m' },
] as const

export const NAI_SCHEDULER_OPTIONS = [
  { value: 'karras', label: 'karras' },
  { value: 'native', label: 'native' },
  { value: 'exponential', label: 'exponential' },
  { value: 'polyexponential', label: 'polyexponential' },
] as const

export const EMPTY_NAI_CHARACTER_PROMPT: NAICharacterPromptDraft = {
  prompt: '',
  uc: '',
  centerX: '0.5',
  centerY: '0.5',
}

export const EMPTY_NAI_VIBE: NAIVibeDraft = {
  encoded: '',
  strength: '0.6',
  informationExtracted: '1',
}

export const EMPTY_NAI_CHARACTER_REFERENCE: NAICharacterReferenceDraft = {
  type: 'character&style',
  strength: '0.6',
  fidelity: '1',
}

export const DEFAULT_NAI_FORM: NAIFormDraft = {
  prompt: '',
  negativePrompt: '',
  model: 'nai-diffusion-4-5-curated',
  action: 'generate',
  sampler: 'k_euler',
  scheduler: 'karras',
  width: '1024',
  height: '1024',
  resolutionPreset: 'square-1024',
  steps: '28',
  scale: '6',
  samples: '1',
  seed: '',
  characterPositionAiChoice: true,
  characters: [],
  vibes: [],
  characterReferences: [],
  varietyPlus: false,
  strength: '0.3',
  noise: '0',
  addOriginalImage: true,
}

export const DEFAULT_COMFYUI_SERVER_FORM: ComfyUIServerFormDraft = {
  name: '',
  endpoint: 'http://127.0.0.1:8188',
  backendType: 'comfyui',
  capacity: '1',
  description: '',
  routingTags: '',
  isActive: true,
  isDefault: false,
}

export * from './image-generation-drafts'

export * from './generation-history-status'

export function FormField({
  label,
  children,
  hint,
  labelAccessory,
}: {
  label: string
  children: ReactNode
  hint?: string
  labelAccessory?: ReactNode
}) {
  return (
    <label className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{label}</span>
          {labelAccessory}
        </div>
        {hint ? <span className="shrink-0 text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </label>
  )
}

/** Parse a numeric text input while keeping a safe fallback. */
export function parseNumberInput(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const NAI_SAMPLE_COUNT_MIN = 1
export const NAI_SAMPLE_COUNT_MAX = 4

/** Clamp the NAI sample count into the supported integer range. */
export function clampNaiSampleCount(value: string | number, fallback = NAI_SAMPLE_COUNT_MIN) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  const integerValue = Math.trunc(parsed)
  return Math.min(NAI_SAMPLE_COUNT_MAX, Math.max(NAI_SAMPLE_COUNT_MIN, integerValue))
}

/** Toggle a string item inside a selection array. */
export function toggleSelectionItem(items: string[], value: string) {
  return items.includes(value) ? items.filter((item) => item !== value) : [...items, value]
}

/** Snap one character position input to the 5x5 grid used by the test API docs. */
export function snapNaiCharacterGridValue(value: string | number) {
  const numericValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numericValue)) {
    return '0.5'
  }

  const nearestValue = NAI_CHARACTER_GRID_VALUES.reduce((best, candidate) => (
    Math.abs(candidate - numericValue) < Math.abs(best - numericValue) ? candidate : best
  ), 0.5)

  return nearestValue.toFixed(1)
}

/** Normalize character positions onto the documented 5x5 grid while keeping user edits intact. */
export function normalizeNaiCharacterPromptDrafts(characters: NAICharacterPromptDraft[]) {
  return characters.map((character) => ({
    ...character,
    centerX: snapNaiCharacterGridValue(character.centerX),
    centerY: snapNaiCharacterGridValue(character.centerY),
  }))
}

/** Check whether a character prompt list can use manual 5x5 placement. */
export function canUseNaiCharacterPositions(characterCount: number) {
  return characterCount >= 1
}

/** Resolve whether the current NAI form should send manual character positions. */
export function shouldUseNaiCharacterPositions(form: Pick<NAIFormDraft, 'characterPositionAiChoice' | 'characters'>) {
  return canUseNaiCharacterPositions(form.characters.length) && !form.characterPositionAiChoice
}

/** Check whether the selected NAI model supports v4 character prompts. */
export function supportsNaiCharacterPrompts(model: string) {
  return model.includes('nai-diffusion-4')
}

/** Check whether the selected NAI model supports 4.5-only character references. */
export function supportsNaiCharacterReferences(model: string) {
  return model.includes('nai-diffusion-4-5')
}

/** Resolve the resolution preset key for a width/height pair. */
export function resolveNaiResolutionPreset(width: string, height: string) {
  const numericWidth = Number(width)
  const numericHeight = Number(height)
  const preset = NAI_RESOLUTION_PRESETS.find((entry) => entry.width === numericWidth && entry.height === numericHeight)
  return preset?.key || 'custom'
}

/** Convert the editable character-prompt rows into the backend payload shape. */
export function buildNaiCharacterPromptPayload(characters: NAICharacterPromptDraft[]) {
  return normalizeNaiCharacterPromptDrafts(characters)
    .map((character) => ({
      prompt: normalizeTextSegmentSpreadsheetText(character.prompt).trim(),
      uc: normalizeTextSegmentSpreadsheetText(character.uc).trim(),
      center_x: parseNumberInput(character.centerX, 0.5),
      center_y: parseNumberInput(character.centerY, 0.5),
    }))
    .filter((character) => character.prompt.length > 0)
}

/** Convert Vibe rows into the backend payload shape. */
export function buildNaiVibePayload(vibes: NAIVibeDraft[]) {
  return vibes
    .map((vibe) => ({
      encoded: vibe.encoded.trim(),
      strength: parseNumberInput(vibe.strength, 0.6),
      information_extracted: parseNumberInput(vibe.informationExtracted, 1),
    }))
    .filter((vibe) => vibe.encoded.length > 0)
}

/** Convert character-reference rows into the backend payload shape. */
export function buildNaiCharacterReferencePayload(characterReferences: NAICharacterReferenceDraft[]) {
  return characterReferences
    .map((reference) => ({
      image: reference.image?.dataUrl || '',
      type: reference.type,
      strength: parseNumberInput(reference.strength, 0.6),
      fidelity: parseNumberInput(reference.fidelity, 1),
    }))
    .filter((reference) => reference.image.length > 0)
}

/** Build a backend-ready NAI snapshot from the current form draft. */
export function buildNaiModuleSnapshot(form: NAIFormDraft) {
  return {
    prompt: normalizeTextSegmentSpreadsheetText(form.prompt).trim(),
    negative_prompt: normalizeTextSegmentSpreadsheetText(form.negativePrompt).trim() || '',
    model: form.model,
    action: form.action,
    sampler: form.sampler,
    noise_schedule: form.scheduler,
    width: parseNumberInput(form.width, 1024),
    height: parseNumberInput(form.height, 1024),
    steps: parseNumberInput(form.steps, 28),
    scale: parseNumberInput(form.scale, 6),
    n_samples: clampNaiSampleCount(form.samples),
    seed: form.seed.trim().length > 0 ? Number(form.seed) : null,
    use_coords: shouldUseNaiCharacterPositions(form),
    characters: buildNaiCharacterPromptPayload(form.characters),
    vibes: buildNaiVibePayload(form.vibes),
    character_refs: buildNaiCharacterReferencePayload(form.characterReferences),
    variety_plus: form.varietyPlus,
    image: form.action !== 'generate' ? form.sourceImage?.dataUrl || null : null,
    mask: form.action === 'infill' ? form.maskImage?.dataUrl || null : null,
    strength: form.action !== 'generate' ? parseNumberInput(form.strength, 0.3) : null,
    noise: form.action !== 'generate' ? parseNumberInput(form.noise, 0) : null,
    add_original_image: form.action === 'infill' ? form.addOriginalImage : null,
  }
}

/** Build candidate module inputs from the current NAI form mode. */
export function buildNaiModuleFieldOptions(form: NAIFormDraft, t: TranslateResource): ModuleFieldOption[] {
  const label = (key: NaiModuleFieldLabelKey) => t(NAI_MODULE_FIELD_LABEL_KEYS[key])
  const options: ModuleFieldOption[] = [
    { key: 'prompt', label: label('prompt'), dataType: 'prompt' },
    { key: 'negative_prompt', label: label('negativePrompt'), dataType: 'prompt' },
    { key: 'model', label: label('model'), dataType: 'text', options: NAI_MODEL_OPTIONS.map((option) => option.value) },
    { key: 'action', label: label('action'), dataType: 'text', options: NAI_ACTION_OPTIONS.map((option) => option.value) },
    { key: 'sampler', label: label('sampler'), dataType: 'text', options: NAI_SAMPLER_OPTIONS.map((option) => option.value) },
    { key: 'noise_schedule', label: label('scheduler'), dataType: 'text', options: NAI_SCHEDULER_OPTIONS.map((option) => option.value) },
    { key: 'width', label: label('width'), dataType: 'number' },
    { key: 'height', label: label('height'), dataType: 'number' },
    { key: 'steps', label: label('steps'), dataType: 'number' },
    { key: 'scale', label: label('scale'), dataType: 'number' },
    { key: 'n_samples', label: label('samples'), dataType: 'number' },
    { key: 'seed', label: label('seed'), dataType: 'number' },
    { key: 'variety_plus', label: label('varietyPlus'), dataType: 'boolean' },
  ]

  if (supportsNaiCharacterPrompts(form.model)) {
    options.push({ key: 'characters', label: label('characters'), dataType: 'json' })
  }

  options.push({ key: 'vibes', label: label('vibes'), dataType: 'json' })

  if (supportsNaiCharacterReferences(form.model)) {
    options.push({ key: 'character_refs', label: label('characterRefs'), dataType: 'json' })
  }

  if (form.action !== 'generate') {
    options.push(
      { key: 'image', label: label('image'), dataType: 'image' },
      { key: 'strength', label: label('strength'), dataType: 'number' },
      { key: 'noise', label: label('noise'), dataType: 'number' },
    )
  }

  if (form.action === 'infill') {
    options.push(
      { key: 'mask', label: label('mask'), dataType: 'mask' },
      { key: 'add_original_image', label: label('addOriginalImage'), dataType: 'boolean' },
    )
  }

  return options
}

/** Build the exposed-field contract for saved generation modules. */
export function buildModuleExposedFields(fieldOptions: ModuleFieldOption[], exposedFieldKeys: string[]) {
  const exposedFieldKeySet = new Set(exposedFieldKeys)

  return fieldOptions
    .filter((field) => exposedFieldKeySet.has(field.key))
    .map((field) => ({
      key: field.key,
      label: field.label,
      data_type: field.dataType,
    }))
}

/** Build module UI schema entries so saved generation modules keep select inputs as dropdowns. */
export function buildModuleUiSchema(fieldOptions: ModuleFieldOption[], snapshot: Record<string, unknown>, exposedFieldKeys: string[]): ModuleUiFieldDefinition[] {
  const exposedFieldKeySet = new Set(exposedFieldKeys)

  return fieldOptions
    .filter((field) => exposedFieldKeySet.has(field.key))
    .map((field) => ({
      key: field.key,
      label: field.label,
      data_type: field.options && field.options.length > 0 ? 'select' : field.dataType,
      default_value: snapshot[field.key],
      options: field.options,
    }))
}
