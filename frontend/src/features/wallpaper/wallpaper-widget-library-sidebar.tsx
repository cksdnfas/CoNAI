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
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { listWallpaperWidgetDefinitions } from './wallpaper-widget-registry'
import { getWallpaperWidgetLibrarySearchSummary, type WallpaperWidgetLibraryFolderId } from './wallpaper-widget-library-search'
import type { WallpaperWidgetDefinition, WallpaperWidgetType } from './wallpaper-types'

interface WallpaperWidgetLibrarySidebarProps {
  selectedWidgetType?: WallpaperWidgetType | null
  onAddWidget: (widgetType: WallpaperWidgetType) => void
}

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

function sortWallpaperWidgetDefinitions(left: WallpaperWidgetDefinition, right: WallpaperWidgetDefinition, locale: string) {
  return left.title.localeCompare(right.title, locale, { numeric: true, sensitivity: 'base' })
}

/** Render one explorer-style wallpaper widget library with folder-style grouping. */
export function WallpaperWidgetLibrarySidebar({ selectedWidgetType, onAddWidget }: WallpaperWidgetLibrarySidebarProps) {
  const { locale, t } = useI18n()
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<WallpaperWidgetLibraryFolderId[]>([])

  const widgetDefinitions = useMemo(
    () => [...listWallpaperWidgetDefinitions()].sort((left, right) => sortWallpaperWidgetDefinitions(left, right, locale)),
    [locale],
  )
  const searchSummary = useMemo(
    () => getWallpaperWidgetLibrarySearchSummary(widgetDefinitions, searchQuery, t),
    [searchQuery, t, widgetDefinitions],
  )

  const hasVisibleWidgets = searchSummary.visibleFolders.length > 0

  const toggleFolder = (folderId: WallpaperWidgetLibraryFolderId) => {
    setCollapsedFolderIds((current) => (
      current.includes(folderId)
        ? current.filter((item) => item !== folderId)
        : [...current, folderId]
    ))
  }

  return (
    <ExplorerSidebar
      title={t({ ko: '위젯 라이브러리', en: 'Widget library' })}
      badge={(
        <Badge
          variant="outline"
          title={searchSummary.hasSearch
            ? t({ ko: `검색 결과 ${searchSummary.visibleWidgetCount} / 전체 ${searchSummary.totalWidgetCount}`, en: `${searchSummary.visibleWidgetCount} / ${searchSummary.totalWidgetCount} matching widgets` })
            : t({ ko: `전체 ${searchSummary.totalWidgetCount}`, en: `${searchSummary.totalWidgetCount} total widgets` })}
        >
          {searchSummary.badgeText}
        </Badge>
      )}
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
              placeholder={t({ ko: '위젯 검색', en: 'Search widgets' })}
              className="h-8 pl-9 text-sm"
            />
          </div>
        </div>
      }
    >
      {searchSummary.visibleFolders.map((folder) => {
        const isExpanded = searchSummary.hasSearch ? true : !collapsedFolderIds.includes(folder.id)

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
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{t(folder.title)}</span>
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
          <AlertTitle>{t({ ko: '검색 결과가 없어', en: 'No matching widgets' })}</AlertTitle>
          <AlertDescription>{t({ ko: '다른 이름이나 설명 키워드로 다시 찾아봐.', en: 'Try another name or description keyword.' })}</AlertDescription>
        </Alert>
      ) : null}
    </ExplorerSidebar>
  )
}
