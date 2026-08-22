import { useState } from 'react'
import { loginNaiWithToken } from '@/lib/api-image-generation-nai'
import { useI18n } from '@/i18n'
import { getErrorMessage } from '../image-generation-shared'

/** Manage NovelAI authentication modal state and login actions for the generation panel. */
export function useNaiAuthController({
  refetchUserData,
  showSnackbar,
}: {
  refetchUserData: () => Promise<unknown>
  showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void
}) {
  const { t } = useI18n()
  const [tokenInput, setTokenInput] = useState('')
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const connectionHint = t('image-generation.components.use.nai.auth.controller.novelai.authentication.is.required.enter.an.access')

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
      showSnackbar({ message: t('image-generation.components.use.nai.auth.controller.novelai.token.connected'), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t('image-generation.components.use.nai.auth.controller.novelai.token.login.failed')), tone: 'error' })
    } finally {
      setIsLoggingIn(false)
    }
  }

  return {
    tokenInput,
    setTokenInput,
    isAuthModalOpen,
    setIsAuthModalOpen,
    isLoggingIn,
    connectionHint,
    handleSubmit: handleTokenLogin,
  }
}
