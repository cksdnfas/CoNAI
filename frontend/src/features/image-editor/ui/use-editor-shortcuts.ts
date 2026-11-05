import { useEffect, useRef, type RefObject } from 'react'
import { isTypingTarget } from '@/lib/keyboard-shortcut'
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
      if (target instanceof Element && target.closest('[data-chat-dock]')) return false
      if (!(target instanceof Node)) return true
      return target === document.body || Boolean(rootRef.current?.contains(target))
    }
    let spacePanHeld = false
    let compareHeld = false

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!ownsEvent(event) || event.defaultPrevented) return
      const typing = isTypingTarget(event)
      const key = event.key.toLowerCase()
      const mod = event.ctrlKey || event.metaKey
      const target = event.target instanceof Element ? event.target : null
      const navigationKey = key.startsWith('arrow') || ['home', 'end', 'pageup', 'pagedown'].includes(key)
      if (navigationKey && target?.closest('[role="slider"], [role="menu"], [role^="menuitem"], [role="tab"], [role="tablist"], [role="listbox"], [role="combobox"]')) return
      if (!mod && key === 'enter' && target?.closest('button, a[href], [role="option"], [role^="menuitem"], [role="tab"]')) return
      // Space pans even after a toolbar button retained focus; menu/option/tab activation stays native.
      if (!mod && key === ' ' && target?.closest('[role="option"], [role^="menuitem"], [role="tab"]')) return
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

      if (key === '\\') {
        consume()
        compareHeld = true
        engine.setCompare(true, true)
        return
      }
      if (key === '?') {
        consume()
        engine.setShortcutsOpen(true)
        return
      }
      if (key.startsWith('arrow')) {
        consume()
        const step = event.shiftKey ? 10 : 1
        engine.nudge(key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0, key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0)
        return
      }
      if (event.altKey && key === 'backspace') {
        consume()
        engine.fillSelection()
        return
      }

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
        spacePanHeld = true
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
      if (event.key === ' ' && spacePanHeld) {
        event.preventDefault()
        event.stopPropagation()
        spacePanHeld = false
        engine.setSpacePan(false)
      }
      if (event.key === '\\' && compareHeld) {
        compareHeld = false
        engine.setCompare(false, true)
      }
    }
    // React and portaled dialogs handle keys first; the viewer listens on window.
    // This also contains save-options keys, whose portal is outside rootRef.
    const containUnhandled = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('[data-chat-dock]')) return
      const portaledControl = target?.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')
      if (ownsEvent(event) || portaledControl) event.stopPropagation()
    }
    const handleBlur = () => {
      spacePanHeld = false
      compareHeld = false
      engine.setSpacePan(false)
      engine.setCompare(false, true)
    }

    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('keyup', handleKeyUp, true)
    document.addEventListener('keydown', containUnhandled)
    document.addEventListener('keyup', containUnhandled)
    window.addEventListener('blur', handleBlur)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('keyup', handleKeyUp, true)
      document.removeEventListener('keydown', containUnhandled)
      document.removeEventListener('keyup', containUnhandled)
      window.removeEventListener('blur', handleBlur)
    }
  }, [engine, maskEnabled, open, rootRef])
}
