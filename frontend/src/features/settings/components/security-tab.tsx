import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { getAuthDatabaseInfo, setupLocalAccount, updateLocalAccount } from '@/lib/api'
import { SettingsField, SettingsValueTile } from './settings-primitives'
import { AUTH_STATUS_QUERY_KEY, useAuthStatusQuery } from '@/features/auth/use-auth-status-query'

/** Render local account setup and credential management for the personal-system login flow. */
export function SecurityTab() {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const authStatusQuery = useAuthStatusQuery()
  const databaseInfoQuery = useQuery({
    queryKey: ['auth-database-info'],
    queryFn: getAuthDatabaseInfo,
    staleTime: 60_000,
  })

  const [setupUsername, setSetupUsername] = useState('')
  const [setupPassword, setSetupPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')

  const setupMutation = useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) => setupLocalAccount(username, password),
    onSuccess: (result) => {
      queryClient.setQueryData(AUTH_STATUS_QUERY_KEY, {
        hasCredentials: true,
        authenticated: true,
        username: result.username ?? setupUsername.trim(),
      })
      setSetupPassword('')
      setCurrentPassword('')
      setNewPassword('')
      setNewUsername(result.username ?? setupUsername.trim())
      showSnackbar({ message: '로그인 계정을 만들고 바로 인증도 붙였어.', tone: 'info' })
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '계정 생성에 실패했어.', tone: 'error' })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ nextCurrentPassword, nextUsername, nextPassword }: { nextCurrentPassword: string; nextUsername: string; nextPassword: string }) =>
      updateLocalAccount(nextCurrentPassword, nextUsername, nextPassword),
    onSuccess: (result) => {
      queryClient.setQueryData(AUTH_STATUS_QUERY_KEY, {
        hasCredentials: true,
        authenticated: true,
        username: result.username ?? newUsername.trim(),
      })
      setCurrentPassword('')
      setNewPassword('')
      setNewUsername(result.username ?? newUsername.trim())
      showSnackbar({ message: '로그인 계정 정보를 갱신했어.', tone: 'info' })
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '계정 갱신에 실패했어.', tone: 'error' })
    },
  })

  if (authStatusQuery.isLoading) {
    return <div className="min-h-[240px] rounded-sm bg-surface-low animate-pulse" />
  }

  const authStatus = authStatusQuery.data ?? null
  const databaseInfo = databaseInfoQuery.data ?? null
  const hasCredentials = authStatus?.hasCredentials === true
  const currentUsername = authStatus?.username ?? null

  return (
    <div className="space-y-8">
      <section>
        <Card>
          <CardContent className="space-y-4">
            <SectionHeading
              variant="inside"
              heading="보안 상태"
              actions={
                hasCredentials ? <Badge variant="secondary">로그인 보호 활성</Badge> : <Badge variant="outline">계정 미설정</Badge>
              }
            />

            <div className="grid gap-3 md:grid-cols-3">
              <SettingsValueTile label="계정 상태" value={hasCredentials ? '설정됨' : '아직 없음'} />
              <SettingsValueTile label="현재 세션" value={authStatus?.authenticated ? '인증됨' : '미인증'} />
              <SettingsValueTile label="현재 사용자" value={currentUsername ?? '없음'} valueClassName="break-all" />
            </div>
          </CardContent>
        </Card>
      </section>

      <section>
        <Card>
          <CardContent className="space-y-4">
            <SectionHeading
              variant="inside"
              heading={hasCredentials ? '계정 정보 변경' : '로그인 계정 만들기'}
              actions={
                <div className="rounded-sm bg-primary/10 p-2 text-primary">
                  {hasCredentials ? <KeyRound className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                </div>
              }
            />

            {!hasCredentials ? (
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  이 개인용 시스템에 첫 계정을 만들면, 그 뒤부터는 모든 페이지 진입 전에 로그인이 필요해.
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <SettingsField label="아이디">
                    <Input
                      variant="settings"
                      value={setupUsername}
                      onChange={(event) => setSetupUsername(event.target.value)}
                      autoComplete="username"
                    />
                  </SettingsField>
                  <SettingsField label="비밀번호">
                    <Input
                      type="password"
                      variant="settings"
                      value={setupPassword}
                      onChange={(event) => setSetupPassword(event.target.value)}
                      autoComplete="new-password"
                    />
                  </SettingsField>
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    onClick={() => void setupMutation.mutateAsync({ username: setupUsername.trim(), password: setupPassword })}
                    disabled={setupMutation.isPending || setupUsername.trim().length === 0 || setupPassword.length === 0}
                  >
                    {setupMutation.isPending ? '생성 중…' : '계정 만들기'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  로그인 페이지에서는 비밀번호 재설정 같은 기능을 제공하지 않고, 여기서만 계정 정보를 바꿀 수 있어.
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <SettingsField label="현재 비밀번호">
                    <Input
                      type="password"
                      variant="settings"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      autoComplete="current-password"
                    />
                  </SettingsField>
                  <SettingsField label="새 아이디">
                    <Input
                      variant="settings"
                      value={newUsername}
                      onChange={(event) => setNewUsername(event.target.value)}
                      autoComplete="username"
                      placeholder={currentUsername ?? '새 아이디'}
                    />
                  </SettingsField>
                  <SettingsField label="새 비밀번호">
                    <Input
                      type="password"
                      variant="settings"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      autoComplete="new-password"
                    />
                  </SettingsField>
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    onClick={() => void updateMutation.mutateAsync({
                      nextCurrentPassword: currentPassword,
                      nextUsername: newUsername.trim() || currentUsername || '',
                      nextPassword: newPassword,
                    })}
                    disabled={updateMutation.isPending || currentPassword.length === 0 || (newUsername.trim().length === 0 && !currentUsername) || newPassword.length === 0}
                  >
                    {updateMutation.isPending ? '변경 중…' : '계정 정보 저장'}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section>
        <Card>
          <CardContent className="space-y-4">
            <SectionHeading variant="inside" heading="복구 안내" />
            <div className="text-sm text-muted-foreground">
              아이디나 비밀번호를 잊었을 때는 로그인 페이지에서 재설정하지 않고, <span className="font-semibold text-foreground">auth.db</span> 파일을 삭제해서 초기화하는 방식으로 복구해.
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <SettingsValueTile label="인증 DB 경로" value={databaseInfo?.authDbPath ?? '불러오는 중…'} valueClassName="break-all text-xs font-medium" />
              <SettingsValueTile label="복구 방법" value={databaseInfo?.recoveryInstructions.ko ?? '불러오는 중…'} valueClassName="text-xs font-medium leading-6" />
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
