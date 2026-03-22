import { createContext, useContext } from 'react'

export type SnackbarTone = 'info' | 'error'

export interface ShowSnackbarOptions {
  message: string
  tone?: SnackbarTone
  durationMs?: number
}

export interface SnackbarContextValue {
  showSnackbar: (options: ShowSnackbarOptions) => void
  closeSnackbar: () => void
}

export const SnackbarContext = createContext<SnackbarContextValue | null>(null)

export function useSnackbar() {
  const context = useContext(SnackbarContext)
  if (!context) {
    throw new Error('useSnackbar must be used within a SnackbarProvider')
  }
  return context
}
