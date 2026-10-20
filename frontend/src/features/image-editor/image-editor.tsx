import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useOverlayBackClose } from '@/components/ui/use-overlay-back-close'
import { useI18n } from '@/i18n'
import { inpaintImageRegion } from '@/lib/api-images'
import { lockBodyScroll } from '@/lib/body-scroll-lock'
import { EditorEngine, type EditorSnapshot } from './engine/editor-engine'
import { canvasToBlob } from './engine/raster'
import { DEFAULT_TEXT_STYLE } from './engine/text'
import { EditorShell } from './ui/editor-shell'
import { useEditorShortcuts } from './ui/use-editor-shortcuts'
import { useImageEditorChatPage } from './use-image-editor-chat-page'

export type ImageEditorResult = {
  /** Every visible layer merged, PNG at document size. */
  source: Blob
  /** Black background, white where masked (only when mask editing is on). */
  mask?: Blob
}

export type ImageEditorProps = {
  open: boolean
  sourceUrl?: string | null
  sourceFileName?: string
  maskUrl?: string | null
  enableMaskEditing?: boolean
  /** Offer AI erase (runs on the server's AI runtime; needs the image edit permission). */
  enableAiErase?: boolean
  onClose: () => void
  /** Resolve when the result is stored; the editor stays open (showing "saving") until then. Throw to keep it open. */
  onSave: (result: ImageEditorResult) => void | Promise<void>
}

const EMPTY_SNAPSHOT: EditorSnapshot = {
  status: 'idle',
  error: null,
  width: 0,
  height: 0,
  tool: 'brush',
  brushSize: 24,
  brushOpacity: 1,
  brushColor: '#ffffff',
  layers: [],
  mask: null,
  activeLayerId: null,
  zoom: 1,
  canUndo: false,
  canRedo: false,
  dirty: false,
  hasSelection: false,
  floating: false,
  cropRatio: 'free',
  cropping: false,
  pressure: true,
  textStyle: DEFAULT_TEXT_STYLE,
  textEditing: false,
  aiEraseAvailable: false,
  aiErasing: false,
  adjust: null,
}

/** Per-browser preference: pen pressure on or off. */
const PRESSURE_STORAGE_KEY = 'conai.image-editor.pressure'

function readPressurePreference() {
  try {
    return window.localStorage.getItem(PRESSURE_STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

const noSubscribe = () => () => {}
const emptySnapshot = () => EMPTY_SNAPSHOT

/** Full-screen image editor: layers, brush, eraser, mask, selection, crop. Mounted only while open. */
export function ImageEditor(props: ImageEditorProps) {
  if (!props.open || !props.sourceUrl) return null
  return <ImageEditorSurface {...props} sourceUrl={props.sourceUrl} />
}

function ImageEditorSurface({ sourceUrl, sourceFileName, maskUrl, enableMaskEditing = false, enableAiErase = false, onClose, onSave }: ImageEditorProps & { sourceUrl: string }) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const stageRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [engine, setEngine] = useState<EditorEngine | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const askingRef = useRef(false)
  /** True right after this editor wrote its own copy to the system clipboard. */
  const ownClipboardRef = useRef(false)
  const snapshot = useSyncExternalStore(engine?.subscribe ?? noSubscribe, engine?.getSnapshot ?? emptySnapshot)

  useLayoutEffect(() => {
    const host = stageRef.current
    if (!host) return
    const created = new EditorEngine(host)
    created.setPressure(readPressurePreference())
    // The engine owns the stage DOM; React only learns about it once it exists.
    setEngine(created)
    return () => {
      created.dispose()
      setEngine(null)
    }
  }, [])

  useEffect(() => {
    if (!engine) return
    void engine.load({
      sourceUrl,
      maskUrl,
      maskEnabled: enableMaskEditing,
      names: {
        original: t({ ko: '원본', en: 'Original' }),
        layer: t({ ko: '레이어', en: 'Layer' }),
        paste: t({ ko: '붙여넣기', en: 'Paste' }),
        aiErase: t({ ko: 'AI 지우기', en: 'AI erase' }),
      },
    })
  }, [enableMaskEditing, engine, maskUrl, sourceUrl, t])

  useEffect(() => {
    engine?.setInpaintHandler(enableAiErase ? inpaintImageRegion : null)
  }, [enableAiErase, engine])

  useEffect(() => {
    try {
      window.localStorage.setItem(PRESSURE_STORAGE_KEY, snapshot.pressure ? '1' : '0')
    } catch {
      // Private mode: the toggle still works for this session.
    }
  }, [snapshot.pressure])

  useEffect(() => {
    if (!engine) return
    return engine.onNotice((notice, detail) => {
      if (notice === 'locked') showSnackbar({ message: t({ ko: '잠겼거나 숨긴 레이어에는 그릴 수 없어', en: 'That layer is locked or hidden' }), tone: 'info' })
      else if (notice === 'no-selection') showSnackbar({ message: t({ ko: '먼저 영역을 선택해', en: 'Select an area first' }), tone: 'info' })
      else if (notice === 'ai-busy') showSnackbar({ message: t({ ko: '지우는 중이야. 끝나면 다시 칠해', en: 'Still erasing — paint again when it finishes' }), tone: 'info' })
      else if (notice === 'ai-failed') showSnackbar({ message: detail || t({ ko: 'AI 지우기에 실패했어', en: 'AI erase failed' }), tone: 'error' })
    })
  }, [engine, showSnackbar, t])

  useEffect(() => lockBodyScroll(), [])

  // Shortcuts only answer keys aimed at the editor: take focus from the button that opened it, hand it back on close.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    rootRef.current?.focus({ preventScroll: true })
    return () => opener?.focus({ preventScroll: true })
  }, [])

  const requestClose = useCallback(() => {
    if (savingRef.current || askingRef.current) return
    if (!engine?.isDirty) {
      onClose()
      return
    }
    askingRef.current = true
    void confirm({
      title: t({ ko: '편집 내용 버리기', en: 'Discard edits' }),
      description: t({ ko: '저장하지 않은 편집 내용이 사라져. 닫을까?', en: 'Unsaved edits will be discarded. Close the editor?' }),
      confirmLabel: t({ ko: '버리고 닫기', en: 'Discard' }),
      cancelLabel: t({ ko: '계속 편집', en: 'Keep editing' }),
      tone: 'destructive',
    }).then((discard) => {
      askingRef.current = false
      if (discard) onClose()
    })
  }, [confirm, engine, onClose, t])

  useOverlayBackClose({ open: true, onClose: requestClose })

  /** Resolves true once onSave finished; a connected chat's reviewed save reports false as a failure. */
  const handleSave = useCallback(async () => {
    if (!engine || savingRef.current || engine.getSnapshot().status !== 'ready') return false
    savingRef.current = true
    setSaving(true)
    try {
      const result = await engine.export()
      await onSave(result)
      return true
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '편집 결과를 저장하지 못했어', en: 'Could not save the edit' }), tone: 'error' })
      return false
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [engine, onSave, showSnackbar, t])

  const handleCopy = useCallback((piece: HTMLCanvasElement | null) => {
    if (!piece || typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return
    void canvasToBlob(piece)
      .then((blob) => navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]))
      .then(() => {
        ownClipboardRef.current = true
      })
      .catch(() => {
        // The internal clipboard still works for pasting inside the editor.
      })
  }, [])

  useEditorShortcuts({ open: true, engine, rootRef, maskEnabled: enableMaskEditing, onRequestClose: requestClose, onSave: () => void handleSave(), onCopy: handleCopy })

  const fileName = sourceFileName ?? t({ ko: '이미지', en: 'Image' })
  useImageEditorChatPage({ engine, snapshot, fileName, saving, save: handleSave })

  // Paste: our own copy goes back where it came from; anything else arrives centred as a floating piece.
  useEffect(() => {
    if (!engine) return
    const handlePaste = (event: ClipboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      const file = Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith('image/'))?.getAsFile()
      event.preventDefault()
      if (ownClipboardRef.current || !file) {
        if (engine.pasteInternal()) return
      }
      if (file) void engine.pasteImage(file)
    }
    const handleBlur = () => {
      ownClipboardRef.current = false
    }
    document.addEventListener('paste', handlePaste)
    window.addEventListener('blur', handleBlur)
    return () => {
      document.removeEventListener('paste', handlePaste)
      window.removeEventListener('blur', handleBlur)
    }
  }, [engine])

  return createPortal(
    <>
      <EditorShell
        engine={engine}
        snapshot={snapshot}
        stageRef={stageRef}
        rootRef={rootRef}
        fileName={fileName}
        maskEnabled={enableMaskEditing}
        saving={saving}
        onRequestClose={requestClose}
        onSave={() => void handleSave()}
        onCopy={handleCopy}
        onImportImage={() => fileInputRef.current?.click()}
        onDropFile={(file) => void engine?.pasteImage(file)}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void engine?.pasteImage(file)
        }}
      />
    </>,
    document.body,
  )
}

export default ImageEditor
