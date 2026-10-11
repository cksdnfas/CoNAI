import { useEffect, useRef, type RefObject } from 'react'
import type { EditorEngine, EditorTool } from '../engine/editor-engine'

const TOOL_KEYS: Record<string, EditorTool> = {
  h: 'hand',
  s: 'select',
  l: 'lasso',
  b: 'brush',
  e: 'eraser',
  i: 'eyedropper',
  t: 'text',
  c: 'crop',
}

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

/**
 * Editor keys, handled on `document` while the editor is open so nothing underneath (the image viewer) reacts too.
 * Keys typed into a field (layer rename, text on the stage) are left alone, apart from Esc and Ctrl+Enter.
 */
export function useEditorShortcuts({
  open,
  engine,
  rootRef,
  maskEnabled,
  onRequestClose,
  onSave,
  onCopy,
}: {
  open: boolean
  engine: EditorEngine | null
  rootRef: RefObject<HTMLElement | null>
  maskEnabled: boolean
  onRequestClose: () => void
  onSave: () => void
  onCopy: (piece: HTMLCanvasElement | null) => void
}) {
  const handlers = useRef({ onRequestClose, onSave, onCopy })
  useEffect(() => {
    handlers.current = { onRequestClose, onSave, onCopy }
  }, [onCopy, onRequestClose, onSave])

  useEffect(() => {
    if (!open || !engine) return

    const ownsEvent = (event: Event) => {
      const target = event.target
      if (!(target instanceof Node)) return true
      return target === document.body || Boolean(rootRef.current?.contains(target))
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!ownsEvent(event) || event.defaultPrevented) return
      const typing = isTypingTarget(event.target)
      const key = event.key.toLowerCase()
      const mod = event.ctrlKey || event.metaKey
      const consume = () => {
        event.preventDefault()
        event.stopPropagation()
      }

      if (key === 'escape') {
        consume()
        // Esc while typing on the stage keeps the text; ✕ is the way to throw it away.
        if (engine.getSnapshot().textEditing) {
          engine.commitTextEdit()
          return
        }
        if (typing) {
          ;(event.target as HTMLElement).blur()
          return
        }
        if (!engine.cancelPending()) handlers.current.onRequestClose()
        return
      }
      if (mod && key === 's') {
        consume()
        if (!event.repeat) handlers.current.onSave()
        return
      }
      if (mod && key === 'enter' && engine.getSnapshot().textEditing) {
        consume()
        engine.commitTextEdit()
        return
      }
      if (typing) return

      if (mod) {
        if (key === 'z') {
          consume()
          if (event.shiftKey) engine.redo()
          else engine.undo()
        } else if (key === 'y') {
          consume()
          engine.redo()
        } else if (key === 'a') {
          consume()
          engine.selectAll()
        } else if (key === 'd') {
          consume()
          engine.clearSelection()
        } else if (key === 'c') {
          consume()
          handlers.current.onCopy(engine.copySelection())
        } else if (key === 'x') {
          consume()
          handlers.current.onCopy(engine.cutSelection())
        } else if (key === '0') {
          consume()
          engine.fitToView()
        } else if (key === '1') {
          consume()
          engine.zoomTo(1)
        } else if (key === '=' || key === '+') {
          consume()
          engine.zoomBy(1.25)
        } else if (key === '-') {
          consume()
          engine.zoomBy(0.8)
        }
        // Ctrl+V is left to the browser: the paste event carries the clipboard image.
        return
      }

      if (key === ' ') {
        consume()
        engine.setSpacePan(true)
        return
      }
      if (key === 'enter') {
        if (engine.confirmPending()) consume()
        return
      }
      if (key === 'delete' || key === 'backspace') {
        consume()
        engine.deleteSelection()
        return
      }
      if (key === '[' || key === ']') {
        consume()
        const size = engine.getSnapshot().brushSize
        const step = Math.max(1, Math.round(size * 0.15))
        engine.setBrushSize(key === '[' ? size - step : size + step)
        return
      }
      if (key === 'm') {
        if (!maskEnabled) return
        consume()
        engine.setTool(event.shiftKey ? 'mask-eraser' : 'mask')
        return
      }
      if (key === 'r') {
        if (!engine.getSnapshot().aiEraseAvailable || event.altKey || event.shiftKey) return
        consume()
        engine.setTool('ai-erase')
        return
      }
      if (event.altKey || event.shiftKey) return
      const tool = TOOL_KEYS[key]
      if (tool) {
        consume()
        engine.setTool(tool)
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ') engine.setSpacePan(false)
    }
    const handleBlur = () => engine.setSpacePan(false)

    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', handleBlur)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', handleBlur)
    }
  }, [engine, maskEnabled, open, rootRef])
}
