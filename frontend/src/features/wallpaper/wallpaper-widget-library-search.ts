import { WALLPAPER_WIDGET_CATEGORIES } from './wallpaper-widget-registry'
import type { WallpaperWidgetCategory, WallpaperWidgetDefinition } from './wallpaper-types'

export type WallpaperWidgetLibraryFolderId = WallpaperWidgetCategory

type WallpaperWidgetLibraryTranslationDictionary = Partial<Record<'ko' | 'en', string>>

export interface WallpaperWidgetLibraryVisibleFolder {
  id: WallpaperWidgetLibraryFolderId
  title: WallpaperWidgetLibraryTranslationDictionary
  widgets: WallpaperWidgetDefinition[]
}

export interface WallpaperWidgetLibrarySearchSummary {
  hasSearch: boolean
  totalWidgetCount: number
  visibleWidgetCount: number
  badgeText: string
  visibleFolders: WallpaperWidgetLibraryVisibleFolder[]
}

function matchesWallpaperWidgetQuery(widget: WallpaperWidgetDefinition, folderTitle: string, query: string) {
  if (!query) {
    return true
  }

  return [
    ...Object.values(widget.title),
    ...Object.values(widget.description),
    widget.type,
    folderTitle,
    ...(widget.searchKeywords ?? []),
  ]
    .join(' ')
    .toLowerCase()
    .includes(query)
}

/** Widgets per category, in registry order, filtered by the search text. */
export function getWallpaperWidgetLibraryVisibleFolders(widgetDefinitions: WallpaperWidgetDefinition[], query: string, t: (dictionary: WallpaperWidgetLibraryTranslationDictionary) => string): WallpaperWidgetLibraryVisibleFolder[] {
  const normalizedQuery = query.trim().toLowerCase()
  return WALLPAPER_WIDGET_CATEGORIES
    .map((category) => {
      const folderTitle = t(category.title)
      return {
        id: category.id,
        title: category.title,
        widgets: widgetDefinitions.filter((widget) => widget.category === category.id && matchesWallpaperWidgetQuery(widget, folderTitle, normalizedQuery)),
      }
    })
    .filter((folder) => folder.widgets.length > 0)
}

export function getWallpaperWidgetLibrarySearchSummary(widgetDefinitions: WallpaperWidgetDefinition[], query: string, t: (dictionary: WallpaperWidgetLibraryTranslationDictionary) => string): WallpaperWidgetLibrarySearchSummary {
  const visibleFolders = getWallpaperWidgetLibraryVisibleFolders(widgetDefinitions, query, t)
  const visibleWidgetCount = visibleFolders.reduce((total, folder) => total + folder.widgets.length, 0)
  const totalWidgetCount = widgetDefinitions.length
  const hasSearch = query.trim().length > 0

  return {
    hasSearch,
    totalWidgetCount,
    visibleWidgetCount,
    badgeText: hasSearch ? `${visibleWidgetCount}/${totalWidgetCount}` : String(totalWidgetCount),
    visibleFolders,
  }
}
