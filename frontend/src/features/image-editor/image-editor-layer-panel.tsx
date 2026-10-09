import { ArrowDown, ArrowDownToLine, ArrowUp, Brush, CopyPlus, Eye, EyeOff, Highlighter, ImageIcon, Layers, Lock, Plus, Trash2, Unlock } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Heading } from '@/components/ui/heading'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
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
    <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Heading level={3} className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" /> {t({ ko: '레이어', en: 'Layers' })}
          </Heading>
          <IconButton variant="ghost" size="icon-sm" onClick={onAddLayer} label={t({ ko: '추가', en: 'Add' })}>
            <Plus className="h-4 w-4" />
          </IconButton>
        </div>

        <div>
          {layers.length > 0 ? layers.map((layer, index) => {
            const isActive = layer.id === activeLayerId
            return (
              <div key={layer.id} className={`space-y-2 border-b border-line py-3 last:border-b-0 ${isActive ? 'bg-primary/8 px-2 shadow-[inset_2px_0_0_var(--primary)]' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-1">
                    <IconButton
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onSetActiveLayerId(layer.id)}
                      label={layer.type === 'draw'
                        ? t({ ko: '드로우 · {count} 스트로크 (눌러서 선택)', en: 'Draw · {count} stroke (click to select)' }, { count: layer.lines.length })
                        : t({ ko: '비트맵 붙여넣기 (눌러서 선택)', en: 'Paste bitmap (click to select)' })}
                    >
                      {layer.type === 'draw' ? <Brush className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                    </IconButton>
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
                      className="h-8 min-w-0 flex-1"
                      aria-label={t({ ko: '레이어 이름 {index}', en: 'Layer name {index}' }, { index: index + 1 })}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <IconButton variant="ghost" size="icon-sm" onClick={() => onToggleLayerVisible(layer.id)} aria-pressed={!layer.visible} label={layer.visible ? t({ ko: '레이어 숨기기', en: 'Hide layer' }) : t({ ko: '레이어 보이기', en: 'Show layer' })}>
                    {layer.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </IconButton>
                  <IconButton variant="ghost" size="icon-sm" onClick={() => onToggleLayerLocked(layer.id)} aria-pressed={layer.locked} label={layer.locked ? t({ ko: '잠금 해제', en: 'Unlock layer' }) : t({ ko: '레이어 잠그기', en: 'Lock layer' })}>
                    {layer.locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                  </IconButton>
                  <IconButton variant="ghost" size="icon-sm" onClick={() => onMoveLayer(layer.id, -1)} disabled={index === 0} label={t({ ko: '위로 이동', en: 'Move up' })}>
                    <ArrowUp className="h-4 w-4" />
                  </IconButton>
                  <IconButton variant="ghost" size="icon-sm" onClick={() => onMoveLayer(layer.id, 1)} disabled={index === layers.length - 1} label={t({ ko: '아래로 이동', en: 'Move down' })}>
                    <ArrowDown className="h-4 w-4" />
                  </IconButton>
                  <IconButton variant="ghost" size="icon-sm" onClick={() => onDuplicateLayer(layer.id)} disabled={loading} label={t({ ko: '복제', en: 'Duplicate' })}>
                    <CopyPlus className="h-4 w-4" />
                  </IconButton>
                  <IconButton variant="ghost" size="icon-sm" onClick={onMergeLayerDown} disabled={!isActive || index === 0 || loading} label={t({ ko: '아래로 병합', en: 'Merge Down' })}>
                    <ArrowDownToLine className="h-4 w-4" />
                  </IconButton>
                  <IconButton variant="ghost" size="icon-sm" onClick={() => onDeleteLayer(layer.id)} disabled={layers.length === 1 && layer.type === 'draw'} label={t({ ko: '레이어 삭제', en: 'Delete layer' })}>
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              </div>
            )
          }) : <EmptyState size="compact" title={t({ ko: '아직 레이어가 없어.', en: 'No layers yet.' })} />}
        </div>

        {enableMaskEditing ? (
          <div className="flex items-center border-t border-line pt-2">
            <Tip content={hasVisibleMask ? t({ ko: '마스크 레이어: 보임', en: 'Mask layer: visible' }) : t({ ko: '마스크 레이어: 비어 있음', en: 'Mask layer: empty' })}>
              <span
                className="inline-flex size-8 items-center justify-center"
                role="img"
                tabIndex={0}
                aria-label={hasVisibleMask ? t({ ko: '마스크 레이어: 보임', en: 'Mask layer: visible' }) : t({ ko: '마스크 레이어: 비어 있음', en: 'Mask layer: empty' })}
              >
                <Highlighter className={cn('h-4 w-4', hasVisibleMask ? 'text-primary' : 'text-muted-foreground/60')} />
              </span>
            </Tip>
          </div>
        ) : null}
    </section>
  )
}
