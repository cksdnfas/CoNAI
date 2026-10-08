import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleUserRound, Languages, LogIn, LogOut, MessageSquare, Search, type LucideIcon } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnchoredPopup, anchoredPopupBodyClassName } from '@/components/ui/anchored-popup'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Separator } from '@/components/ui/separator'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useCodexChatPanelToggle, useCodexChatUnreadCount } from '@/features/codex-chat/codex-chat-shell'
import { UnreadCount } from '@/features/codex-chat/chat-unread-count'
import { useHomeSearchToggle } from '@/features/home/components/home-search-ui'
import { useI18n } from '@/i18n'
import { logoutLocalAccount } from '@/lib/api-auth'
import { cn } from '@/lib/utils'
import { LanguageTabs } from './language-switch'
import { AUTH_STATUS_QUERY_KEY, useAuthStatusQuery } from './use-auth-status-query'

type HeaderAccountMenuProps = {
  /** Narrow headers fold the search key into this menu. */
  foldedSearch?: boolean
  /** Narrow headers fold the chat side-panel key into this menu. */
  foldedChat?: boolean
}

/** Render one compact header account button with a mini popup: who is signed in, language, sign-out, and folded header keys. */
export function HeaderAccountMenu({ foldedSearch = false, foldedChat = false }: HeaderAccountMenuProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const authStatusQuery = useAuthStatusQuery()
  const searchToggle = useHomeSearchToggle()
  const chatToggle = useCodexChatPanelToggle()
  const unreadCount = useCodexChatUnreadCount()
  const [isOpen, setIsOpen] = useState(false)
  const [isLanguageOpen, setIsLanguageOpen] = useState(false)
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

  const closeMenu = () => {
    setIsOpen(false)
    setIsLanguageOpen(false)
  }

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
      closeMenu()
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

  const showSearch = foldedSearch
  const menuChat = foldedChat ? chatToggle : null
  // The folded chat key hands its unread dot to this key.
  const hasUnreadChat = menuChat !== null && unreadCount > 0

  const runAndClose = (action: () => void) => {
    closeMenu()
    action()
  }

  return (
    <div ref={containerRef} className="relative">
      <IconButton
        variant="shell"
        onClick={() => (isOpen ? closeMenu() : setIsOpen(true))}
        data-state={isOpen ? 'open' : 'closed'}
        label={t('headerAccountMenu.accountMenu')}
        tooltipSide="bottom"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="relative"
      >
        <CircleUserRound className="h-4 w-4" />
        {hasUnreadChat ? <span aria-hidden="true" className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary" /> : null}
      </IconButton>

      <AnchoredPopup open={isOpen} anchorRef={containerRef} onClose={closeMenu} align="end" side="bottom" closeOnBack>
        <div className={`w-[248px] space-y-2 ${anchoredPopupBodyClassName}`} role="menu" aria-label={t('headerAccountMenu.accountMenu')}>
          <div className="flex items-center gap-2.5">
            {isSignedIn ? (
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/12 text-sm font-semibold text-primary" aria-hidden="true">
                {authStatus.username?.charAt(0).toUpperCase()}
              </span>
            ) : (
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-fill text-muted-foreground" aria-hidden="true">
                <CircleUserRound className="h-4 w-4" />
              </span>
            )}
            <div className="min-w-0 flex-1 leading-tight">
              {isSignedIn ? (
                <>
                  <div className="truncate text-sm font-semibold text-foreground">{authStatus.username}</div>
                  <div className="text-xs text-muted-foreground">{accountTypeLabel}</div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {isAnonymousSession ? t({ ko: '로그인하지 않음', en: 'Not signed in' }) : accountTypeLabel}
                </div>
              )}
            </div>
            <IconButton
              size="icon-sm"
              variant="ghost"
              label={t({ ko: '표시 언어', en: 'Display language' })}
              active={isLanguageOpen}
              onClick={() => setIsLanguageOpen((current) => !current)}
            >
              <Languages />
            </IconButton>
            {isSignedIn ? (
              <IconButton
                size="icon-sm"
                variant="ghost"
                label={logoutMutation.isPending ? t('headerAccountMenu.signingOut') : t('headerAccountMenu.signOut')}
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
              >
                <LogOut />
              </IconButton>
            ) : null}
          </div>

          {isLanguageOpen ? <LanguageTabs className="pb-1 pl-10.5" /> : null}

          {isAnonymousSession || showSearch || menuChat ? <Separator /> : null}

          {showSearch ? (
            <MenuRow
              icon={Search}
              label={t({ ko: '검색', en: 'Search' })}
              onClick={() => runAndClose(searchToggle.toggle)}
              end={searchToggle.appliedChipCount > 0 ? t({ ko: '필터 {count}', en: '{count} filters' }, { count: searchToggle.appliedChipCount }) : null}
            />
          ) : null}

          {menuChat ? (
            <MenuRow
              icon={MessageSquare}
              label={t({ ko: '채팅', en: 'Chat' })}
              onClick={() => runAndClose(menuChat.toggle)}
              onPointerEnter={menuChat.preload}
              end={unreadCount > 0 ? <UnreadCount count={unreadCount} /> : null}
            />
          ) : null}

          {isAnonymousSession ? (
            <MenuRow
              icon={LogIn}
              label={t('loginPage.signIn')}
              onClick={() => runAndClose(() => navigate(`/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`))}
              className="text-primary hover:text-primary [&_svg]:text-primary"
            />
          ) : null}
        </div>
      </AnchoredPopup>
    </div>
  )
}

/** One labelled action row; touch has no tooltips, so folded keys get words here. */
function MenuRow({ icon: Icon, label, end, onClick, onPointerEnter, className }: {
  icon: LucideIcon
  label: string
  end?: ReactNode
  onClick: () => void
  onPointerEnter?: () => void
  className?: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      role="menuitem"
      className={cn('w-full justify-start [&_svg]:text-muted-foreground', className)}
      onClick={onClick}
      onPointerEnter={onPointerEnter}
    >
      <Icon className="h-4 w-4" />
      {label}
      {end ? <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-normal tabular-nums text-muted-foreground">{end}</span> : null}
    </Button>
  )
}
