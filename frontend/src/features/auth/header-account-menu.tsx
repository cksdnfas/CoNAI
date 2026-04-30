import { useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleUserRound, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { AnchoredPopup, anchoredPopupBodyClassName, anchoredPopupLabelClassName } from '@/components/ui/anchored-popup'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { logoutLocalAccount } from '@/lib/api'
import { AUTH_STATUS_QUERY_KEY, useAuthStatusQuery } from './use-auth-status-query'

/** Render one compact header account button with a mini popup for logout. */
export function HeaderAccountMenu() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const authStatusQuery = useAuthStatusQuery()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const authStatus = authStatusQuery.data ?? null
  const isVisible = authStatus?.hasCredentials === true && authStatus?.authenticated === true && Boolean(authStatus.username)

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

  if (!isVisible) {
    return null
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        data-state={isOpen ? 'open' : 'closed'}
        className="theme-shell-icon-button inline-flex size-9 shrink-0 items-center justify-center rounded-sm text-foreground/80 transition-all duration-300 hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
        aria-label={t('headerAccountMenu.accountMenu')}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title={t({ ko: '계정', en: 'Account' })}
      >
        <CircleUserRound className="h-4 w-4" />
      </button>

      <AnchoredPopup open={isOpen} anchorRef={containerRef} onClose={() => setIsOpen(false)} align="end" side="bottom" closeOnBack>
        <div className={`w-[220px] space-y-3 ${anchoredPopupBodyClassName}`} role="menu" aria-label={t('headerAccountMenu.accountMenu')}>
          <div className="space-y-1">
            <div className={anchoredPopupLabelClassName}>{t({ ko: '현재 계정', en: 'Current account' })}</div>
            <div className="text-sm font-semibold text-foreground">{authStatus?.username}</div>
            <div className="text-xs text-muted-foreground">{accountTypeLabel}</div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full justify-start"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
          >
            <LogOut className="h-4 w-4" />
            {logoutMutation.isPending ? t('headerAccountMenu.signingOut') : t('headerAccountMenu.signOut')}
          </Button>
        </div>
      </AnchoredPopup>
    </div>
  )
}
