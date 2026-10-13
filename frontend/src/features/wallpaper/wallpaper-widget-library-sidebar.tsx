import { useMemo, useState, type DragEvent } from 'react'
import {
  Activity,
  AudioLines,
  BarChart3,
  Bot,
  CalendarDays,
  Clock3,
  Cpu,
  Eye,
  EyeOff,
  Grid2x2,
  ImageIcon,
  Images,
  Layers3,
  Library,
  Lock,
  LockOpen,
  MessageSquareText,
  MessagesSquare,
  Newspaper,
  Plus,
  Sparkles,
  Type,
  UserRound,
  Workflow,
  AudioWaveform,
  Music,
  Gauge,
  Play,
} from 'lucide-react'
import { SearchField } from '@/components/common/search-field'
import { TextTabs } from '@/components/common/text-tabs'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { SidebarGroupLabel, SidebarItem, SidebarNav } from '@/components/ui/sidebar'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { getWallpaperWidgetsFrontToBack } from './wallpaper-layout-utils'
import { getWallpaperWidgetDisplayTitle, listWallpaperWidgetDefinitions } from './wallpaper-widget-registry'
import { getWallpaperWidgetLibrarySearchSummary } from './wallpaper-widget-library-search'
import type { WallpaperWidgetInstance, WallpaperWidgetType } from './wallpaper-types'

/** MIME type for dragging a library entry onto the canvas. */
export const WALLPAPER_WIDGET_DRAG_TYPE = 'application/x-conai-wallpaper-widget'

const WIDGET_ICONS: Record<WallpaperWidgetType, typeof Clock3> = {
  clock: Clock3,
  calendar: CalendarDays,
  'text-note': Type,
  'queue-status': Workflow,
  'activity-pulse': Activity,
  'recent-results': Grid2x2,
  'group-image-view': Images,
  'image-showcase': ImageIcon,
  'floating-collage': Layers3,
  'generation-progress': Cpu,
  'generation-stats': BarChart3,
  'llm-usage': Bot,
  'library-stats': Library,
  'character-card': UserRound,
  'chat-recent': MessageSquareText,
  'chat-inbox': MessagesSquare,
  'audio-player': AudioLines,
  'post-ticker': Newspaper,
  'prompt-of-day': Sparkles,
  'audio-visualizer': AudioWaveform,
  'now-playing': Music,
  'system-monitor': Gauge,
  'quick-run': Play,
}

export function getWallpaperWidgetIcon(widgetType: WallpaperWidgetType) {
  return WIDGET_ICONS[widgetType] ?? Type
}

interface WallpaperWidgetLibrarySidebarProps {
  widgets: WallpaperWidgetInstance[]
  selectedIds: string[]
  onAddWidget: (widgetType: WallpaperWidgetType) => void
  onSelect: (ids: string[]) => void
  onReorder: (frontToBackIds: string[]) => void
  onToggleHidden: (widget: WallpaperWidgetInstance) => void
  onToggleLocked: (widget: WallpaperWidgetInstance) => void
}

function WidgetLibrary({ onAddWidget }: { onAddWidget: (widgetType: WallpaperWidgetType) => void }) {
  const { t } = useI18n()
  const [searchQuery, setSearchQuery] = useState('')
  const definitions = useMemo(() => listWallpaperWidgetDefinitions(), [])
  const searchSummary = useMemo(() => getWallpaperWidgetLibrarySearchSummary(definitions, searchQuery, t), [definitions, searchQuery, t])

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SearchField value={searchQuery} onChange={setSearchQuery} placeholder={t({ ko: '위젯 검색', en: 'Search widgets' })} />
      <SidebarNav aria-label={t({ ko: '위젯 라이브러리', en: 'Widget library' })}>
        {searchSummary.visibleFolders.map((folder) => (
          <div key={folder.id}>
            <SidebarGroupLabel>{t(folder.title)}</SidebarGroupLabel>
            {folder.widgets.map((widget) => (
              <SidebarItem
                key={widget.type}
                icon={getWallpaperWidgetIcon(widget.type)}
                label={t(widget.title)}
                title={t(widget.description)}
                draggable
                onDragStart={(event: DragEvent<HTMLButtonElement>) => {
                  event.dataTransfer.setData(WALLPAPER_WIDGET_DRAG_TYPE, widget.type)
                  event.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => onAddWidget(widget.type)}
                trailing={<Plus className="size-3.5 text-muted-foreground" aria-hidden />}
              />
            ))}
          </div>
        ))}
      </SidebarNav>
      {searchSummary.visibleFolders.length === 0 ? (
        <EmptyState size="compact" title={t({ ko: '검색 결과가 없어', en: 'No matching widgets' })} />
      ) : null}
    </div>
  )
}

const WALLPAPER_LAYER_DRAG_TYPE = 'application/x-conai-wallpaper-layer'

function LayerList({ widgets, selectedIds, onSelect, onReorder, onToggleHidden, onToggleLocked }: Omit<WallpaperWidgetLibrarySidebarProps, 'onAddWidget'>) {
  const { t } = useI18n()
  const ordered = useMemo(() => getWallpaperWidgetsFrontToBack(widgets), [widgets])
  const [dragId, setDragId] = useState<string | null>(null)
  // Where the dragged layer would land: above or below the hovered row (the bottom half of the last row reaches the end).
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null)

  if (ordered.length === 0) {
    return <EmptyState size="compact" title={t({ ko: '아직 위젯이 없어', en: 'No widgets yet' })} />
  }

  const drop = (targetId: string, after: boolean) => {
    if (!dragId || dragId === targetId) return
    const ids = ordered.map((widget) => widget.id).filter((id) => id !== dragId)
    ids.splice(ids.indexOf(targetId) + (after ? 1 : 0), 0, dragId)
    onReorder(ids)
  }
  const endDrag = () => {
    setDragId(null)
    setOver(null)
  }

  return (
    <SidebarNav aria-label={t({ ko: '레이어', en: 'Layers' })}>
      {ordered.map((widget) => {
        const isSelected = selectedIds.includes(widget.id)
        return (
          <div
            key={widget.id}
            className={cn(
              'relative flex items-center gap-0.5 rounded-md',
              dragId === widget.id ? 'opacity-50' : null,
              over?.id === widget.id && dragId !== widget.id
                ? cn('before:pointer-events-none before:absolute before:inset-x-1 before:h-0.5 before:rounded-full before:bg-primary', over.after ? 'before:-bottom-px' : 'before:-top-px')
                : null,
            )}
            draggable
            onDragStart={(event) => {
              // Firefox only starts a drag that carries data; a private type keeps the id out of text fields.
              event.dataTransfer.setData(WALLPAPER_LAYER_DRAG_TYPE, widget.id)
              event.dataTransfer.effectAllowed = 'move'
              setDragId(widget.id)
            }}
            onDragOver={(event) => {
              if (!dragId) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              const rect = event.currentTarget.getBoundingClientRect()
              const after = event.clientY > rect.top + rect.height / 2
              if (over?.id !== widget.id || over.after !== after) setOver({ id: widget.id, after })
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver((current) => (current?.id === widget.id ? null : current))
            }}
            onDrop={(event) => {
              event.preventDefault()
              const rect = event.currentTarget.getBoundingClientRect()
              drop(widget.id, event.clientY > rect.top + rect.height / 2)
              endDrag()
            }}
            onDragEnd={endDrag}
          >
            <SidebarItem
              className={cn('min-w-0 flex-1', widget.hidden ? 'opacity-50' : null)}
              icon={getWallpaperWidgetIcon(widget.type)}
              label={getWallpaperWidgetDisplayTitle(widget, t)}
              active={isSelected}
              onClick={(event) => {
                event.preventDefault()
                onSelect(event.shiftKey || event.ctrlKey || event.metaKey
                  ? (isSelected ? selectedIds.filter((id) => id !== widget.id) : [...selectedIds, widget.id])
                  : [widget.id])
              }}
            />
            <IconButton variant="ghost" size="icon-xs" label={widget.hidden ? t({ ko: '보이기', en: 'Show' }) : t({ ko: '숨기기', en: 'Hide' })} onClick={() => onToggleHidden(widget)} className={widget.hidden ? undefined : 'text-muted-foreground'}>
              {widget.hidden ? <EyeOff /> : <Eye />}
            </IconButton>
            <IconButton variant="ghost" size="icon-xs" label={widget.locked ? t({ ko: '잠금 해제', en: 'Unlock' }) : t({ ko: '잠금', en: 'Lock' })} onClick={() => onToggleLocked(widget)} className={widget.locked ? undefined : 'text-muted-foreground'}>
              {widget.locked ? <Lock /> : <LockOpen />}
            </IconButton>
          </div>
        )
      })}
    </SidebarNav>
  )
}

/** Left column: the widget library and the layer list, as text tabs. */
export function WallpaperWidgetLibrarySidebar(props: WallpaperWidgetLibrarySidebarProps) {
  const { t } = useI18n()
  const [tab, setTab] = useState<'widgets' | 'layers'>('widgets')
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <TextTabs
        value={tab}
        onChange={setTab}
        ariaLabel={t({ ko: '위젯 패널', en: 'Widget panel' })}
        items={[
          { value: 'widgets', label: t({ ko: '위젯', en: 'Widgets' }) },
          { value: 'layers', label: t({ ko: '레이어', en: 'Layers' }), count: props.widgets.length || null },
        ]}
      />
      {tab === 'widgets' ? <WidgetLibrary onAddWidget={props.onAddWidget} /> : <LayerList {...props} />}
    </div>
  )
}
