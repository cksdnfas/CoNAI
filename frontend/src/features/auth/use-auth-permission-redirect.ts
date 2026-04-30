import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { PAGE_ACCESS_CATALOG } from './page-access-catalog'

interface UseAuthPermissionRedirectOptions {
  enabled: boolean
  permissionKey: string
}

/** Redirect one blocked page visit to the access overview with a shared snackbar notice. */
export function useAuthPermissionRedirect({ enabled, permissionKey }: UseAuthPermissionRedirectOptions) {
  const location = useLocation()
  const navigate = useNavigate()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const hasRedirectedRef = useRef(false)

  useEffect(() => {
    if (!enabled || hasRedirectedRef.current) {
      return
    }

    hasRedirectedRef.current = true
    const matchedPage = PAGE_ACCESS_CATALOG.find((item) => item.permissionKey === permissionKey)
    const pageLabel = matchedPage ? t(matchedPage.labelKey) : t('useAuthPermissionRedirect.thisPage')

    showSnackbar({
      message: t('useAuthPermissionRedirect.valueCannotBeOpenedWith', { pageLabel }),
      tone: 'error',
    })

    const nextPath = `${location.pathname}${location.search}`
    navigate('/access', {
      replace: true,
      state: nextPath ? { blockedPath: nextPath, blockedPermissionKey: permissionKey } : undefined,
    })
  }, [enabled, location.pathname, location.search, navigate, permissionKey, showSnackbar, t])
}
