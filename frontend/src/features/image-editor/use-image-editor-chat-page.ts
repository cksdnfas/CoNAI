import { useState } from 'react'
import type { ChatPageAction, ChatPageData } from '@conai/shared'
import { useChatPageRegistration, type WorkflowUndo } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageChoice, pageFreeText, pageNumber, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { useI18n } from '@/i18n'
import { createRandomUuid } from '@/lib/random-uuid'
import type { CropRatio, EditorEngine, EditorSnapshot, EditorTool } from './engine/editor-engine'

const TOOLS: EditorTool[] = ['hand', 'select', 'lasso', 'brush', 'eraser', 'ai-erase', 'eyedropper', 'text', 'mask', 'mask-eraser', 'crop']
const CROP_RATIOS: CropRatio[] = ['free', 'original', '1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9']
const TRANSFORMS = ['rotate_cw', 'rotate_ccw', 'flip_x', 'flip_y']
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
  const selection = ['select_all', ...(snapshot.hasSelection ? ['clear', 'delete'] : [])]
  const mask = snapshot.mask ? [...(snapshot.hasSelection ? ['fill_selection', 'erase_selection'] : []), 'invert', 'clear'] : []
  const dirty = snapshot.dirty || snapshot.floating || snapshot.textEditing || snapshot.adjust !== null

  const actions: ChatPageAction[] = saving ? [] : [
    pageAction('image_editor.tool', t({ ko: '도구 선택', en: 'Select tool' }), t({ ko: 'crop은 자르기 상자를 열어. 다른 도구로 바꾸면 붙여넣기 조각·텍스트·보정은 확정돼.', en: 'crop opens the crop box. Switching tools commits a floating piece, text or adjustment.' }), pageObject({ tool: pageChoice(tools) }, ['tool'])),
    ...(paint.length > 1 ? [pageAction('image_editor.layer_select', t({ ko: '레이어 선택', en: 'Select layer' }), t({ ko: '칠하기와 선택 명령이 이 레이어에 적용돼.', en: 'Painting and selection commands act on this layer.' }), pageObject({ layerId: pageChoice(paint.map((layer) => layer.id)) }, ['layerId']))] : []),
    pageAction('image_editor.brush', t({ ko: '브러시 설정', en: 'Brush settings' }), t({ ko: '하나 이상 지정해. color는 #RRGGBB이고 텍스트 색도 따라가.', en: 'Give at least one. color is #RRGGBB; text fill follows it.' }), pageObject({ size: pageNumber(1, 1000, true), opacity: pageNumber(0.01, 1), color: pageText(7) })),
    pageAction('image_editor.layer', t({ ko: '레이어 표시·잠금', en: 'Layer visibility and lock' }), t({ ko: '레이어(마스크 포함)를 보이거나 숨기고 잠가. 숨기기는 실행 취소 기록에 남아.', en: 'Show/hide or lock a layer (the mask too). Hiding is an undo step.' }), pageObject({ layerId: pageChoice(layerIds), visible: { type: 'boolean' }, locked: { type: 'boolean' } }, ['layerId'])),
    pageAction('image_editor.crop', t({ ko: '자르기 비율', en: 'Crop ratio' }), t({ ko: '자르는 중이면 상자를 그 비율로 맞춰.', en: 'While cropping, the box takes this ratio.' }), pageObject({ ratio: pageChoice(CROP_RATIOS) }, ['ratio'])),
    ...(snapshot.cropping ? [pageAction('image_editor.crop_apply', t({ ko: '자르기 적용·취소', en: 'Apply or cancel crop' }), t({ ko: '현재 자르기 상자로 문서를 자르거나 자르기를 끝내.', en: 'Crop the document to the current box, or leave cropping.' }), pageObject({ op: pageChoice(['apply', 'cancel']) }, ['op']))] : []),
    ...(history.length ? [pageAction('image_editor.history', t({ ko: '실행 취소·다시 실행', en: 'Undo or redo' }), t({ ko: '편집기의 실행 취소 기록을 한 단계 움직여.', en: 'Move one step in the editor history.' }), pageObject({ step: pageChoice(history) }, ['step']))] : []),
    pageAction('image_editor.transform', t({ ko: '회전·뒤집기', en: 'Rotate or flip' }), t({ ko: '모든 레이어를 90° 회전하거나 뒤집어. 선택은 풀려.', en: 'Rotate every layer 90° or flip it; clears the selection.' }), pageObject({ op: pageChoice(TRANSFORMS) }, ['op'])),
    pageAction('image_editor.selection', t({ ko: '선택 영역', en: 'Selection' }), t({ ko: 'delete는 선택한 픽셀을 활성 레이어(마스크 도구면 마스크)에서 지워.', en: 'delete erases the selected pixels from the active layer (the mask with a mask tool).' }), pageObject({ op: pageChoice(selection) }, ['op'])),
    ...(mask.length ? [pageAction('image_editor.mask', t({ ko: '마스크 편집', en: 'Edit mask' }), t({ ko: '선택 영역을 마스크에 칠하거나 빼고, 마스크를 반전하거나 비워.', en: 'Paint or remove the selection in the mask, invert or clear the mask.' }), pageObject({ op: pageChoice(mask) }, ['op']))] : []),
    pageAction('image_editor.save', t({ ko: '편집 결과 저장', en: 'Save the edit' }), t({ ko: '편집기의 저장 버튼과 같아. 보이는 레이어를 합쳐 이 편집기를 연 곳에 넘겨.', en: 'Same as the editor\'s Save: merges the visible layers and hands them to whatever opened the editor.' }), undefined, 'save'),
  ]

  const data: Record<string, ChatPageData> = {
    document: { fileName: pageFreeText(fileName.slice(0, 200)), width: snapshot.width, height: snapshot.height, status: snapshot.status, error: snapshot.error ? pageFreeText(snapshot.error.slice(0, 300)) : null, saving },
    tool: snapshot.tool,
    brush: { size: snapshot.brushSize, opacity: snapshot.brushOpacity, color: snapshot.brushColor },
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
  }

  const applyAction = async (id: string, args: Record<string, ChatPageData>, assertCurrent: () => void): Promise<WorkflowUndo | void> => {
    assertCurrent()
    if (!engine || engine.getSnapshot().status !== 'ready' || saving) throw new Error('이미지 편집기가 준비되지 않았거나 저장 중이야.')
    const now = engine.getSnapshot()
    switch (id) {
      case 'image_editor.tool': engine.setTool(args.tool as EditorTool); return
      case 'image_editor.layer_select': engine.setActiveLayer(String(args.layerId)); return
      case 'image_editor.brush': {
        const color = typeof args.color === 'string' ? args.color : undefined
        if (color !== undefined && !HEX.test(color)) throw new Error('color는 #RRGGBB 형식이어야 해.')
        if (args.size === undefined && args.opacity === undefined && color === undefined) throw new Error('size, opacity, color 중 하나 이상 지정해줘.')
        const before = { size: now.brushSize, opacity: now.brushOpacity, color: now.brushColor }
        if (typeof args.size === 'number') engine.setBrushSize(args.size)
        if (typeof args.opacity === 'number') engine.setBrushOpacity(args.opacity)
        if (color !== undefined) engine.setBrushColor(color)
        const after = { size: typeof args.size === 'number' ? args.size : before.size, opacity: typeof args.opacity === 'number' ? args.opacity : before.opacity, color: color ?? before.color }
        return {
          isCurrent: () => { const live = engine.getSnapshot(); return live.brushSize === after.size && live.brushOpacity === after.opacity && live.brushColor === after.color },
          restore: () => { engine.setBrushSize(before.size); engine.setBrushOpacity(before.opacity); engine.setBrushColor(before.color) },
        }
      }
      case 'image_editor.layer': {
        const layerId = String(args.layerId)
        const find = (shot: EditorSnapshot) => (shot.mask?.id === layerId ? shot.mask : shot.layers.find((layer) => layer.id === layerId && layer.kind === 'paint'))
        const layer = find(now)
        if (!layer) throw new Error('그 레이어가 없어. 지금 화면을 다시 읽어줘.')
        if (typeof args.visible !== 'boolean' && typeof args.locked !== 'boolean') throw new Error('visible 또는 locked를 지정해줘.')
        const before = { visible: layer.visible, locked: layer.locked }
        const after = { visible: typeof args.visible === 'boolean' ? args.visible : before.visible, locked: typeof args.locked === 'boolean' ? args.locked : before.locked }
        if (after.visible !== before.visible) engine.setLayerVisible(layerId, after.visible)
        if (after.locked !== before.locked) engine.setLayerLocked(layerId, after.locked)
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
        else engine.flip(args.op === 'flip_x' ? 'x' : 'y')
        return
      case 'image_editor.selection':
        if (args.op === 'select_all') engine.selectAll()
        else if (args.op === 'clear') engine.clearSelection()
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
    localRevision: JSON.stringify([snapshot.layers.map((layer) => `${layer.id}:${layer.version}`), snapshot.mask?.version ?? null, snapshot.adjust, snapshot.textEditing ? snapshot.textStyle : null, engine?.floatingScreenBox() ?? null]),
    apply: () => {},
    applyAction,
  } : null)
}
