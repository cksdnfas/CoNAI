import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleHelp, UserPlus } from 'lucide-react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Field } from '@/components/ui/field'
import { Inset } from '@/components/ui/inset'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Heading } from '@/components/ui/heading'
import { IconButton } from '@/components/ui/icon-button'
import { Panel } from '@/components/ui/panel'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { AuthRequestError, createGuestAccount, loginLocalAccount, type AuthMutationRecord } from '@/lib/api-auth'
import { LanguageSwitch } from './language-switch'
import { AUTH_STATUS_QUERY_KEY, useAuthStatusQuery } from './use-auth-status-query'

/** Marks a guest signup whose account was created but whose follow-up sign-in failed. */
class GuestSignInAfterCreateError extends Error {
  readonly username: string

  constructor(username: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Guest sign-in failed after account creation', { cause })
    this.name = 'GuestSignInAfterCreateError'
    this.username = username
  }
}

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
  const { showSnackbar, closeSnackbar } = useSnackbar()
  const { t } = useI18n()
  const authStatusQuery = useAuthStatusQuery()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [guestUsername, setGuestUsername] = useState('')
  const [guestPassword, setGuestPassword] = useState('')
  const [isGuestModalOpen, setIsGuestModalOpen] = useState(false)
  const [isRecoveryModalOpen, setIsRecoveryModalOpen] = useState(false)
  const [loginFormNotice, setLoginFormNotice] = useState<{ tone: 'error' | 'info'; message: string } | null>(null)

  const nextPath = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return resolveNextPath(params.get('next'))
  }, [location.search])
  // 로그인 뒤에는 이용 가능한 페이지 목록에서 시작한다(원래 흐름).
  const resolvePostLoginPath = () => (nextPath === '/' ? '/access' : nextPath)

  const describeLoginError = (error: unknown) => {
    if (error instanceof AuthRequestError) {
      if (error.status === 401) return t({ ko: '아이디나 비밀번호가 맞지 않아.', en: 'The username or password is incorrect.' })
      if (error.status === 429) return t({ ko: '로그인 시도가 너무 많아. 잠시 뒤에 다시 해 줘.', en: 'Too many sign-in attempts. Try again in a moment.' })
    }
    return t('loginPage.signInFailed')
  }

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
      setLoginFormNotice(null)
      closeSnackbar()
      showSnackbar({ message: t('loginPage.signedIn'), tone: 'info' })
      navigate(resolvePostLoginPath(), { replace: true })
    },
    onError: (error) => {
      // Keep the password so a typo in the username (or a transient error) doesn't force retyping it.
      // The reason stays next to the form; a snackbar would outlive the page after a later successful sign-in.
      setLoginFormNotice({ tone: 'error', message: describeLoginError(error) })
    },
  })

  const guestSignupMutation = useMutation({
    mutationFn: async ({ nextUsername, nextPassword }: { nextUsername: string; nextPassword: string }) => {
      await createGuestAccount(nextUsername, nextPassword)
      try {
        return await loginLocalAccount(nextUsername, nextPassword)
      } catch (error) {
        // The account now exists, so retrying signup would only hit "username taken".
        throw new GuestSignInAfterCreateError(nextUsername, error)
      }
    },
    onSuccess: (result) => {
      applyAuthenticatedSession(result, guestUsername.trim())
      setGuestUsername('')
      setGuestPassword('')
      setIsGuestModalOpen(false)
      showSnackbar({ message: t('loginPage.guestAccountCreatedAndSigned'), tone: 'info' })
      navigate(resolvePostLoginPath(), { replace: true })
    },
    onError: (error) => {
      setGuestPassword('')
      if (error instanceof GuestSignInAfterCreateError) {
        setGuestUsername('')
        setIsGuestModalOpen(false)
        setUsername(error.username)
        setPassword('')
        setLoginFormNotice({ tone: 'info', message: t('loginPage.guestAccountCreatedSignIn') })
        return
      }
      showSnackbar({ message: error instanceof Error ? error.message : t('loginPage.failedToCreateGuestAccount'), tone: 'error' })
    },
  })

  if (authStatusQuery.isLoading) {
    return <div className="min-h-screen bg-surface-low animate-pulse" />
  }

  if (authStatusQuery.data?.authenticated) {
    return <Navigate to={resolvePostLoginPath()} replace />
  }

  const hasCredentials = authStatusQuery.data?.hasCredentials === true
  const canCreateGuestAccount = authStatusQuery.data?.permissionKeys.includes('auth.guest.create') === true

  if (!hasCredentials) {
    return <Navigate to={nextPath} replace />
  }

  return (
    <>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Text variant="overline" className="font-semibold">CoNAI</Text>
          <LanguageSwitch className="w-full max-w-[240px]" />
        </div>

        <Panel tone="low" padding="lg" className="space-y-6">
          <div className="flex items-start justify-between gap-3">
            <Heading level={1}>{t('loginPage.signIn')}</Heading>
            <div className="flex shrink-0 items-center gap-2">
              <IconButton
                size="icon-sm"
                variant="ghost"
                onClick={() => setIsRecoveryModalOpen(true)}
                label={t('loginPage.recoveryGuide')}
              >
                <CircleHelp className="h-4 w-4" />
              </IconButton>
            </div>
          </div>

          <form
            aria-label={t('loginPage.accountSignIn')}
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              setLoginFormNotice(null)
              loginMutation.mutate({ nextUsername: username.trim(), nextPassword: password })
            }}
          >
            <Field label={t({ ko: '아이디', en: 'Username' })}>
              <Input
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value)
                  if (loginFormNotice?.tone === 'error') setLoginFormNotice(null)
                }}
                autoComplete="username"
                aria-invalid={loginFormNotice?.tone === 'error' || undefined}
                aria-describedby={loginFormNotice ? 'login-form-notice' : undefined}
              />
            </Field>
            <Field label={t({ ko: '비밀번호', en: 'Password' })}>
              <Input
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  if (loginFormNotice?.tone === 'error') setLoginFormNotice(null)
                }}
                autoComplete="current-password"
                aria-invalid={loginFormNotice?.tone === 'error' || undefined}
                aria-describedby={loginFormNotice ? 'login-form-notice' : undefined}
              />
            </Field>
            {loginFormNotice ? (
              <div
                id="login-form-notice"
                role={loginFormNotice.tone === 'error' ? 'alert' : 'status'}
                className={
                  loginFormNotice.tone === 'error'
                    ? 'rounded-sm bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground'
                    : 'rounded-sm bg-info-soft px-3 py-2 text-sm text-info-soft-foreground'
                }
              >
                {loginFormNotice.message}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              {canCreateGuestAccount ? (
                <IconButton variant="secondary" onClick={() => setIsGuestModalOpen(true)} label={t('loginPage.createGuestAccount')}>
                  <UserPlus />
                </IconButton>
              ) : null}
              <Button className="ml-auto" type="submit" disabled={loginMutation.isPending || username.trim().length === 0 || password.length === 0}>
                {loginMutation.isPending ? t('loginPage.signingIn') : t('loginPage.signIn')}
              </Button>
            </div>
          </form>
        </Panel>
      </div>

      <Modal
        open={isRecoveryModalOpen}
        onClose={() => setIsRecoveryModalOpen(false)}
        title={t('loginPage.recoveryGuide')}
        widthClassName="max-w-lg"
      >
        <ModalBody>
          <div className="text-sm text-muted-foreground">{t('loginPage.recoveryForgotPassword')}</div>

          <Inset className="text-sm text-muted-foreground">
            {t('loginPage.recoveryAdminLost')}
          </Inset>
        </ModalBody>
      </Modal>

      <Modal
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
          <ModalBody>
            <Field label={t({ ko: '아이디', en: 'Username' })}>
              <Input value={guestUsername} onChange={(event) => setGuestUsername(event.target.value)} autoComplete="username" />
            </Field>

            <Field label={t({ ko: '비밀번호', en: 'Password' })}>
              <Input type="password" value={guestPassword} onChange={(event) => setGuestPassword(event.target.value)} autoComplete="new-password" />
            </Field>

            <Inset className="text-sm text-muted-foreground">
              {t({ ko: '게스트 계정은 언제든 초기화될 수 있어.', en: 'Guest accounts may be reset at any time.' })}
            </Inset>

            <ModalFooter>
              <Button type="button" variant="ghost" onClick={() => setIsGuestModalOpen(false)} disabled={guestSignupMutation.isPending}>
                {t({ ko: '취소', en: 'Cancel' })}
              </Button>
              <Button type="submit" disabled={guestSignupMutation.isPending || guestUsername.trim().length === 0 || guestPassword.length === 0}>
                {guestSignupMutation.isPending ? t('loginPage.creating') : t('loginPage.createAndStart')}
              </Button>
            </ModalFooter>
          </ModalBody>
        </form>
      </Modal>
    </>
  )
}
