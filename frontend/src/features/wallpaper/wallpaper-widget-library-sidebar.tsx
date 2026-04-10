import { useMemo, useState } from 'react'
import {
  Activity,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Clock3,
  Folder,
  Grid2x2,
  ImageIcon,
  Images,
  Layers3,
  Plus,
  Search,
  Type,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ExplorerSidebar } from '@/components/common/explorer-sidebar'
import { getNavigationItemClassName } from '@/components/common/navigation-item'
import { cn } from '@/lib/utils'
import { listWallpaperWidgetDefinitions } from './wallpaper-widget-registry'
import type { WallpaperWidgetDefinition, WallpaperWidgetType } from './wallpaper-types'

type WallpaperWidgetLibraryFolderId = 'realtime' | 'images' | 'notes' | 'misc'

interface WallpaperWidgetLibrarySidebarProps {
  selectedWidgetType?: WallpaperWidgetType | null
  onAddWidget: (widgetType: WallpaperWidgetType) => void
}

interface WallpaperWidgetLibraryFolder {
  id: WallpaperWidgetLibraryFolderId
  title: string
  widgetTypes: WallpaperWidgetType[]
}

const WALLPAPER_WIDGET_LIBRARY_FOLDERS: WallpaperWidgetLibraryFolder[] = [
  {
    id: 'realtime',
    title: '실시간 정보',
    widgetTypes: ['clock', 'queue-status', 'activity-pulse'],
  },
  {
    id: 'images',
    title: '이미지',
    widgetTypes: ['recent-results', 'group-image-view', 'image-showcase', 'floating-collage'],
  },
  {
    id: 'notes',
    title: '텍스트',
    widgetTypes: ['text-note'],
  },
]

const WIDGET_FOLDER_TITLE_BY_TYPE = new Map<WallpaperWidgetType, string>(
  WALLPAPER_WIDGET_LIBRARY_FOLDERS.flatMap((folder) => folder.widgetTypes.map((widgetType) => [widgetType, folder.title] as const)),
)

function getWallpaperWidgetIcon(widgetType: WallpaperWidgetType) {
  if (widgetType === 'clock') {
    return Clock3
  }

  if (widgetType === 'queue-status') {
    return BarChart3
  }

  if (widgetType === 'activity-pulse') {
    return Activity
  }

  if (widgetType === 'recent-results') {
    return Grid2x2
  }

  if (widgetType === 'group-image-view') {
    return Images
  }

  if (widgetType === 'image-showcase') {
    return ImageIcon
  }

  if (widgetType === 'floating-collage') {
    return Layers3
  }

  return Type
}

function sortWallpaperWidgetDefinitions(left: WallpaperWidgetDefinition, right: WallpaperWidgetDefinition) {
  return left.title.localeCompare(right.title, 'ko-KR', { numeric: true, sensitivity: 'base' })
}

function matchesWallpaperWidgetQuery(widget: WallpaperWidgetDefinition, query: string) {
  if (!query) {
    return true
  }

  const folderTitle = WIDGET_FOLDER_TITLE_BY_TYPE.get(widget.type) ?? '기타'
  return [widget.title, widget.description, widget.type, folderTitle]
    .join(' ')
    .toLowerCase()
    .includes(query)
}

/** Render one explorer-style wallpaper widget library with folder-style grouping. */
export function WallpaperWidgetLibrarySidebar({ selectedWidgetType, onAddWidget }: WallpaperWidgetLibrarySidebarProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<WallpaperWidgetLibraryFolderId[]>([])
  const normalizedQuery = searchQuery.trim().toLowerCase()

  const widgetDefinitions = useMemo(
    () => [...listWallpaperWidgetDefinitions()].sort(sortWallpaperWidgetDefinitions),
    [],
  )

  const widgetDefinitionByType = useMemo(
    () => new Map(widgetDefinitions.map((widget) => [widget.type, widget] as const)),
    [widgetDefinitions],
  )

  const visibleFolders = useMemo(() => {
    const knownWidgetTypes = new Set<WallpaperWidgetType>()
    const folders = WALLPAPER_WIDGET_LIBRARY_FOLDERS.map((folder) => {
      const widgets = folder.widgetTypes
        .map((widgetType) => {
          knownWidgetTypes.add(widgetType)
          return widgetDefinitionByType.get(widgetType) ?? null
        })
        .filter((widget): widget is WallpaperWidgetDefinition => widget !== null)
        .filter((widget) => matchesWallpaperWidgetQuery(widget, normalizedQuery))

      return {
        ...folder,
        widgets,
      }
    })

    const miscWidgets = widgetDefinitions.filter((widget) => !knownWidgetTypes.has(widget.type) && matchesWallpaperWidgetQuery(widget, normalizedQuery))
    if (miscWidgets.length > 0) {
      folders.push({
        id: 'misc',
        title: '기타',
        widgetTypes: miscWidgets.map((widget) => widget.type),
        widgets: miscWidgets,
      })
    }

    return folders.filter((folder) => folder.widgets.length > 0)
  }, [normalizedQuery, widgetDefinitionByType, widgetDefinitions])

  const hasVisibleWidgets = visibleFolders.length > 0

  const toggleFolder = (folderId: WallpaperWidgetLibraryFolderId) => {
    setCollapsedFolderIds((current) => (
      current.includes(folderId)
        ? current.filter((item) => item !== folderId)
        : [...current, folderId]
    ))
  }

  return (
    <ExplorerSidebar
      title="위젯 라이브러리"
      badge={<Badge variant="outline">{widgetDefinitions.length}</Badge>}
      floatingFrame
      floatingLockStorageKey="conai:wallpaper:widget-library-sidebar-locked"
      className="sticky top-24 z-20 isolate self-start max-h-[calc(100vh-var(--theme-shell-header-height)-1.5rem)]"
      bodyClassName="space-y-1 overflow-y-auto pr-1"
      headerExtra={
        <div className="space-y-3 border-b border-white/5 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="위젯 검색"
              className="h-8 pl-9 text-sm"
            />
          </div>
        </div>
      }
    >
      {visibleFolders.map((folder) => {
        const isExpanded = normalizedQuery ? true : !collapsedFolderIds.includes(folder.id)

        return (
          <div key={folder.id} className="space-y-1">
            <button
              type="button"
              onClick={() => toggleFolder(folder.id)}
              className={getNavigationItemClassName({
                active: false,
                className: 'flex items-center gap-2 px-2 py-2',
              })}
            >
              {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
              <Folder className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{folder.title}</span>
              <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">
                {folder.widgets.length}
              </Badge>
            </button>

            {isExpanded ? (
              <div className="space-y-1">
                {folder.widgets.map((widget) => {
                  const Icon = getWallpaperWidgetIcon(widget.type)
                  return (
                    <button
                      key={widget.type}
                      type="button"
                      onClick={() => onAddWidget(widget.type)}
                      className={getNavigationItemClassName({
                        active: selectedWidgetType === widget.type,
                        density: 'sm',
                        className: 'flex items-center gap-2 pl-10 pr-2',
                      })}
                    >
                      <Icon className={cn('h-4 w-4 shrink-0', selectedWidgetType === widget.type ? 'text-primary' : 'text-muted-foreground')} />
                      <div className={cn('min-w-0 flex-1 truncate text-sm font-medium', selectedWidgetType === widget.type ? 'text-primary' : 'text-foreground')}>
                        {widget.title}
                      </div>
                      <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
        )
      })}

      {!hasVisibleWidgets ? (
        <Alert>
          <AlertTitle>검색 결과가 없어</AlertTitle>
          <AlertDescription>다른 이름이나 설명 키워드로 다시 찾아봐.</AlertDescription>
        </Alert>
      ) : null}
    </ExplorerSidebar>
  )
}
