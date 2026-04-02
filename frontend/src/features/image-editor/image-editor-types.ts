export type ImageEditorTool = 'pan' | 'select' | 'brush' | 'eraser' | 'mask-brush' | 'mask-eraser' | 'crop'

export type ImageEditorStrokeMode = 'draw' | 'erase'

export type ImageEditorStroke = {
  id: string
  mode: ImageEditorStrokeMode
  points: number[]
  strokeWidth: number
  color: string
  opacity: number
}

export type ImageEditorDrawLayer = {
  id: string
  type: 'draw'
  name: string
  visible: boolean
  locked: boolean
  lines: ImageEditorStroke[]
}

export type ImageEditorPasteLayer = {
  id: string
  type: 'paste'
  name: string
  visible: boolean
  locked: boolean
  imageDataUrl: string
  x: number
  y: number
  width: number
  height: number
}

export type ImageEditorLayer = ImageEditorDrawLayer | ImageEditorPasteLayer

export type ImageEditorCropRect = {
  x: number
  y: number
  width: number
  height: number
}

export type ImageEditorSavePayload = {
  sourceImageDataUrl: string
  maskImageDataUrl?: string
}
