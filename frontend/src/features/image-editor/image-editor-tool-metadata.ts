import type { TranslationDictionary, TranslationInput, TranslationParams } from '@/i18n'
import type { ImageEditorTool } from './image-editor-types'

type TranslateFn = (input: TranslationInput, params?: TranslationParams) => string

const BRUSH_TOOLS = new Set<ImageEditorTool>(['brush', 'eraser', 'mask-brush', 'mask-eraser'])

export function isImageEditorBrushTool(tool: ImageEditorTool): boolean {
  return BRUSH_TOOLS.has(tool)
}

export function getImageEditorToolShortcut(tool: ImageEditorTool): string {
  switch (tool) {
    case 'pan':
      return 'H'
    case 'select':
      return 'S'
    case 'brush':
      return 'B'
    case 'eraser':
      return 'E'
    case 'mask-brush':
      return 'M'
    case 'mask-eraser':
      return 'Shift+M'
    case 'crop':
      return 'C'
    default:
      return '-'
  }
}

export function getImageEditorToolLabel(tool: ImageEditorTool): TranslationDictionary {
  switch (tool) {
    case 'pan':
      return { ko: '이동', en: 'Pan' }
    case 'select':
      return { ko: '선택', en: 'Select' }
    case 'brush':
      return { ko: '브러시', en: 'Brush' }
    case 'eraser':
      return { ko: '지우개', en: 'Eraser' }
    case 'mask-brush':
      return { ko: '마스크 브러시', en: 'Mask brush' }
    case 'mask-eraser':
      return { ko: '마스크 지우개', en: 'Mask eraser' }
    case 'crop':
      return { ko: '자르기', en: 'Crop' }
    default:
      return { ko: String(tool), en: String(tool) }
  }
}

export function getImageEditorBrushSizeLabel(brushSize: number, translate: TranslateFn): string {
  return translate({ ko: '브러시 {value}px', en: 'Brush {value}px' }, { value: brushSize })
}

export function getImageEditorBrushOpacityLabel(brushOpacity: number, translate: TranslateFn): string {
  return translate({ ko: '불투명도 {value}%', en: 'Opacity {value}%' }, { value: brushOpacity })
}
