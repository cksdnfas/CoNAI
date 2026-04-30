import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleHelp, ShieldCheck, UserPlus } from 'lucide-react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/common/page-header'
import { PageSection } from '@/components/common/page-surface'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsField, SettingsInsetBlock, SettingsModalBody, SettingsModalFooter } from '@/features/settings/components/settings-primitives'
import { useI18n } from '@/i18n'
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
  const { language, t } = useI18n()
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
      showSnackbar({ message: t('loginPage.signedIn'), tone: 'info' })
      navigate(defaultPostLoginPath, { replace: true })
    },
    onError: (error) => {
      setPassword('')
      showSnackbar({ message: error instanceof Error ? error.message : t('loginPage.signInFailed'), tone: 'error' })
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
      showSnackbar({ message: t('loginPage.guestAccountCreatedAndSigned'), tone: 'info' })
      navigate(defaultPostLoginPath, { replace: true })
    },
    onError: (error) => {
      setGuestPassword('')
      showSnackbar({ message: error instanceof Error ? error.message : t('loginPage.failedToCreateGuestAccount'), tone: 'error' })
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
            title={t('loginPage.signIn')}
            description=""
          />

          <div className="grid gap-6">
            <PageSection
              title={t('loginPage.accountSignIn')}
              className="border-primary/15 bg-card"
              bodyClassName="space-y-4"
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{t('loginPage.localAccount')}</Badge>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => setIsRecoveryModalOpen(true)}
                    aria-label={t('loginPage.recoveryGuide')}
                    title={t('loginPage.recoveryGuide')}
                  >
                    <CircleHelp className="h-4 w-4" />
                  </Button>
                </div>
              }
            >
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  void loginMutation.mutateAsync({ nextUsername: username.trim(), nextPassword: password })
                }}
              >
                <SettingsField label={t({ ko: '아이디', en: 'Username' })}>
                  <Input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
                </SettingsField>
                <SettingsField label={t({ ko: '비밀번호', en: 'Password' })}>
                  <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
                </SettingsField>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Button type="button" variant="outline" onClick={() => setIsGuestModalOpen(true)}>
                    <UserPlus className="h-4 w-4" />
                    {t('loginPage.createGuestAccount')}
                  </Button>
                  <Button type="submit" disabled={loginMutation.isPending || username.trim().length === 0 || password.length === 0}>
                    {loginMutation.isPending ? t('loginPage.signingIn') : t('loginPage.signIn')}
                  </Button>
                </div>
              </form>
            </PageSection>
          </div>
        </div>
      </div>

      <SettingsModal
        open={isRecoveryModalOpen}
        onClose={() => setIsRecoveryModalOpen(false)}
        title={t('loginPage.recoveryGuide')}
        widthClassName="max-w-lg"
      >
        <SettingsModalBody>
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-primary/12 p-3 text-primary">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-semibold text-foreground">auth.db</div>
              <div className="break-all text-sm text-muted-foreground">{databaseInfo?.authDbPath ?? t('loginPage.loading')}</div>
            </div>
          </div>

          <SettingsInsetBlock className="text-sm text-muted-foreground">
            {(language === 'en' ? databaseInfo?.recoveryInstructions.en : databaseInfo?.recoveryInstructions.ko) ?? databaseInfo?.recoveryInstructions.ko ?? t('loginPage.loadingRecoveryGuide')}
          </SettingsInsetBlock>
        </SettingsModalBody>
      </SettingsModal>

      <SettingsModal
        open={isGuestModalOpen}
        onClose={() => {
          if (guestSignupMutation.isPending) {
            return
          }
          setIsGuestModalOpen(false)
        }}
        title={t('loginPage.createGuestAccount')}
        widthClassName="max-w-lg"
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void guestSignupMutation.mutateAsync({ nextUsername: guestUsername.trim(), nextPassword: guestPassword })
          }}
        >
          <SettingsModalBody>
            <SettingsField label={t({ ko: '아이디', en: 'Username' })}>
              <Input value={guestUsername} onChange={(event) => setGuestUsername(event.target.value)} autoComplete="username" />
            </SettingsField>

            <SettingsField label={t({ ko: '비밀번호', en: 'Password' })}>
              <Input type="password" value={guestPassword} onChange={(event) => setGuestPassword(event.target.value)} autoComplete="new-password" />
            </SettingsField>

            <SettingsInsetBlock className="text-sm text-muted-foreground">
              {t({ ko: '게스트 계정은 언제든 초기화될 수 있어.', en: 'Guest accounts may be reset at any time.' })}
            </SettingsInsetBlock>

            <SettingsModalFooter>
              <Button type="button" variant="ghost" onClick={() => setIsGuestModalOpen(false)} disabled={guestSignupMutation.isPending}>
                {t({ ko: '취소', en: 'Cancel' })}
              </Button>
              <Button type="submit" disabled={guestSignupMutation.isPending || guestUsername.trim().length === 0 || guestPassword.length === 0}>
                {guestSignupMutation.isPending ? t('loginPage.creating') : t('loginPage.createAndStart')}
              </Button>
            </SettingsModalFooter>
          </SettingsModalBody>
        </form>
      </SettingsModal>
    </>
  )
}
