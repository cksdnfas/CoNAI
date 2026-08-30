import type {
  GraphWorkflowDocument,
  ModulePortDataType,
  ModulePortDefinition,
  ModuleUiFieldDefinition,
} from '../../types/moduleGraph'

export const MINIMAX_DIRECTOR_NODE_EDITOR = 'minimax_h3_director_dasiwa' as const

const MINIMAX_DIRECTOR_MODES = ['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REF2VA', 'Image Inpaint'] as const
type MiniMaxDirectorMode = typeof MINIMAX_DIRECTOR_MODES[number]
const MINIMAX_DIRECTOR_VIDEO_MODES: MiniMaxDirectorMode[] = ['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REF2VA']
const MINIMAX_CANVAS_MULTIPLE = 32
const MINIMAX_RESOLUTION_PRESETS: Record<string, number> = {
  '144p': 0.0352, '240p': 0.0977, '360p': 0.22, '480p': 0.391, '540p': 0.494, '576p': 0.396,
  '720p': 0.879, '900p': 1.373, '1024p': 1, '1080p': 1.978, '1152p': 2.25, '1440p': 3.516,
  '2160p': 7.91, '2K': 3.906, '4K': 7.91,
  '0.26 MP - Preview': 0.26, '0.36 MP - Small': 0.36, '0.52 MP - SD': 0.52, '0.65 MP - Balanced': 0.65,
  '0.83 MP - HD': 0.83, '1.00 MP - 1024p': 1, '1.05 MP - HD+': 1.05, '1.20 MP - HD++': 1.2,
  '1.35 MP - 2K lite': 1.35, '1.55 MP - 2K': 1.55, '1.65 MP - 2K+': 1.65, '1.75 MP - QHD': 1.75,
  '2.10 MP - FHD': 2.1, '3.30 MP - QHD+': 3.3, '4.75 MP - 2K Pro': 4.75, '6.50 MP - Production': 6.5, '8.30 MP - UHD': 8.3,
}

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
  { inputKey: 'duration', label: '길이', dataType: 'number', visibleField: 'duration', activeModes: MINIMAX_DIRECTOR_VIDEO_MODES },
  { inputKey: 'frame_rate', label: '프레임 레이트', dataType: 'number', visibleField: 'frame_rate', activeModes: MINIMAX_DIRECTOR_VIDEO_MODES },
  { inputKey: 'ref_image_size', label: '이미지 크기', dataType: 'text', visibleField: 'ref_image_size', activeModes: ['REF2VA'] },
  { inputKey: 'resolution.aspect', label: '출력 비율', dataType: 'text', visibleField: 'timeline_data' },
  { inputKey: 'resolution.resolution', label: '해상도 프리셋', dataType: 'text', visibleField: 'timeline_data' },
  { inputKey: 'resolution.input_scaling', label: '입력 스케일링', dataType: 'text', visibleField: 'timeline_data' },
  { inputKey: 'resolution.custom_aspect_w', label: '사용자 비율 너비', dataType: 'number', visibleField: 'timeline_data' },
  { inputKey: 'resolution.custom_aspect_h', label: '사용자 비율 높이', dataType: 'number', visibleField: 'timeline_data' },
  { inputKey: 'resolution.custom_mode', label: '사용자 해상도 방식', dataType: 'text', visibleField: 'timeline_data' },
  { inputKey: 'resolution.custom_mp', label: '사용자 메가픽셀', dataType: 'number', visibleField: 'timeline_data' },
  { inputKey: 'resolution.custom_width', label: '사용자 고정 너비', dataType: 'number', visibleField: 'timeline_data' },
  { inputKey: 'resolution.custom_height', label: '사용자 고정 높이', dataType: 'number', visibleField: 'timeline_data' },
  { inputKey: 'postprocess.simple.enabled', label: '단순 2× 리사이즈', dataType: 'boolean', visibleField: 'timeline_data' },
  { inputKey: 'postprocess.model.enabled', label: '모델 업스케일', dataType: 'boolean', visibleField: 'timeline_data' },
  { inputKey: 'postprocess.model.model_name', label: '업스케일 모델', dataType: 'text', visibleField: 'timeline_data' },
  { inputKey: 'postprocess.rtx.enabled', label: 'RTX 후처리', dataType: 'boolean', visibleField: 'timeline_data' },
  { inputKey: 'postprocess.rtx.denoise', label: 'RTX 노이즈 제거', dataType: 'boolean', visibleField: 'timeline_data' },
  { inputKey: 'postprocess.rtx.denoise_quality', label: 'RTX 노이즈 제거 품질', dataType: 'text', visibleField: 'timeline_data' },
  { inputKey: 'postprocess.rtx.deblur', label: 'RTX 디블러', dataType: 'boolean', visibleField: 'timeline_data' },
  { inputKey: 'postprocess.rtx.deblur_quality', label: 'RTX 디블러 품질', dataType: 'text', visibleField: 'timeline_data' },
  { inputKey: 'postprocess.rtx.upscale', label: 'RTX 업스케일 방식', dataType: 'text', visibleField: 'timeline_data' },
  { inputKey: 'postprocess.rtx.upscale_quality', label: 'RTX 업스케일 품질', dataType: 'text', visibleField: 'timeline_data' },
  { inputKey: 'postprocess.rtx.resize_type', label: 'RTX 출력 크기 방식', dataType: 'text', visibleField: 'timeline_data' },
  { inputKey: 'postprocess.rtx.scale', label: 'RTX 배율', dataType: 'number', visibleField: 'timeline_data' },
  { inputKey: 'postprocess.rtx.megapixels', label: 'RTX 메가픽셀', dataType: 'number', visibleField: 'timeline_data' },
  { inputKey: 'postprocess.rtx.width', label: 'RTX 너비', dataType: 'number', visibleField: 'timeline_data' },
  { inputKey: 'postprocess.rtx.height', label: 'RTX 높이', dataType: 'number', visibleField: 'timeline_data' },
  { inputKey: 'postprocess.rtx.divisible_by', label: 'RTX 픽셀 배수', dataType: 'text', visibleField: 'timeline_data' },
  { inputKey: 'postprocess.rtx.ratio_preset', label: 'RTX 목표 비율', dataType: 'text', visibleField: 'timeline_data' },
  { inputKey: 'postprocess.rtx.resize_method', label: 'RTX 비율 처리', dataType: 'text', visibleField: 'timeline_data' },
  { inputKey: 'postprocess.rtx.device_id', label: 'RTX GPU 번호', dataType: 'number', visibleField: 'timeline_data' },
  { inputKey: 'postprocess.rtx.empty_cache', label: 'RTX 캐시 비우기', dataType: 'boolean', visibleField: 'timeline_data' },
  { inputKey: 'postprocess.rtx.use_mmap', label: 'RTX mmap', dataType: 'boolean', visibleField: 'timeline_data' },
  { inputKey: 'postprocess.rtx.auto_unload_models', label: 'RTX 모델 자동 언로드', dataType: 'boolean', visibleField: 'timeline_data' },
  { inputKey: 'start_image', label: '시작 이미지', dataType: 'image', visibleField: 'timeline_data', activeModes: ['I2VA', 'FL2VA', 'Image Inpaint'] },
  { inputKey: 'end_image', label: '끝 이미지', dataType: 'image', visibleField: 'timeline_data', activeModes: ['FL2VA', 'L2VA'] },
  { inputKey: 'reference_image', label: '참조 이미지', dataType: 'image', visibleField: 'timeline_data', activeModes: ['REF2VA'], multiple: true },
  { inputKey: 'reference_video', label: '참조 영상', dataType: 'video', visibleField: 'timeline_data', activeModes: ['REF2VA'], multiple: true },
  { inputKey: 'reference_audio', label: '참조 오디오', dataType: 'audio', visibleField: 'timeline_data', activeModes: ['REF2VA'], multiple: true },
  { inputKey: 'prompt.mode', label: '프롬프트 모드', dataType: 'text', visibleField: 'prompt' },
  { inputKey: 'prompt.simple_prompt', label: '간단 프롬프트', dataType: 'prompt', visibleField: 'prompt' },
  { inputKey: 'prompt.imd', label: '통합 설명', dataType: 'prompt', visibleField: 'prompt', activeModes: ['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'Image Inpaint'] },
  { inputKey: 'prompt.subject_definitions', label: '주체 정의', dataType: 'prompt', visibleField: 'prompt', activeModes: ['REF2VA'] },
  { inputKey: 'prompt.summary', label: '요약', dataType: 'prompt', visibleField: 'prompt', activeModes: ['REF2VA'] },
  { inputKey: 'prompt.retention_analysis', label: '보존 분석', dataType: 'prompt', visibleField: 'prompt', activeModes: ['REF2VA'] },
  { inputKey: 'prompt.detailed_description', label: '상세 설명', dataType: 'prompt', visibleField: 'prompt', activeModes: ['REF2VA'] },
  { inputKey: 'prompt.soundscape', label: '사운드스케이프', dataType: 'prompt', visibleField: 'prompt' },
  { inputKey: 'prompt.music', label: '음악', dataType: 'prompt', visibleField: 'prompt' },
]

const DEFAULT_VISIBLE_FIELDS = new Set(['mode', 'width', 'height', 'duration', 'frame_rate', 'ref_image_size', 'timeline_data', 'prompt'])

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
  return (port.key === 'image' && port.data_type === 'image')
    || (port.key === 'video' && port.data_type === 'video')
}

/** Hydrate saved Director modules with current virtual inputs and a mixed-media output contract. */
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
    ? { ...port, key: 'media', label: 'Workflow Media', data_type: 'any' as const }
    : port)

  return {
    ...moduleDefinition,
    exposed_inputs: [...ordinaryInputs, ...directorInputs],
    output_ports: outputPorts,
    ui_schema: hydratedUiSchema,
  }
}

/** Remap saved image/video Director edges to the mixed-media output. */
export function normalizeMiniMaxDirectorLegacyGraphEdges<T extends {
  id: number
  output_ports: ModulePortDefinition[]
  ui_schema?: ModuleUiFieldDefinition[] | null
}>(graph: GraphWorkflowDocument, modulesById: Map<number, T>) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
  let changed = false
  const edges = graph.edges.map((edge) => {
    if (edge.source_port_key !== 'image' && edge.source_port_key !== 'video') return edge
    const sourceNode = nodeById.get(edge.source_node_id)
    const sourceModule = sourceNode ? modulesById.get(sourceNode.module_id) : null
    const isDirectorModule = sourceModule?.ui_schema?.some(isMiniMaxDirectorField) === true
    const hasMediaOutput = sourceModule?.output_ports.some((port) => port.key === 'media' && port.data_type === 'any') === true
    if (!isDirectorModule || !hasMediaOutput) return edge
    changed = true
    return { ...edge, source_port_key: 'media' }
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

function connectedMediaNumber(value: unknown, ...keys: string[]) {
  if (!isRecord(value)) return null
  for (const key of keys) {
    const candidate = Number(value[key])
    if (Number.isFinite(candidate) && candidate > 0) return candidate
  }
  return null
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
      const duration = connectedMediaNumber(value, 'duration', 'mediaDuration') ?? (params.mediaType === 'image' ? 1 : 2)
      const sourceWidth = connectedMediaNumber(value, 'source_width', 'sourceWidth', 'width')
      const sourceHeight = connectedMediaNumber(value, 'source_height', 'sourceHeight', 'height')
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
          duration,
          ...(sourceWidth && sourceHeight ? { source_width: sourceWidth, source_height: sourceHeight } : {}),
          ...(params.mediaType === 'video' ? { media_mode: 'video', trim_start: 0, trim_end: duration } : {}),
          ...(params.mediaType === 'audio' ? { trim_start: 0, trim_end: duration } : {}),
        },
      }
    })
}

function unwrapConnectedValue(value: unknown) {
  return Array.isArray(value) ? value[0] : value
}

function setNestedRecordValue(target: Record<string, any>, path: string[], value: unknown) {
  let cursor = target
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index]
    cursor[segment] = isRecord(cursor[segment]) ? { ...cursor[segment] } : {}
    cursor = cursor[segment]
  }
  cursor[path[path.length - 1]] = value
}

function finiteNumber(value: unknown, fallback: number) {
  const candidate = Number(value)
  return Number.isFinite(candidate) ? candidate : fallback
}

function normalizeResolution(value: unknown) {
  const source = isRecord(value) ? value : {}
  return {
    aspect: typeof source.aspect === 'string' ? source.aspect : 'auto',
    resolution: typeof source.resolution === 'string' ? source.resolution : 'auto',
    input_scaling: typeof source.input_scaling === 'string' ? source.input_scaling : 'Auto',
    custom_aspect_w: Math.max(1, finiteNumber(source.custom_aspect_w, 16)),
    custom_aspect_h: Math.max(1, finiteNumber(source.custom_aspect_h, 9)),
    custom_mode: source.custom_mode === 'fixed' ? 'fixed' : 'mp',
    custom_mp: Math.max(0.01, finiteNumber(source.custom_mp, 1)),
    custom_width: Math.max(16, finiteNumber(source.custom_width, 1344)),
    custom_height: Math.max(16, finiteNumber(source.custom_height, 768)),
  }
}

function snapMiniMaxCanvas(value: number) {
  return Math.max(MINIMAX_CANVAS_MULTIPLE, Math.round(value / MINIMAX_CANVAS_MULTIPLE) * MINIMAX_CANVAS_MULTIPLE)
}

function resolveMiniMaxCanvas(items: Record<string, any>[], resolutionValue: unknown): [number, number] {
  const resolution = normalizeResolution(resolutionValue)
  if (resolution.resolution === 'custom' && resolution.custom_mode === 'fixed') {
    return [snapMiniMaxCanvas(resolution.custom_width), snapMiniMaxCanvas(resolution.custom_height)]
  }

  const source = items
    .filter((item) => item.enabled !== false
      && (item.type === 'image' || item.type === 'video')
      && finiteNumber(item.source_width, 0) > 0
      && finiteNumber(item.source_height, 0) > 0)
    .sort((left, right) => finiteNumber(left.slot, 0) - finiteNumber(right.slot, 0)
      || finiteNumber(left.order, 0) - finiteNumber(right.order, 0))[0]
  const aspect = resolution.aspect === 'auto'
    ? (source ? finiteNumber(source.source_width, 4) / finiteNumber(source.source_height, 3) : 4 / 3)
    : resolution.aspect === 'custom'
      ? resolution.custom_aspect_w / resolution.custom_aspect_h
      : (() => {
          const [width, height] = resolution.aspect.split(':').map(Number)
          return Number.isFinite(width) && Number.isFinite(height) && height > 0 ? width / height : 4 / 3
        })()

  if (resolution.resolution === 'auto') {
    const shortSide = 768
    return aspect >= 1
      ? [snapMiniMaxCanvas(shortSide * aspect), shortSide]
      : [shortSide, snapMiniMaxCanvas(shortSide / aspect)]
  }

  const megapixels = resolution.resolution === 'custom'
    ? resolution.custom_mp
    : MINIMAX_RESOLUTION_PRESETS[resolution.resolution] ?? 1
  const height = Math.sqrt((megapixels * 1024 * 1024) / aspect)
  return [snapMiniMaxCanvas(height * aspect), snapMiniMaxCanvas(height)]
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
    let widthConnected = false
    let heightConnected = false

    for (const port of fieldPorts) {
      const binding = port.node_binding
      const connectedValue = nextInputs[port.key]
      delete nextInputs[port.key]
      if (!binding || connectedValue === undefined || !isMiniMaxDirectorPortActive(port, fieldValue, field.default_value)) continue

      if (binding.input_key === 'width' || binding.input_key === 'height' || binding.input_key === 'duration' || binding.input_key === 'frame_rate' || binding.input_key === 'ref_image_size') {
        fieldValue[binding.input_key] = unwrapConnectedValue(connectedValue)
        if (binding.input_key === 'width') widthConnected = true
        if (binding.input_key === 'height') heightConnected = true
      }
    }

    const timeline = parseJsonRecord(fieldValue.timeline_data)
    let items = Array.isArray(timeline.items) ? timeline.items.filter(isRecord).map((item) => ({ ...item })) : []
    const directBuilder = parseJsonRecord(fieldValue.builder_state)
    const timelineBuilder = parseJsonRecord(timeline.builder_state)
    const builder = Object.keys(directBuilder).length > 0 ? directBuilder : timelineBuilder
    builder.mode = mode
    builder.duration = Number.isFinite(Number(fieldValue.duration)) ? Number(fieldValue.duration) : 5
    builder.prompt_mode = builder.prompt_mode === 'simple' ? 'simple' : 'structured'
    builder.simple_prompt = typeof builder.simple_prompt === 'string' ? builder.simple_prompt : ''
    const refBuilder = isRecord(builder.ref) ? { ...builder.ref } : {}
    const metadata = isRecord(fieldValue.__conai_minimax_h3_director) ? { ...fieldValue.__conai_minimax_h3_director } : {}
    const assets = isRecord(metadata.assets) ? { ...metadata.assets } : {}
    const resolution = normalizeResolution(timeline.resolution)
    const postprocess = isRecord(timeline.postprocess) ? { ...timeline.postprocess } : {}

    for (const port of fieldPorts) {
      const binding = port.node_binding
      const connectedValue = resolvedInputs[port.key]
      if (!binding || connectedValue === undefined || !isMiniMaxDirectorPortActive(port, fieldValue, field.default_value)) continue

      if (binding.input_key.startsWith('prompt.')) {
        const promptKey = binding.input_key.slice('prompt.'.length)
        const promptValue = String(Array.isArray(connectedValue) ? connectedValue[0] ?? '' : connectedValue)
        if (promptKey === 'mode') {
          if (promptValue === 'simple' || promptValue === 'structured') builder.prompt_mode = promptValue
        } else if (promptKey === 'simple_prompt') {
          builder.simple_prompt = promptValue
        } else if (promptKey === 'imd') {
          builder.imd = promptValue
        } else if (promptKey === 'soundscape' || promptKey === 'music') {
          if (mode === 'REF2VA') refBuilder[promptKey] = promptValue
          else builder[promptKey] = promptValue
        } else {
          refBuilder[promptKey] = promptValue
        }
        continue
      }

      if (binding.input_key.startsWith('resolution.')) {
        setNestedRecordValue(resolution, binding.input_key.slice('resolution.'.length).split('.'), unwrapConnectedValue(connectedValue))
        continue
      }

      if (binding.input_key.startsWith('postprocess.')) {
        setNestedRecordValue(postprocess, binding.input_key.slice('postprocess.'.length).split('.'), unwrapConnectedValue(connectedValue))
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
    timeline.resolution = normalizeResolution(resolution)
    timeline.postprocess = postprocess
    const [resolvedWidth, resolvedHeight] = resolveMiniMaxCanvas(timeline.items, timeline.resolution)
    if (!widthConnected) fieldValue.width = resolvedWidth
    if (!heightConnected) fieldValue.height = resolvedHeight
    fieldValue.timeline_data = JSON.stringify(timeline)
    fieldValue.builder_state = JSON.stringify(builder)
    fieldValue.__conai_minimax_h3_director = { ...metadata, assets }
    nextInputs[field.key] = fieldValue
  }

  return nextInputs
}
