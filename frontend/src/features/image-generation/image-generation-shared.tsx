import type { ReactNode } from 'react'
import type {
  ComfyUIServerConnectionStatus,
  GenerationHistoryRecord,
  GenerationServiceType,
  ModulePortDataType,
  WorkflowMarkedField,
} from '@/lib/api'

export type HistoryFilter = 'all' | GenerationServiceType

export type SelectedImageDraft = {
  fileName: string
  dataUrl: string
}

export type NAIFormDraft = {
  prompt: string
  negativePrompt: string
  model: string
  action: 'generate' | 'img2img' | 'infill'
  sampler: string
  width: string
  height: string
  steps: string
  scale: string
  samples: string
  seed: string
  ucPreset: string
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
}

export const DEFAULT_NAI_FORM: NAIFormDraft = {
  prompt: '',
  negativePrompt: '',
  model: 'nai-diffusion-4-5-curated',
  action: 'generate',
  sampler: 'k_euler',
  width: '1024',
  height: '1024',
  steps: '28',
  scale: '6',
  samples: '1',
  seed: '',
  ucPreset: '0',
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
export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file as data URL'))
    reader.readAsDataURL(file)
  })
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

export function SummaryChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm bg-surface-high px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm text-foreground">{value}</div>
    </div>
  )
}

/** Parse a numeric text input while keeping a safe fallback. */
export function parseNumberInput(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Toggle a string item inside a selection array. */
export function toggleSelectionItem(items: string[], value: string) {
  return items.includes(value) ? items.filter((item) => item !== value) : [...items, value]
}

/** Build a backend-ready NAI snapshot from the current form draft. */
export function buildNaiModuleSnapshot(form: NAIFormDraft) {
  return {
    prompt: form.prompt.trim(),
    negative_prompt: form.negativePrompt.trim() || '',
    model: form.model,
    action: form.action,
    sampler: form.sampler,
    width: parseNumberInput(form.width, 1024),
    height: parseNumberInput(form.height, 1024),
    steps: parseNumberInput(form.steps, 28),
    scale: parseNumberInput(form.scale, 6),
    n_samples: parseNumberInput(form.samples, 1),
    seed: form.seed.trim().length > 0 ? Number(form.seed) : null,
    ucPreset: parseNumberInput(form.ucPreset, 0),
    variety_plus: form.varietyPlus,
    image: form.sourceImage?.dataUrl || null,
    mask: form.maskImage?.dataUrl || null,
    strength: form.action !== 'generate' ? parseNumberInput(form.strength, 0.3) : null,
    noise: form.action !== 'generate' ? parseNumberInput(form.noise, 0) : null,
    add_original_image: form.action === 'infill' ? form.addOriginalImage : null,
  }
}

/** Build candidate module inputs from the current NAI form mode. */
export function buildNaiModuleFieldOptions(form: NAIFormDraft): ModuleFieldOption[] {
  const options: ModuleFieldOption[] = [
    { key: 'prompt', label: 'Prompt', dataType: 'prompt' },
    { key: 'negative_prompt', label: 'Negative Prompt', dataType: 'prompt' },
    { key: 'model', label: 'Model', dataType: 'text' },
    { key: 'action', label: 'Action', dataType: 'text' },
    { key: 'sampler', label: 'Sampler', dataType: 'text' },
    { key: 'width', label: 'Width', dataType: 'number' },
    { key: 'height', label: 'Height', dataType: 'number' },
    { key: 'steps', label: 'Steps', dataType: 'number' },
    { key: 'scale', label: 'CFG Scale', dataType: 'number' },
    { key: 'n_samples', label: 'Samples', dataType: 'number' },
    { key: 'seed', label: 'Seed', dataType: 'number' },
    { key: 'ucPreset', label: 'ucPreset', dataType: 'number' },
    { key: 'variety_plus', label: 'Variety+', dataType: 'boolean' },
  ]

  if (form.action !== 'generate') {
    options.push(
      { key: 'image', label: 'Source Image', dataType: 'image' },
      { key: 'strength', label: 'Strength', dataType: 'number' },
      { key: 'noise', label: 'Noise', dataType: 'number' },
    )
  }

  if (form.action === 'infill') {
    options.push(
      { key: 'mask', label: 'Mask Image', dataType: 'mask' },
      { key: 'add_original_image', label: 'Add Original Image', dataType: 'boolean' },
    )
  }

  return options
}
