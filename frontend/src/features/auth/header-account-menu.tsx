import { useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleUserRound, LogIn, LogOut, Map as MapIcon } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnchoredPopup, anchoredPopupBodyClassName } from '@/components/ui/anchored-popup'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { logoutLocalAccount } from '@/lib/api-auth'
import { LanguageSwitch } from './language-switch'
import { AUTH_STATUS_QUERY_KEY, useAuthStatusQuery } from './use-auth-status-query'

/** Render one compact header account button with a mini popup for account actions and the page list. */
export function HeaderAccountMenu() {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const authStatusQuery = useAuthStatusQuery()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const authStatus = authStatusQuery.data ?? null
  const isSignedIn = authStatus?.hasCredentials === true && authStatus?.authenticated === true && Boolean(authStatus.username)
  const isAnonymousSession = authStatus?.hasCredentials === true && authStatus?.authenticated !== true

  const accountTypeLabel = useMemo(() => {
    if (authStatus?.accountType === 'admin') {
      return t({ ko: '관리자', en: 'Admin' })
    }
    if (authStatus?.accountType === 'guest') {
      return t({ ko: '게스트', en: 'Guest' })
    }
    return t({ ko: '계정', en: 'Account' })
  }, [authStatus?.accountType, t])

  const logoutMutation = useMutation({
    mutationFn: logoutLocalAccount,
    onSuccess: async () => {
      await queryClient.cancelQueries()
      queryClient.clear()
      queryClient.setQueryData(AUTH_STATUS_QUERY_KEY, {
        hasCredentials: true,
        authenticated: false,
        username: null,
        accountId: null,
        accountType: null,
        isAdmin: false,
        groupKeys: ['anonymous'],
        permissionKeys: [],
      })
      await queryClient.invalidateQueries({ queryKey: AUTH_STATUS_QUERY_KEY })
      setIsOpen(false)
      showSnackbar({ message: t('headerAccountMenu.signedOut'), tone: 'info' })
      navigate('/login', { replace: true })
    },
    onError: (error) => {
      showSnackbar({
        message: error instanceof Error ? error.message : t('headerAccountMenu.signOutFailed'),
        tone: 'error',
      })
    },
  })

  if (!authStatus) {
    return null
  }

  const openPage = (path: string) => {
    setIsOpen(false)
    navigate(path)
  }

  return (
    <div ref={containerRef} className="relative">
      <IconButton
        variant="shell"
        onClick={() => setIsOpen((current) => !current)}
        data-state={isOpen ? 'open' : 'closed'}
        label={t('headerAccountMenu.accountMenu')}
        tooltipSide="bottom"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <CircleUserRound className="h-4 w-4" />
      </IconButton>

      <AnchoredPopup open={isOpen} anchorRef={containerRef} onClose={() => setIsOpen(false)} align="end" side="bottom" closeOnBack>
        <div className={`w-[220px] space-y-3 ${anchoredPopupBodyClassName}`} role="menu" aria-label={t('headerAccountMenu.accountMenu')}>
          {isSignedIn ? (
            <div className="space-y-1">
              <div className="text-sm font-semibold text-foreground">{authStatus.username}</div>
              <div className="text-xs text-muted-foreground">{accountTypeLabel}</div>
            </div>
          ) : isAnonymousSession ? (
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">{t({ ko: '로그인하지 않음', en: 'Not signed in' })}</div>
            </div>
          ) : null}

          {/* Anonymous sessions are sent to /login by the shell guard, so the page list is only offered once signed in. */}
          {!isAnonymousSession ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => openPage('/access')}
            >
              <MapIcon className="h-4 w-4" />
              {t('appShell.availablePages')}
            </Button>
          ) : null}

          <LanguageSwitch />

          {isSignedIn ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-full justify-start"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
            >
              <LogOut className="h-4 w-4" />
              {logoutMutation.isPending ? t('headerAccountMenu.signingOut') : t('headerAccountMenu.signOut')}
            </Button>
          ) : null}

          {isAnonymousSession ? (
            <Button
              type="button"
              size="sm"
              className="w-full justify-start"
              onClick={() => openPage(`/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`)}
            >
              <LogIn className="h-4 w-4" />
              {t('loginPage.signIn')}
            </Button>
          ) : null}
        </div>
      </AnchoredPopup>
    </div>
  )
}
