import type { PropsWithChildren } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { Snackbar } from './snackbar'
import { SnackbarContext, type ShowSnackbarOptions, type SnackbarTone } from './snackbar-context'

interface SnackbarState {
  open: boolean
  message: string | null
  tone: SnackbarTone
  durationMs: number
  nonce: number
}

export function SnackbarProvider({ children }: PropsWithChildren) {
  const [snackbar, setSnackbar] = useState<SnackbarState>({
    open: false,
    message: null,
    tone: 'info',
    durationMs: 2800,
    nonce: 0,
  })

  const closeSnackbar = useCallback(() => {
    setSnackbar((current) => ({ ...current, open: false }))
  }, [])

  const showSnackbar = useCallback(({ message, tone = 'info', durationMs = 2800 }: ShowSnackbarOptions) => {
    setSnackbar((current) => ({
      open: true,
      message,
      tone,
      durationMs,
      nonce: current.nonce + 1,
    }))
  }, [])

  const value = useMemo(
    () => ({
      showSnackbar,
      closeSnackbar,
    }),
    [closeSnackbar, showSnackbar],
  )

  return (
    <SnackbarContext.Provider value={value}>
      {children}
      <Snackbar
        open={snackbar.open}
        message={snackbar.message}
        tone={snackbar.tone}
        durationMs={snackbar.durationMs}
        nonce={snackbar.nonce}
        onClose={closeSnackbar}
      />
    </SnackbarContext.Provider>
  )
}
