import { Crop, Minus, Square, ZoomIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface ImageEditorSessionActionsProps {
  canFlattenVisible: boolean
  canMergeVisible: boolean
  canClearActiveDrawLayer: boolean
  hasSelectionRect: boolean
  saving: boolean
  loading: boolean
  canSave: boolean
  onMergeVisible: () => void
  onFlattenVisible: () => void
  onFitToScreen: () => void
  onClearActiveDrawLayer: () => void
  onClearAllDrawLayers: () => void
  onClearSelection: () => void
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
  saving,
  loading,
  canSave,
  onMergeVisible,
  onFlattenVisible,
  onFitToScreen,
  onClearActiveDrawLayer,
  onClearAllDrawLayers,
  onClearSelection,
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
        <Button type="button" variant="secondary" onClick={onFitToScreen} className="w-full justify-start">
          <ZoomIn className="h-4 w-4" /> Fit to screen
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
        <Button type="button" variant="secondary" onClick={onCancelCrop} className="w-full justify-start">
          <Crop className="h-4 w-4" /> Cancel crop
        </Button>
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
