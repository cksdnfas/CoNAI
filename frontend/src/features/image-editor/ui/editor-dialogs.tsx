import { useState } from 'react'
import { Lock, LockOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Chip } from '@/components/ui/chip'
import { Text } from '@/components/ui/text'
import { ListRow } from '@/components/ui/list-row'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { useI18n } from '@/i18n'
import type { EditorEngine, EditorSnapshot } from '../engine/editor-engine'
import { clampDocumentSize, RESIZE_LIMITS } from '../engine/resize'

export const EDITOR_SHORTCUTS = [
  { key: 'H / S / L', ko: '손 / 사각 선택 / 올가미', en: 'Hand / rectangle / lasso' },
  { key: 'B / E / I / T / C', ko: '브러시 / 지우개 / 스포이드 / 텍스트 / 자르기', en: 'Brush / eraser / eyedropper / text / crop' },
  { key: 'M / Shift+M / R', ko: '마스크 / 마스크 지우개 / AI 지우기', en: 'Mask / mask eraser / AI erase' },
  { key: 'Ctrl+S', ko: '저장', en: 'Save' },
  { key: 'Ctrl+Z / Ctrl+Shift+Z', ko: '실행 취소 / 다시 실행 (실행 취소는 떠 있는 조각을 먼저 버려)', en: 'Undo / redo (undo discards a floating piece first)' },
  { key: 'Ctrl+A / Ctrl+D', ko: '전체 선택 / 선택 해제', en: 'Select all / deselect' },
  { key: 'Ctrl+C / X / V', ko: '복사 / 잘라내기 / 붙여넣기', en: 'Copy / cut / paste' },
  { key: 'Delete', ko: '선택 영역 지우기 (떠 있는 조각은 버려)', en: 'Erase selection (discards a floating piece)' },
  { key: 'Alt+Backspace', ko: '선택 영역을 브러시 색으로 채우기', en: 'Fill selection with brush color' },
  { key: '← ↑ ↓ → / Shift', ko: '선택 영역·조각 1px / 10px 이동', en: 'Move selection or piece by 1px / 10px' },
  { key: 'Shift+click', ko: '마지막 획 끝에서 직선 그리기', en: 'Draw a straight line from the last stroke end' },
  { key: 'Alt+click', ko: '브러시·지우개에서 색 고르기', en: 'Pick a color with brush or eraser' },
  { key: '[ / ]', ko: '브러시 작게 / 크게', en: 'Smaller / larger brush' },
  { key: 'Space+drag', ko: '화면 이동', en: 'Pan' },
  { key: 'Ctrl+0 / Ctrl+1', ko: '화면 맞춤 / 100%', en: 'Fit / 100%' },
  { key: 'Ctrl+- / Ctrl++ / Wheel', ko: '축소 / 확대 / 휠 확대·축소', en: 'Zoom out / in / wheel zoom' },
  { key: 'Enter / Ctrl+Enter', ko: '조각·자르기·AI 지우기 적용 / 텍스트 적용', en: 'Apply piece, crop or AI erase / apply text' },
  { key: 'Esc', ko: '현재 작업 취소 / 닫기 (텍스트는 적용)', en: 'Cancel pending action / close (text is kept)' },
  { key: '\\', ko: '누르는 동안 원본 비교', en: 'Hold to compare original' },
  { key: '?', ko: '단축키 보기', en: 'Show shortcuts' },
]

function ResizeDialog({ engine, snapshot }: { engine: EditorEngine; snapshot: EditorSnapshot }) {
  const { t } = useI18n()
  const [width, setWidth] = useState(String(snapshot.width))
  const [height, setHeight] = useState(String(snapshot.height))
  const [locked, setLocked] = useState(true)
  const [ratio, setRatio] = useState(snapshot.width / snapshot.height)
  const valid = Number.isSafeInteger(Number(width)) && Number.isSafeInteger(Number(height)) && Number(width) > 0 && Number(height) > 0
  const willShrink = valid && (Number(width) > RESIZE_LIMITS.dimension || Number(height) > RESIZE_LIMITS.dimension || Number(width) * Number(height) > RESIZE_LIMITS.pixels)
  const close = () => engine.setResizeOpen(false)
  const change = (value: string, horizontal: boolean) => {
    if (horizontal) setWidth(value)
    else setHeight(value)
    if (locked && Number(value) > 0) {
      const other = String(Math.max(1, Math.round(horizontal ? Number(value) / ratio : Number(value) * ratio)))
      if (horizontal) setHeight(other)
      else setWidth(other)
    }
  }
  return (
    <Modal open onClose={close} title={t({ ko: '이미지 크기', en: 'Image size' })} size="sm">
      <form onSubmit={(event) => {
        event.preventDefault()
        const size = clampDocumentSize(Number(width), Number(height))
        if (!size) return
        engine.resizeDocument(size.width, size.height)
        close()
      }}>
        <ModalBody>
          <Field label={t({ ko: '너비 (px)', en: 'Width (px)' })}>
            <Input type="number" min={1} step={1} value={width} onChange={(event) => change(event.target.value, true)} />
          </Field>
          <Field label={t({ ko: '높이 (px)', en: 'Height (px)' })}>
            <Input type="number" min={1} step={1} value={height} onChange={(event) => change(event.target.value, false)} />
          </Field>
          {willShrink ? <Text variant="caption" tone="warning">{t({ ko: '적용하면 브라우저 한도에 맞춰 줄여. 한 변 최대 {side}px, 전체 최대 {pixels}픽셀이야.', en: 'Applying will shrink the result to the browser limit: {side}px per side and {pixels} total pixels.' }, { side: RESIZE_LIMITS.dimension, pixels: RESIZE_LIMITS.pixels })}</Text> : null}
          <IconButton active={locked} variant="ghost" label={t({ ko: '비율 잠금', en: 'Lock aspect ratio' })} onClick={() => {
            if (!locked && valid) setRatio(Number(width) / Number(height))
            setLocked(!locked)
          }}>{locked ? <Lock /> : <LockOpen />}</IconButton>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={close}>{t({ ko: '취소', en: 'Cancel' })}</Button>
          <Button type="submit" disabled={!valid}>{t({ ko: '적용', en: 'Apply' })}</Button>
        </ModalFooter>
      </form>
    </Modal>
  )
}

export function EditorDialogs({ engine, snapshot }: { engine: EditorEngine; snapshot: EditorSnapshot }) {
  const { t } = useI18n()
  return (
    <>
      {snapshot.resizeOpen ? <ResizeDialog engine={engine} snapshot={snapshot} /> : null}
      <Modal open={snapshot.shortcutsOpen} onClose={() => engine.setShortcutsOpen(false)} title={t({ ko: '단축키', en: 'Shortcuts' })} size="md">
        <ModalBody spacing="none">
          <Text variant="caption">{t({ ko: 'Mac에서는 Ctrl 대신 ⌘를 써. 선택 안쪽을 끌면 픽셀을 들어서 옮겨.', en: 'Use ⌘ instead of Ctrl on Mac. Drag inside a selection to lift its pixels.' })}</Text>
          {EDITOR_SHORTCUTS.map((item) => (
            <ListRow key={item.key} leading={<Chip asChild mono size="sm" tone="muted"><kbd>{item.key}</kbd></Chip>}>{t(item)}</ListRow>
          ))}
        </ModalBody>
      </Modal>
    </>
  )
}
