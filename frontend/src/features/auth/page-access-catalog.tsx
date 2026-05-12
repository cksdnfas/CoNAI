import { FolderTree, House, Image as ImageIcon, LayoutGrid, MessageSquareText, Settings2, Sparkles, Upload, WandSparkles, type LucideIcon } from 'lucide-react'
import { hasAuthPermission } from './auth-permissions'

export interface PageAccessCatalogItem {
  path: string
  labelKey: string
  descriptionKey: string
  permissionKey: string
  icon: LucideIcon
  category: 'primary' | 'derived'
}

export const PAGE_ACCESS_CATALOG: PageAccessCatalogItem[] = [
  {
    path: '/',
    labelKey: 'pageAccessCatalog.home',
    descriptionKey: 'pageAccessCatalog.imageBrowsing',
    permissionKey: 'page.home.view',
    icon: House,
    category: 'primary',
  },
  {
    path: '/groups',
    labelKey: 'pageAccessCatalog.groups',
    descriptionKey: 'pageAccessCatalog.groupBrowsing',
    permissionKey: 'page.groups.view',
    icon: FolderTree,
    category: 'primary',
  },
  {
    path: '/prompts',
    labelKey: 'pageAccessCatalog.prompts',
    descriptionKey: 'pageAccessCatalog.promptReview',
    permissionKey: 'page.prompts.view',
    icon: MessageSquareText,
    category: 'primary',
  },
  {
    path: '/generation',
    labelKey: 'pageAccessCatalog.generation',
    descriptionKey: 'pageAccessCatalog.imageGeneration',
    permissionKey: 'page.generation.view',
    icon: Sparkles,
    category: 'primary',
  },
  {
    path: '/wildcards',
    labelKey: 'pageAccessCatalog.wildcards',
    descriptionKey: 'pageAccessCatalog.wildcardWork',
    permissionKey: 'page.wildcards.view',
    icon: WandSparkles,
    category: 'derived',
  },
  {
    path: '/wallpaper',
    labelKey: 'pageAccessCatalog.wallpaper',
    descriptionKey: 'pageAccessCatalog.editorView',
    permissionKey: 'page.wallpaper.view',
    icon: LayoutGrid,
    category: 'primary',
  },
  {
    path: '/wallpaper/runtime',
    labelKey: 'pageAccessCatalog.wallpaperRuntime',
    descriptionKey: 'pageAccessCatalog.runtimeView',
    permissionKey: 'page.wallpaper.runtime.view',
    icon: ImageIcon,
    category: 'derived',
  },
  {
    path: '/upload',
    labelKey: 'pageAccessCatalog.upload',
    descriptionKey: 'pageAccessCatalog.fileRegistration',
    permissionKey: 'page.upload.view',
    icon: Upload,
    category: 'primary',
  },
  {
    path: '/settings',
    labelKey: 'pageAccessCatalog.settings',
    descriptionKey: 'pageAccessCatalog.environmentManagement',
    permissionKey: 'page.settings.view',
    icon: Settings2,
    category: 'primary',
  },
]

/** Return only the major destinations that the current account can open now. */
export function listAccessiblePageAccessItems(permissionKeys: string[]) {
  return PAGE_ACCESS_CATALOG.filter((item) => hasAuthPermission(permissionKeys, item.permissionKey))
}
