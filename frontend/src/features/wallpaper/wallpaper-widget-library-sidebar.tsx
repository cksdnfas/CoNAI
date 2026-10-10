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
  Newspaper,
  Plus,
  Search,
  Sparkles,
  Type,
  UserRound,
  Workflow,
} from 'lucide-react'
import { TextTabs } from '@/components/common/text-tabs'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
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
  'audio-player': AudioLines,
  'post-ticker': Newspaper,
  'prompt-of-day': Sparkles,
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
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={t({ ko: '위젯 검색', en: 'Search widgets' })}
          aria-label={t({ ko: '위젯 검색', en: 'Search widgets' })}
          className="h-8 pl-8 text-xs"
        />
      </div>
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

function LayerList({ widgets, selectedIds, onSelect, onReorder, onToggleHidden, onToggleLocked }: Omit<WallpaperWidgetLibrarySidebarProps, 'onAddWidget'>) {
  const { t } = useI18n()
  const ordered = useMemo(() => getWallpaperWidgetsFrontToBack(widgets), [widgets])
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  if (ordered.length === 0) {
    return <EmptyState size="compact" title={t({ ko: '아직 위젯이 없어', en: 'No widgets yet' })} />
  }

  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) return
    const ids = ordered.map((widget) => widget.id).filter((id) => id !== dragId)
    ids.splice(ids.indexOf(targetId), 0, dragId)
    onReorder(ids)
  }

  return (
    <SidebarNav aria-label={t({ ko: '레이어', en: 'Layers' })}>
      {ordered.map((widget) => {
        const isSelected = selectedIds.includes(widget.id)
        return (
          <div
            key={widget.id}
            className={cn('flex items-center gap-0.5 rounded-md', overId === widget.id && dragId !== widget.id ? 'ring-1 ring-inset ring-primary/60' : null)}
            draggable
            onDragStart={() => setDragId(widget.id)}
            onDragOver={(event) => { event.preventDefault(); setOverId(widget.id) }}
            onDrop={(event) => { event.preventDefault(); drop(widget.id); setDragId(null); setOverId(null) }}
            onDragEnd={() => { setDragId(null); setOverId(null) }}
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
