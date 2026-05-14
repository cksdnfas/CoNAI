import type { TranslationInput, TranslationParams } from '../i18n'
import type { ImageEditorTool } from '../features/image-editor/image-editor-types'
import {
  getImageEditorBrushColorLabel,
  getImageEditorBrushOpacityLabel,
  getImageEditorBrushSizeLabel,
  getImageEditorToolHint,
  getImageEditorToolLabel,
  getImageEditorToolShortcut,
  isImageEditorBrushTool,
} from '../features/image-editor/image-editor-tool-metadata'

function translate(input: TranslationInput, params?: TranslationParams) {
  const template = typeof input === 'string'
    ? input
    : input.en ?? input.ko ?? ''

  return template.replace(/\{([^}]+)\}/g, (match, key: string) => {
    const value = params?.[key]
    return value === undefined || value === null ? match : String(value)
  })
}

function translateKo(input: TranslationInput, params?: TranslationParams) {
  const template = typeof input === 'string'
    ? input
    : input.ko ?? input.en ?? ''

  return template.replace(/\{([^}]+)\}/g, (match, key: string) => {
    const value = params?.[key]
    return value === undefined || value === null ? match : String(value)
  })
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

const tools: ImageEditorTool[] = ['pan', 'select', 'brush', 'eraser', 'mask-brush', 'mask-eraser', 'crop']

function assertToolMetadataCoverage() {
  const expectedShortcuts: Record<ImageEditorTool, string> = {
    pan: 'H',
    select: 'S',
    brush: 'B',
    eraser: 'E',
    'mask-brush': 'M',
    'mask-eraser': 'Shift+M',
    crop: 'C',
  }

  const expectedEnglishLabels: Record<ImageEditorTool, string> = {
    pan: 'Pan',
    select: 'Select',
    brush: 'Brush',
    eraser: 'Eraser',
    'mask-brush': 'Mask brush',
    'mask-eraser': 'Mask eraser',
    crop: 'Crop',
  }

  for (const tool of tools) {
    assertEqual(getImageEditorToolShortcut(tool), expectedShortcuts[tool], `${tool} should keep its documented shortcut`)
    assertEqual(translate(getImageEditorToolLabel(tool)), expectedEnglishLabels[tool], `${tool} should expose one shared English label`)
    assert(translateKo(getImageEditorToolLabel(tool)).trim().length > 0, `${tool} should expose a Korean label`)
    assert(translate(getImageEditorToolHint(tool)).trim().length > 0, `${tool} should expose an English hint`)
    assert(translateKo(getImageEditorToolHint(tool)).trim().length > 0, `${tool} should expose a Korean hint`)
  }
}

function assertBrushToolDetection() {
  for (const tool of tools) {
    const expected = tool === 'brush' || tool === 'eraser' || tool === 'mask-brush' || tool === 'mask-eraser'
    assertEqual(isImageEditorBrushTool(tool), expected, `${tool} brush-tool detection should match drawing/mask tools`)
  }
}

function assertBrushStatusLabels() {
  assertEqual(getImageEditorBrushSizeLabel(16, translate), 'Brush 16px', 'toolbar/canvas brush size label should include the actual brush size')
  assertEqual(getImageEditorBrushSizeLabel(7, translateKo), '브러시 7px', 'Korean brush size label should include the actual brush size')
  assertEqual(getImageEditorBrushColorLabel('#38bdf8', translate), 'Color #38BDF8', 'toolbar brush color label should include the current brush color')
  assertEqual(getImageEditorBrushColorLabel('#ff4d4f', translateKo), '색상 #FF4D4F', 'Korean brush color label should include the current brush color')
  assertEqual(getImageEditorBrushOpacityLabel(65, translate), 'Opacity 65%', 'toolbar/canvas opacity label should include the actual opacity')
  assertEqual(getImageEditorBrushOpacityLabel(80, translateKo), '불투명도 80%', 'Korean opacity label should include the actual opacity')

  const combinedToolbarStatus = [
    getImageEditorBrushSizeLabel(16, translate),
    getImageEditorBrushColorLabel('#38bdf8', translate),
    getImageEditorBrushOpacityLabel(100, translate),
  ].join(' | ')
  assert(!combinedToolbarStatus.includes('[ ]'), 'toolbar brush status must not regress to the blank placeholder')
}

assertToolMetadataCoverage()
assertBrushToolDetection()
assertBrushStatusLabels()

console.log('Image editor tool contracts verified.')
