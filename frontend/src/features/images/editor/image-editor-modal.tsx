import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { imageEditorApi } from '@/services/image-editor-api'

interface ImageEditorModalProps {
  open: boolean
  fileId: number | null
  onOpenChange: (open: boolean) => void
  onSaved?: () => void | Promise<void>
}

export function ImageEditorModal({ open, fileId, onOpenChange, onSaved }: ImageEditorModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null

    const load = async () => {
      if (!open || fileId === null) {
        return
      }

      setLoading(true)
      setError(null)

      try {
        const blob = await imageEditorApi.getEditableImageBlob(fileId)
        if (cancelled) {
          return
        }

        objectUrl = URL.createObjectURL(blob)
        const image = new Image()
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve()
          image.onerror = () => reject(new Error('Failed to decode image'))
          image.src = objectUrl as string
        })

        if (cancelled) {
          return
        }

        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx) {
          throw new Error('Editor canvas is not available')
        }

        canvas.width = image.width
        canvas.height = image.height
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(image, 0, 0)
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load editor image')
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [fileId, open])

  const drawAtPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) {
      return
    }

    const rect = canvas.getBoundingClientRect()
    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1
    const x = (event.clientX - rect.left) * scaleX
    const y = (event.clientY - rect.top) * scaleY

    ctx.fillStyle = 'rgba(255, 0, 0, 0.95)'
    ctx.beginPath()
    ctx.arc(x, y, 8, 0, Math.PI * 2)
    ctx.fill()
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) {
      return
    }

    drawingRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    drawAtPoint(event)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) {
      return
    }

    drawAtPoint(event)
  }

  const handlePointerEnd = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) {
      return
    }

    drawingRef.current = false
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const handleClear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) {
      return
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  const handleSave = async () => {
    if (fileId === null || saving) {
      return
    }

    const canvas = canvasRef.current
    if (!canvas) {
      setError('Editor canvas is not available')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const imageData = canvas.toDataURL('image/webp', 0.95)
      await imageEditorApi.saveEditedImage(fileId, imageData, 90)
      await onSaved?.()
      onOpenChange(false)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save image edits')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="image-editor-modal" className="h-[90vh] w-[90vw] max-h-[90vh] max-w-[90vw]">
        <DialogHeader>
          <DialogTitle>Image Editor</DialogTitle>
          <DialogDescription>Draw directly on the image, then save to apply changes.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/20 p-3">
          {loading ? <p className="text-sm text-muted-foreground">Loading editor image...</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <canvas
            ref={canvasRef}
            data-testid="image-editor-canvas"
            className="mx-auto block max-h-full max-w-full cursor-crosshair rounded border bg-background"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" data-testid="image-editor-clear-action" onClick={handleClear} disabled={loading || saving}>
            Clear
          </Button>
          <Button type="button" variant="outline" data-testid="image-editor-cancel-action" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" data-testid="image-editor-save-action" onClick={() => void handleSave()} disabled={loading || saving || fileId === null}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
