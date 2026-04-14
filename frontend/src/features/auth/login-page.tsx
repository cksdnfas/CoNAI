import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleHelp, ShieldCheck, UserPlus } from 'lucide-react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/common/page-header'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { createGuestAccount, getAuthDatabaseInfo, loginLocalAccount, type AuthMutationRecord } from '@/lib/api'
import { AUTH_STATUS_QUERY_KEY, useAuthStatusQuery } from './use-auth-status-query'

/** Sanitize one post-login redirect target to local app paths only. */
function resolveNextPath(rawNext: string | null) {
  if (!rawNext || !rawNext.startsWith('/') || rawNext === '/login') {
    return '/'
  }

  return rawNext
}

export function LoginPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const authStatusQuery = useAuthStatusQuery()
  const databaseInfoQuery = useQuery({
    queryKey: ['auth-database-info'],
    queryFn: getAuthDatabaseInfo,
    staleTime: 60_000,
  })
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [guestUsername, setGuestUsername] = useState('')
  const [guestPassword, setGuestPassword] = useState('')
  const [isGuestModalOpen, setIsGuestModalOpen] = useState(false)
  const [isRecoveryModalOpen, setIsRecoveryModalOpen] = useState(false)

  const nextPath = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return resolveNextPath(params.get('next'))
  }, [location.search])
  const defaultPostLoginPath = nextPath === '/' ? '/access' : nextPath

  const applyAuthenticatedSession = (result: AuthMutationRecord, fallbackUsername: string) => {
    queryClient.setQueryData(AUTH_STATUS_QUERY_KEY, {
      hasCredentials: true,
      authenticated: true,
      username: result.username ?? fallbackUsername,
      accountId: result.accountId ?? null,
      accountType: result.accountType ?? null,
      isAdmin: result.isAdmin ?? false,
      groupKeys: result.groupKeys ?? [],
      permissionKeys: result.permissionKeys ?? [],
    })
  }

  const loginMutation = useMutation({
    mutationFn: ({ nextUsername, nextPassword }: { nextUsername: string; nextPassword: string }) =>
      loginLocalAccount(nextUsername, nextPassword),
    onSuccess: async (result) => {
      applyAuthenticatedSession(result, username.trim())
      setPassword('')
      showSnackbar({ message: '로그인됐어.', tone: 'info' })
      navigate(defaultPostLoginPath, { replace: true })
    },
    onError: (error) => {
      setPassword('')
      showSnackbar({ message: error instanceof Error ? error.message : '로그인에 실패했어.', tone: 'error' })
    },
  })

  const guestSignupMutation = useMutation({
    mutationFn: async ({ nextUsername, nextPassword }: { nextUsername: string; nextPassword: string }) => {
      await createGuestAccount(nextUsername, nextPassword)
      return loginLocalAccount(nextUsername, nextPassword)
    },
    onSuccess: (result) => {
      applyAuthenticatedSession(result, guestUsername.trim())
      setGuestUsername('')
      setGuestPassword('')
      setIsGuestModalOpen(false)
      showSnackbar({ message: '게스트 계정을 만들고 바로 들어왔어.', tone: 'info' })
      navigate(defaultPostLoginPath, { replace: true })
    },
    onError: (error) => {
      setGuestPassword('')
      showSnackbar({ message: error instanceof Error ? error.message : '게스트 계정 생성에 실패했어.', tone: 'error' })
    },
  })

  if (authStatusQuery.isLoading) {
    return <div className="min-h-screen bg-surface-low animate-pulse" />
  }

  if (authStatusQuery.data?.authenticated) {
    return <Navigate to={defaultPostLoginPath} replace />
  }

  const hasCredentials = authStatusQuery.data?.hasCredentials === true

  if (!hasCredentials) {
    return <Navigate to={nextPath} replace />
  }

  const databaseInfo = databaseInfoQuery.data ?? null

  return (
    <>
      <div className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-6 py-10">
        <div className="w-full space-y-8">
          <PageHeader
            eyebrow="Personal Access"
            title="로그인"
            description=""
          />

          <div className="grid gap-6">
            <Card className="border-primary/15 bg-card">
              <CardContent className="space-y-4">
                <SectionHeading
                  variant="inside"
                  heading="계정 로그인"
                  actions={
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">로컬 계정</Badge>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => setIsRecoveryModalOpen(true)}
                        aria-label="복구 안내"
                        title="복구 안내"
                      >
                        <CircleHelp className="h-4 w-4" />
                      </Button>
                    </div>
                  }
                />

                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void loginMutation.mutateAsync({ nextUsername: username.trim(), nextPassword: password })
                  }}
                >
                  <label className="block space-y-2 text-sm">
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">아이디</span>
                    <Input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
                  </label>
                  <label className="block space-y-2 text-sm">
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">비밀번호</span>
                    <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
                  </label>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Button type="button" variant="outline" onClick={() => setIsGuestModalOpen(true)}>
                      <UserPlus className="h-4 w-4" />
                      게스트 계정 만들기
                    </Button>
                    <Button type="submit" disabled={loginMutation.isPending || username.trim().length === 0 || password.length === 0}>
                      {loginMutation.isPending ? '로그인 중…' : '로그인'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

          </div>
        </div>
      </div>

      <SettingsModal
        open={isRecoveryModalOpen}
        onClose={() => setIsRecoveryModalOpen(false)}
        title="복구 안내"
        widthClassName="max-w-lg"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-primary/12 p-3 text-primary">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-semibold text-foreground">auth.db</div>
              <div className="text-sm text-muted-foreground break-all">{databaseInfo?.authDbPath ?? '불러오는 중…'}</div>
            </div>
          </div>

          <div className="rounded-sm border border-border bg-surface-container/72 px-3 py-3 text-sm text-muted-foreground">
            {databaseInfo?.recoveryInstructions.ko ?? '복구 안내를 불러오는 중…'}
          </div>
        </div>
      </SettingsModal>

      <SettingsModal
        open={isGuestModalOpen}
        onClose={() => {
          if (guestSignupMutation.isPending) {
            return
          }
          setIsGuestModalOpen(false)
        }}
        title="게스트 계정 만들기"
        widthClassName="max-w-lg"
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void guestSignupMutation.mutateAsync({ nextUsername: guestUsername.trim(), nextPassword: guestPassword })
          }}
        >
          <label className="block space-y-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">아이디</span>
            <Input value={guestUsername} onChange={(event) => setGuestUsername(event.target.value)} autoComplete="username" />
          </label>

          <label className="block space-y-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">비밀번호</span>
            <Input type="password" value={guestPassword} onChange={(event) => setGuestPassword(event.target.value)} autoComplete="new-password" />
          </label>

          <div className="text-sm text-muted-foreground">
            게스트 계정은 언제든 초기화될 수 있어.
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setIsGuestModalOpen(false)} disabled={guestSignupMutation.isPending}>
              취소
            </Button>
            <Button type="submit" disabled={guestSignupMutation.isPending || guestUsername.trim().length === 0 || guestPassword.length === 0}>
              {guestSignupMutation.isPending ? '생성 중…' : '만들고 바로 시작'}
            </Button>
          </div>
        </form>
      </SettingsModal>
    </>
  )
}
