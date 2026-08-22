import type {
  GraphWorkflowDocument,
  ModulePortDataType,
  ModulePortDefinition,
  ModuleUiFieldDefinition,
} from '../../types/moduleGraph'

export const MINIMAX_DIRECTOR_NODE_EDITOR = 'minimax_h3_director_dasiwa' as const

const MINIMAX_DIRECTOR_MODES = ['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REF2VA'] as const
type MiniMaxDirectorMode = typeof MINIMAX_DIRECTOR_MODES[number]

type MiniMaxDirectorPortSpec = {
  inputKey: string
  label: string
  dataType: ModulePortDataType
  visibleField: string
  activeModes?: MiniMaxDirectorMode[]
  multiple?: boolean
}

const PORT_SPECS: MiniMaxDirectorPortSpec[] = [
  { inputKey: 'width', label: '너비', dataType: 'number', visibleField: 'width' },
  { inputKey: 'height', label: '높이', dataType: 'number', visibleField: 'height' },
  { inputKey: 'duration', label: '길이', dataType: 'number', visibleField: 'duration' },
  { inputKey: 'ref_image_size', label: '이미지 크기', dataType: 'text', visibleField: 'ref_image_size' },
  { inputKey: 'start_image', label: '시작 이미지', dataType: 'image', visibleField: 'timeline_data', activeModes: ['I2VA', 'FL2VA'] },
  { inputKey: 'end_image', label: '끝 이미지', dataType: 'image', visibleField: 'timeline_data', activeModes: ['FL2VA', 'L2VA'] },
  { inputKey: 'reference_image', label: '참조 이미지', dataType: 'image', visibleField: 'timeline_data', activeModes: ['REF2VA'], multiple: true },
  { inputKey: 'reference_video', label: '참조 영상', dataType: 'video', visibleField: 'timeline_data', activeModes: ['REF2VA'], multiple: true },
  { inputKey: 'reference_audio', label: '참조 오디오', dataType: 'audio', visibleField: 'timeline_data', activeModes: ['REF2VA'], multiple: true },
  { inputKey: 'prompt.imd', label: '통합 설명', dataType: 'prompt', visibleField: 'prompt', activeModes: ['T2VA', 'I2VA', 'FL2VA', 'L2VA'] },
  { inputKey: 'prompt.subject_definitions', label: '주체 정의', dataType: 'prompt', visibleField: 'prompt', activeModes: ['REF2VA'] },
  { inputKey: 'prompt.summary', label: '요약', dataType: 'prompt', visibleField: 'prompt', activeModes: ['REF2VA'] },
  { inputKey: 'prompt.retention_analysis', label: '보존 분석', dataType: 'prompt', visibleField: 'prompt', activeModes: ['REF2VA'] },
  { inputKey: 'prompt.detailed_description', label: '상세 설명', dataType: 'prompt', visibleField: 'prompt', activeModes: ['REF2VA'] },
  { inputKey: 'prompt.soundscape', label: '사운드스케이프', dataType: 'prompt', visibleField: 'prompt' },
  { inputKey: 'prompt.music', label: '음악', dataType: 'prompt', visibleField: 'prompt' },
]

const DEFAULT_VISIBLE_FIELDS = new Set(['mode', 'width', 'height', 'duration', 'ref_image_size', 'timeline_data', 'prompt'])

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getFieldKey(field: { id?: unknown; key?: unknown }) {
  if (typeof field.id === 'string' && field.id.trim()) return field.id
  if (typeof field.key === 'string' && field.key.trim()) return field.key
  return null
}

function buildPortKey(fieldKey: string, inputKey: string) {
  return `${fieldKey}.__minimax__.${inputKey}`
}

export function isMiniMaxDirectorField(field: { node_editor?: unknown }) {
  return field?.node_editor === MINIMAX_DIRECTOR_NODE_EDITOR
}

export function isMiniMaxDirectorPort(port: ModulePortDefinition) {
  return port.node_binding?.node_editor === MINIMAX_DIRECTOR_NODE_EDITOR
}

/** Expand one Director composite field into graph-native scalar, media, and prompt ports. */
export function buildMiniMaxDirectorPorts(field: {
  id?: unknown
  key?: unknown
  jsonPath?: unknown
  node_visible_fields?: unknown
}): ModulePortDefinition[] {
  const fieldKey = getFieldKey(field)
  if (!fieldKey) return []

  const visibleFields = Array.isArray(field.node_visible_fields)
    ? new Set(field.node_visible_fields.filter((value): value is string => typeof value === 'string'))
    : DEFAULT_VISIBLE_FIELDS
  const sourcePath = typeof field.jsonPath === 'string' && field.jsonPath.trim() ? field.jsonPath : fieldKey

  return PORT_SPECS
    .filter((spec) => visibleFields.has(spec.visibleField))
    .map((spec) => ({
      key: buildPortKey(fieldKey, spec.inputKey),
      label: spec.label,
      direction: 'input' as const,
      data_type: spec.dataType,
      required: false,
      multiple: spec.multiple ?? false,
      source_path: `${sourcePath}#${spec.inputKey}`,
      node_binding: {
        node_editor: MINIMAX_DIRECTOR_NODE_EDITOR,
        field_key: fieldKey,
        input_key: spec.inputKey,
        active_modes: spec.activeModes,
      },
    }))
}

function getMiniMaxDirectorMode(fieldValue: unknown, defaultValue?: unknown): MiniMaxDirectorMode {
  const candidate = isRecord(fieldValue) ? fieldValue.mode : undefined
  const fallback = isRecord(defaultValue) ? defaultValue.mode : undefined
  const value = typeof candidate === 'string' ? candidate : fallback
  return MINIMAX_DIRECTOR_MODES.includes(value as MiniMaxDirectorMode) ? value as MiniMaxDirectorMode : 'FL2VA'
}

export function isMiniMaxDirectorPortActive(port: ModulePortDefinition, fieldValue: unknown, defaultValue?: unknown) {
  if (!isMiniMaxDirectorPort(port)) return true
  const activeModes = port.node_binding?.active_modes
  return !activeModes || activeModes.length === 0 || activeModes.includes(getMiniMaxDirectorMode(fieldValue, defaultValue))
}

function shouldUpgradeLegacyOutputPort(port: ModulePortDefinition) {
  return port.key === 'image'
    && port.data_type === 'image'
    && (port.label === 'Workflow Image' || port.label === 'Generated Image' || port.label === '워크플로 이미지')
}

/** Hydrate legacy saved Director modules with current virtual inputs and a video output contract. */
export function hydrateMiniMaxDirectorModulePorts<T extends {
  exposed_inputs: ModulePortDefinition[]
  output_ports: ModulePortDefinition[]
  ui_schema?: ModuleUiFieldDefinition[] | null
  template_defaults?: Record<string, any>
}>(moduleDefinition: T): T {
  const markedFields = Array.isArray(moduleDefinition.template_defaults?.marked_fields)
    ? moduleDefinition.template_defaults.marked_fields
    : []
  const markedFieldById = new Map(markedFields
    .filter((field: any) => typeof field?.id === 'string')
    .map((field: any) => [field.id, field]))
  const hydratedUiSchema = (moduleDefinition.ui_schema ?? []).map((field) => {
    const markedField = markedFieldById.get(field.key) as any
    if (!isMiniMaxDirectorField(field) || markedField?.node_editor !== MINIMAX_DIRECTOR_NODE_EDITOR) return field
    return {
      ...field,
      node_visible_fields: field.node_visible_fields ?? markedField.node_visible_fields,
      node_numeric_bounds: field.node_numeric_bounds ?? markedField.node_numeric_bounds,
    }
  })
  const directorFields = hydratedUiSchema.filter(isMiniMaxDirectorField)
  if (directorFields.length === 0) return moduleDefinition

  const ordinaryInputs = (moduleDefinition.exposed_inputs ?? []).filter((port) => !isMiniMaxDirectorPort(port))
  const directorInputs = directorFields.flatMap((field) => buildMiniMaxDirectorPorts(field))
  const outputPorts = (moduleDefinition.output_ports ?? []).map((port) => shouldUpgradeLegacyOutputPort(port)
    ? { ...port, key: 'video', label: 'Workflow Video', data_type: 'video' as const }
    : port)

  return {
    ...moduleDefinition,
    exposed_inputs: [...ordinaryInputs, ...directorInputs],
    output_ports: outputPorts,
    ui_schema: hydratedUiSchema,
  }
}

/** Remap saved pre-video Director edges without breaking existing workflow documents. */
export function normalizeMiniMaxDirectorLegacyGraphEdges<T extends {
  id: number
  output_ports: ModulePortDefinition[]
  ui_schema?: ModuleUiFieldDefinition[] | null
}>(graph: GraphWorkflowDocument, modulesById: Map<number, T>) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
  let changed = false
  const edges = graph.edges.map((edge) => {
    if (edge.source_port_key !== 'image') return edge
    const sourceNode = nodeById.get(edge.source_node_id)
    const sourceModule = sourceNode ? modulesById.get(sourceNode.module_id) : null
    const isDirectorModule = sourceModule?.ui_schema?.some(isMiniMaxDirectorField) === true
    const hasVideoOutput = sourceModule?.output_ports.some((port) => port.key === 'video' && port.data_type === 'video') === true
    if (!isDirectorModule || !hasVideoOutput) return edge
    changed = true
    return { ...edge, source_port_key: 'video' }
  })

  return changed ? { ...graph, edges } : graph
}

function parseJsonRecord(value: unknown) {
  if (isRecord(value)) return { ...value }
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return isRecord(parsed) ? { ...parsed } : {}
  } catch {
    return {}
  }
}

function normalizeIncomingValues(value: unknown) {
  return Array.isArray(value) ? value : [value]
}

function connectedMediaName(value: unknown, fallback: string) {
  if (isRecord(value)) {
    const candidate = value.fileName ?? value.originalFileName
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }
  return fallback
}

function buildConnectedMediaItems(params: {
  portKey: string
  mediaType: 'image' | 'video' | 'audio'
  values: unknown[]
  slot?: number
}) {
  return params.values
    .filter((value) => value !== undefined && value !== null && value !== '')
    .map((value, index) => {
      const id = `graph-${params.portKey.replace(/[^a-zA-Z0-9_-]/g, '-')}-${index}`
      const slot = params.slot ?? index
      return {
        id,
        asset: value,
        item: {
          id,
          type: params.mediaType,
          value: connectedMediaName(value, `${params.mediaType}-${index + 1}`),
          enabled: true,
          order: 0,
          slot,
          start: slot,
          duration: params.mediaType === 'image' ? 1 : 2,
          ...(params.mediaType === 'video' ? { media_mode: 'video', trim_start: 0, trim_end: 2 } : {}),
          ...(params.mediaType === 'audio' ? { trim_start: 0, trim_end: 2 } : {}),
        },
      }
    })
}

/** Merge graph-connected Director ports into the composite field consumed by ComfyUI. */
export function applyMiniMaxDirectorPortInputs(
  resolvedInputs: Record<string, any>,
  moduleDefinition: { exposed_inputs: ModulePortDefinition[]; ui_schema?: ModuleUiFieldDefinition[] | null },
) {
  const nextInputs = { ...resolvedInputs }

  for (const field of (moduleDefinition.ui_schema ?? []).filter(isMiniMaxDirectorField)) {
    const fieldPorts = moduleDefinition.exposed_inputs.filter((port) => port.node_binding?.field_key === field.key && isMiniMaxDirectorPort(port))
    if (fieldPorts.length === 0) continue

    const fieldValue = isRecord(nextInputs[field.key]) ? { ...nextInputs[field.key] } : {}
    const mode = getMiniMaxDirectorMode(fieldValue, field.default_value)

    for (const port of fieldPorts) {
      const binding = port.node_binding
      const connectedValue = nextInputs[port.key]
      delete nextInputs[port.key]
      if (!binding || connectedValue === undefined || !isMiniMaxDirectorPortActive(port, fieldValue, field.default_value)) continue

      if (binding.input_key === 'width' || binding.input_key === 'height' || binding.input_key === 'duration' || binding.input_key === 'ref_image_size') {
        fieldValue[binding.input_key] = Array.isArray(connectedValue) ? connectedValue[0] : connectedValue
      }
    }

    const timeline = parseJsonRecord(fieldValue.timeline_data)
    let items = Array.isArray(timeline.items) ? timeline.items.filter(isRecord).map((item) => ({ ...item })) : []
    const directBuilder = parseJsonRecord(fieldValue.builder_state)
    const timelineBuilder = parseJsonRecord(timeline.builder_state)
    const builder = Object.keys(directBuilder).length > 0 ? directBuilder : timelineBuilder
    builder.mode = mode
    builder.duration = Number.isFinite(Number(fieldValue.duration)) ? Number(fieldValue.duration) : 5
    const refBuilder = isRecord(builder.ref) ? { ...builder.ref } : {}
    const metadata = isRecord(fieldValue.__conai_minimax_h3_director) ? { ...fieldValue.__conai_minimax_h3_director } : {}
    const assets = isRecord(metadata.assets) ? { ...metadata.assets } : {}

    for (const port of fieldPorts) {
      const binding = port.node_binding
      const connectedValue = resolvedInputs[port.key]
      if (!binding || connectedValue === undefined || !isMiniMaxDirectorPortActive(port, fieldValue, field.default_value)) continue

      if (binding.input_key.startsWith('prompt.')) {
        const promptKey = binding.input_key.slice('prompt.'.length)
        const promptValue = String(Array.isArray(connectedValue) ? connectedValue[0] ?? '' : connectedValue)
        if (promptKey === 'imd') {
          builder.imd = promptValue
        } else if (promptKey === 'soundscape' || promptKey === 'music') {
          if (mode === 'REF2VA') refBuilder[promptKey] = promptValue
          else builder[promptKey] = promptValue
        } else {
          refBuilder[promptKey] = promptValue
        }
        continue
      }

      const mediaConfig = binding.input_key === 'start_image'
        ? { type: 'image' as const, slot: 0, replace: (item: Record<string, any>) => item.type === 'image' && Number(item.slot) === 0 }
        : binding.input_key === 'end_image'
          ? { type: 'image' as const, slot: 1, replace: (item: Record<string, any>) => item.type === 'image' && Number(item.slot) === 1 }
          : binding.input_key === 'reference_image'
            ? { type: 'image' as const, slot: undefined, replace: (item: Record<string, any>) => item.type === 'image' }
            : binding.input_key === 'reference_video'
              ? { type: 'video' as const, slot: undefined, replace: (item: Record<string, any>) => item.type === 'video' }
              : binding.input_key === 'reference_audio'
                ? { type: 'audio' as const, slot: undefined, replace: (item: Record<string, any>) => item.type === 'audio' }
                : null
      if (!mediaConfig) continue

      items = items.filter((item) => !mediaConfig.replace(item))
      const connectedItems = buildConnectedMediaItems({
        portKey: port.key,
        mediaType: mediaConfig.type,
        values: normalizeIncomingValues(connectedValue),
        slot: mediaConfig.slot,
      })
      for (const connectedItem of connectedItems) {
        items.push(connectedItem.item)
        assets[connectedItem.id] = connectedItem.asset
      }
    }

    builder.ref = refBuilder
    timeline.version = 1
    timeline.items = items.map((item, index) => ({ ...item, order: index }))
    timeline.prompt_blocks = Array.isArray(timeline.prompt_blocks) ? timeline.prompt_blocks : []
    timeline.builder_state = builder
    fieldValue.timeline_data = JSON.stringify(timeline)
    fieldValue.builder_state = JSON.stringify(builder)
    fieldValue.__conai_minimax_h3_director = { ...metadata, assets }
    nextInputs[field.key] = fieldValue
  }

  return nextInputs
}
