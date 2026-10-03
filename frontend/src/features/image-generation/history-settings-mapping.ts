import type { ConfirmFn } from '@/components/ui/confirm-dialog'
import type { TranslationInput, TranslationParams } from '@/i18n'
import type { WorkflowMarkedField } from '@/lib/api-image-generation-types'
import { buildWorkflowDraft } from './image-generation-drafts'
import {
  DEFAULT_NAI_FORM,
  normalizeNaiCharacterPromptDrafts,
  resolveNaiResolutionPreset,
  type NAICharacterPromptDraft,
  type NAIFormDraft,
  type WorkflowFieldDraftValue,
} from './image-generation-shared'

type Translate = (input: TranslationInput, params?: TranslationParams) => string

/** Ask before replacing form content the user typed with settings from a history record. */
export function confirmHistorySettingsOverwrite(confirm: ConfirmFn, t: Translate) {
  return confirm({
    title: t({ ko: '기록 설정 불러오기', en: 'Load record settings' }),
    description: t({
      ko: '지금 입력한 내용을 이 기록의 설정으로 덮어쓸까?',
      en: 'Replace the current input with the settings from this record?',
    }),
    confirmLabel: t({ ko: '덮어쓰기', en: 'Replace' }),
  })
}

/** Snackbar text after a history record's settings were applied to a provider form. */
export function getHistorySettingsLoadedMessage(t: Translate, historyId: number, hasImageInputs: boolean) {
  return hasImageInputs
    ? t({ ko: '기록 #{id}의 설정을 불러왔어. 이미지 입력은 다시 넣어줘.', en: 'Loaded the settings from record #{id}. Attach the image inputs again.' }, { id: historyId })
    : t({ ko: '기록 #{id}의 설정을 불러왔어.', en: 'Loaded the settings from record #{id}.' }, { id: historyId })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readText(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function readNumberText(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  if (typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Number(value))) {
    return value.trim()
  }

  return undefined
}

function hasEntries(value: unknown) {
  return Array.isArray(value) && value.length > 0
}

/**
 * Map a stored NAI queue payload back onto the NAI form.
 * Image inputs (source/mask, vibes, character references) are not stored in a reusable form,
 * so the current ones are kept and `hasImageInputs` tells the caller to ask for them again.
 */
export function buildNaiFormFromHistoryPayload(payload: Record<string, unknown>, current: NAIFormDraft) {
  const action: NAIFormDraft['action'] = payload.action === 'img2img' || payload.action === 'infill' ? payload.action : 'generate'
  const width = readNumberText(payload.width) ?? DEFAULT_NAI_FORM.width
  const height = readNumberText(payload.height) ?? DEFAULT_NAI_FORM.height
  const characters: NAICharacterPromptDraft[] = Array.isArray(payload.characters)
    ? payload.characters.flatMap((character) => (
        isRecord(character) && typeof character.prompt === 'string'
          ? [{
              prompt: character.prompt,
              uc: readText(character.uc) ?? '',
              centerX: readNumberText(character.center_x) ?? '0.5',
              centerY: readNumberText(character.center_y) ?? '0.5',
            }]
          : []
      ))
    : []

  const model = readText(payload.model) || current.model
  const form: NAIFormDraft = {
    ...current,
    prompt: readText(payload.prompt) ?? '',
    negativePrompt: readText(payload.negative_prompt) ?? '',
    model,
    // The kept vibes were encoded for the current model; re-encode on submit when it changes.
    vibes: model === current.model ? current.vibes : current.vibes.map((vibe) => (vibe.image ? { ...vibe, encoded: '' } : vibe)),
    action,
    sampler: readText(payload.sampler) || DEFAULT_NAI_FORM.sampler,
    scheduler: readText(payload.noise_schedule) || DEFAULT_NAI_FORM.scheduler,
    width,
    height,
    resolutionPreset: resolveNaiResolutionPreset(width, height),
    steps: readNumberText(payload.steps) ?? DEFAULT_NAI_FORM.steps,
    scale: readNumberText(payload.scale) ?? DEFAULT_NAI_FORM.scale,
    samples: readNumberText(payload.n_samples) ?? DEFAULT_NAI_FORM.samples,
    seed: readNumberText(payload.seed) ?? '',
    characterPositionAiChoice: payload.use_coords !== true,
    characters: normalizeNaiCharacterPromptDrafts(characters),
    varietyPlus: payload.variety_plus === true,
    transparentBackground: payload.transparent_background === true,
    strength: readNumberText(payload.strength) ?? DEFAULT_NAI_FORM.strength,
    noise: readNumberText(payload.noise) ?? DEFAULT_NAI_FORM.noise,
    addOriginalImage: typeof payload.add_original_image === 'boolean' ? payload.add_original_image : DEFAULT_NAI_FORM.addOriginalImage,
  }

  return {
    form,
    hasImageInputs: action !== 'generate' || hasEntries(payload.vibes) || hasEntries(payload.character_refs),
  }
}

/** Whether the NAI form holds prompt text the user could lose by loading other settings. */
export function hasNaiPromptContent(form: NAIFormDraft) {
  return form.prompt.trim().length > 0
    || form.negativePrompt.trim().length > 0
    || form.characters.some((character) => character.prompt.trim().length > 0 || character.uc.trim().length > 0)
}

/** Whether two NAI forms differ in their prompt text (main, negative, or character prompts). */
export function hasNaiPromptDifference(left: NAIFormDraft, right: NAIFormDraft) {
  return left.prompt !== right.prompt
    || left.negativePrompt !== right.negativePrompt
    || JSON.stringify(left.characters.map(({ prompt, uc }) => [prompt, uc])) !== JSON.stringify(right.characters.map(({ prompt, uc }) => [prompt, uc]))
}

function toWorkflowDraftValue(field: WorkflowMarkedField, value: unknown): WorkflowFieldDraftValue | undefined {
  if (field.type === 'node') {
    return isRecord(value) ? JSON.parse(JSON.stringify(value)) as Record<string, unknown> : undefined
  }

  const text = typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : undefined
  if (text === undefined) {
    return undefined
  }

  return field.type === 'textarea' ? [text] : text
}

/**
 * Map a stored ComfyUI queue payload (`prompt_data` keyed by marked-field id) back onto a workflow draft.
 * Fields missing from the payload were empty when submitted and fall back to their defaults.
 * Image fields keep the current draft value because stored image inputs are not reusable.
 */
export function buildComfyDraftFromHistoryPayload(
  payload: Record<string, unknown>,
  fields: WorkflowMarkedField[],
  currentDraft: Record<string, WorkflowFieldDraftValue>,
) {
  const promptData = isRecord(payload.prompt_data) ? payload.prompt_data : null
  if (!promptData) {
    return null
  }

  const draft = buildWorkflowDraft(fields)
  let hasImageInputs = false
  for (const field of fields) {
    if (field.type === 'image') {
      if (field.id in promptData) {
        hasImageInputs = true
      }
      if (currentDraft[field.id] !== undefined) {
        draft[field.id] = currentDraft[field.id]
      }
      continue
    }

    if (!(field.id in promptData)) {
      continue
    }

    const value = toWorkflowDraftValue(field, promptData[field.id])
    if (value !== undefined) {
      draft[field.id] = value
    }
  }

  return { draft, hasImageInputs }
}

function serializeComparableWorkflowDraft(fields: WorkflowMarkedField[], draft: Record<string, WorkflowFieldDraftValue>) {
  return JSON.stringify(fields
    .filter((field) => field.type !== 'image')
    .map((field) => draft[field.id] ?? ''))
}

/** Whether the workflow draft differs from another draft outside image fields. */
export function hasWorkflowDraftDifference(
  fields: WorkflowMarkedField[],
  left: Record<string, WorkflowFieldDraftValue>,
  right: Record<string, WorkflowFieldDraftValue>,
) {
  return serializeComparableWorkflowDraft(fields, left) !== serializeComparableWorkflowDraft(fields, right)
}
