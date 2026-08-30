import type {
  ModuleDefinitionRecord,
  ModulePortDefinition,
} from '@/lib/api-module-graph'

const MINIMAX_DIRECTOR_NODE_EDITOR = 'minimax_h3_director_dasiwa'
const MINIMAX_DIRECTOR_MODES = new Set(['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REF2VA', 'Image Inpaint'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isMiniMaxDirectorInputPort(port: ModulePortDefinition) {
  return port.node_binding?.node_editor === MINIMAX_DIRECTOR_NODE_EDITOR
}

function getMiniMaxDirectorMode(
  module: ModuleDefinitionRecord,
  inputValues: Record<string, unknown> | undefined,
  port: ModulePortDefinition,
) {
  const fieldKey = port.node_binding?.field_key
  const uiField = fieldKey ? module.ui_schema?.find((field) => field.key === fieldKey) : null
  const fieldValue = fieldKey ? inputValues?.[fieldKey] : null
  const candidate = isRecord(fieldValue) ? fieldValue.mode : undefined
  const fallback = isRecord(uiField?.default_value) ? uiField.default_value.mode : undefined
  const mode = typeof candidate === 'string' ? candidate : fallback
  return typeof mode === 'string' && MINIMAX_DIRECTOR_MODES.has(mode) ? mode : 'FL2VA'
}

export function isMiniMaxDirectorInputPortActive(
  module: ModuleDefinitionRecord,
  inputValues: Record<string, unknown> | undefined,
  port: ModulePortDefinition,
) {
  if (!isMiniMaxDirectorInputPort(port)) return true
  const activeModes = port.node_binding?.active_modes
  return !activeModes || activeModes.length === 0 || activeModes.includes(getMiniMaxDirectorMode(module, inputValues, port))
}

export function getActiveModuleInputPorts(module: ModuleDefinitionRecord, inputValues?: Record<string, unknown>) {
  return (module.exposed_inputs ?? []).filter((port) => isMiniMaxDirectorInputPortActive(module, inputValues, port))
}

export function getMiniMaxDirectorInputPort(
  module: ModuleDefinitionRecord,
  inputValues: Record<string, unknown> | undefined,
  fieldKey: string,
  inputKey: string,
) {
  return (module.exposed_inputs ?? []).find((port) => (
    port.node_binding?.node_editor === MINIMAX_DIRECTOR_NODE_EDITOR
    && port.node_binding.field_key === fieldKey
    && port.node_binding.input_key === inputKey
    && isMiniMaxDirectorInputPortActive(module, inputValues, port)
  )) ?? null
}

export function resolveMiniMaxDirectorLegacyOutputPortKey(module: ModuleDefinitionRecord, portKey: string) {
  if (portKey !== 'image' && portKey !== 'video') return portKey
  const isDirectorModule = module.ui_schema?.some((field) => field.node_editor === MINIMAX_DIRECTOR_NODE_EDITOR) === true
  const hasMediaOutput = module.output_ports.some((port) => port.key === 'media' && port.data_type === 'any')
  return isDirectorModule && hasMediaOutput ? 'media' : portKey
}
