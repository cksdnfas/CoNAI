import { getModuleOperationKey } from './module-graph-module-helpers'
import type { ModuleDefinitionRecord, ModulePortDefinition } from '@/lib/api-module-graph'

export const ADVANCED_OUTPUT_PORTS_ENABLED_KEY = '__advanced_output_ports_enabled'

function hasConfiguredGraphValue(value: unknown) {
  if (value === null || value === undefined) {
    return false
  }

  if (typeof value === 'string') {
    return value.trim().length > 0
  }

  if (Array.isArray(value)) {
    return value.length > 0
  }

  if (typeof value === 'object') {
    return Object.keys(value).length > 0
  }

  return true
}

export function isAdvancedOutputPortsEnabled(inputValues: Record<string, unknown> | undefined) {
  return inputValues?.[ADVANCED_OUTPUT_PORTS_ENABLED_KEY] === true
}

/** Resolve whether one output port is secondary/debug-like enough to hide in normal node mode. */
function isAdvancedModuleOutputPort(module: ModuleDefinitionRecord, port: ModulePortDefinition, inputValues: Record<string, unknown> | undefined) {
  const operationKey = getModuleOperationKey(module)
  const hasStructuredOutput = hasConfiguredGraphValue(inputValues?.structured_output_json)

  if (operationKey === 'system.load_llm_preset') {
    return false
  }

  if (operationKey === 'system.call_llm' || operationKey === 'system.call_codex_message') {
    if (port.key === 'metadata') {
      return true
    }

    if (port.key === 'text') {
      return hasStructuredOutput
    }

    if (port.key === 'json') {
      return !hasStructuredOutput
    }
  }

  if (operationKey === 'system.json_extract') {
    return false
  }

  if (port.key === 'metadata' || port.key.endsWith('_ref') || port.key.endsWith('_json')) {
    return true
  }

  return false
}

export function hasAdvancedModuleOutputPorts(module: ModuleDefinitionRecord, inputValues: Record<string, unknown> | undefined) {
  return (module.output_ports ?? []).some((port) => isAdvancedModuleOutputPort(module, port, inputValues))
}

export function getVisibleModuleOutputPorts(
  module: ModuleDefinitionRecord,
  inputValues: Record<string, unknown> | undefined,
  options: {
    includeAdvanced?: boolean
    connectedInputKeys?: Iterable<string>
    connectedOutputKeys?: Iterable<string>
  } = {},
) {
  const operationKey = getModuleOperationKey(module)
  if (operationKey === 'system.load_llm_preset') {
    const activePortKey = inputValues?.preset_type === 'structuredOutputJsonPresets' ? 'json' : 'text'
    return (module.output_ports ?? []).filter((port) => port.key === activePortKey)
  }

  const connectedInputKeys = new Set(options.connectedInputKeys ?? [])
  const connectedOutputKeys = new Set(options.connectedOutputKeys ?? [])
  if (operationKey === 'system.call_llm' || operationKey === 'system.call_codex_message') {
    const hasStructuredOutput = hasConfiguredGraphValue(inputValues?.structured_output_json)
      || connectedInputKeys.has('structured_output_json')
    return (module.output_ports ?? []).filter((port) => {
      if (port.key === 'json') {
        return hasStructuredOutput || connectedOutputKeys.has(port.key)
      }

      if (port.key === 'text') {
        return !hasStructuredOutput || options.includeAdvanced === true || connectedOutputKeys.has(port.key)
      }

      if (port.key === 'metadata') {
        return options.includeAdvanced === true || connectedOutputKeys.has(port.key)
      }

      return true
    })
  }

  return (module.output_ports ?? []).filter((port) => {
    const isAdvanced = isAdvancedModuleOutputPort(module, port, inputValues)
    return !isAdvanced || options.includeAdvanced === true || connectedOutputKeys.has(port.key)
  })
}
