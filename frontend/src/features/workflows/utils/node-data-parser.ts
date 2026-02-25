import { inferDataType } from './data-type-colors'

export interface NodeInput {
  name: string
  type: 'connection' | 'parameter'
  value?: unknown
  dataType?: string
  sourceNode?: string
  sourceSlot?: number
}

export interface NodeOutput {
  name: string
  slot: number
  dataType: string
}

export interface NodeWidget {
  name: string
  value: unknown
  type: string
}

export interface EnhancedNodeData {
  nodeId: string
  title: string
  classType: string
  inputs: NodeInput[]
  outputs: NodeOutput[]
  widgets: NodeWidget[]
  position?: { x: number; y: number }
  size?: { width: number; height: number }
  color?: string
  bgColor?: string
  rawNode: Record<string, unknown>
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isNumberArray = (value: unknown): value is number[] => Array.isArray(value) && value.every((item) => typeof item === 'number')

export function parseNode(
  nodeId: string,
  nodeData: Record<string, unknown>,
  workflow: Record<string, Record<string, unknown>>,
): EnhancedNodeData {
  const inputs: NodeInput[] = []
  const outputs: NodeOutput[] = []
  const widgets: NodeWidget[] = []

  const meta = isRecord(nodeData._meta) ? nodeData._meta : undefined
  const titleFromMeta = typeof meta?.title === 'string' ? meta.title : undefined
  const titleFromNode = typeof nodeData.title === 'string' ? nodeData.title : undefined
  const title = titleFromMeta || titleFromNode || `Node ${nodeId}`
  const classType = typeof nodeData.class_type === 'string' ? nodeData.class_type : 'UnknownNode'

  const inputSource = isRecord(nodeData.inputs) ? nodeData.inputs : undefined
  if (inputSource) {
    Object.entries(inputSource).forEach(([key, rawValue]) => {
      if (Array.isArray(rawValue) && rawValue.length >= 2) {
        const sourceNodeId = String(rawValue[0])
        const sourceSlot = typeof rawValue[1] === 'number' ? rawValue[1] : 0
        const sourceNode = workflow[sourceNodeId]
        const sourceNodeType = typeof sourceNode?.class_type === 'string' ? sourceNode.class_type : undefined
        const dataType = inferDataType(key, rawValue, sourceNodeType)

        inputs.push({
          name: key,
          type: 'connection',
          dataType,
          sourceNode: sourceNodeId,
          sourceSlot,
        })
      } else {
        const dataType = inferDataType(key, rawValue, classType)
        inputs.push({
          name: key,
          type: 'parameter',
          value: rawValue,
          dataType,
        })
      }
    })
  }

  const outputInfo = inferOutputs(classType)
  outputInfo.forEach((output, index) => {
    outputs.push({
      name: output.name,
      slot: index,
      dataType: output.dataType,
    })
  })

  if (Array.isArray(nodeData.widgets_values)) {
    const widgetNames = inferWidgetNames(classType)
    nodeData.widgets_values.forEach((value, index) => {
      widgets.push({
        name: widgetNames[index] || `widget_${index}`,
        value,
        type: Array.isArray(value) ? 'array' : typeof value,
      })
    })
  }

  const metaPosition = meta?.position
  const position = isNumberArray(metaPosition) && metaPosition.length >= 2 ? { x: metaPosition[0], y: metaPosition[1] } : undefined

  const metaSize = meta?.size
  const size = isNumberArray(metaSize) && metaSize.length >= 2 ? { width: metaSize[0], height: metaSize[1] } : undefined

  return {
    nodeId,
    title,
    classType,
    inputs,
    outputs,
    widgets,
    position,
    size,
    color: typeof meta?.color === 'string' ? meta.color : undefined,
    bgColor: typeof meta?.bgcolor === 'string' ? meta.bgcolor : undefined,
    rawNode: nodeData,
  }
}

function inferOutputs(classType: string): Array<{ name: string; dataType: string }> {
  const type = classType.toLowerCase()

  if (type.includes('checkpointloader')) {
    return [
      { name: 'MODEL', dataType: 'MODEL' },
      { name: 'CLIP', dataType: 'CLIP' },
      { name: 'VAE', dataType: 'VAE' },
    ]
  }
  if (type.includes('loraloader')) {
    return [
      { name: 'MODEL', dataType: 'MODEL' },
      { name: 'CLIP', dataType: 'CLIP' },
    ]
  }
  if (type.includes('cliptextencode')) return [{ name: 'CONDITIONING', dataType: 'CONDITIONING' }]
  if (type.includes('sampler')) return [{ name: 'LATENT', dataType: 'LATENT' }]
  if (type.includes('vaedecode')) return [{ name: 'IMAGE', dataType: 'IMAGE' }]
  if (type.includes('vaeencode')) return [{ name: 'LATENT', dataType: 'LATENT' }]
  if (type.includes('emptylatent')) return [{ name: 'LATENT', dataType: 'LATENT' }]
  if (type.includes('loadimage')) {
    return [
      { name: 'IMAGE', dataType: 'IMAGE' },
      { name: 'MASK', dataType: 'MASK' },
    ]
  }
  if (type.includes('controlnet')) return [{ name: 'CONDITIONING', dataType: 'CONDITIONING' }]

  return [{ name: 'OUTPUT', dataType: 'UNKNOWN' }]
}

function inferWidgetNames(classType: string): string[] {
  const type = classType.toLowerCase()

  if (type.includes('cliptextencode')) return ['text']
  if (type.includes('checkpointloader')) return ['ckpt_name']
  if (type.includes('loraloader')) return ['lora_name', 'strength_model', 'strength_clip']
  if (type.includes('ksampler')) return ['seed', 'control_after_generate', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise']
  if (type.includes('emptylatent')) return ['width', 'height', 'batch_size']
  if (type.includes('saveimage')) return ['filename_prefix']
  if (type.includes('loadimage')) return ['image', 'upload']

  return []
}

export function calculateNodeHeight(data: EnhancedNodeData): number {
  const baseHeight = 40
  const sectionHeader = 28
  const itemHeight = 24
  const padding = 16

  let height = baseHeight + padding
  if (data.inputs.length > 0) height += sectionHeader + data.inputs.length * itemHeight
  if (data.widgets.length > 0) height += sectionHeader + data.widgets.length * itemHeight
  if (data.outputs.length > 0) height += sectionHeader + data.outputs.length * itemHeight

  return Math.max(120, Math.min(600, height))
}
