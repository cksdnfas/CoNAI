import type { ReactNode } from 'react'
import type {
  ComfyUIServerConnectionStatus,
  GenerationHistoryRecord,
  GenerationServiceType,
  ModulePortDataType,
  ModuleUiFieldDefinition,
  WorkflowMarkedField,
} from '@/lib/api'

export type HistoryFilter = 'all' | GenerationServiceType

export type SelectedImageDraft = {
  fileName: string
  dataUrl: string
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

export type WorkflowFieldDraftValue = string | SelectedImageDraft

export type ComfyUIServerFormDraft = {
  name: string
  endpoint: string
  description: string
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
  description: '',
}

/** Read a human-friendly error message from an unknown failure. */
export function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

/** Format a history timestamp for the current locale. */
export function formatHistoryDate(value?: string | null) {
  if (!value) {
    return '시간 정보 없음'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

/** Build the initial draft object for workflow marked fields. */
export function buildWorkflowDraft(fields: WorkflowMarkedField[]) {
  return fields.reduce<Record<string, WorkflowFieldDraftValue>>((draft, field) => {
    const defaultValue = field.default_value
    draft[field.id] = defaultValue === undefined || defaultValue === null ? '' : String(defaultValue)
    return draft
  }, {})
}

/** Read a local file into a data URL for API transport. */
export function readFileAsDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file as data URL'))
    reader.readAsDataURL(file)
  })
}

/** Build one selected-image draft from a local File object. */
export async function buildSelectedImageDraftFromFile(file: File): Promise<SelectedImageDraft> {
  return {
    fileName: file.name,
    dataUrl: await readFileAsDataUrl(file),
  }
}

/** Build one selected-image draft by fetching an existing image URL. */
export async function buildSelectedImageDraftFromUrl(url: string, fileName?: string): Promise<SelectedImageDraft> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`)
  }

  const blob = await response.blob()
  const resolvedFileName = fileName || url.split('/').pop() || 'selected-image'

  return {
    fileName: resolvedFileName,
    dataUrl: await readFileAsDataUrl(blob),
  }
}

/** Build one selected-image draft directly from a prepared data URL payload. */
export function buildSelectedImageDraftFromDataUrl(dataUrl: string, fileName = 'edited-image.png'): SelectedImageDraft {
  return {
    fileName,
    dataUrl,
  }
}

/** Check whether a workflow field draft has a usable value. */
export function hasWorkflowFieldValue(value: WorkflowFieldDraftValue | undefined) {
  if (!value) {
    return false
  }

  if (typeof value === 'string') {
    return value.trim().length > 0
  }

  return value.dataUrl.trim().length > 0
}

/** Convert workflow field input strings into the payload expected by the backend. */
export function buildWorkflowPromptData(fields: WorkflowMarkedField[], draft: Record<string, WorkflowFieldDraftValue>) {
  return fields.reduce<Record<string, string | number | SelectedImageDraft>>((payload, field) => {
    const value = draft[field.id]

    if (!hasWorkflowFieldValue(value)) {
      return payload
    }

    if (typeof value !== 'string') {
      payload[field.id] = value
      return payload
    }

    if (field.type === 'number') {
      payload[field.id] = Number(value)
      return payload
    }

    payload[field.id] = value.trim()
    return payload
  }, {})
}

/** Resolve the most useful image detail route for a history item. */
export function getHistoryDetailHref(record: GenerationHistoryRecord) {
  const compositeHash = record.actual_composite_hash || record.composite_hash
  return compositeHash ? `/images/${compositeHash}` : null
}

/** Resolve a compact label for the history service type. */
export function getHistoryServiceLabel(serviceType: GenerationServiceType) {
  return serviceType === 'novelai' ? 'NAI' : 'ComfyUI'
}

/** Resolve a compact label for the history status badge. */
export function getHistoryStatusLabel(status: GenerationHistoryRecord['generation_status']) {
  if (status === 'completed') return '완료'
  if (status === 'failed') return '실패'
  if (status === 'processing') return '처리 중'
  return '대기 중'
}

/** Resolve a concise title for each history row. */
export function getHistoryTitle(record: GenerationHistoryRecord) {
  if (record.service_type === 'novelai') {
    return record.nai_model || 'NovelAI 생성'
  }

  return record.workflow_name || 'ComfyUI 워크플로우'
}

export function FormField({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
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
      prompt: character.prompt.trim(),
      uc: character.uc.trim(),
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
    prompt: form.prompt.trim(),
    negative_prompt: form.negativePrompt.trim() || '',
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
export function buildNaiModuleFieldOptions(form: NAIFormDraft): ModuleFieldOption[] {
  const options: ModuleFieldOption[] = [
    { key: 'prompt', label: '프롬프트', dataType: 'prompt' },
    { key: 'negative_prompt', label: '네거티브 프롬프트', dataType: 'prompt' },
    { key: 'model', label: '모델', dataType: 'text', options: NAI_MODEL_OPTIONS.map((option) => option.value) },
    { key: 'action', label: '동작', dataType: 'text', options: NAI_ACTION_OPTIONS.map((option) => option.value) },
    { key: 'sampler', label: '샘플러', dataType: 'text', options: NAI_SAMPLER_OPTIONS.map((option) => option.value) },
    { key: 'noise_schedule', label: '스케줄러', dataType: 'text', options: NAI_SCHEDULER_OPTIONS.map((option) => option.value) },
    { key: 'width', label: '너비', dataType: 'number' },
    { key: 'height', label: '높이', dataType: 'number' },
    { key: 'steps', label: '스텝', dataType: 'number' },
    { key: 'scale', label: 'CFG 스케일', dataType: 'number' },
    { key: 'n_samples', label: '샘플 수', dataType: 'number' },
    { key: 'seed', label: '시드', dataType: 'number' },
    { key: 'variety_plus', label: '버라이어티+', dataType: 'boolean' },
  ]

  if (supportsNaiCharacterPrompts(form.model)) {
    options.push({ key: 'characters', label: '캐릭터 프롬프트', dataType: 'json' })
  }

  options.push({ key: 'vibes', label: '바이브 전송', dataType: 'json' })

  if (supportsNaiCharacterReferences(form.model)) {
    options.push({ key: 'character_refs', label: '캐릭터 레퍼런스', dataType: 'json' })
  }

  if (form.action !== 'generate') {
    options.push(
      { key: 'image', label: '원본 이미지', dataType: 'image' },
      { key: 'strength', label: '강도', dataType: 'number' },
      { key: 'noise', label: '노이즈', dataType: 'number' },
    )
  }

  if (form.action === 'infill') {
    options.push(
      { key: 'mask', label: '마스크 이미지', dataType: 'mask' },
      { key: 'add_original_image', label: '원본 이미지 추가', dataType: 'boolean' },
    )
  }

  return options
}

/** Build module UI schema entries so saved NAI modules keep select inputs as dropdowns. */
export function buildNaiModuleUiSchema(fieldOptions: ModuleFieldOption[], snapshot: Record<string, unknown>, exposedFieldKeys: string[]): ModuleUiFieldDefinition[] {
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
