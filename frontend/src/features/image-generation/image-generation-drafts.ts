import { readBlobAsDataUrl } from '@/lib/file-data-url'
import type { WorkflowMarkedField } from '@/lib/api-image-generation-types'
import type { NAIFormDraft, SelectedImageDraft, WorkflowFieldDraftValue, WorkflowNodeDraftValue, WorkflowTextDraftSegments } from './image-generation-shared'
import { DEFAULT_NAI_FORM, EMPTY_NAI_CHARACTER_PROMPT, EMPTY_NAI_CHARACTER_REFERENCE, EMPTY_NAI_VIBE } from './image-generation-shared'

const NAI_FORM_DRAFT_STORAGE_KEY = 'conai:image-generation:nai-form-draft:v1'
const COMFY_WORKFLOW_DRAFT_STORAGE_KEY_PREFIX = 'conai:image-generation:comfy:workflow-draft:v1:'

type PersistedNaiFormDraft = {
  selectedCharacterIndex: number | null
  form: NAIFormDraft
}

function readLocalStorageJson<T>(key: string): T | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const rawValue = window.localStorage.getItem(key)
    if (!rawValue) {
      return null
    }

    return JSON.parse(rawValue) as T
  } catch {
    return null
  }
}

function writeLocalStorageJson(key: string, value: unknown) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore quota/private-mode persistence failures.
  }
}

function removeLocalStorageValue(key: string) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.removeItem(key)
  } catch {
    // Ignore storage cleanup failures.
  }
}

function normalizePersistedNaiFormDraft(value: Partial<NAIFormDraft> | null | undefined): NAIFormDraft {
  const rawCharacters = Array.isArray(value?.characters) ? value.characters : []
  const rawVibes = Array.isArray(value?.vibes) ? value.vibes : []
  const rawCharacterReferences = Array.isArray(value?.characterReferences) ? value.characterReferences : []

  return {
    ...DEFAULT_NAI_FORM,
    ...value,
    characters: rawCharacters.map((character) => ({
      ...EMPTY_NAI_CHARACTER_PROMPT,
      ...character,
    })),
    vibes: rawVibes.map((vibe) => ({
      ...EMPTY_NAI_VIBE,
      strength: typeof vibe?.strength === 'string' ? vibe.strength : EMPTY_NAI_VIBE.strength,
      informationExtracted: typeof vibe?.informationExtracted === 'string' ? vibe.informationExtracted : EMPTY_NAI_VIBE.informationExtracted,
      encoded: '',
      image: undefined,
    })),
    characterReferences: rawCharacterReferences.map((reference) => ({
      ...EMPTY_NAI_CHARACTER_REFERENCE,
      type: reference?.type === 'character' || reference?.type === 'style' || reference?.type === 'character&style'
        ? reference.type
        : EMPTY_NAI_CHARACTER_REFERENCE.type,
      strength: typeof reference?.strength === 'string' ? reference.strength : EMPTY_NAI_CHARACTER_REFERENCE.strength,
      fidelity: typeof reference?.fidelity === 'string' ? reference.fidelity : EMPTY_NAI_CHARACTER_REFERENCE.fidelity,
      image: undefined,
    })),
    sourceImage: undefined,
    maskImage: undefined,
  }
}

function buildPersistableNaiFormDraft(form: NAIFormDraft): NAIFormDraft {
  return {
    ...form,
    vibes: form.vibes.map((vibe) => ({
      ...vibe,
      encoded: '',
      image: undefined,
    })),
    characterReferences: form.characterReferences.map((reference) => ({
      ...reference,
      image: undefined,
    })),
    sourceImage: undefined,
    maskImage: undefined,
  }
}

/** Restore the last persisted NAI editor draft, excluding heavy image payloads. */
export function loadPersistedNaiFormDraft(): PersistedNaiFormDraft {
  const rawValue = readLocalStorageJson<Partial<PersistedNaiFormDraft>>(NAI_FORM_DRAFT_STORAGE_KEY)
  const selectedCharacterIndex = typeof rawValue?.selectedCharacterIndex === 'number' ? rawValue.selectedCharacterIndex : null

  return {
    selectedCharacterIndex,
    form: normalizePersistedNaiFormDraft(rawValue?.form),
  }
}

/** Persist the current NAI editor draft while omitting image payloads that would bloat storage. */
export function persistNaiFormDraft(form: NAIFormDraft, selectedCharacterIndex: number | null) {
  writeLocalStorageJson(NAI_FORM_DRAFT_STORAGE_KEY, {
    selectedCharacterIndex,
    form: buildPersistableNaiFormDraft(form),
  } satisfies PersistedNaiFormDraft)
}

function buildComfyWorkflowDraftStorageKey(workflowId: number) {
  return `${COMFY_WORKFLOW_DRAFT_STORAGE_KEY_PREFIX}${workflowId}`
}

/** Check whether one stored draft value is a string-array textarea payload. */
function isWorkflowTextDraftSegments(value: unknown): value is WorkflowTextDraftSegments {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/** Keep at least one visible textarea segment even when the stored value is empty. */
function normalizeWorkflowTextDraftSegments(value: unknown): WorkflowTextDraftSegments {
  if (isWorkflowTextDraftSegments(value)) {
    return value.length > 0 ? value : ['']
  }

  if (typeof value === 'string') {
    return [value]
  }

  return ['']
}

function isSelectedImageDraft(value: unknown): value is SelectedImageDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const record = value as Record<string, unknown>
  return typeof record.fileName === 'string' && typeof record.dataUrl === 'string'
}

function isWorkflowNodeDraftValue(value: unknown): value is WorkflowNodeDraftValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !isSelectedImageDraft(value)
}

function cloneWorkflowNodeDraftValue(value: WorkflowNodeDraftValue): WorkflowNodeDraftValue {
  return JSON.parse(JSON.stringify(value)) as WorkflowNodeDraftValue
}

/** Normalize one prompt segment before comma-joining it for API submission. */
function normalizeWorkflowPromptSegment(value: string) {
  return value
    .trim()
    .replace(/^[,\s]+/, '')
    .replace(/[,\s]+$/, '')
    .trim()
}

/** Join textarea segments into one API-safe comma-separated prompt string. */
export function joinWorkflowPromptSegments(segments: WorkflowTextDraftSegments) {
  return segments
    .map(normalizeWorkflowPromptSegment)
    .filter((segment) => segment.length > 0)
    .join(', ')
}

/** Restore one persisted draft value in the shape expected by the current field type. */
function normalizeWorkflowDraftValue(field: WorkflowMarkedField, value: unknown): WorkflowFieldDraftValue {
  if (field.type === 'textarea') {
    return normalizeWorkflowTextDraftSegments(value)
  }

  if (field.type === 'node') {
    return isWorkflowNodeDraftValue(value) ? cloneWorkflowNodeDraftValue(value) : {}
  }

  if (field.type === 'image') {
    return isSelectedImageDraft(value) ? value : ''
  }

  return typeof value === 'string' ? value : ''
}

/** Restore one persisted Comfy workflow draft, limited to text/select/number fields. */
export function loadPersistedComfyWorkflowDraft(workflowId: number, fields?: WorkflowMarkedField[]): Record<string, WorkflowFieldDraftValue> {
  const rawValue = readLocalStorageJson<Record<string, unknown>>(buildComfyWorkflowDraftStorageKey(workflowId))
  if (!rawValue) {
    return {}
  }

  const persistedEntries = Object.entries(rawValue)
    .filter(([, value]) => typeof value === 'string' || isWorkflowTextDraftSegments(value) || isWorkflowNodeDraftValue(value))

  if (!fields) {
    return Object.fromEntries(persistedEntries) as Record<string, WorkflowFieldDraftValue>
  }

  const fieldMap = new Map(fields.map((field) => [field.id, field]))
  return Object.fromEntries(
    persistedEntries.flatMap(([fieldId, value]) => {
      const field = fieldMap.get(fieldId)
      return field ? [[fieldId, normalizeWorkflowDraftValue(field, value)]] : []
    }),
  ) as Record<string, WorkflowFieldDraftValue>
}

/** Persist one Comfy workflow draft, skipping image payload fields. */
export function persistComfyWorkflowDraft(workflowId: number, draft: Record<string, WorkflowFieldDraftValue>) {
  const persistableDraft = Object.fromEntries(
    Object.entries(draft).filter(([, value]) => typeof value === 'string' || isWorkflowTextDraftSegments(value) || isWorkflowNodeDraftValue(value)),
  )

  writeLocalStorageJson(buildComfyWorkflowDraftStorageKey(workflowId), persistableDraft)
}

/** Remove one persisted Comfy workflow draft, usually after an explicit reset. */
export function clearPersistedComfyWorkflowDraft(workflowId: number) {
  removeLocalStorageValue(buildComfyWorkflowDraftStorageKey(workflowId))
}

/** Build the initial draft object for workflow marked fields. */
export function buildWorkflowDraft(fields: WorkflowMarkedField[]) {
  return fields.reduce<Record<string, WorkflowFieldDraftValue>>((draft, field) => {
    draft[field.id] = normalizeWorkflowDraftValue(field, field.default_value)
    return draft
  }, {})
}

/** Read a local file into a data URL for API transport. */
export function readFileAsDataUrl(file: Blob) {
  return readBlobAsDataUrl(file, 'Failed to read file as data URL')
}

/** Infer one mime type from a data URL so workflow previews can classify media correctly. */
function inferMimeTypeFromDataUrl(dataUrl: string) {
  const match = /^data:([^;,]+)[;,]/i.exec(dataUrl)
  return match?.[1] ?? undefined
}

/** Build one selected-image draft by fetching an existing image URL. */
export async function buildSelectedImageDraftFromUrl(url: string, fileName?: string): Promise<SelectedImageDraft> {
  const response = await fetch(url, {
    credentials: 'include',
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`)
  }

  const blob = await response.blob()
  const resolvedFileName = fileName || url.split('/').pop() || 'selected-image'
  const dataUrl = await readFileAsDataUrl(blob)

  return {
    fileName: resolvedFileName,
    dataUrl,
    mimeType: blob.type || inferMimeTypeFromDataUrl(dataUrl),
  }
}

/** Build one selected-image draft directly from a prepared data URL payload. */
export function buildSelectedImageDraftFromDataUrl(dataUrl: string, fileName = 'edited-image.png'): SelectedImageDraft {
  return {
    fileName,
    dataUrl,
    mimeType: inferMimeTypeFromDataUrl(dataUrl),
  }
}

/** Check whether a workflow field draft has a usable value. */
export function hasWorkflowFieldValue(value: WorkflowFieldDraftValue | undefined) {
  if (!value) {
    return false
  }

  if (Array.isArray(value)) {
    return joinWorkflowPromptSegments(value).length > 0
  }

  if (typeof value === 'string') {
    return value.trim().length > 0
  }

  if (isSelectedImageDraft(value)) {
    return value.dataUrl.trim().length > 0
  }

  return Object.keys(value).length > 0
}

/** Convert workflow field input strings into the payload expected by the backend. */
export function buildWorkflowPromptData(fields: WorkflowMarkedField[], draft: Record<string, WorkflowFieldDraftValue>) {
  return fields.reduce<Record<string, unknown>>((payload, field) => {
    const value = draft[field.id]

    if (!hasWorkflowFieldValue(value)) {
      return payload
    }

    if (Array.isArray(value)) {
      const joinedValue = joinWorkflowPromptSegments(value)
      if (joinedValue.length > 0) {
        payload[field.id] = joinedValue
      }
      return payload
    }

    if (typeof value !== 'string') {
      payload[field.id] = isWorkflowNodeDraftValue(value) ? cloneWorkflowNodeDraftValue(value) : value
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
