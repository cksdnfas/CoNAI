import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Spinner } from '@/components/ui/loading-state'
import { Modal, ModalBody } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { cancelCodexDeviceLogin, getCodexDeviceLogin, startCodexDeviceLogin } from '@/lib/api-image-generation-queue'
import { copyTextToClipboard } from '@/lib/clipboard'
import { getErrorMessage } from '../image-generation-shared'

const CODEX_DEVICE_LOGIN_QUERY_KEY = ['codex-device-login'] as const
const CODEX_DEVICE_LOGIN_POLL_MS = 2000

type CodexDeviceLoginDialogProps = {
  open: boolean
  onClose: () => void
  onSucceeded: () => void
}

/** Admin-only modal that runs the server's `codex login --device-auth` and shows the one-time code until it is approved. */
export function CodexDeviceLoginDialog({ open, onClose, onSucceeded }: CodexDeviceLoginDialogProps) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const succeededRef = useRef(false)

  const startMutation = useMutation({
    mutationFn: startCodexDeviceLogin,
    onSuccess: (result) => {
      queryClient.setQueryData(CODEX_DEVICE_LOGIN_QUERY_KEY, result)
    },
  })
  const { mutate: startLogin, reset: resetStart } = startMutation

  const loginQuery = useQuery({
    queryKey: CODEX_DEVICE_LOGIN_QUERY_KEY,
    queryFn: getCodexDeviceLogin,
    enabled: open && startMutation.isSuccess,
    refetchInterval: (query) => (query.state.data?.data.status === 'pending' ? CODEX_DEVICE_LOGIN_POLL_MS : false),
  })

  const loginState = startMutation.isSuccess ? loginQuery.data?.data ?? startMutation.data.data : null
  const loginStatus = loginState?.status ?? null
  const isPending = loginStatus === 'pending'

  useEffect(() => {
    if (!open) {
      return
    }

    succeededRef.current = false
    startLogin()
    return () => {
      resetStart()
      queryClient.removeQueries({ queryKey: CODEX_DEVICE_LOGIN_QUERY_KEY })
    }
  }, [open, queryClient, resetStart, startLogin])

  useEffect(() => {
    if (!open || loginStatus !== 'succeeded' || succeededRef.current) {
      return
    }

    succeededRef.current = true
    showSnackbar({ message: t({ ko: 'Codex 로그인 완료', en: 'Signed in to Codex' }), tone: 'info' })
    onSucceeded()
    onClose()
  }, [loginStatus, onClose, onSucceeded, open, showSnackbar, t])

  const handleClose = () => {
    if (isPending || startMutation.isPending) {
      void cancelCodexDeviceLogin().catch(() => {})
    }
    onClose()
  }

  const handleCopyCode = async () => {
    if (!loginState?.userCode) {
      return
    }

    try {
      await copyTextToClipboard(loginState.userCode)
      showSnackbar({ message: t({ ko: '코드 복사했어', en: 'Code copied' }), tone: 'info' })
    } catch {
      showSnackbar({ message: t({ ko: '복사 실패', en: 'Copy failed' }), tone: 'error' })
    }
  }

  const errorMessage = startMutation.isError
    ? getErrorMessage(startMutation.error, t({ ko: 'Codex 로그인을 시작하지 못했어.', en: 'Could not start the Codex sign-in.' }))
    : loginStatus === 'failed'
      ? loginState?.message || t({ ko: 'Codex 로그인 실패', en: 'Codex sign-in failed' })
      : loginStatus === 'cancelled' || loginStatus === 'idle'
        ? t({ ko: '로그인이 중단됐어.', en: 'The sign-in was stopped.' })
        : null
  const verificationUrl = loginState?.verificationUrl?.startsWith('https://') ? loginState.verificationUrl : null

  return (
    <Modal open={open} onClose={handleClose} title={t({ ko: 'Codex 로그인', en: 'Codex sign-in' })} widthClassName="max-w-md">
      <ModalBody>
        {errorMessage ? (
          <div className="space-y-4">
            <p className="whitespace-pre-wrap break-words text-sm text-destructive">{errorMessage}</p>
            <div className="flex justify-end">
              <Button onClick={() => startLogin()}>{t({ ko: '다시 시도', en: 'Try again' })}</Button>
            </div>
          </div>
        ) : isPending && loginState?.userCode ? (
          <div className="space-y-5">
            <div className="flex items-center justify-center gap-2">
              <span className="select-all font-mono text-3xl font-semibold tracking-[0.2em] text-foreground">{loginState.userCode}</span>
              <IconButton variant="ghost" size="icon-sm" onClick={() => void handleCopyCode()} label={t({ ko: '코드 복사', en: 'Copy code' })}>
                <Copy />
              </IconButton>
            </div>
            {verificationUrl ? (
              <Button asChild className="w-full">
                <a href={verificationUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink />
                  {t({ ko: '인증 페이지 열기', en: 'Open sign-in page' })}
                </a>
              </Button>
            ) : null}
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Spinner size="sm" />
              <span>{t({ ko: '승인 기다리는 중…', en: 'Waiting for approval…' })}</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner size="sm" />
            <span>{t({ ko: '코드 받는 중…', en: 'Getting a code…' })}</span>
          </div>
        )}
      </ModalBody>
    </Modal>
  )
}
