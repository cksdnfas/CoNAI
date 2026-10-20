import { createContext, useContext, type ReactNode } from 'react'

export type SnackbarTone = 'info' | 'error'

export interface SnackbarAction {
  label: string
  onClick: () => void
}

export interface ShowSnackbarOptions {
  message: string
  action?: SnackbarAction
  /** Optional rich content; plain snackbars keep their existing rendering. */
  content?: ReactNode
  /** Replace a visible card with this key, even when its message changes. */
  key?: string
  tone?: SnackbarTone
  /** Defaults to 2.8s for info, 10s with an action; errors stay at least 8s. */
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
