import { memo, useCallback, useMemo, useState, type MouseEvent } from 'react'
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  Clock3,
  Grid2x2,
  ImageIcon,
  Images,
  Layers3,
  Plus,
  Search,
  Type,
} from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { SidebarGroupLabel, SidebarItem, SidebarNav } from '@/components/ui/sidebar'
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
  const handleToggleFolder = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    // Only expand / collapse: keep the mobile drawer open.
    event.preventDefault()
    onToggleFolder(folder.id)
  }, [folder.id, onToggleFolder])

  return (
    <>
      <SidebarItem
        icon={isExpanded ? ChevronDown : ChevronRight}
        label={t(folder.title)}
        aria-expanded={isExpanded}
        onClick={handleToggleFolder}
        className="font-medium text-foreground"
      />

      {isExpanded ? folder.widgets.map((widget) => (
        <SidebarItem
          key={widget.type}
          icon={getWallpaperWidgetIcon(widget.type)}
          label={t(widget.title)}
          depth={1}
          active={selectedWidgetType === widget.type}
          onClick={() => onAddWidget(widget.type)}
          trailing={<Plus className="size-3.5 text-muted-foreground" aria-hidden />}
        />
      )) : null}
    </>
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
        {searchSummary.hasSearch ? (
          <SidebarGroupLabel>{searchSummary.badgeText}</SidebarGroupLabel>
        ) : null}
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
      </SidebarNav>

      {!hasVisibleWidgets ? (
        <EmptyState size="compact" title={t({ ko: '검색 결과가 없어', en: 'No matching widgets' })} />
      ) : null}
    </div>
  )
}
