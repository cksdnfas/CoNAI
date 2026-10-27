import { useEffect, useRef, useState } from 'react'
import { FlipHorizontal, LoaderCircle, RotateCcw, RotateCw } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Slider } from '@/components/ui/slider'
import { useI18n } from '@/i18n'
import { APP_NAME } from '@/lib/app-metadata'
import type { AppIconSource } from './appearance-tab.types'
import { CHAT_DOCK_INSET, useSettingsEditorChatPage } from './use-settings-editor-chat-page'

const OUTPUT_SIZE = 128
const DEFAULT_EDIT = { mode: 'contain', zoom: 1, x: 0, y: 0, rotation: 0, flip: false }
type IconEdit = typeof DEFAULT_EDIT
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** Preview and export share the same crop; only the CSS preview has a checkerboard. */
function drawIcon(canvas: HTMLCanvasElement, image: ImageBitmap, edit: IconEdit, size: number) {
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable')
  const sideways = edit.rotation % 180 !== 0
  const width = sideways ? image.height : image.width
  const height = sideways ? image.width : image.height
  const scale = (edit.mode === 'cover' ? Math.max(size / width, size / height) : Math.min(size / width, size / height)) * edit.zoom
  context.imageSmoothingQuality = 'high'
  context.translate(size * (0.5 + edit.x), size * (0.5 + edit.y))
  context.rotate(edit.rotation * Math.PI / 180)
  context.scale(edit.flip ? -1 : 1, 1)
  context.drawImage(image, -image.width * scale / 2, -image.height * scale / 2, image.width * scale, image.height * scale)
  return context
}

export function AppIconEditor({ source, isSaving, onRegister, onClose }: {
  source: AppIconSource
  isSaving: boolean
  onRegister: (dataUrl: string) => Promise<void>
  onClose: () => void
}) {
  const { t } = useI18n()
  const title = t({ ko: '앱 마크 편집', en: 'Edit app mark' })
  const [image, setImage] = useState<ImageBitmap | null>(null)
  const [edit, setEdit] = useState<IconEdit>({ ...DEFAULT_EDIT })
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const stageRef = useRef<HTMLCanvasElement | null>(null)
  const previewRef = useRef<HTMLCanvasElement | null>(null)
  const savingRef = useRef(false)
  const dragRef = useRef<{ pointerId: number; x: number; y: number; edit: IconEdit } | null>(null)

  useEffect(() => {
    let active = true
    let bitmap: ImageBitmap | null = null
    setImage(null)
    setLoadError(null)
    const loaded = new Image()
    loaded.src = source.url
    void loaded.decode().then(async () => {
      if (!active) return
      if (loaded.naturalWidth * loaded.naturalHeight > 16_000_000) {
        setLoadError(t({ ko: '1,600만 화소 이하의 이미지를 골라줘.', en: 'Choose an image with at most 16 million pixels.' }))
        return
      }
      // Freeze animations so the saved pixels match the preview even after waiting or dragging.
      bitmap = await createImageBitmap(loaded)
      if (!active) { bitmap.close(); return }
      setImage(bitmap)
      loaded.src = ''
    }).catch(() => {
      if (active) setLoadError(t({ ko: '이미지를 열지 못했어. 다른 이미지로 다시 골라줘.', en: 'Could not open the image. Choose another image.' }))
    })
    return () => { active = false; bitmap?.close(); loaded.src = '' }
  }, [source.url, t])

  useEffect(() => {
    if (!image) return
    if (stageRef.current) drawIcon(stageRef.current, image, edit, 320)
    if (previewRef.current) drawIcon(previewRef.current, image, edit, OUTPUT_SIZE)
  }, [image, edit])

  const handleRegister = async () => {
    if (!image || isSaving || savingRef.current) throw new Error(t({ ko: '이미지가 준비될 때까지 기다려줘.', en: 'Wait until the image is ready.' }))
    savingRef.current = true
    setSaveError(null)
    try {
      const canvas = document.createElement('canvas')
      const context = drawIcon(canvas, image, edit, OUTPUT_SIZE)
      const pixels = context.getImageData(0, 0, OUTPUT_SIZE, OUTPUT_SIZE).data
      if (!pixels.some((value, index) => index % 4 === 3 && value > 0)) {
        throw new Error(t({ ko: '선택한 영역이 전부 투명이야. 이미지 위치나 확대를 조절해줘.', en: 'The selected area is fully transparent. Adjust the position or zoom.' }))
      }
      await onRegister(canvas.toDataURL('image/png'))
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t({ ko: '앱 마크를 저장하지 못했어. 다시 등록해줘.', en: 'Could not save the app mark. Try registering it again.' }))
      throw error
    } finally {
      savingRef.current = false
    }
  }

  useSettingsEditorChatPage({
    open: true, title, resourceId: `app-mark:${source.id}`, dirty: true,
    fields: [
      { id: 'mode', label: t({ ko: '전체 넣기 / 영역 자르기', en: 'Fit / crop' }), type: 'select', value: edit.mode, options: ['contain', 'cover'] },
      { id: 'zoom', label: t({ ko: '확대', en: 'Zoom' }), type: 'number', value: edit.zoom, min: 0.25, max: 4 },
      { id: 'x', label: t({ ko: '가로 위치', en: 'Horizontal position' }), type: 'number', value: edit.x, min: -1, max: 1 },
      { id: 'y', label: t({ ko: '세로 위치', en: 'Vertical position' }), type: 'number', value: edit.y, min: -1, max: 1 },
      { id: 'rotation', label: t({ ko: '회전', en: 'Rotation' }), type: 'select', value: String(edit.rotation), options: ['0', '90', '180', '270'] },
      { id: 'flip', label: t({ ko: '좌우 반전', en: 'Flip horizontally' }), type: 'boolean', value: edit.flip },
    ],
    data: { image: { width: image?.width ?? null, height: image?.height ?? null }, output: { size: OUTPUT_SIZE, format: 'PNG', transparency: 'preserved' }, status: loadError ? 'failed' : image ? 'ready' : 'loading' },
    apply: (patch) => {
      if (isSaving || savingRef.current) throw new Error(t({ ko: '등록 중에는 편집할 수 없어.', en: 'Cannot edit while registering.' }))
      setEdit((value) => ({
        ...value,
        ...(patch.mode === 'contain' || patch.mode === 'cover' ? { mode: patch.mode } : {}),
        ...(typeof patch.zoom === 'number' ? { zoom: clamp(patch.zoom, 0.25, 4) } : {}),
        ...(typeof patch.x === 'number' ? { x: clamp(patch.x, -1, 1) } : {}),
        ...(typeof patch.y === 'number' ? { y: clamp(patch.y, -1, 1) } : {}),
        ...(typeof patch.rotation === 'string' && ['0', '90', '180', '270'].includes(patch.rotation) ? { rotation: Number(patch.rotation) } : {}),
        ...(typeof patch.flip === 'boolean' ? { flip: patch.flip } : {}),
      }))
    },
    save: image && !isSaving ? handleRegister : undefined,
  })

  const register = () => { void handleRegister().catch(() => {}) }
  const disabled = !image || isSaving
  return (
    <Modal open title={title} onClose={() => { if (!savingRef.current && !isSaving) onClose() }} onSave={disabled ? undefined : register} size="md" sidePanelInset={CHAT_DOCK_INSET}>
      <ModalBody>
        <div
          role="application" tabIndex={disabled ? -1 : 0}
          aria-label={t({ ko: '자르기 영역: 드래그하거나 방향키로 위치 이동', en: 'Crop area: drag or use arrow keys to move' })}
          className="bg-checker relative mx-auto aspect-square w-72 max-w-full touch-none overflow-hidden rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40 cursor-grab active:cursor-grabbing"
          onPointerDown={(event) => {
            if (disabled || event.button !== 0) return
            event.currentTarget.setPointerCapture(event.pointerId)
            dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, edit }
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current
            if (!drag || drag.pointerId !== event.pointerId || disabled) return
            const side = event.currentTarget.getBoundingClientRect().width
            setEdit({ ...drag.edit, x: clamp(drag.edit.x + (event.clientX - drag.x) / side, -1, 1), y: clamp(drag.edit.y + (event.clientY - drag.y) / side, -1, 1) })
          }}
          onPointerUp={() => { dragRef.current = null }} onPointerCancel={() => { dragRef.current = null }} onLostPointerCapture={() => { dragRef.current = null }}
          onKeyDown={(event) => {
            if (disabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
            event.preventDefault()
            const step = event.shiftKey ? 0.05 : 0.01
            setEdit((value) => ({ ...value, x: clamp(value.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), -1, 1), y: clamp(value.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0), -1, 1) }))
          }}
        >
          <canvas ref={stageRef} className="block size-full" aria-hidden />
          {!image && !loadError ? <div className="absolute inset-0 flex items-center justify-center"><LoaderCircle className="size-6 animate-spin text-muted-foreground" aria-label={t({ ko: '이미지 불러오는 중', en: 'Loading image' })} /></div> : null}
        </div>
        <SegmentedControl fullWidth value={edit.mode} ariaLabel={t({ ko: '자르기 방식', en: 'Crop mode' })} items={[
          { value: 'contain', label: t({ ko: '전체 넣기', en: 'Fit whole image' }), disabled },
          { value: 'cover', label: t({ ko: '영역 자르기', en: 'Crop area' }), disabled },
        ]} onChange={(mode) => setEdit((value) => ({ ...value, mode, zoom: 1, x: 0, y: 0 }))} />
        <div className="flex items-center gap-3">
          <span className="shrink-0 text-sm text-muted-foreground">{t({ ko: '확대', en: 'Zoom' })}</span>
          <Slider min={0.25} max={4} step={0.01} disabled={disabled} value={[edit.zoom]} onValueChange={([zoom]) => setEdit((value) => ({ ...value, zoom }))} aria-label={t({ ko: '확대', en: 'Zoom' })} />
          <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{Math.round(edit.zoom * 100)}%</span>
        </div>
        <div className="flex items-center gap-1">
          <IconButton variant="ghost" size="icon-sm" disabled={disabled} label={t({ ko: '왼쪽으로 90° 회전', en: 'Rotate left 90°' })} onClick={() => setEdit((value) => ({ ...value, rotation: (value.rotation + 270) % 360 }))}><RotateCcw /></IconButton>
          <IconButton variant="ghost" size="icon-sm" disabled={disabled} label={t({ ko: '오른쪽으로 90° 회전', en: 'Rotate right 90°' })} onClick={() => setEdit((value) => ({ ...value, rotation: (value.rotation + 90) % 360 }))}><RotateCw /></IconButton>
          <IconButton variant="ghost" size="icon-sm" disabled={disabled} active={edit.flip} label={t({ ko: '좌우 반전', en: 'Flip horizontally' })} onClick={() => setEdit((value) => ({ ...value, flip: !value.flip }))}><FlipHorizontal /></IconButton>
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setEdit({ ...DEFAULT_EDIT })}>{t({ ko: '편집 초기화', en: 'Reset edits' })}</Button>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
          <span className="text-xs text-muted-foreground">{t({ ko: '상단 표시 미리보기', en: 'Header preview' })}</span>
          <div className="flex items-center gap-3"><canvas ref={previewRef} className="size-8 rounded-sm" aria-label={t({ ko: '앱 마크 실제 크기 미리보기', en: 'App mark at actual display size' })} /><span className="text-lg font-bold tracking-tight">{APP_NAME}</span></div>
        </div>
        {loadError || saveError ? <div role="alert" className="text-sm text-destructive">{loadError ?? saveError}</div> : null}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" disabled={isSaving} onClick={onClose}>{t({ ko: '취소', en: 'Cancel' })}</Button>
        <Button disabled={disabled} onClick={register} aria-busy={isSaving || undefined}>
          {isSaving ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
          {isSaving ? t({ ko: '등록 중', en: 'Registering' }) : t({ ko: '등록', en: 'Register' })}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
