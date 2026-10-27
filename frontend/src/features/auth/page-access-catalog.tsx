import { Archive, AudioLines, Blocks, Contact, Film, FolderTree, Image as ImageIcon, Images, LayoutGrid, MessageSquareText, Newspaper, Settings, Shuffle, Tags, Upload, Wallpaper, Wand, type LucideIcon } from 'lucide-react'
import { chatPagePermission } from '@conai/shared'
import { hasAuthPermission } from './auth-permissions'

export interface PageAccessCatalogItem {
  path: string
  labelKey: string
  permissionKey: string
  icon: LucideIcon
}

/**
 * Every page a person can be sent to, with its name and icon. Icons keep one meaning across the app: the gear is app
 * settings only (a page's own settings use sliders) and the wand is image or media generation (✦ is AI writing).
 */
const PAGE_ACCESS_ENTRIES: Omit<PageAccessCatalogItem, 'permissionKey'>[] = [
  { path: '/access', labelKey: 'appShell.availablePages', icon: LayoutGrid },
  { path: '/', labelKey: 'pageAccessCatalog.home', icon: Images },
  { path: '/groups', labelKey: 'pageAccessCatalog.groups', icon: FolderTree },
  { path: '/upload', labelKey: 'pageAccessCatalog.upload', icon: Upload },
  { path: '/files', labelKey: 'pageAccessCatalog.files', icon: Archive },
  { path: '/prompts', labelKey: 'pageAccessCatalog.prompts', icon: Tags },
  { path: '/wildcards', labelKey: 'pageAccessCatalog.wildcards', icon: Shuffle },
  { path: '/characters', labelKey: 'pageAccessCatalog.characters', icon: Contact },
  { path: '/generation', labelKey: 'pageAccessCatalog.generation', icon: Wand },
  { path: '/audio', labelKey: 'pageAccessCatalog.audio', icon: AudioLines },
  { path: '/sprite', labelKey: 'pageAccessCatalog.sprite', icon: Film },
  { path: '/chat', labelKey: 'pageAccessCatalog.chat', icon: MessageSquareText },
  { path: '/posts', labelKey: 'pageAccessCatalog.posts', icon: Newspaper },
  { path: '/wallpaper', labelKey: 'pageAccessCatalog.wallpaper', icon: Wallpaper },
  { path: '/wallpaper/runtime', labelKey: 'pageAccessCatalog.wallpaperRuntime', icon: ImageIcon },
  { path: '/extensions', labelKey: 'pageAccessCatalog.extensions', icon: Blocks },
  { path: '/settings', labelKey: 'pageAccessCatalog.settings', icon: Settings },
]

/** Page keys come from the shared route map, so a route's key is written in one place. */
export const PAGE_ACCESS_CATALOG: PageAccessCatalogItem[] = PAGE_ACCESS_ENTRIES.map((entry) => ({ ...entry, permissionKey: chatPagePermission(entry.path) ?? '' }))

/** Return only the major destinations that the current account can open now. */
export function listAccessiblePageAccessItems(permissionKeys: string[]) {
  return PAGE_ACCESS_CATALOG.filter((item) => !item.permissionKey || hasAuthPermission(permissionKeys, item.permissionKey))
}
