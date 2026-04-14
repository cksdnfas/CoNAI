import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck, UserPlus } from 'lucide-react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/common/page-header'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { createGuestAccount, getAuthDatabaseInfo, loginLocalAccount } from '@/lib/api'
import { AUTH_STATUS_QUERY_KEY, useAuthStatusQuery } from './use-auth-status-query'

/** Sanitize one post-login redirect target to local app paths only. */
function resolveNextPath(rawNext: string | null) {
  if (!rawNext || !rawNext.startsWith('/')) {
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

  const nextPath = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return resolveNextPath(params.get('next'))
  }, [location.search])

  const loginMutation = useMutation({
    mutationFn: ({ nextUsername, nextPassword }: { nextUsername: string; nextPassword: string }) =>
      loginLocalAccount(nextUsername, nextPassword),
    onSuccess: async (result) => {
      queryClient.setQueryData(AUTH_STATUS_QUERY_KEY, {
        hasCredentials: true,
        authenticated: true,
        username: result.username ?? username.trim(),
        accountId: result.accountId ?? null,
        accountType: result.accountType ?? null,
        isAdmin: result.isAdmin ?? false,
        groupKeys: result.groupKeys ?? [],
        permissionKeys: result.permissionKeys ?? [],
      })
      setPassword('')
      showSnackbar({ message: '로그인됐어.', tone: 'info' })
      navigate(nextPath, { replace: true })
    },
    onError: (error) => {
      setPassword('')
      showSnackbar({ message: error instanceof Error ? error.message : '로그인에 실패했어.', tone: 'error' })
    },
  })

  const guestSignupMutation = useMutation({
    mutationFn: ({ nextUsername, nextPassword }: { nextUsername: string; nextPassword: string }) =>
      createGuestAccount(nextUsername, nextPassword),
    onSuccess: (result) => {
      setGuestPassword('')
      setGuestUsername('')
      showSnackbar({ message: `${result.account.username} 계정을 만들었어.`, tone: 'info' })
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
    return <Navigate to={nextPath} replace />
  }

  const hasCredentials = authStatusQuery.data?.hasCredentials === true

  if (!hasCredentials) {
    return <Navigate to={nextPath} replace />
  }

  const databaseInfo = databaseInfoQuery.data ?? null

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-6 py-10">
      <div className="w-full space-y-8">
        <PageHeader
          eyebrow="Personal Access"
          title="로그인"
          description=""
        />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_320px]">
          <Card className="border-primary/15 bg-card">
            <CardContent className="space-y-4">
              <SectionHeading
                variant="inside"
                heading="계정 로그인"
                actions={
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">로컬 계정</Badge>
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
                <div className="flex justify-end">
                  <Button type="submit" disabled={loginMutation.isPending || username.trim().length === 0 || password.length === 0}>
                    {loginMutation.isPending ? '로그인 중…' : '로그인'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4">
              <SectionHeading
                variant="inside"
                heading="게스트 계정"
                actions={
                  <div className="rounded-sm bg-primary/10 p-2 text-primary">
                    <UserPlus className="h-4 w-4" />
                  </div>
                }
              />

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
                <div className="flex justify-end">
                  <Button type="submit" variant="outline" disabled={guestSignupMutation.isPending || guestUsername.trim().length === 0 || guestPassword.length === 0}>
                    {guestSignupMutation.isPending ? '생성 중…' : '생성'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4">
              <SectionHeading variant="inside" heading="복구" />

              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-primary/12 p-3 text-primary">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-foreground">auth.db</div>
                  <div className="text-sm text-muted-foreground break-all">{databaseInfo?.authDbPath ?? '불러오는 중…'}</div>
                </div>
              </div>

              <div className="text-sm text-muted-foreground">{databaseInfo?.recoveryInstructions.ko ?? '복구 안내를 불러오는 중…'}</div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
