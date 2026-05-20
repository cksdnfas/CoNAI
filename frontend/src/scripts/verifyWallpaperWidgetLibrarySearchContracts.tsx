import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deepEqual, equal } from 'node:assert/strict'
import { getWallpaperWidgetLibrarySearchSummary, getWallpaperWidgetLibraryVisibleFolders } from '../features/wallpaper/wallpaper-widget-library-search'
import { listWallpaperWidgetDefinitions } from '../features/wallpaper/wallpaper-widget-registry'

const __dirname = dirname(fileURLToPath(import.meta.url))

type TranslationDictionary = Partial<Record<'ko' | 'en', string>>

const widgets = [...listWallpaperWidgetDefinitions()]
const ko = (dictionary: TranslationDictionary) => dictionary.ko ?? dictionary.en ?? ''
const en = (dictionary: TranslationDictionary) => dictionary.en ?? dictionary.ko ?? ''

const allSummary = getWallpaperWidgetLibrarySearchSummary(widgets, '', ko)
equal(allSummary.totalWidgetCount, 8)
equal(allSummary.visibleWidgetCount, 8)
equal(allSummary.badgeText, '8')
deepEqual(allSummary.visibleFolders.map((folder) => `${folder.id}:${folder.widgets.length}`), ['realtime:3', 'images:4', 'notes:1'])

const imageSummary = getWallpaperWidgetLibrarySearchSummary(widgets, '이미지', ko)
equal(imageSummary.visibleWidgetCount, 4)
equal(imageSummary.badgeText, '4/8')
deepEqual(imageSummary.visibleFolders.map((folder) => folder.id), ['images'])

const typedSummary = getWallpaperWidgetLibrarySearchSummary(widgets, '  queue-status  ', ko)
equal(typedSummary.visibleWidgetCount, 1)
equal(typedSummary.badgeText, '1/8')
equal(typedSummary.visibleFolders[0]?.widgets[0]?.type, 'queue-status')

const englishFolderSummary = getWallpaperWidgetLibrarySearchSummary(widgets, 'images', en)
equal(englishFolderSummary.visibleWidgetCount, 4)
deepEqual(englishFolderSummary.visibleFolders.map((folder) => folder.id), ['images'])

const emptySummary = getWallpaperWidgetLibrarySearchSummary(widgets, 'missing-widget-query', ko)
equal(emptySummary.visibleWidgetCount, 0)
equal(emptySummary.badgeText, '0/8')
deepEqual(emptySummary.visibleFolders, [])

const visibleFolders = getWallpaperWidgetLibraryVisibleFolders(widgets, '실행', ko)
deepEqual(visibleFolders.flatMap((folder) => folder.widgets.map((widget) => widget.type)), ['queue-status', 'activity-pulse'])

const librarySidebarSource = readFileSync(resolve(__dirname, '../features/wallpaper/wallpaper-widget-library-sidebar.tsx'), 'utf8')
equal(
  librarySidebarSource.includes('const collapsedFolderIdSet = useMemo(() => new Set(collapsedFolderIds), [collapsedFolderIds])'),
  true,
  'widget library sidebar should memoize collapsed folder ids for render lookups',
)
equal(
  librarySidebarSource.includes('!collapsedFolderIds.includes(folder.id)'),
  false,
  'widget library sidebar should not scan collapsedFolderIds for each visible folder render',
)

console.log('Wallpaper widget library search contracts verified.')
