import { useMemo, useState } from 'react'
import { loginNai, loginNaiWithToken } from '@/lib/api'
import { getErrorMessage } from '../image-generation-shared'

export type NaiLoginMode = 'account' | 'token'

/** Manage NovelAI authentication modal state and login actions for the generation panel. */
export function useNaiAuthController({
  refetchUserData,
  showSnackbar,
}: {
  refetchUserData: () => Promise<unknown>
  showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void
}) {
  const [loginMode, setLoginMode] = useState<NaiLoginMode>('account')
  const [usernameInput, setUsernameInput] = useState('')
  const [passwordInput, setPasswordInput] = useState('')
  const [tokenInput, setTokenInput] = useState('')
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)
  const [isLoggingIn, setIsLoggingIn] = useState(false)

  const connectionHint = useMemo(
    () => loginMode === 'account'
      ? 'NovelAI 인증이 필요합니다. 계정으로 로그인하세요.'
      : 'NovelAI 인증이 필요합니다. access token을 입력해 연결하세요.',
    [loginMode],
  )

  /** Submit one account login flow and refresh server-side user state on success. */
  const handleAccountLogin = async () => {
    const username = usernameInput.trim()
    const password = passwordInput
    if (username.length === 0 || password.length === 0 || isLoggingIn) {
      return
    }

    try {
      setIsLoggingIn(true)
      await loginNai(username, password)
      await refetchUserData()
      setPasswordInput('')
      setIsAuthModalOpen(false)
      showSnackbar({ message: 'NovelAI 로그인 완료.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'NovelAI 로그인에 실패했어.'), tone: 'error' })
    } finally {
      setIsLoggingIn(false)
    }
  }

  /** Submit one token login flow and refresh server-side user state on success. */
  const handleTokenLogin = async () => {
    const token = tokenInput.trim()
    if (token.length === 0 || isLoggingIn) {
      return
    }

    try {
      setIsLoggingIn(true)
      await loginNaiWithToken(token)
      await refetchUserData()
      setTokenInput('')
      setIsAuthModalOpen(false)
      showSnackbar({ message: 'NovelAI 토큰 연결 완료.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'NovelAI 토큰 로그인에 실패했어.'), tone: 'error' })
    } finally {
      setIsLoggingIn(false)
    }
  }

  /** Submit whichever authentication flow is selected in the current modal. */
  const handleSubmit = async () => {
    if (loginMode === 'account') {
      await handleAccountLogin()
      return
    }

    await handleTokenLogin()
  }

  return {
    loginMode,
    setLoginMode,
    usernameInput,
    setUsernameInput,
    passwordInput,
    setPasswordInput,
    tokenInput,
    setTokenInput,
    isAuthModalOpen,
    setIsAuthModalOpen,
    isLoggingIn,
    connectionHint,
    handleSubmit,
  }
}
