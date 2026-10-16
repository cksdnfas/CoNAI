import { Archive, AudioLines, Film, FolderTree, Image as ImageIcon, Images, LayoutGrid, MessageSquareText, Newspaper, Settings2, Sparkles, Upload, WandSparkles, type LucideIcon } from 'lucide-react'
import { chatPagePermission } from '@conai/shared'
import { hasAuthPermission } from './auth-permissions'

export interface PageAccessCatalogItem {
  path: string
  labelKey: string
  permissionKey: string
  icon: LucideIcon
  category: 'primary' | 'derived'
}

// Same order as the header's default: library, making, chat then posts, the rest.
const PAGE_ACCESS_ENTRIES: Omit<PageAccessCatalogItem, 'permissionKey'>[] = [
  { path: '/extensions', labelKey: 'pageAccessCatalog.extensions', icon: LayoutGrid, category: 'derived' },
  {
    path: '/',
    labelKey: 'pageAccessCatalog.home',
    icon: Images,
    category: 'primary',
  },
  {
    path: '/groups',
    labelKey: 'pageAccessCatalog.groups',
    icon: FolderTree,
    category: 'primary',
  },
  {
    path: '/upload',
    labelKey: 'pageAccessCatalog.upload',
    icon: Upload,
    category: 'primary',
  },
  {
    path: '/files',
    labelKey: 'pageAccessCatalog.files',
    icon: Archive,
    category: 'primary',
  },
  {
    path: '/prompts',
    labelKey: 'pageAccessCatalog.prompts',
    icon: MessageSquareText,
    category: 'primary',
  },
  {
    path: '/wildcards',
    labelKey: 'pageAccessCatalog.wildcards',
    icon: WandSparkles,
    category: 'derived',
  },
  {
    path: '/generation',
    labelKey: 'pageAccessCatalog.generation',
    icon: Sparkles,
    category: 'primary',
  },
  {
    path: '/audio',
    labelKey: 'pageAccessCatalog.audio',
    icon: AudioLines,
    category: 'primary',
  },
  {
    path: '/sprite',
    labelKey: 'pageAccessCatalog.sprite',
    icon: Film,
    category: 'primary',
  },
  { path: '/chat', labelKey: 'pageAccessCatalog.chat', icon: MessageSquareText, category: 'derived' },
  {
    path: '/posts',
    labelKey: 'pageAccessCatalog.posts',
    icon: Newspaper,
    category: 'primary',
  },
  {
    path: '/wallpaper',
    labelKey: 'pageAccessCatalog.wallpaper',
    icon: LayoutGrid,
    category: 'primary',
  },
  {
    path: '/wallpaper/runtime',
    labelKey: 'pageAccessCatalog.wallpaperRuntime',
    icon: ImageIcon,
    category: 'derived',
  },
  {
    path: '/settings',
    labelKey: 'pageAccessCatalog.settings',
    icon: Settings2,
    category: 'primary',
  },
]

/** Page keys come from the shared route map, so a route's key is written in one place. */
export const PAGE_ACCESS_CATALOG: PageAccessCatalogItem[] = PAGE_ACCESS_ENTRIES.map((entry) => ({ ...entry, permissionKey: chatPagePermission(entry.path) ?? '' }))

/** Return only the major destinations that the current account can open now. */
export function listAccessiblePageAccessItems(permissionKeys: string[]) {
  return PAGE_ACCESS_CATALOG.filter((item) => !item.permissionKey || hasAuthPermission(permissionKeys, item.permissionKey))
}
