import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { ImageEditorCropRect, ImageEditorTool } from './image-editor-types'
import { clampImageEditorRect, normalizeImageEditorRect } from './image-editor-utils'

type ImageEditorSelectionClipboardLike = {
  imageDataUrl: string
  width: number
  height: number
  x: number
  y: number
  pasteCount: number
}

/** Register keyboard shortcuts for undo/redo, tool switching, selection actions, and rect nudging. */
export function useImageEditorKeyboardShortcuts({
  open,
  enableMaskEditing,
  documentSize,
  cropRect,
  selectionRect,
  selectionClipboardRef,
  queueHistoryCommit,
  setCropRect,
  setSelectionRect,
  setTool,
  setBrushSize,
  handleUndo,
  handleRedo,
  handleDeleteSelection,
  handleSelectionTransfer,
  handlePasteStoredSelection,
}: {
  open: boolean
  enableMaskEditing: boolean
  documentSize: { width: number; height: number }
  cropRect: ImageEditorCropRect | null
  selectionRect: ImageEditorCropRect | null
  selectionClipboardRef: MutableRefObject<ImageEditorSelectionClipboardLike | null>
  queueHistoryCommit: () => void
  setCropRect: Dispatch<SetStateAction<ImageEditorCropRect | null>>
  setSelectionRect: Dispatch<SetStateAction<ImageEditorCropRect | null>>
  setTool: Dispatch<SetStateAction<ImageEditorTool>>
  setBrushSize: Dispatch<SetStateAction<number>>
  handleUndo: () => void | Promise<void>
  handleRedo: () => void | Promise<void>
  handleDeleteSelection: () => void | Promise<void>
  handleSelectionTransfer: (mode: 'copy' | 'cut' | 'duplicate' | 'promote') => void | Promise<void>
  handlePasteStoredSelection: () => void
}) {
  useEffect(() => {
    if (!open) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTypingTarget = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if (isTypingTarget) {
        return
      }

      const lowerKey = event.key.toLowerCase()
      const isShortcutModifier = event.ctrlKey || event.metaKey
      if (isShortcutModifier && lowerKey === 'z' && !event.shiftKey) {
        event.preventDefault()
        void handleUndo()
        return
      }

      if (isShortcutModifier && (lowerKey === 'y' || (event.shiftKey && lowerKey === 'z'))) {
        event.preventDefault()
        void handleRedo()
        return
      }

      if (event.key === 'Escape') {
        if (cropRect) {
          event.preventDefault()
          setCropRect(null)
          setTool('brush')
          return
        }

        if (selectionRect) {
          event.preventDefault()
          setSelectionRect(null)
          return
        }
      }

      if (event.key === '[') {
        event.preventDefault()
        setBrushSize((current) => Math.max(1, current - 2))
        return
      }

      if (event.key === ']') {
        event.preventDefault()
        setBrushSize((current) => Math.min(256, current + 2))
        return
      }

      if (!isShortcutModifier) {
        if (lowerKey === 'h') {
          event.preventDefault()
          setTool('pan')
          return
        }

        if (lowerKey === 's') {
          event.preventDefault()
          setTool('select')
          return
        }

        if (lowerKey === 'b') {
          event.preventDefault()
          setTool('brush')
          return
        }

        if (lowerKey === 'e') {
          event.preventDefault()
          setTool('eraser')
          return
        }

        if (lowerKey === 'c') {
          event.preventDefault()
          setTool('crop')
          return
        }

        if (enableMaskEditing && lowerKey === 'm') {
          event.preventDefault()
          setTool(event.shiftKey ? 'mask-eraser' : 'mask-brush')
          return
        }
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const step = event.shiftKey ? 10 : 1
        const deltaX = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
        const deltaY = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0

        if (event.altKey) {
          if (cropRect) {
            event.preventDefault()
            setCropRect((current) => resizeRect(current, deltaX, deltaY, documentSize))
            queueHistoryCommit()
            return
          }

          if (selectionRect) {
            event.preventDefault()
            setSelectionRect((current) => resizeRect(current, deltaX, deltaY, documentSize))
            queueHistoryCommit()
            return
          }
        }

        if (cropRect) {
          event.preventDefault()
          setCropRect((current) => nudgeRect(current, deltaX, deltaY, documentSize))
          queueHistoryCommit()
          return
        }

        if (selectionRect) {
          event.preventDefault()
          setSelectionRect((current) => nudgeRect(current, deltaX, deltaY, documentSize))
          queueHistoryCommit()
          return
        }
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && selectionRect) {
        event.preventDefault()
        void handleDeleteSelection()
        return
      }

      if (isShortcutModifier && lowerKey === 'c' && selectionRect) {
        event.preventDefault()
        void handleSelectionTransfer('copy')
        return
      }

      if (isShortcutModifier && lowerKey === 'x' && selectionRect) {
        event.preventDefault()
        void handleSelectionTransfer('cut')
        return
      }

      if (isShortcutModifier && lowerKey === 'd' && selectionRect) {
        event.preventDefault()
        void handleSelectionTransfer('duplicate')
        return
      }

      if (isShortcutModifier && event.shiftKey && lowerKey === 'v' && selectionClipboardRef.current) {
        event.preventDefault()
        handlePasteStoredSelection()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    cropRect,
    documentSize,
    enableMaskEditing,
    handleDeleteSelection,
    handlePasteStoredSelection,
    handleRedo,
    handleSelectionTransfer,
    handleUndo,
    open,
    queueHistoryCommit,
    selectionClipboardRef,
    selectionRect,
    setBrushSize,
    setCropRect,
    setSelectionRect,
    setTool,
  ])
}

function nudgeRect(rect: ImageEditorCropRect | null, deltaX: number, deltaY: number, documentSize: { width: number; height: number }) {
  if (!rect) {
    return null
  }

  const normalizedRect = normalizeImageEditorRect(rect)
  return clampImageEditorRect({
    x: normalizedRect.x + deltaX,
    y: normalizedRect.y + deltaY,
    width: normalizedRect.width,
    height: normalizedRect.height,
  }, documentSize.width, documentSize.height)
}

function resizeRect(rect: ImageEditorCropRect | null, deltaWidth: number, deltaHeight: number, documentSize: { width: number; height: number }) {
  if (!rect) {
    return null
  }

  const normalizedRect = normalizeImageEditorRect(rect)
  return clampImageEditorRect({
    x: normalizedRect.x,
    y: normalizedRect.y,
    width: Math.max(1, normalizedRect.width + deltaWidth),
    height: Math.max(1, normalizedRect.height + deltaHeight),
  }, documentSize.width, documentSize.height)
}
