import type { GraphWorkflowExposedInput, ModuleDefinitionRecord } from '@/lib/api'
import { buildWorkflowExposedInputId } from './module-graph-validation'
import { getModuleBaseDisplayName, getModuleNodeDisplayLabel, normalizeModulePortDescription, type ModuleGraphNode } from './module-graph-shared'

export const WORKFLOW_INPUT_ENABLED_KEY = '__workflow_input_enabled'
export const WORKFLOW_INPUT_LABEL_KEY = '__workflow_input_label'
export const WORKFLOW_INPUT_DESCRIPTION_KEY = '__workflow_input_description'
export const WORKFLOW_INPUT_REQUIRED_KEY = '__workflow_input_required'

const CONSTANT_INPUT_OPERATION_KEYS = new Set([
  'system.constant_text',
  'system.constant_prompt',
  'system.constant_json',
  'system.constant_image',
  'system.constant_number',
  'system.constant_boolean',
])

function getModuleOperationKey(module: ModuleDefinitionRecord) {
  if (typeof module.internal_fixed_values?.operation_key === 'string') {
    return module.internal_fixed_values.operation_key
  }

  if (typeof module.template_defaults?.operation_key === 'string') {
    return module.template_defaults.operation_key
  }

  return null
}

function normalizeBooleanFlag(value: unknown) {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    const normalizedValue = value.trim().toLowerCase()
    if (normalizedValue === 'true') return true
    if (normalizedValue === 'false') return false
  }

  return false
}

function normalizeOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/** Resolve whether one module can act as a graph-defined workflow input source. */
export function isWorkflowInputSourceModule(module: ModuleDefinitionRecord) {
  return module.engine_type === 'system' && CONSTANT_INPUT_OPERATION_KEYS.has(getModuleOperationKey(module) ?? '')
}

/** Resolve the single exposed input port used by one constant-input node. */
export function getWorkflowInputSourcePort(node: ModuleGraphNode) {
  if (!isWorkflowInputSourceModule(node.data.module)) {
    return null
  }

  return node.data.module.exposed_inputs[0] ?? null
}

/** Resolve whether one node is currently marked for workflow-run input exposure. */
export function isWorkflowInputEnabledForNode(node: ModuleGraphNode) {
  return normalizeBooleanFlag(node.data.inputValues?.[WORKFLOW_INPUT_ENABLED_KEY])
}

/** Build one runtime-exposed input definition from one configured node. */
export function buildWorkflowInputDefinitionFromNode(node: ModuleGraphNode): GraphWorkflowExposedInput | null {
  const sourcePort = getWorkflowInputSourcePort(node)
  if (!sourcePort || !isWorkflowInputEnabledForNode(node)) {
    return null
  }

  const uiField = node.data.module.ui_schema?.find((field) => field.key === sourcePort.key)
  const required = normalizeBooleanFlag(node.data.inputValues?.[WORKFLOW_INPUT_REQUIRED_KEY])
  const nodeDisplayLabel = getModuleNodeDisplayLabel(node)
  const label = normalizeOptionalString(node.data.inputValues?.[WORKFLOW_INPUT_LABEL_KEY])
    ?? `${nodeDisplayLabel} · ${sourcePort.label}`
  const description = normalizeOptionalString(node.data.inputValues?.[WORKFLOW_INPUT_DESCRIPTION_KEY])
    ?? normalizeModulePortDescription(sourcePort.description)
    ?? undefined

  return {
    id: buildWorkflowExposedInputId(node.id, sourcePort.key),
    node_id: node.id,
    port_key: sourcePort.key,
    label,
    data_type: sourcePort.data_type,
    ui_data_type: uiField?.data_type,
    description,
    required,
    placeholder: uiField?.placeholder || sourcePort.label,
    default_value: node.data.inputValues?.[sourcePort.key],
    options: uiField?.options,
    module_id: node.data.module.id,
    module_name: getModuleBaseDisplayName(node.data.module),
  }
}

/** Derive the complete workflow-run input definition list directly from configured graph nodes. */
export function deriveWorkflowExposedInputsFromNodes(nodes: ModuleGraphNode[]) {
  return nodes.flatMap((node) => {
    const definition = buildWorkflowInputDefinitionFromNode(node)
    return definition ? [definition] : []
  })
}

/** Build default runtime-input values from one exposed-input definition list. */
export function buildWorkflowRunInputDefaults(exposedInputs: GraphWorkflowExposedInput[]) {
  return exposedInputs.reduce<Record<string, unknown>>((acc, inputDefinition) => {
    if (inputDefinition.default_value !== undefined) {
      acc[inputDefinition.id] = inputDefinition.default_value
    }
    return acc
  }, {})
}

/** Copy legacy saved workflow-input metadata into constant nodes so node-local config becomes the source of truth. */
export function applySavedWorkflowInputMetadataToNodes(
  nodes: ModuleGraphNode[],
  exposedInputs: GraphWorkflowExposedInput[] | undefined,
) {
  if (!exposedInputs || exposedInputs.length === 0) {
    return nodes
  }

  const exposedInputMap = new Map(exposedInputs.map((inputDefinition) => [inputDefinition.id, inputDefinition]))

  return nodes.map((node) => {
    const sourcePort = getWorkflowInputSourcePort(node)
    if (!sourcePort) {
      return node
    }

    const inputDefinition = exposedInputMap.get(buildWorkflowExposedInputId(node.id, sourcePort.key))
    if (!inputDefinition) {
      return node
    }

    const nextInputValues: Record<string, unknown> = {
      ...node.data.inputValues,
      [WORKFLOW_INPUT_ENABLED_KEY]: true,
      [WORKFLOW_INPUT_LABEL_KEY]: inputDefinition.label,
      [WORKFLOW_INPUT_DESCRIPTION_KEY]: normalizeModulePortDescription(inputDefinition.description) ?? '',
      [WORKFLOW_INPUT_REQUIRED_KEY]: Boolean(inputDefinition.required),
    }

    if (nextInputValues[sourcePort.key] === undefined && inputDefinition.default_value !== undefined) {
      nextInputValues[sourcePort.key] = inputDefinition.default_value
    }

    return {
      ...node,
      data: {
        ...node.data,
        inputValues: nextInputValues,
      },
    }
  })
}
