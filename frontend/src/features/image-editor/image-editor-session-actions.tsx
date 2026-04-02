import { Crop, Minus, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { ImageEditorCropRect } from './image-editor-types'

interface ImageEditorSessionActionsProps {
  canFlattenVisible: boolean
  canMergeVisible: boolean
  canClearActiveDrawLayer: boolean
  hasSelectionRect: boolean
  selectionRect: ImageEditorCropRect | null
  cropRect: ImageEditorCropRect | null
  saving: boolean
  loading: boolean
  canSave: boolean
  onMergeVisible: () => void
  onFlattenVisible: () => void
  onClearActiveDrawLayer: () => void
  onClearAllDrawLayers: () => void
  onClearSelection: () => void
  onSelectionRectFieldChange: (field: 'x' | 'y' | 'width' | 'height', value: number) => void
  onCropRectFieldChange: (field: 'x' | 'y' | 'width' | 'height', value: number) => void
  onCancelCrop: () => void
  onClose: () => void
  onSave: () => void
}

/** Render the session-level action panel for destructive or global editor actions. */
export function ImageEditorSessionActions({
  canFlattenVisible,
  canMergeVisible,
  canClearActiveDrawLayer,
  hasSelectionRect,
  selectionRect,
  cropRect,
  saving,
  loading,
  canSave,
  onMergeVisible,
  onFlattenVisible,
  onClearActiveDrawLayer,
  onClearAllDrawLayers,
  onClearSelection,
  onSelectionRectFieldChange,
  onCropRectFieldChange,
  onCancelCrop,
  onClose,
  onSave,
}: ImageEditorSessionActionsProps) {
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="border-b border-border/70 pb-4 text-sm font-semibold text-foreground">Session actions</div>
        <Button type="button" variant="secondary" onClick={onMergeVisible} className="w-full justify-start" disabled={!canMergeVisible}>
          Merge visible
        </Button>
        <Button type="button" variant="secondary" onClick={onFlattenVisible} className="w-full justify-start" disabled={!canFlattenVisible}>
          Flatten visible
        </Button>
        <Button type="button" variant="secondary" onClick={onClearActiveDrawLayer} className="w-full justify-start" disabled={!canClearActiveDrawLayer}>
          <Minus className="h-4 w-4" /> Clear active draw layer
        </Button>
        <Button type="button" variant="secondary" onClick={onClearAllDrawLayers} className="w-full justify-start">
          <Minus className="h-4 w-4" /> Clear all draw layers
        </Button>
        <Button type="button" variant="secondary" onClick={onClearSelection} className="w-full justify-start" disabled={!hasSelectionRect}>
          <Square className="h-4 w-4" /> Clear selection
        </Button>

        {selectionRect ? (
          <div className="space-y-2 rounded-sm border border-border bg-surface-low p-3">
            <div className="text-xs font-medium text-foreground">Selection bounds</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs text-muted-foreground">X<Input type="number" value={Math.round(selectionRect.x)} onChange={(event) => onSelectionRectFieldChange('x', Number(event.target.value) || 0)} className="h-8" /></label>
              <label className="space-y-1 text-xs text-muted-foreground">Y<Input type="number" value={Math.round(selectionRect.y)} onChange={(event) => onSelectionRectFieldChange('y', Number(event.target.value) || 0)} className="h-8" /></label>
              <label className="space-y-1 text-xs text-muted-foreground">W<Input type="number" min={1} value={Math.round(selectionRect.width)} onChange={(event) => onSelectionRectFieldChange('width', Number(event.target.value) || 1)} className="h-8" /></label>
              <label className="space-y-1 text-xs text-muted-foreground">H<Input type="number" min={1} value={Math.round(selectionRect.height)} onChange={(event) => onSelectionRectFieldChange('height', Number(event.target.value) || 1)} className="h-8" /></label>
            </div>
          </div>
        ) : null}

        {cropRect ? (
          <>
            <Button type="button" variant="secondary" onClick={onCancelCrop} className="w-full justify-start">
              <Crop className="h-4 w-4" /> Cancel crop
            </Button>

            <div className="space-y-2 rounded-sm border border-border bg-surface-low p-3">
              <div className="text-xs font-medium text-foreground">Crop bounds</div>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-xs text-muted-foreground">X<Input type="number" value={Math.round(cropRect.x)} onChange={(event) => onCropRectFieldChange('x', Number(event.target.value) || 0)} className="h-8" /></label>
                <label className="space-y-1 text-xs text-muted-foreground">Y<Input type="number" value={Math.round(cropRect.y)} onChange={(event) => onCropRectFieldChange('y', Number(event.target.value) || 0)} className="h-8" /></label>
                <label className="space-y-1 text-xs text-muted-foreground">W<Input type="number" min={1} value={Math.round(cropRect.width)} onChange={(event) => onCropRectFieldChange('width', Number(event.target.value) || 1)} className="h-8" /></label>
                <label className="space-y-1 text-xs text-muted-foreground">H<Input type="number" min={1} value={Math.round(cropRect.height)} onChange={(event) => onCropRectFieldChange('height', Number(event.target.value) || 1)} className="h-8" /></label>
              </div>
            </div>
          </>
        ) : null}
        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" className="flex-1" onClick={onSave} disabled={!canSave || saving || loading}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
