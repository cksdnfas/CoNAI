import { ArrowDown, ArrowUp, Eye, EyeOff, Layers, Lock, Plus, Trash2, Unlock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { ImageEditorLayer } from './image-editor-types'

interface ImageEditorLayerPanelProps {
  layers: ImageEditorLayer[]
  activeLayerId: string | null
  loading: boolean
  enableMaskEditing: boolean
  hasVisibleMask: boolean
  onAddLayer: () => void
  onSetActiveLayerId: (layerId: string) => void
  onRenameLayer: (layerId: string, name: string) => void
  onCommitRename: () => void
  onToggleLayerVisible: (layerId: string) => void
  onToggleLayerLocked: (layerId: string) => void
  onMoveLayer: (layerId: string, direction: -1 | 1) => void
  onDuplicateLayer: (layerId: string) => void
  onMergeLayerDown: () => void
  onDeleteLayer: (layerId: string) => void
}

/** Render the layer list panel and per-layer actions. */
export function ImageEditorLayerPanel({
  layers,
  activeLayerId,
  loading,
  enableMaskEditing,
  hasVisibleMask,
  onAddLayer,
  onSetActiveLayerId,
  onRenameLayer,
  onCommitRename,
  onToggleLayerVisible,
  onToggleLayerLocked,
  onMoveLayer,
  onDuplicateLayer,
  onMergeLayerDown,
  onDeleteLayer,
}: ImageEditorLayerPanelProps) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between border-b border-border/70 pb-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Layers className="h-4 w-4" /> Layers
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={onAddLayer}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>

        <div className="space-y-2">
          {layers.length > 0 ? layers.map((layer, index) => {
            const isActive = layer.id === activeLayerId
            return (
              <div key={layer.id} className={`space-y-2 rounded-sm border p-3 ${isActive ? 'border-primary bg-primary/5' : 'border-border bg-surface-low'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-2">
                    <button type="button" className="w-full min-w-0 text-left" onClick={() => onSetActiveLayerId(layer.id)}>
                      <div className="text-xs text-muted-foreground">{layer.type === 'draw' ? `Draw · ${layer.lines.length} stroke${layer.lines.length === 1 ? '' : 's'}` : 'Paste bitmap'}</div>
                    </button>
                    <Input
                      value={layer.name}
                      onChange={(event) => onRenameLayer(layer.id, event.target.value)}
                      onFocus={() => onSetActiveLayerId(layer.id)}
                      onBlur={onCommitRename}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.currentTarget.blur()
                        }
                      }}
                      className="h-8"
                      aria-label={`Layer name ${index + 1}`}
                    />
                  </div>
                  <Badge variant={isActive ? 'secondary' : 'outline'}>{index + 1}</Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => onToggleLayerVisible(layer.id)}>
                    {layer.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => onToggleLayerLocked(layer.id)}>
                    {layer.locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => onMoveLayer(layer.id, -1)} disabled={index === 0}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => onMoveLayer(layer.id, 1)} disabled={index === layers.length - 1}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => onDuplicateLayer(layer.id)} disabled={loading}>
                    Duplicate
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={onMergeLayerDown} disabled={!isActive || index === 0 || loading}>
                    Merge Down
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => onDeleteLayer(layer.id)} disabled={layers.length === 1 && layer.type === 'draw'}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )
          }) : <div className="text-sm text-muted-foreground">No layers yet.</div>}
        </div>

        {enableMaskEditing ? (
          <div className="space-y-2 rounded-sm border border-border bg-surface-low p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-foreground">Mask layer</div>
              <Badge variant={hasVisibleMask ? 'secondary' : 'outline'}>{hasVisibleMask ? 'Visible' : 'Empty'}</Badge>
            </div>
            <div className="text-xs text-muted-foreground">The mask layer is exported separately for infill. Brush paints white. Eraser removes white.</div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
