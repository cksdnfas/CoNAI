import { useState } from 'react'
import type { ChatPageAction, ChatPageData } from '@conai/shared'
import { useChatPageRegistration, type WorkflowUndo } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageChoice, pageFreeText, pageNumber, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { useI18n } from '@/i18n'
import { createRandomUuid } from '@/lib/random-uuid'
import { MAX_BRUSH_SIZE, type CropRatio, type EditorEngine, type EditorSnapshot, type EditorTool } from './engine/editor-engine'
import { NEUTRAL_ADJUSTMENTS, type Adjustments } from './engine/adjust'
import { RESIZE_LIMITS } from './engine/resize'

const TOOLS: EditorTool[] = ['hand', 'select', 'lasso', 'brush', 'eraser', 'ai-erase', 'eyedropper', 'text', 'mask', 'mask-eraser', 'crop']
const CROP_RATIOS: CropRatio[] = ['free', 'original', '1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9']
const TRANSFORMS = ['rotate_cw', 'rotate_ccw', 'flip_x', 'flip_y', 'resize', 'zoom', 'fit']
const ADJUST_KEYS = ['brightness', 'contrast', 'saturation', 'hue', 'temperature', 'grayscale', 'invert'] as const
/** Layers listed in page data; layerCount tells the chat when there are more. */
const LAYER_LIMIT = 40
const HEX = /^#[0-9a-fA-F]{6}$/

type Input = {
  engine: EditorEngine | null
  snapshot: EditorSnapshot
  fileName: string
  saving: boolean
  /** The editor's own save (export → onSave); false when it did not save. */
  save: () => Promise<boolean>
}

/**
 * The open image editor as a chat page: a small view of the document, tool and layers, view/draft operations that call
 * the engine's public methods like the editor's buttons do, and a reviewed save through the editor's own save path.
 * Closing is not offered, so unsaved edits are only discarded through the editor's own confirmation.
 */
export function useImageEditorChatPage({ engine, snapshot, fileName, saving, save }: Input) {
  const { t } = useI18n()
  // One identity per opened editor, so a card made for an earlier editor never applies to a later one.
  const [resourceId] = useState(() => createRandomUuid())
  const ready = Boolean(engine) && snapshot.status === 'ready'
  const paint = snapshot.layers.filter((layer) => layer.kind === 'paint')
  const layerIds = [...paint.map((layer) => layer.id), ...(snapshot.mask ? [snapshot.mask.id] : [])]
  const tools = TOOLS.filter((tool) => (snapshot.mask || (tool !== 'mask' && tool !== 'mask-eraser')) && (snapshot.aiEraseAvailable || tool !== 'ai-erase'))
  const history = [...(snapshot.canUndo ? ['undo'] : []), ...(snapshot.canRedo ? ['redo'] : [])]
  const selection = ['select_all', 'copy', 'paste', ...(snapshot.hasSelection ? ['clear', 'delete', 'cut', 'invert', 'fill', 'lift', 'nudge'] : []), ...(snapshot.floating ? ['apply', 'discard', 'nudge', 'delete'] : [])]
  const mask = snapshot.mask ? [...(snapshot.hasSelection ? ['fill_selection', 'erase_selection'] : []), 'invert', 'clear'] : []
  const dirty = snapshot.dirty || snapshot.floating || snapshot.textEditing || snapshot.adjust !== null

  const actions: ChatPageAction[] = saving ? [] : [
    pageAction('image_editor.tool', t({ ko: '도구와 작업', en: 'Tools and pending work' }), t({ ko: 'op 기본값 select는 tool을 골라. compare·shortcuts는 enabled로 원본 비교·단축키를 열어. ai_apply/ai_clear는 칠한 AI 영역을 적용/비워. pick은 x,y의 색을 골라. adjust는 보정 값을 미리 보고 adjust_apply/reset은 적용/되돌리기야.', en: 'op defaults to select (requires tool). compare/shortcuts use enabled; ai_apply/ai_clear run/clear the painted AI mask; pick samples x,y; adjust previews adjustments; adjust_apply/reset commits/reverts them.' }), pageObject({
      op: pageChoice(['select', 'compare', 'shortcuts', 'ai_apply', 'ai_clear', 'pick', 'adjust', 'adjust_apply', 'adjust_reset']),
      tool: pageChoice(tools), enabled: { type: 'boolean' }, x: pageNumber(0, snapshot.width - 1), y: pageNumber(0, snapshot.height - 1),
      brightness: pageNumber(-100, 100), contrast: pageNumber(-100, 100), saturation: pageNumber(-100, 100), hue: pageNumber(-180, 180), temperature: pageNumber(-100, 100), grayscale: { type: 'boolean' }, invert: { type: 'boolean' },
    })),
    pageAction('image_editor.layer_select', t({ ko: '레이어 선택', en: 'Select layer' }), t({ ko: 'original은 처음 연 원본 레이어가 남아 있으면 골라.', en: 'original selects the initially opened Original layer when it still exists.' }), pageObject({ layerId: pageChoice([...(engine?.hasOriginalLayer ? ['original'] : []), ...layerIds]) }, ['layerId'])),
    pageAction('image_editor.brush', t({ ko: '브러시·텍스트 설정과 직선', en: 'Brush/text settings and straight lines' }), t({ ko: 'color는 #RRGGBB야. from/to를 함께 주면 현재 브러시·지우개·마스크로 직선을 그려. fontSize/strokeWidth는 텍스트 크기/외곽선이야.', en: 'color is #RRGGBB. Supply both from/to to draw a line with the current brush/eraser/mask. fontSize/strokeWidth set text size/outline.' }), pageObject({
      size: pageNumber(1, MAX_BRUSH_SIZE, true), opacity: pageNumber(0.01, 1), color: pageText(7), pressure: { type: 'boolean' },
      fontSize: pageNumber(6, 400), strokeWidth: pageNumber(0, 40),
      from: pageObject({ x: pageNumber(0, snapshot.width), y: pageNumber(0, snapshot.height) }, ['x', 'y']),
      to: pageObject({ x: pageNumber(0, snapshot.width), y: pageNumber(0, snapshot.height) }, ['x', 'y']),
    })),
    pageAction('image_editor.layer', t({ ko: '레이어 편집', en: 'Edit layer' }), t({ ko: 'op 기본값 properties는 표시·잠금·이름·불투명도를 바꿔. 숨기기는 기록·변경 상태에 남지 않아. move의 index는 아래부터 0이야. add 외에는 layerId가 필요해.', en: 'op defaults to properties: visibility, lock, name and opacity. Visibility changes are not undoable or dirty. move index counts from zero at the bottom. All operations except add require layerId.' }), pageObject({
      op: pageChoice(['properties', 'add', 'duplicate', 'remove', 'move', 'up', 'down']),
      layerId: pageChoice(layerIds), visible: { type: 'boolean' }, locked: { type: 'boolean' }, name: { type: 'string' }, opacity: pageNumber(0, 1), index: pageNumber(0, Math.max(0, paint.length - 1), true),
    })),
    pageAction('image_editor.crop', t({ ko: '자르기 비율', en: 'Crop ratio' }), t({ ko: '자르는 중이면 상자를 그 비율로 맞춰.', en: 'While cropping, the box takes this ratio.' }), pageObject({ ratio: pageChoice(CROP_RATIOS) }, ['ratio'])),
    ...(snapshot.cropping ? [pageAction('image_editor.crop_apply', t({ ko: '자르기 적용·취소', en: 'Apply or cancel crop' }), t({ ko: '현재 자르기 상자로 문서를 자르거나 자르기를 끝내.', en: 'Crop the document to the current box, or leave cropping.' }), pageObject({ op: pageChoice(['apply', 'cancel']) }, ['op']))] : []),
    ...(history.length ? [pageAction('image_editor.history', t({ ko: '실행 취소·다시 실행', en: 'Undo or redo' }), t({ ko: '편집기의 실행 취소 기록을 한 단계 움직여.', en: 'Move one step in the editor history.' }), pageObject({ step: pageChoice(history) }, ['step']))] : []),
    pageAction('image_editor.transform', t({ ko: '보기·크기·회전·뒤집기', en: 'View, resize, rotate and flip' }), t({ ko: 'resize는 width/height로 모든 레이어 크기를 바꿔. lockRatio면 너비를 기준으로 비율을 유지해. 브라우저 캔버스 한도 안으로 줄여. zoom은 percent, fit은 화면 맞춤이야.', en: 'resize uses width/height for all layers; lockRatio preserves the ratio from width. Dimensions are clamped to browser canvas limits. zoom uses percent; fit fits the viewport.' }), pageObject({ op: pageChoice(TRANSFORMS), width: pageNumber(1, RESIZE_LIMITS.dimension, true), height: pageNumber(1, RESIZE_LIMITS.dimension, true), lockRatio: { type: 'boolean' }, percent: pageNumber(2, 3200) }, ['op'])),
    pageAction('image_editor.selection', t({ ko: '선택 영역·조각', en: 'Selection and floating piece' }), t({ ko: 'fill은 브러시 색으로 채워. lift는 픽셀을 들어서 옮길 준비를 해. nudge는 dx/dy만큼 옮겨. copy/cut/paste는 편집기 내부 클립보드야. 떠 있는 조각에서 delete/discard는 그 조각만 버려.', en: 'fill uses brush color; lift cuts into a floating piece; nudge moves by dx/dy. copy/cut/paste use the internal clipboard. delete/discard only removes a floating piece.' }), pageObject({ op: pageChoice([...new Set(selection)]), dx: pageNumber(undefined, undefined, true), dy: pageNumber(undefined, undefined, true) }, ['op'])),
    ...(mask.length ? [pageAction('image_editor.mask', t({ ko: '마스크 편집', en: 'Edit mask' }), t({ ko: '선택 영역을 마스크에 칠하거나 빼고, 마스크를 반전하거나 비워.', en: 'Paint or remove the selection in the mask, invert or clear the mask.' }), pageObject({ op: pageChoice(mask) }, ['op']))] : []),
    ...(dirty && !snapshot.aiErasing && !snapshot.aiMaskPending ? [pageAction('image_editor.save', t({ ko: '편집 결과 저장', en: 'Save the edit' }), t({ ko: '편집기의 저장 버튼과 같아. 보이는 레이어를 합쳐 이 편집기를 연 곳에 넘겨. 저장 옵션을 취소하면 편집기로 돌아와.', en: 'Same as Save. Merges visible layers and hands them to the opener. Cancelling save options returns to the editor.' }), undefined, 'save')] : []),
  ]

  const data: Record<string, ChatPageData> = {
    document: { fileName: pageFreeText(fileName.slice(0, 200)), width: snapshot.width, height: snapshot.height, status: snapshot.status, error: snapshot.error ? pageFreeText(snapshot.error.slice(0, 300)) : null, saving },
    tool: snapshot.tool,
    brush: { size: snapshot.brushSize, opacity: snapshot.brushOpacity, color: snapshot.brushColor, recentColors: snapshot.recentColors, pressure: snapshot.pressure },
    layers: paint.slice(0, LAYER_LIMIT).map((layer) => ({ id: layer.id, name: pageFreeText(layer.name.slice(0, 80)), visible: layer.visible, locked: layer.locked, active: layer.id === snapshot.activeLayerId, ...(layer.text ? { editableText: true } : {}) })),
    layerCount: paint.length,
    mask: snapshot.mask ? { enabled: true, id: snapshot.mask.id, visible: snapshot.mask.visible, locked: snapshot.mask.locked } : { enabled: false },
    crop: { ratio: snapshot.cropRatio, cropping: snapshot.cropping },
    hasSelection: snapshot.hasSelection,
    floating: snapshot.floating,
    textEditing: snapshot.textEditing,
    canUndo: snapshot.canUndo,
    canRedo: snapshot.canRedo,
    dirty,
    aiEraseAvailable: snapshot.aiEraseAvailable,
    aiErasing: snapshot.aiErasing,
    aiMaskPending: snapshot.aiMaskPending,
    comparing: snapshot.comparing,
    adjustments: snapshot.adjust?.value ?? NEUTRAL_ADJUSTMENTS,
    textStyle: { fontSize: snapshot.textStyle.fontSize, strokeWidth: snapshot.textStyle.strokeWidth },
  }

  const applyAction = async (id: string, args: Record<string, ChatPageData>, assertCurrent: () => void): Promise<WorkflowUndo | void> => {
    assertCurrent()
    if (!engine || engine.getSnapshot().status !== 'ready' || saving) throw new Error('이미지 편집기가 준비되지 않았거나 저장 중이야.')
    const now = engine.getSnapshot()
    switch (id) {
      case 'image_editor.tool':
        switch (args.op ?? 'select') {
          case 'select':
            if (typeof args.tool !== 'string') throw new Error(t({ ko: 'tool을 지정해줘', en: 'Specify tool' }))
            engine.setTool(args.tool as EditorTool); return
          case 'compare': engine.setCompare(args.enabled !== false); return
          case 'shortcuts': engine.setShortcutsOpen(args.enabled !== false); return
          case 'ai_apply': await engine.runAiErase(); return
          case 'ai_clear': engine.cancelAiErase(); return
          case 'pick':
            if (typeof args.x !== 'number' || typeof args.y !== 'number') throw new Error(t({ ko: 'x,y를 지정해줘', en: 'Specify x,y' }))
            engine.pickColor({ x: args.x, y: args.y }); return
          case 'adjust': {
            const patch = Object.fromEntries(ADJUST_KEYS.filter((key) => args[key] !== undefined).map((key) => [key, args[key]])) as Partial<Adjustments>
            engine.previewAdjust(patch); return
          }
          case 'adjust_apply': engine.commitAdjust(); return
          case 'adjust_reset': engine.cancelAdjust(); return
        }
        return
      case 'image_editor.layer_select':
        if (args.layerId === 'original') engine.selectOriginal()
        else engine.setActiveLayer(String(args.layerId))
        return
      case 'image_editor.brush': {
        const color = typeof args.color === 'string' ? args.color : undefined
        if (color !== undefined && !HEX.test(color)) throw new Error('color는 #RRGGBB 형식이어야 해.')
        if (args.from !== undefined || args.to !== undefined) {
          if (!args.from || !args.to || typeof args.from !== 'object' || typeof args.to !== 'object' || Array.isArray(args.from) || Array.isArray(args.to)) throw new Error(t({ ko: 'from/to를 함께 지정해줘', en: 'Specify both from/to' }))
          if (!['brush', 'eraser', 'mask', 'mask-eraser', 'ai-erase'].includes(now.tool)) throw new Error(t({ ko: '먼저 그리기 도구를 골라', en: 'Select a paint tool first' }))
        }
        const before = { size: now.brushSize, opacity: now.brushOpacity, color: now.brushColor }
        if (typeof args.size === 'number') engine.setBrushSize(args.size)
        if (typeof args.opacity === 'number') engine.setBrushOpacity(args.opacity)
        if (color !== undefined) engine.setBrushColor(color)
        if (typeof args.pressure === 'boolean') engine.setPressure(args.pressure)
        if (typeof args.fontSize === 'number') engine.setTextStyle({ fontSize: args.fontSize })
        if (typeof args.strokeWidth === 'number') engine.setTextStyle({ strokeWidth: args.strokeWidth })
        if (args.from && args.to) {
          const from = args.from as { x: number; y: number }
          const to = args.to as { x: number; y: number }
          engine.drawLine(from, to)
          return
        }
        if (args.pressure !== undefined || args.fontSize !== undefined || args.strokeWidth !== undefined) return
        const after = { size: typeof args.size === 'number' ? args.size : before.size, opacity: typeof args.opacity === 'number' ? args.opacity : before.opacity, color: color ?? before.color }
        return {
          isCurrent: () => { const live = engine.getSnapshot(); return live.brushSize === after.size && live.brushOpacity === after.opacity && live.brushColor === after.color },
          restore: () => { engine.setBrushSize(before.size); engine.setBrushOpacity(before.opacity); engine.setBrushColor(before.color) },
        }
      }
      case 'image_editor.layer': {
        if (args.op === 'add') { engine.addLayer(); return }
        const layerId = String(args.layerId)
        const find = (shot: EditorSnapshot) => (shot.mask?.id === layerId ? shot.mask : shot.layers.find((layer) => layer.id === layerId && layer.kind === 'paint'))
        const layer = find(now)
        if (!layer) throw new Error('그 레이어가 없어. 지금 화면을 다시 읽어줘.')
        const index = paint.length - 1 - paint.findIndex((item) => item.id === layerId)
        if (args.op === 'duplicate') { engine.duplicateLayer(layerId); return }
        if (args.op === 'remove') { engine.removeLayer(layerId); return }
        if (args.op === 'up' || args.op === 'down') { engine.moveLayer(layerId, index + (args.op === 'up' ? 1 : -1)); return }
        if (args.op === 'move') {
          if (typeof args.index !== 'number') throw new Error(t({ ko: 'index를 지정해줘', en: 'Specify index' }))
          engine.moveLayer(layerId, args.index); return
        }
        const before = { visible: layer.visible, locked: layer.locked }
        const after = { visible: typeof args.visible === 'boolean' ? args.visible : before.visible, locked: typeof args.locked === 'boolean' ? args.locked : before.locked }
        if (after.visible !== before.visible) engine.setLayerVisible(layerId, after.visible)
        if (after.locked !== before.locked) engine.setLayerLocked(layerId, after.locked)
        if (typeof args.name === 'string') engine.renameLayer(layerId, args.name)
        if (typeof args.opacity === 'number') {
          engine.previewLayerOpacity(layerId, args.opacity)
          engine.commitLayerOpacity(layerId, layer.opacity)
        }
        if (args.name !== undefined || args.opacity !== undefined) return
        return {
          isCurrent: () => { const live = find(engine.getSnapshot()); return Boolean(live) && live!.visible === after.visible && live!.locked === after.locked },
          restore: () => {
            if (after.visible !== before.visible) engine.setLayerVisible(layerId, before.visible)
            if (after.locked !== before.locked) engine.setLayerLocked(layerId, before.locked)
          },
        }
      }
      case 'image_editor.crop': engine.setCropRatio(args.ratio as CropRatio); return
      case 'image_editor.crop_apply': if (args.op === 'apply') engine.applyCrop(); else engine.cancelCrop(); return
      case 'image_editor.history': if (args.step === 'undo') engine.undo(); else engine.redo(); return
      case 'image_editor.transform':
        if (args.op === 'rotate_cw' || args.op === 'rotate_ccw') engine.rotate(args.op === 'rotate_cw')
        else if (args.op === 'flip_x' || args.op === 'flip_y') engine.flip(args.op === 'flip_x' ? 'x' : 'y')
        else if (args.op === 'fit') engine.fitToView()
        else if (args.op === 'zoom') {
          if (typeof args.percent !== 'number') throw new Error(t({ ko: 'percent를 지정해줘', en: 'Specify percent' }))
          engine.zoomTo(args.percent / 100)
        } else if (args.op === 'resize') {
          if (typeof args.width !== 'number' || (!args.lockRatio && typeof args.height !== 'number')) throw new Error(t({ ko: '너비와 높이를 지정해줘', en: 'Specify width and height' }))
          engine.resizeDocument(args.width, args.lockRatio ? Math.max(1, Math.round(args.width * now.height / now.width)) : Number(args.height))
        }
        return
      case 'image_editor.selection':
        if (args.op === 'select_all') engine.selectAll()
        else if (args.op === 'clear') engine.clearSelection()
        else if (args.op === 'invert') engine.invertSelection()
        else if (args.op === 'fill') engine.fillSelection()
        else if (args.op === 'lift') engine.liftSelection()
        else if (args.op === 'nudge') engine.nudge(Number(args.dx ?? 0), Number(args.dy ?? 0))
        else if (args.op === 'copy') engine.copySelection()
        else if (args.op === 'cut') engine.cutSelection()
        else if (args.op === 'paste') engine.pasteInternal()
        else if (args.op === 'apply') engine.commitFloating()
        else if (args.op === 'discard') engine.discardFloating()
        else engine.deleteSelection()
        return
      case 'image_editor.mask':
        if (args.op === 'invert') engine.invertMask()
        else if (args.op === 'clear') engine.clearMask()
        else engine.fillMaskFromSelection(args.op === 'erase_selection')
        return
      case 'image_editor.save':
        if (!(await save())) throw new Error('편집 결과를 저장하지 못했어. 편집기는 열려 있어.')
        return
      default: throw new Error('이미지 편집기에 없는 작업이야.')
    }
  }

  useChatPageRegistration(ready ? {
    kind: 'image_editor', title: t({ ko: '이미지 편집기', en: 'Image editor' }), resourceId, priority: 200, fields: [], dirty, actions, data,
    // Pixel edits (layer versions), the pending adjustment, text style and the floating piece / edited text box change the
    // revision without being sent, so a reviewed save matches what was reviewed. The box is in stage coordinates, so a
    // zoom or pan seen by a later render also makes an open card stale; that only asks for a new card.
    localRevision: JSON.stringify([snapshot.layers, snapshot.mask, snapshot.adjust, snapshot.aiMaskPending, snapshot.textEditing ? snapshot.textStyle : null, engine?.floatingScreenBox() ?? null, engine?.cropSize() ?? null]),
    apply: () => {},
    applyAction,
  } : null)
}
