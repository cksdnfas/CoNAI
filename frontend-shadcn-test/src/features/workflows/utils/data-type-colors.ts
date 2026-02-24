export interface DataTypeColor {
  color: string
  label: string
}

export const DATA_TYPE_COLORS: Record<string, DataTypeColor> = {
  MODEL: { color: '#9C27B0', label: 'Model' },
  CLIP: { color: '#FF9800', label: 'CLIP' },
  VAE: { color: '#E91E63', label: 'VAE' },
  CONDITIONING: { color: '#F44336', label: 'Conditioning' },
  LATENT: { color: '#00BCD4', label: 'Latent' },
  IMAGE: { color: '#4CAF50', label: 'Image' },
  MASK: { color: '#FFFFFF', label: 'Mask' },
  CONTROL_NET: { color: '#FF5722', label: 'ControlNet' },
  UPSCALE_MODEL: { color: '#673AB7', label: 'Upscale Model' },
  SAMPLER: { color: '#2196F3', label: 'Sampler' },
  SIGMAS: { color: '#3F51B5', label: 'Sigmas' },
  NOISE: { color: '#607D8B', label: 'Noise' },
  STRING: { color: '#9E9E9E', label: 'String' },
  INT: { color: '#795548', label: 'Integer' },
  FLOAT: { color: '#8D6E63', label: 'Float' },
  BOOLEAN: { color: '#FFEB3B', label: 'Boolean' },
  UNKNOWN: { color: '#757575', label: 'Unknown' },
}

export function inferDataType(paramName: string, value: unknown, sourceNodeType?: string): string {
  const name = paramName.toLowerCase()

  if (name.includes('model')) return 'MODEL'
  if (name.includes('clip')) return 'CLIP'
  if (name.includes('vae')) return 'VAE'
  if (name.includes('conditioning') || name.includes('positive') || name.includes('negative')) return 'CONDITIONING'
  if (name.includes('latent') || name.includes('samples')) return 'LATENT'
  if (name.includes('image') || name.includes('images')) return 'IMAGE'
  if (name.includes('mask')) return 'MASK'
  if (name.includes('control_net') || name.includes('controlnet')) return 'CONTROL_NET'
  if (name.includes('upscale')) return 'UPSCALE_MODEL'
  if (name.includes('sampler')) return 'SAMPLER'
  if (name.includes('sigmas')) return 'SIGMAS'
  if (name.includes('noise')) return 'NOISE'

  if (sourceNodeType) {
    const sourceType = sourceNodeType.toLowerCase()
    if (sourceType.includes('checkpoint') || sourceType.includes('modelloader')) return 'MODEL'
    if (sourceType.includes('cliploader') || sourceType.includes('cliptext')) return 'CLIP'
    if (sourceType.includes('vaeloader') || sourceType.includes('vaedecode')) return 'VAE'
    if (sourceType.includes('sampler')) return 'LATENT'
    if (sourceType.includes('image')) return 'IMAGE'
  }

  if (typeof value === 'string') return 'STRING'
  if (typeof value === 'number') return Number.isInteger(value) ? 'INT' : 'FLOAT'
  if (typeof value === 'boolean') return 'BOOLEAN'

  return 'UNKNOWN'
}

export function getDataTypeColor(dataType: string): string {
  const type = dataType.toUpperCase()
  return DATA_TYPE_COLORS[type]?.color || DATA_TYPE_COLORS.UNKNOWN.color
}

export function getDataTypeLabel(dataType: string): string {
  const type = dataType.toUpperCase()
  return DATA_TYPE_COLORS[type]?.label || dataType
}
