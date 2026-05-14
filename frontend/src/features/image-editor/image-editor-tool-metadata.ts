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

export function getImageEditorToolHint(tool: ImageEditorTool): TranslationDictionary {
  switch (tool) {
    case 'pan':
      return { ko: '보기를 드래그해서 세부 영역을 확인해.', en: 'Drag the view to inspect details.' }
    case 'select':
      return { ko: '선택 영역을 만들고, 이동하거나 크기를 조절해.', en: 'Create, move, or resize a selection rectangle.' }
    case 'brush':
      return { ko: '현재 드로우 레이어에 칠해.', en: 'Paint on the active draw layer.' }
    case 'eraser':
      return { ko: '현재 드로우 레이어의 내용을 지워.', en: 'Erase content from the active draw layer.' }
    case 'mask-brush':
      return { ko: '마스크에 흰색 편집 가능 영역을 칠해.', en: 'Paint white editable infill regions into the mask.' }
    case 'mask-eraser':
      return { ko: '마스크의 흰색 영역을 지워.', en: 'Remove white regions from the mask.' }
    case 'crop':
      return { ko: '자르기 영역을 드래그한 다음 적용해.', en: 'Drag a crop area, then apply it.' }
    default:
      return { ko: '', en: '' }
  }
}

export function getImageEditorBrushColorLabel(brushColor: string, translate: TranslateFn): string {
  return translate({ ko: '색상 {value}', en: 'Color {value}' }, { value: brushColor.toUpperCase() })
}

export function getImageEditorBrushSizeLabel(brushSize: number, translate: TranslateFn): string {
  return translate({ ko: '브러시 {value}px', en: 'Brush {value}px' }, { value: brushSize })
}

export function getImageEditorBrushOpacityLabel(brushOpacity: number, translate: TranslateFn): string {
  return translate({ ko: '불투명도 {value}%', en: 'Opacity {value}%' }, { value: brushOpacity })
}
