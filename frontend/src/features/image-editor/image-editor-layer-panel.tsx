import { ArrowDown, ArrowUp, Eye, EyeOff, Layers, Lock, Plus, Trash2, Unlock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Heading } from '@/components/ui/heading'
import { IconButton } from '@/components/ui/icon-button'
import { Panel } from '@/components/ui/panel'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
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
  const { t } = useI18n()

  return (
    <Panel tone="low" className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Heading level={3} className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" /> {t({ ko: '레이어', en: 'Layers' })}
          </Heading>
          <Button type="button" variant="secondary" size="sm" onClick={onAddLayer}>
            <Plus className="h-4 w-4" /> {t({ ko: '추가', en: 'Add' })}
          </Button>
        </div>

        <div className="space-y-2">
          {layers.length > 0 ? layers.map((layer, index) => {
            const isActive = layer.id === activeLayerId
            return (
              <div key={layer.id} className={`space-y-2 rounded-sm p-3 ${isActive ? 'bg-primary/10 ring-1 ring-primary/40' : 'bg-surface-lowest'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-2">
                    <Button type="button" variant="nav" size="xs" className="-mx-1.5 w-[calc(100%+0.75rem)]" onClick={() => onSetActiveLayerId(layer.id)}>
                      {layer.type === 'draw'
                        ? t({ ko: '드로우 · {count} 스트로크', en: 'Draw · {count} stroke' }, { count: layer.lines.length })
                        : t({ ko: '비트맵 붙여넣기', en: 'Paste bitmap' })}
                    </Button>
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
                      aria-label={t({ ko: '레이어 이름 {index}', en: 'Layer name {index}' }, { index: index + 1 })}
                    />
                  </div>
                  <Badge variant={isActive ? 'secondary' : 'outline'}>{index + 1}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <IconButton variant="subtle" size="icon-sm" onClick={() => onToggleLayerVisible(layer.id)} aria-pressed={!layer.visible} label={layer.visible ? t({ ko: '레이어 숨기기', en: 'Hide layer' }) : t({ ko: '레이어 보이기', en: 'Show layer' })}>
                    {layer.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </IconButton>
                  <IconButton variant="subtle" size="icon-sm" onClick={() => onToggleLayerLocked(layer.id)} aria-pressed={layer.locked} label={layer.locked ? t({ ko: '잠금 해제', en: 'Unlock layer' }) : t({ ko: '레이어 잠그기', en: 'Lock layer' })}>
                    {layer.locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                  </IconButton>
                  <IconButton variant="subtle" size="icon-sm" onClick={() => onMoveLayer(layer.id, -1)} disabled={index === 0} label={t({ ko: '위로 이동', en: 'Move up' })}>
                    <ArrowUp className="h-4 w-4" />
                  </IconButton>
                  <IconButton variant="subtle" size="icon-sm" onClick={() => onMoveLayer(layer.id, 1)} disabled={index === layers.length - 1} label={t({ ko: '아래로 이동', en: 'Move down' })}>
                    <ArrowDown className="h-4 w-4" />
                  </IconButton>
                  <Button type="button" variant="subtle" size="sm" onClick={() => onDuplicateLayer(layer.id)} disabled={loading}>
                    {t({ ko: '복제', en: 'Duplicate' })}
                  </Button>
                  <Button type="button" variant="subtle" size="sm" onClick={onMergeLayerDown} disabled={!isActive || index === 0 || loading}>
                    {t({ ko: '아래로 병합', en: 'Merge Down' })}
                  </Button>
                  <IconButton variant="subtle" size="icon-sm" onClick={() => onDeleteLayer(layer.id)} disabled={layers.length === 1 && layer.type === 'draw'} label={t({ ko: '레이어 삭제', en: 'Delete layer' })}>
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              </div>
            )
          }) : <EmptyState size="compact" title={t({ ko: '아직 레이어가 없어.', en: 'No layers yet.' })} />}
        </div>

        {enableMaskEditing ? (
          <div className="space-y-2 rounded-sm bg-surface-lowest p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-foreground">{t({ ko: '마스크 레이어', en: 'Mask layer' })}</div>
              <Badge variant={hasVisibleMask ? 'secondary' : 'outline'}>{hasVisibleMask ? t({ ko: '보임', en: 'Visible' }) : t({ ko: '비어 있음', en: 'Empty' })}</Badge>
            </div>
            <div className="text-xs text-muted-foreground">{t({ ko: '마스크 레이어는 인필용으로 별도 내보내져. 브러시는 흰색을 칠하고, 지우개는 흰색을 지워.', en: 'The mask layer is exported separately for infill. Brush paints white. Eraser removes white.' })}</div>
          </div>
        ) : null}
    </Panel>
  )
}
