import { isMiniMaxDirectorInputPortActive } from './module-graph-minimax-director-ports'
import { getModuleOperationKey, getPortTypeColor } from './module-graph-module-helpers'
import type { ModuleGraphNode } from './module-graph-types'
import type { ModulePortDataType, ModulePortDefinition } from '@/lib/api-module-graph'

/** Parse a React Flow handle id and recover the port key. */
export function parseHandleId(handleId?: string | null) {
  if (!handleId) {
    return null
  }

  const [direction, ...rest] = handleId.split(':')
  return {
    direction,
    portKey: rest.join(':'),
  }
}

/** Build a stable React Flow handle id for module ports. */
export function buildHandleId(direction: 'in' | 'out', portKey: string) {
  return `${direction}:${portKey}`
}


/** Resolve one module port from a node/handle pair. */
export function findNodePort(node: ModuleGraphNode | undefined, direction: 'in' | 'out', portKey?: string | null): ModulePortDefinition | null {
  if (!node || !portKey) {
    return null
  }

  const portList = direction === 'out' ? node.data.module.output_ports : node.data.module.exposed_inputs
  const directPort = portList.find((port) => port.key === portKey)
  if (directPort) {
    if (direction === 'in' && !isMiniMaxDirectorInputPortActive(node.data.module, node.data.inputValues, directPort)) {
      return null
    }
    return directPort
  }

  const operationKey = getModuleOperationKey(node.data.module)

  if (direction !== 'in') {
    return null
  }

  if (operationKey === 'system.random_text_choice') {
    const dynamicKey = portKey.startsWith('options.') ? portKey.slice('options.'.length).trim() : ''
    const parentPort = node.data.module.exposed_inputs.find((port) => port.key === 'options')
    if (!parentPort || !dynamicKey) {
      return null
    }

    return {
      ...parentPort,
      key: portKey,
      label: dynamicKey,
      data_type: 'any',
      required: false,
      multiple: false,
      default_value: undefined,
    }
  }

  if (operationKey !== 'system.api_request') {
    return null
  }

  const dynamicParentKey = portKey.startsWith('values.') ? 'values' : portKey.startsWith('headers.') ? 'headers' : null
  if (!dynamicParentKey) {
    return null
  }

  const parentPort = node.data.module.exposed_inputs.find((port) => port.key === dynamicParentKey)
  const dynamicLabel = portKey.slice(`${dynamicParentKey}.`.length).trim()
  if (!parentPort || !dynamicLabel) {
    return null
  }

  return {
    ...parentPort,
    key: portKey,
    label: dynamicLabel,
    data_type: dynamicParentKey === 'headers' ? 'text' : 'any',
    required: false,
    multiple: false,
    default_value: undefined,
  }
}

/** Group prompt/text into one string family so graph users can bridge them intentionally. */
export function getModulePortCompatibility(sourceType?: ModulePortDataType | null, targetType?: ModulePortDataType | null) {
  if (!sourceType || !targetType) {
    return 'incompatible' as const
  }

  if (sourceType === targetType || targetType === 'any' || sourceType === 'any') {
    return 'exact' as const
  }

  const isStringBridge = (sourceType === 'text' && targetType === 'prompt') || (sourceType === 'prompt' && targetType === 'text')
  return isStringBridge ? 'string-bridge' as const : 'incompatible' as const
}

/** Every link is a solid line in its source port's type color (text→prompt included); the module edge draws it. */
export function buildModuleEdgePresentation(sourcePort: ModulePortDefinition | null, targetPort: ModulePortDefinition | null): { type: string; style: { stroke: string } } {
  const dataType = sourcePort?.data_type ?? targetPort?.data_type ?? null

  return {
    type: 'module',
    style: { stroke: dataType ? getPortTypeColor(dataType) : '#94a3b8' },
  }
}
