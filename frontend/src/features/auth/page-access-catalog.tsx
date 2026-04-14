import { FolderTree, House, Image as ImageIcon, LayoutGrid, MessageSquareText, Settings2, Sparkles, Upload, type LucideIcon } from 'lucide-react'
import { hasAuthPermission } from './auth-permissions'

export interface PageAccessCatalogItem {
  path: string
  label: string
  description: string
  permissionKey: string
  icon: LucideIcon
}

export const PAGE_ACCESS_CATALOG: PageAccessCatalogItem[] = [
  {
    path: '/',
    label: '홈',
    description: '이미지 탐색',
    permissionKey: 'page.home.view',
    icon: House,
  },
  {
    path: '/groups',
    label: '그룹',
    description: '그룹 탐색',
    permissionKey: 'page.groups.view',
    icon: FolderTree,
  },
  {
    path: '/prompts',
    label: '프롬프트',
    description: '프롬프트 확인',
    permissionKey: 'page.prompts.view',
    icon: MessageSquareText,
  },
  {
    path: '/generation',
    label: '생성',
    description: '이미지 생성',
    permissionKey: 'page.generation.view',
    icon: Sparkles,
  },
  {
    path: '/wallpaper',
    label: '월페이퍼',
    description: '편집 화면',
    permissionKey: 'page.wallpaper.view',
    icon: LayoutGrid,
  },
  {
    path: '/wallpaper/runtime',
    label: '월페이퍼 런타임',
    description: '실행 화면',
    permissionKey: 'page.wallpaper.runtime.view',
    icon: ImageIcon,
  },
  {
    path: '/upload',
    label: '업로드',
    description: '파일 등록',
    permissionKey: 'page.upload.view',
    icon: Upload,
  },
  {
    path: '/settings',
    label: '설정',
    description: '환경 관리',
    permissionKey: 'page.settings.view',
    icon: Settings2,
  },
]

/** Return only the major destinations that the current account can open now. */
export function listAccessiblePageAccessItems(permissionKeys: string[]) {
  return PAGE_ACCESS_CATALOG.filter((item) => hasAuthPermission(permissionKeys, item.permissionKey))
}
