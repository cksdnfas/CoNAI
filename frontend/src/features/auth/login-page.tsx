import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/common/page-header'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { getAuthDatabaseInfo, loginLocalAccount } from '@/lib/api'
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

  if (authStatusQuery.isLoading) {
    return <div className="min-h-screen bg-surface-low animate-pulse" />
  }

  if (authStatusQuery.data?.authenticated) {
    return <Navigate to={nextPath} replace />
  }

  const hasCredentials = authStatusQuery.data?.hasCredentials === true
  const databaseInfo = databaseInfoQuery.data ?? null

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl items-center px-6 py-10">
      <div className="w-full space-y-8">
        <PageHeader
          eyebrow="Personal Access"
          title={hasCredentials ? '로그인' : '로그인 설정 없음'}
          description={hasCredentials ? '이 개인용 이미지 관리 시스템은 계정이 설정되면 로그인 후에만 사용할 수 있어.' : '아직 로컬 로그인 계정이 만들어지지 않았어. 먼저 설정 페이지의 보안 탭에서 계정을 만들어.'}
        />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="border-primary/15 bg-card">
            <CardContent className="space-y-4">
              <SectionHeading
                variant="inside"
                heading={hasCredentials ? '계정 로그인' : '현재 상태'}
                actions={
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">개인용 시스템</Badge>
                    {hasCredentials ? <Badge variant="outline">로그인 필요</Badge> : <Badge variant="outline">계정 생성 필요</Badge>}
                  </div>
                }
              />

              {hasCredentials ? (
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
              ) : (
                <div className="space-y-4 text-sm text-muted-foreground">
                  <div>로그인 페이지에서는 계정 생성이나 비밀번호 재설정을 하지 않아. 그건 앱 안의 설정 &gt; 보안 탭에서만 처리해.</div>
                  <div className="flex flex-wrap gap-3">
                    <Button asChild>
                      <Link to="/settings">설정으로 이동</Link>
                    </Button>
                    <Button asChild variant="outline">
                      <Link to="/">홈으로 돌아가기</Link>
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4">
              <SectionHeading variant="inside" heading="복구 안내" />

              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-primary/12 p-3 text-primary">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-foreground">비밀번호 재설정 없음</div>
                  <div className="text-sm text-muted-foreground">아이디나 비밀번호를 잊으면 auth.db 파일을 삭제해서 초기화하는 방식이야.</div>
                </div>
              </div>

              <div className="space-y-2 text-sm text-muted-foreground">
                <div><span className="font-semibold text-foreground">인증 DB:</span> <span className="break-all">{databaseInfo?.authDbPath ?? '불러오는 중…'}</span></div>
                <div>{databaseInfo?.recoveryInstructions.ko ?? '복구 안내를 불러오는 중…'}</div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
