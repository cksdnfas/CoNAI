import { FolderTree, House, Image as ImageIcon, LayoutGrid, MessageSquareText, Settings2, Sparkles, Upload, WandSparkles, type LucideIcon } from 'lucide-react'
import { hasAuthPermission } from './auth-permissions'

export interface PageAccessCatalogItem {
  path: string
  label: string
  labelKey: string
  description: string
  descriptionKey: string
  permissionKey: string
  icon: LucideIcon
  category: 'primary' | 'derived'
}

export const PAGE_ACCESS_CATALOG: PageAccessCatalogItem[] = [
  {
    path: '/',
    label: '홈',
    labelKey: 'pageAccessCatalog.home',
    description: '이미지 탐색',
    descriptionKey: 'pageAccessCatalog.imageBrowsing',
    permissionKey: 'page.home.view',
    icon: House,
    category: 'primary',
  },
  {
    path: '/groups',
    label: '그룹',
    labelKey: 'pageAccessCatalog.groups',
    description: '그룹 탐색',
    descriptionKey: 'pageAccessCatalog.groupBrowsing',
    permissionKey: 'page.groups.view',
    icon: FolderTree,
    category: 'primary',
  },
  {
    path: '/prompts',
    label: '프롬프트',
    labelKey: 'pageAccessCatalog.prompts',
    description: '프롬프트 확인',
    descriptionKey: 'pageAccessCatalog.promptReview',
    permissionKey: 'page.prompts.view',
    icon: MessageSquareText,
    category: 'primary',
  },
  {
    path: '/generation',
    label: '생성',
    labelKey: 'pageAccessCatalog.generation',
    description: '이미지 생성',
    descriptionKey: 'pageAccessCatalog.imageGeneration',
    permissionKey: 'page.generation.view',
    icon: Sparkles,
    category: 'primary',
  },
  {
    path: '/wildcards',
    label: '와일드카드',
    labelKey: 'pageAccessCatalog.wildcards',
    description: '와일드카드 작업',
    descriptionKey: 'pageAccessCatalog.wildcardWork',
    permissionKey: 'page.wildcards.view',
    icon: WandSparkles,
    category: 'derived',
  },
  {
    path: '/wallpaper',
    label: '월페이퍼',
    labelKey: 'pageAccessCatalog.wallpaper',
    description: '편집 화면',
    descriptionKey: 'pageAccessCatalog.editorView',
    permissionKey: 'page.wallpaper.view',
    icon: LayoutGrid,
    category: 'primary',
  },
  {
    path: '/wallpaper/runtime',
    label: '월페이퍼 런타임',
    labelKey: 'pageAccessCatalog.wallpaperRuntime',
    description: '실행 화면',
    descriptionKey: 'pageAccessCatalog.runtimeView',
    permissionKey: 'page.wallpaper.runtime.view',
    icon: ImageIcon,
    category: 'derived',
  },
  {
    path: '/upload',
    label: '업로드',
    labelKey: 'pageAccessCatalog.upload',
    description: '파일 등록',
    descriptionKey: 'pageAccessCatalog.fileRegistration',
    permissionKey: 'page.upload.view',
    icon: Upload,
    category: 'primary',
  },
  {
    path: '/settings',
    label: '설정',
    labelKey: 'pageAccessCatalog.settings',
    description: '환경 관리',
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
