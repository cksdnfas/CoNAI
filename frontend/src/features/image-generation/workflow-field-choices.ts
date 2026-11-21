import type { CustomDropdownList, WorkflowMarkedField } from '@/lib/api-image-generation-types'

/**
 * How a generation form offers a marked field, shared by the form (comfy-generation-panel) and the authoring editor's
 * default picker. Mirrors the backend: workflowPromptValueResolver.workflowDropdownChoices for the choices and
 * workflowHiddenFieldPolicy for hidden fields.
 */

/** The random pick a dropdown-list field offers first; the backend rolls it on every run. */
export const WORKFLOW_FIELD_RANDOM_OPTION_VALUE = '__random__'
const COMFY_AUTO_COLLECT_SOURCE_PATH = 'comfyui-default-server-api'
const COMFY_MODEL_PREVIEW_FOLDERS = new Set(['checkpoints', 'loras', 'diffusion_models', 'unet_gguf'])
const HIDEABLE_FIELD_TYPES: ReadonlySet<WorkflowMarkedField['type']> = new Set(['text', 'textarea', 'number', 'select'])
/** Model path inputs take dropdown lists, not the server's choices (backend COMFY_MODEL_PATH_INPUT_KEYS). */
const COMFY_MODEL_PATH_INPUT_KEYS = new Set(['ckpt_name', 'lora_name', 'unet_name', 'vae_name', 'clip_name', 'control_net_name', 'style_model_name'])
/** A newly marked input becomes a select of the server's choices only up to this many. */
export const MAX_AUTO_SELECT_CHOICES = 100

/** The model folder whose thumbnails an auto-collected ComfyUI list can preview. */
export function resolveComfyModelPreviewFolder(dropdownList: CustomDropdownList) {
  if (!dropdownList.is_auto_collected || dropdownList.source_path !== COMFY_AUTO_COLLECT_SOURCE_PATH) {
    return undefined
  }

  const rootFolder = dropdownList.name.replace(/\s*\(통합\)$/, '').split('/')[0]?.trim()
  return rootFolder && COMFY_MODEL_PREVIEW_FOLDERS.has(rootFolder) ? rootFolder : undefined
}

/** A dropdown list's items as select options: the random pick first, blank items dropped. */
export function buildDropdownSelectOptions(items: string[]) {
  return [
    WORKFLOW_FIELD_RANDOM_OPTION_VALUE,
    ...items.filter((item) => item.trim().length > 0 && item !== WORKFLOW_FIELD_RANDOM_OPTION_VALUE),
  ]
}

/** The field as a generation form shows it: one naming an existing dropdown list is a select of that list's items. */
export function resolveWorkflowMarkedField(field: WorkflowMarkedField, dropdownListByName: ReadonlyMap<string, CustomDropdownList>): WorkflowMarkedField {
  const dropdownList = field.dropdown_list_name ? dropdownListByName.get(field.dropdown_list_name) : undefined
  if (!dropdownList) {
    return field
  }

  return {
    ...field,
    type: 'select',
    options: buildDropdownSelectOptions(dropdownList.items),
    model_preview_folder: resolveComfyModelPreviewFolder(dropdownList),
  }
}

/** Whether a field of this type can be hidden (text, textarea, number and select). */
export function canHideWorkflowField(type: WorkflowMarkedField['type']) {
  return HIDEABLE_FIELD_TYPES.has(type)
}

/** A hidden field is a fixed value no form offers; the flag on an image or node field is ignored. */
export function isHiddenWorkflowField(field: Pick<WorkflowMarkedField, 'type' | 'hidden'>) {
  return field.hidden === true && canHideWorkflowField(field.type)
}

/** The fields a generation form, its draft, validation and payload hold: the visible ones, resolved. */
export function resolveVisibleWorkflowFields(fields: readonly WorkflowMarkedField[], dropdownListByName: ReadonlyMap<string, CustomDropdownList>) {
  return fields.filter((field) => !isHiddenWorkflowField(field)).map((field) => resolveWorkflowMarkedField(field, dropdownListByName))
}

/** The choices a generation form offers for a resolved field; empty when it shows a free input. */
export function workflowFieldChoices(field: WorkflowMarkedField): string[] {
  return field.type === 'select' ? field.options ?? [] : []
}

function comparablePath(value: string) {
  return value.replace(/\\/g, '/')
}

/** The choice a stored value stands for: itself, or the one that differs from it only by path separator. */
export function findWorkflowFieldChoice(choices: readonly string[], value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  if (choices.includes(value)) return value
  const comparable = comparablePath(value)
  return choices.find((choice) => comparablePath(choice) === comparable) ?? null
}

/** Dropdown lists split by whether they hold the value (separators aside), each part in the original order. */
export function partitionDropdownListsByValue(lists: readonly CustomDropdownList[], value: unknown) {
  const holding: CustomDropdownList[] = []
  const others: CustomDropdownList[] = []
  for (const list of lists) {
    if (findWorkflowFieldChoice(list.items, value) !== null) holding.push(list)
    else others.push(list)
  }
  return { holding, others }
}

/** The server's choices a newly marked input takes as a select, or null to keep the inferred field type. */
export function autoSelectChoices(inputKey: string, value: unknown, choices: readonly string[] | undefined): string[] | null {
  if (typeof value !== 'string' || !choices || choices.length === 0 || choices.length > MAX_AUTO_SELECT_CHOICES) return null
  return COMFY_MODEL_PATH_INPUT_KEYS.has(inputKey) ? null : [...choices]
}
