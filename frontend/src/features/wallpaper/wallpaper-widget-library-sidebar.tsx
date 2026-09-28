import { memo, useCallback, useMemo, useState } from 'react'
import {
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ExplorerSidebar } from '@/components/common/explorer-sidebar'
import { useI18n } from '@/i18n'
import { listWallpaperWidgetDefinitions } from './wallpaper-widget-registry'
import { getWallpaperWidgetLibrarySearchSummary, type WallpaperWidgetLibraryFolderId } from './wallpaper-widget-library-search'
import type { WallpaperWidgetDefinition, WallpaperWidgetType } from './wallpaper-types'

interface WallpaperWidgetLibrarySidebarProps {
  selectedWidgetType?: WallpaperWidgetType | null
  onAddWidget: (widgetType: WallpaperWidgetType) => void
}

interface WallpaperWidgetLibraryFolderProps {
  folder: ReturnType<typeof getWallpaperWidgetLibrarySearchSummary>['visibleFolders'][number]
  isExpanded: boolean
  selectedWidgetType?: WallpaperWidgetType | null
  onAddWidget: (widgetType: WallpaperWidgetType) => void
  onToggleFolder: (folderId: WallpaperWidgetLibraryFolderId) => void
  t: ReturnType<typeof useI18n>['t']
}

function getWallpaperWidgetIcon(widgetType: WallpaperWidgetType) {
  if (widgetType === 'clock') {
    return Clock3
  }

  if (widgetType === 'queue-status') {
    return BarChart3
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

function sortWallpaperWidgetDefinitions(left: WallpaperWidgetDefinition, right: WallpaperWidgetDefinition, locale: string, t: ReturnType<typeof useI18n>['t']) {
  return t(left.title).localeCompare(t(right.title), locale, { numeric: true, sensitivity: 'base' })
}

const WallpaperWidgetLibraryFolder = memo(function WallpaperWidgetLibraryFolder({
  folder,
  isExpanded,
  selectedWidgetType,
  onAddWidget,
  onToggleFolder,
  t,
}: WallpaperWidgetLibraryFolderProps) {
  const handleToggleFolder = useCallback(() => onToggleFolder(folder.id), [folder.id, onToggleFolder])

  return (
    <div className="space-y-1">
      <Button type="button" variant="nav" aria-expanded={isExpanded} onClick={handleToggleFolder} className="gap-2 px-2">
        {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <Folder className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{t(folder.title)}</span>
        <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-2xs">
          {folder.widgets.length}
        </Badge>
      </Button>

      {isExpanded ? (
        <div className="space-y-1 pl-6">
          {folder.widgets.map((widget) => {
            const Icon = getWallpaperWidgetIcon(widget.type)
            const isSelected = selectedWidgetType === widget.type
            return (
              <Button
                key={widget.type}
                type="button"
                variant="nav"
                data-active={isSelected}
                onClick={() => onAddWidget(widget.type)}
                className="gap-2"
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-foreground">{t(widget.title)}</span>
                <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
})

/** Render one explorer-style wallpaper widget library with folder-style grouping. */
export function WallpaperWidgetLibrarySidebar({ selectedWidgetType, onAddWidget }: WallpaperWidgetLibrarySidebarProps) {
  const { locale, t } = useI18n()
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<WallpaperWidgetLibraryFolderId[]>([])

  const widgetDefinitions = useMemo(
    () => [...listWallpaperWidgetDefinitions()].sort((left, right) => sortWallpaperWidgetDefinitions(left, right, locale, t)),
    [locale, t],
  )
  const searchSummary = useMemo(
    () => getWallpaperWidgetLibrarySearchSummary(widgetDefinitions, searchQuery, t),
    [searchQuery, t, widgetDefinitions],
  )
  const collapsedFolderIdSet = useMemo(() => new Set(collapsedFolderIds), [collapsedFolderIds])

  const hasVisibleWidgets = searchSummary.visibleFolders.length > 0

  const toggleFolder = useCallback((folderId: WallpaperWidgetLibraryFolderId) => {
    setCollapsedFolderIds((current) => (
      current.includes(folderId)
        ? current.filter((item) => item !== folderId)
        : [...current, folderId]
    ))
  }, [])

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
      {searchSummary.visibleFolders.map((folder) => (
        <WallpaperWidgetLibraryFolder
          key={folder.id}
          folder={folder}
          isExpanded={searchSummary.hasSearch ? true : !collapsedFolderIdSet.has(folder.id)}
          selectedWidgetType={selectedWidgetType}
          onAddWidget={onAddWidget}
          onToggleFolder={toggleFolder}
          t={t}
        />
      ))}

      {!hasVisibleWidgets ? (
        <Alert>
          <AlertTitle>{t({ ko: '검색 결과가 없어', en: 'No matching widgets' })}</AlertTitle>
          <AlertDescription>{t({ ko: '다른 이름이나 설명 키워드로 다시 찾아봐.', en: 'Try another name or description keyword.' })}</AlertDescription>
        </Alert>
      ) : null}
    </ExplorerSidebar>
  )
}
