import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Eye, EyeOff, ImagePlus, Lock, LockOpen, MoreHorizontal, Plus, Type } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Slider } from '@/components/ui/slider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { EditorEngine, EditorLayerInfo, EditorSnapshot } from '../engine/editor-engine'

/** One layer thumbnail, redrawn whenever the layer's pixels change. */
function LayerThumb({ engine, layer }: { engine: EditorEngine; layer: EditorLayerInfo }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    if (ref.current) engine.drawThumbnail(layer.id, ref.current)
  }, [engine, layer.id, layer.version])

  return (
    <span className="relative size-9 shrink-0">
      <canvas
        ref={ref}
        width={72}
        height={72}
        aria-hidden="true"
        className={cn(
          'size-9 rounded-xs bg-[repeating-conic-gradient(var(--surface-high)_0_25%,var(--surface-highest)_0_50%)] bg-[length:12px_12px]',
          layer.kind === 'floating' && 'outline outline-1 outline-dashed outline-outline-subtle',
        )}
      />
      {layer.text ? (
        <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-xs bg-surface-highest text-foreground">
          <Type className="size-3" />
        </span>
      ) : null}
    </span>
  )
}

function LayerRow({
  engine,
  layer,
  active,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  engine: EditorEngine
  layer: EditorLayerInfo
  active: boolean
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void
  onDrop?: (event: DragEvent<HTMLDivElement>) => void
}) {
  const { t } = useI18n()
  const [renaming, setRenaming] = useState(false)
  const name = layer.kind === 'mask' ? t({ ko: '마스크', en: 'Mask' }) : layer.name
  const draggable = layer.kind === 'paint' && !renaming

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={() => engine.setActiveLayer(layer.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) engine.setActiveLayer(layer.id)
      }}
      className={cn(
        'flex h-13 cursor-default items-center gap-2.5 pr-2 pl-3 outline-none focus-visible:bg-surface-high',
        active ? 'bg-primary/12' : 'hover:bg-surface-container',
      )}
    >
      <LayerThumb engine={engine} layer={layer} />
      {renaming ? (
        <input
          autoFocus
          defaultValue={layer.name}
          aria-label={t({ ko: '레이어 이름', en: 'Layer name' })}
          className="h-8 min-w-0 flex-1 rounded-xs bg-surface-container px-2 text-sm outline-none"
          onClick={(event) => event.stopPropagation()}
          onBlur={(event) => {
            engine.renameLayer(layer.id, event.target.value)
            setRenaming(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
          }}
        />
      ) : (
        <span
          className={cn('min-w-0 flex-1 truncate text-sm', layer.locked && layer.kind === 'paint' ? 'text-muted-foreground' : 'text-foreground')}
          onDoubleClick={(event) => {
            if (layer.kind !== 'paint') return
            // Text layers open for editing; the name follows the text unless renamed from the ⋯ menu.
            if (layer.text) {
              event.stopPropagation()
              engine.editTextLayer(layer.id)
            } else {
              setRenaming(true)
            }
          }}
        >
          {name}
        </span>
      )}
      {layer.kind !== 'floating' ? (
        <>
          <IconButton
            size="icon-sm"
            variant="ghost"
            label={layer.visible ? t({ ko: '숨기기', en: 'Hide' }) : t({ ko: '보이기', en: 'Show' })}
            onClick={(event) => {
              event.stopPropagation()
              engine.setLayerVisible(layer.id, !layer.visible)
            }}
          >
            {layer.visible ? <Eye className="size-4" /> : <EyeOff className="size-4 text-muted-foreground" />}
          </IconButton>
          {layer.kind === 'paint' ? (
            <IconButton
              size="icon-sm"
              variant="ghost"
              label={layer.locked ? t({ ko: '잠금 풀기', en: 'Unlock' }) : t({ ko: '잠그기', en: 'Lock' })}
              onClick={(event) => {
                event.stopPropagation()
                engine.setLayerLocked(layer.id, !layer.locked)
              }}
            >
              {layer.locked ? <Lock className="size-4" /> : <LockOpen className="size-4 text-muted-foreground/60" />}
            </IconButton>
          ) : <span className="size-8 shrink-0" />}
        </>
      ) : null}
    </div>
  )
}

/** Import, add and the ⋯ layer menu; sits in the side panel's tab row. */
export function LayerActions({ engine, snapshot, onImportImage }: { engine: EditorEngine; snapshot: EditorSnapshot; onImportImage: () => void }) {
  const { t } = useI18n()
  const paintLayers = snapshot.layers.filter((layer) => layer.kind === 'paint')
  const active = paintLayers.find((layer) => layer.id === snapshot.activeLayerId) ?? null
  const activeIndexFromTop = active ? paintLayers.indexOf(active) : -1

  return (
    <>
      <IconButton size="icon-sm" variant="ghost" label={t({ ko: '이미지 가져오기', en: 'Import image' })} onClick={onImportImage}>
        <ImagePlus className="size-4" />
      </IconButton>
      <IconButton size="icon-sm" variant="ghost" label={t({ ko: '레이어 추가', en: 'Add layer' })} onClick={() => engine.addLayer()}>
        <Plus className="size-4" />
      </IconButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton size="icon-sm" variant="ghost" label={t({ ko: '레이어 메뉴', en: 'Layer menu' })}>
            <MoreHorizontal className="size-4" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!active} onSelect={() => active && engine.duplicateLayer(active.id)}>
            {t({ ko: '복제', en: 'Duplicate' })}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!active || activeIndexFromTop >= paintLayers.length - 1} onSelect={() => engine.mergeDown()}>
            {t({ ko: '아래로 병합', en: 'Merge down' })}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={paintLayers.length <= 1} onSelect={() => engine.flatten()}>
            {t({ ko: '평탄화', en: 'Flatten' })}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!active || paintLayers.length <= 1} onSelect={() => active && engine.removeLayer(active.id)}>
            {t({ ko: '삭제', en: 'Delete' })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

/** Layer list for the side panel (desktop) and the layer sheet (phone). */
export function LayerPanel({ engine, snapshot }: { engine: EditorEngine; snapshot: EditorSnapshot }) {
  const { t } = useI18n()
  const dragIdRef = useRef<string | null>(null)
  const opacityStartRef = useRef<number | null>(null)
  const paintLayers = snapshot.layers.filter((layer) => layer.kind === 'paint')
  const floating = snapshot.layers.find((layer) => layer.kind === 'floating')
  const maskActive = snapshot.tool === 'mask' || snapshot.tool === 'mask-eraser'
  const active = paintLayers.find((layer) => layer.id === snapshot.activeLayerId) ?? null

  /** Rows are listed top first; the engine counts from the bottom. */
  const toEngineIndex = (indexFromTop: number) => paintLayers.length - 1 - indexFromTop

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pt-1">
        {snapshot.mask ? <LayerRow engine={engine} layer={snapshot.mask} active={maskActive} /> : null}
        {snapshot.mask ? <div className="mx-3 border-t border-line" /> : null}
        {floating ? <LayerRow engine={engine} layer={floating} active /> : null}
        {paintLayers.map((layer, index) => (
          <LayerRow
            key={layer.id}
            engine={engine}
            layer={layer}
            active={!maskActive && !floating && layer.id === snapshot.activeLayerId}
            onDragStart={(event) => {
              dragIdRef.current = layer.id
              event.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(event) => {
              if (dragIdRef.current) event.preventDefault()
            }}
            onDrop={(event) => {
              event.preventDefault()
              const id = dragIdRef.current
              dragIdRef.current = null
              if (id && id !== layer.id) engine.moveLayer(id, toEngineIndex(index))
            }}
          />
        ))}
      </div>

      {active && !maskActive ? (
        <div className="flex shrink-0 items-center gap-3 border-t border-line px-4 py-3.5">
          <span className="text-xs text-muted-foreground">{t({ ko: '불투명도', en: 'Opacity' })}</span>
          <Slider
            className="flex-1"
            min={0}
            max={100}
            step={1}
            value={[Math.round(active.opacity * 100)]}
            aria-label={t({ ko: '레이어 불투명도', en: 'Layer opacity' })}
            onValueChange={([value]) => {
              if (opacityStartRef.current === null) opacityStartRef.current = active.opacity
              engine.previewLayerOpacity(active.id, (value ?? 100) / 100)
            }}
            onValueCommit={() => {
              const from = opacityStartRef.current
              opacityStartRef.current = null
              if (from !== null) engine.commitLayerOpacity(active.id, from)
            }}
          />
          <span className="w-10 text-right text-sm tabular-nums">{Math.round(active.opacity * 100)}%</span>
        </div>
      ) : null}
    </div>
  )
}
