import { useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleUserRound, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { AnchoredPopup } from '@/components/ui/anchored-popup'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { logoutLocalAccount } from '@/lib/api'
import { AUTH_STATUS_QUERY_KEY, useAuthStatusQuery } from './use-auth-status-query'

/** Render one compact header account button with a mini popup for logout. */
export function HeaderAccountMenu() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const authStatusQuery = useAuthStatusQuery()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const authStatus = authStatusQuery.data ?? null
  const isVisible = authStatus?.hasCredentials === true && authStatus?.authenticated === true && Boolean(authStatus.username)

  const accountTypeLabel = useMemo(() => {
    if (authStatus?.accountType === 'admin') {
      return '관리자'
    }
    if (authStatus?.accountType === 'guest') {
      return '게스트'
    }
    return '계정'
  }, [authStatus?.accountType])

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
      showSnackbar({ message: '로그아웃했어.', tone: 'info' })
      navigate('/login', { replace: true })
    },
    onError: (error) => {
      showSnackbar({
        message: error instanceof Error ? error.message : '로그아웃에 실패했어.',
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
        className="theme-floating-panel inline-flex items-center gap-2 rounded-full p-2 text-sm text-foreground transition hover:bg-surface-high"
        aria-label="계정 메뉴"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title="계정"
      >
        <CircleUserRound className="h-4 w-4" />
      </button>

      <AnchoredPopup open={isOpen} anchorRef={containerRef} onClose={() => setIsOpen(false)} align="end" side="bottom">
        <div className="w-[220px] space-y-3 p-3" role="menu" aria-label="계정 메뉴">
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">현재 계정</div>
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
            {logoutMutation.isPending ? '로그아웃 중…' : '로그아웃'}
          </Button>
        </div>
      </AnchoredPopup>
    </div>
  )
}
