import type { WallpaperWidgetDefinition, WallpaperWidgetType } from './wallpaper-types'

export type WallpaperWidgetLibraryFolderId = 'realtime' | 'images' | 'notes' | 'misc'

type WallpaperWidgetLibraryTranslationDictionary = Partial<Record<'ko' | 'en', string>>

interface WallpaperWidgetLibraryFolder {
  id: WallpaperWidgetLibraryFolderId
  title: WallpaperWidgetLibraryTranslationDictionary
  widgetTypes: WallpaperWidgetType[]
}

export interface WallpaperWidgetLibraryVisibleFolder extends WallpaperWidgetLibraryFolder {
  widgets: WallpaperWidgetDefinition[]
}

export interface WallpaperWidgetLibrarySearchSummary {
  hasSearch: boolean
  totalWidgetCount: number
  visibleWidgetCount: number
  badgeText: string
  visibleFolders: WallpaperWidgetLibraryVisibleFolder[]
}

const WALLPAPER_WIDGET_LIBRARY_FOLDERS: WallpaperWidgetLibraryFolder[] = [
  {
    id: 'realtime',
    title: { ko: '실시간 정보', en: 'Realtime' },
    widgetTypes: ['clock', 'queue-status', 'activity-pulse'],
  },
  {
    id: 'images',
    title: { ko: '이미지', en: 'Images' },
    widgetTypes: ['recent-results', 'group-image-view', 'image-showcase', 'floating-collage'],
  },
  {
    id: 'notes',
    title: { ko: '텍스트', en: 'Text' },
    widgetTypes: ['text-note'],
  },
]

const WIDGET_FOLDER_TITLE_BY_TYPE = new Map<WallpaperWidgetType, WallpaperWidgetLibraryTranslationDictionary>(
  WALLPAPER_WIDGET_LIBRARY_FOLDERS.flatMap((folder) => folder.widgetTypes.map((widgetType) => [widgetType, folder.title] as const)),
)

function matchesWallpaperWidgetQuery(widget: WallpaperWidgetDefinition, query: string, t: (dictionary: WallpaperWidgetLibraryTranslationDictionary) => string) {
  if (!query) {
    return true
  }

  const folderTitle = t(WIDGET_FOLDER_TITLE_BY_TYPE.get(widget.type) ?? { ko: '기타', en: 'Misc' })
  return [widget.title, widget.description, widget.type, folderTitle, ...(widget.searchKeywords ?? [])]
    .join(' ')
    .toLowerCase()
    .includes(query)
}

export function getWallpaperWidgetLibraryVisibleFolders(widgetDefinitions: WallpaperWidgetDefinition[], query: string, t: (dictionary: WallpaperWidgetLibraryTranslationDictionary) => string): WallpaperWidgetLibraryVisibleFolder[] {
  const normalizedQuery = query.trim().toLowerCase()
  const widgetDefinitionByType = new Map(widgetDefinitions.map((widget) => [widget.type, widget] as const))
  const knownWidgetTypes = new Set<WallpaperWidgetType>()
  const folders: WallpaperWidgetLibraryVisibleFolder[] = WALLPAPER_WIDGET_LIBRARY_FOLDERS.map((folder) => {
    const widgets = folder.widgetTypes
      .map((widgetType) => {
        knownWidgetTypes.add(widgetType)
        return widgetDefinitionByType.get(widgetType) ?? null
      })
      .filter((widget): widget is WallpaperWidgetDefinition => widget !== null)
      .filter((widget) => matchesWallpaperWidgetQuery(widget, normalizedQuery, t))

    return {
      ...folder,
      widgets,
    }
  })

  const miscWidgets = widgetDefinitions.filter((widget) => !knownWidgetTypes.has(widget.type) && matchesWallpaperWidgetQuery(widget, normalizedQuery, t))
  if (miscWidgets.length > 0) {
    folders.push({
      id: 'misc',
      title: { ko: '기타', en: 'Misc' },
      widgetTypes: miscWidgets.map((widget) => widget.type),
      widgets: miscWidgets,
    })
  }

  return folders.filter((folder) => folder.widgets.length > 0)
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
