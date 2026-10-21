import type { ReactNode } from 'react'
import {
  getNaiFixedModelSettings,
  getNaiQualityTags,
  getNaiUcPresetIds,
  NAI_ENHANCE_AMOUNTS,
  planNaiEnhance,
  type NaiEnhanceAmount,
  type NaiEnhancePlan,
  type NaiEnhanceUnavailableReason,
  type NaiFixedModelSettings,
  type NaiUcPresetId,
} from '@conai/shared'
import type { TranslationInput, TranslationParams } from '@/i18n'
import { normalizeTextSegmentSpreadsheetText } from './components/prompt-text-segment-helpers'
import type {
  ComfyUIServerConnectionStatus,
} from '@/lib/api-image-generation-types'
import type { ModulePortDataType } from '@/lib/api-module-graph'

export { getErrorMessage } from '@/lib/error-message'

export type SelectedImageDraft = {
  fileName: string
  dataUrl: string
  mimeType?: string
  /** Set when a library image was picked and passed on unchanged, so callers can reference it instead of copying. */
  compositeHash?: string
}

const imageDraftRevisions = new WeakMap<object, { dataUrl: string; id: number }>()
let imageDraftRevision = 0

/** Track image content by identity, without serializing base64 on every input change. */
export function getImageDraftRevision(draft: object) {
  return JSON.stringify(draft, function (this: object, key: string, value: unknown) {
    if (key !== 'dataUrl' || typeof value !== 'string') return value
    let revision = imageDraftRevisions.get(this)
    if (!revision || revision.dataUrl !== value) {
      revision = { dataUrl: value, id: ++imageDraftRevision }
      imageDraftRevisions.set(this, revision)
    }
    return revision.id
  })
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

/** Enhance setting of the img2img form: off or one NovelAI upscale amount. */
export type NaiEnhanceSetting = 'off' | NaiEnhanceAmount
export const NAI_ENHANCE_SETTINGS: readonly NaiEnhanceSetting[] = ['off', ...NAI_ENHANCE_AMOUNTS]

export type NAIFormDraft = {
  prompt: string
  negativePrompt: string
  /** Append the model's quality tags to the prompt (server side). */
  qualityToggle: boolean
  /** Undesired Content preset placed before the negative prompt (server side). */
  ucPreset: NaiUcPresetId
  /** Queue jobs per Generate click (`enqueue_count`). */
  queueCount: string
  enhance: NaiEnhanceSetting
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
  transparentBackground: boolean
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

export const NAI_MODEL_OPTIONS = [
  { value: 'nai-diffusion-5-curated', label: 'NAI Diffusion V5 Curated' },
  { value: 'nai-diffusion-5-full', label: 'NAI Diffusion V5 Full' },
  { value: 'nai-diffusion-5-full-medium', label: 'NAI Diffusion V5 Full Medium (Economy)' },
  { value: 'nai-diffusion-4-5-curated', label: 'NAI Diffusion 4.5 Curated' },
  { value: 'nai-diffusion-4-5-full', label: 'NAI Diffusion 4.5 Full' },
  { value: 'nai-diffusion-4-curated-preview', label: 'NAI Diffusion 4 Curated' },
  { value: 'nai-diffusion-3', label: 'NAI Diffusion 3' },
] as const

export const NAI_ACTION_OPTIONS = [
  { value: 'generate', label: { ko: '새로 생성', en: 'Generate' } },
  { value: 'img2img', label: { ko: '이미지 변형 (img2img)', en: 'Image to image (img2img)' } },
  { value: 'infill', label: { ko: '인페인트 (infill)', en: 'Inpaint (infill)' } },
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
  // Off/none so existing prompts do not change for current users.
  qualityToggle: false,
  ucPreset: 'none',
  queueCount: '1',
  enhance: 'off',
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
  transparentBackground: false,
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

/** Repeat (queue jobs per click) range; the server caps `enqueue_count` at 32 as well. */
export const NAI_QUEUE_COUNT_MIN = 1
export const NAI_QUEUE_COUNT_MAX = 32

/** Clamp the NAI repeat count into the supported integer range. */
export function clampNaiQueueCount(value: string | number) {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) ? Math.min(NAI_QUEUE_COUNT_MAX, Math.max(NAI_QUEUE_COUNT_MIN, parsed)) : NAI_QUEUE_COUNT_MIN
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

/** Check whether the selected NAI model supports structured character prompts. */
export function supportsNaiCharacterPrompts(model: string) {
  return model.includes('nai-diffusion-4') || model.includes('nai-diffusion-5')
}

/** Check whether the selected NAI model can generate an alpha channel from prompt tags. */
export function supportsNaiTransparentBackground(model: string) {
  return model.includes('nai-diffusion-5')
}

/** Check whether the selected NAI model supports 4.5-only character references. */
export function supportsNaiCharacterReferences(model: string) {
  return model.includes('nai-diffusion-4-5')
}

/** Check whether the selected NAI model supports Vibe Transfer; NovelAI has not released it for V5. */
export function supportsNaiVibes(model: string) {
  return !model.includes('nai-diffusion-5')
}

/**
 * Quality tags / UC preset the model can use: unsupported values fall back to off / none, and a model with fixed
 * settings (V5 Full Medium) forces its UC preset (shown and sent; the stored value stays for switching back).
 */
export function resolveNaiPromptPresets(form: Pick<NAIFormDraft, 'model' | 'qualityToggle' | 'ucPreset'>) {
  return {
    qualityToggle: form.qualityToggle && getNaiQualityTags(form.model) !== null,
    ucPreset: getNaiFixedModelSettings(form.model)?.ucPreset ?? (getNaiUcPresetIds(form.model).includes(form.ucPreset) ? form.ucPreset : 'none' as const),
  }
}

/** Steps / sampler the request uses: a model with fixed settings overrides the stored values, which stay for switching back. */
export function resolveNaiSamplingSettings(form: Pick<NAIFormDraft, 'model' | 'steps' | 'sampler'>) {
  const fixed = getNaiFixedModelSettings(form.model)
  return fixed ? { steps: String(fixed.steps), sampler: fixed.sampler } : { steps: form.steps, sampler: form.sampler }
}

/** Why a V5 model cannot take vibes (submit, chat preset save, module-graph vibe inputs). */
export function getNaiVibesUnsupportedMessage(t: (input: TranslationInput) => string) {
  return t({
    ko: 'NovelAI가 V5 모델의 바이브 트랜스퍼를 아직 공개하지 않았어. 바이브를 지우거나 다른 모델을 골라줘.',
    en: 'NovelAI has not released Vibe Transfer for V5 models yet. Remove the vibes or pick another model.',
  })
}

/** Why the negative prompt is read-only on a model with fixed settings (NAI tab, chat preset editor). */
export function getNaiFixedNegativeHint(t: (input: TranslationInput) => string) {
  return t({
    ko: '이 모델은 고정된 Heavy UC만 써. 빼고 싶은 요소는 프롬프트에 -2::hat:: 처럼 음수 가중치로 넣어줘.',
    en: 'This model always uses the fixed Heavy UC. Put unwanted elements in the prompt as negative weights, e.g. -2::hat::.',
  })
}

/** Page-assistant hint on an input a model with fixed settings decides; the value shown is the one used. */
export const NAI_FIXED_MODEL_FIELD_HINT = 'Fixed by the selected model (NAI Diffusion V5 Full Medium); the value shown is what it uses. To set it, first change the model in a separate change. Put unwanted elements in the prompt as negative weights like -2::hat::.'

/** Page-assistant refusal for a patch to inputs a model with fixed settings decides. */
export function getNaiFixedFieldsError(t: (input: TranslationInput, params?: TranslationParams) => string, fields: readonly string[], settings: NaiFixedModelSettings) {
  return t({
    ko: '{fields}: 선택한 모델은 스텝 {steps}·{sampler}·Heavy UC로 고정이라 바꿀 수 없어. 빼고 싶은 요소는 프롬프트에 -2::hat:: 처럼 음수 가중치로 넣어줘.',
    en: '{fields}: the selected model fixes {steps} steps, {sampler} and the Heavy UC, so these cannot change. Put unwanted elements in the prompt as negative weights like -2::hat::.',
  }, { fields: fields.join(', '), steps: settings.steps, sampler: settings.sampler })
}

export type NaiImageSize = { width: number; height: number }

/** Why the form cannot enhance: not img2img, no source image, source size still loading, or the planner's reason. */
export type NaiEnhanceIssue = 'action' | 'source' | 'size_pending' | NaiEnhanceUnavailableReason

export type NaiFormEnhancePlan = { plan: NaiEnhancePlan; issue?: undefined } | { plan?: undefined; issue: NaiEnhanceIssue }

/** Plan one enhance amount for the form's img2img source image (natural size). */
export function planNaiFormEnhance(
  form: Pick<NAIFormDraft, 'action' | 'model' | 'sourceImage'>,
  sourceSize: NaiImageSize | null,
  amount: NaiEnhanceAmount,
): NaiFormEnhancePlan {
  if (form.action !== 'img2img') return { issue: 'action' }
  if (!form.sourceImage) return { issue: 'source' }
  if (!sourceSize) return { issue: 'size_pending' }
  const result = planNaiEnhance(sourceSize, amount, form.model)
  return result.ok ? { plan: result.plan } : { issue: result.reason }
}

/** The form's active enhance; null when it is off or the request is not img2img with a source (then it is not sent). */
export function resolveNaiFormEnhance(form: Pick<NAIFormDraft, 'action' | 'enhance' | 'model' | 'sourceImage'>, sourceSize: NaiImageSize | null) {
  if (form.enhance === 'off' || form.action !== 'img2img' || !form.sourceImage) return null
  return planNaiFormEnhance(form, sourceSize, form.enhance)
}

/** Short reason text for an enhance issue (option labels, field hint, submit and assistant errors). */
export function getNaiEnhanceIssueLabel(t: (input: TranslationInput) => string, issue: NaiEnhanceIssue) {
  switch (issue) {
    case 'action': return t({ ko: 'img2img에서만 가능', en: 'img2img only' })
    case 'source': return t({ ko: '원본 이미지 필요', en: 'Source image required' })
    case 'size_pending': return t({ ko: '원본 크기 확인 중', en: 'Reading the source size' })
    case 'model': return t({ ko: 'V5 모델 전용', en: 'V5 models only' })
    case 'custom_size': return t({ ko: 'NovelAI 표준 크기만 가능', en: 'NovelAI standard sizes only' })
    case 'over_cap': return t({ ko: '결과가 최대 크기(약 3.1MP) 초과', en: 'Result would exceed the ~3.1MP cap' })
    case 'already_max': return t({ ko: '원본이 이미 최대 크기', en: 'Source is already at the cap' })
  }
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

