import { FolderTree, Image as ImageIcon, Images, LayoutGrid, MessageSquareText, Settings2, Sparkles, Upload, WandSparkles, type LucideIcon } from 'lucide-react'
import { hasAuthPermission } from './auth-permissions'

export interface PageAccessCatalogItem {
  path: string
  labelKey: string
  permissionKey: string
  icon: LucideIcon
  category: 'primary' | 'derived'
}

export const PAGE_ACCESS_CATALOG: PageAccessCatalogItem[] = [
  {
    path: '/',
    labelKey: 'pageAccessCatalog.home',
    permissionKey: 'page.home.view',
    icon: Images,
    category: 'primary',
  },
  {
    path: '/groups',
    labelKey: 'pageAccessCatalog.groups',
    permissionKey: 'page.groups.view',
    icon: FolderTree,
    category: 'primary',
  },
  {
    path: '/prompts',
    labelKey: 'pageAccessCatalog.prompts',
    permissionKey: 'page.prompts.view',
    icon: MessageSquareText,
    category: 'primary',
  },
  {
    path: '/generation',
    labelKey: 'pageAccessCatalog.generation',
    permissionKey: 'page.generation.view',
    icon: Sparkles,
    category: 'primary',
  },
  {
    path: '/wildcards',
    labelKey: 'pageAccessCatalog.wildcards',
    permissionKey: 'page.wildcards.view',
    icon: WandSparkles,
    category: 'derived',
  },
  {
    path: '/wallpaper',
    labelKey: 'pageAccessCatalog.wallpaper',
    permissionKey: 'page.wallpaper.view',
    icon: LayoutGrid,
    category: 'primary',
  },
  {
    path: '/wallpaper/runtime',
    labelKey: 'pageAccessCatalog.wallpaperRuntime',
    permissionKey: 'page.wallpaper.runtime.view',
    icon: ImageIcon,
    category: 'derived',
  },
  {
    path: '/upload',
    labelKey: 'pageAccessCatalog.upload',
    permissionKey: 'page.upload.view',
    icon: Upload,
    category: 'primary',
  },
  {
    path: '/settings',
    labelKey: 'pageAccessCatalog.settings',
    permissionKey: 'page.settings.view',
    icon: Settings2,
    category: 'primary',
  },
]

/** Return only the major destinations that the current account can open now. */
export function listAccessiblePageAccessItems(permissionKeys: string[]) {
  return PAGE_ACCESS_CATALOG.filter((item) => hasAuthPermission(permissionKeys, item.permissionKey))
}
