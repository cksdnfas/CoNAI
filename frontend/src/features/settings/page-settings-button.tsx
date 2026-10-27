import { lazy, Suspense } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { IconButton } from '@/components/ui/icon-button'
import { Button } from '@/components/ui/button'
import { usePageSettings } from '@/components/common/page-settings-context'
import { PAGE_ACCESS_CATALOG } from '@/features/auth/page-access-catalog'
import { useI18n } from '@/i18n'

const PageSettingsDialog = lazy(() => import('./page-settings-dialog'))

/**
 * This page's settings in the header ("갤러리 설정"): sliders, never the gear (app settings), worded from lg and an
 * icon key below, where the pinned pages and menus need the room.
 */
export function PageSettingsButton() {
  const settings = usePageSettings()
  const { pathname } = useLocation()
  const { t } = useI18n()
  if (!settings.scopes.length) return null
  const page = PAGE_ACCESS_CATALOG.find((item) => item.path === pathname)
  const label = pathname === '/settings' ? t({ ko: '공용 설정 빠른 편집', en: 'Quick shared settings' }) : settings.scopes.length === 1 && settings.scopes[0] === 'appearance' ? t({ ko: '공용 화면 설정', en: 'Shared appearance settings' }) : page ? t({ ko: '{page} 설정', en: '{page} settings' }, { page: t(page.labelKey) }) : t({ ko: '현재 페이지 설정', en: 'Current page settings' })
  return <>
    <Button variant="ghost" size="sm" className="hidden lg:inline-flex" onClick={() => settings.open()}><SlidersHorizontal />{label}</Button>
    <IconButton className="lg:hidden" variant="ghost" label={label} onClick={() => settings.open()}><SlidersHorizontal /></IconButton>
    {settings.scope ? <Suspense fallback={null}><PageSettingsDialog key={pathname} title={label} /></Suspense> : null}
  </>
}
