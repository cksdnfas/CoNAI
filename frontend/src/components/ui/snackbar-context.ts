import { createContext, useContext, type ReactNode } from 'react'

export type SnackbarTone = 'info' | 'error'

export interface ShowSnackbarOptions {
  message: string
  /** Optional rich content; plain snackbars keep their existing rendering. */
  content?: ReactNode
  /** Replace a visible card with this key, even when its message changes. */
  key?: string
  tone?: SnackbarTone
  /** Auto-close delay. Defaults to 2.8s for info; errors always stay at least 8s and can be closed by hand. */
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
