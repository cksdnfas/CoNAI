import { isRouteErrorResponse } from 'react-router-dom'

/** Read a human-friendly error message from an unknown failure. */
export function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

/** Read route-level loader/render errors, preserving router status details when present. */
export function getRouteErrorMessage(error: unknown, fallback: string) {
  if (isRouteErrorResponse(error)) {
    return String(error.statusText || error.data || `HTTP ${error.status}`)
  }

  return getErrorMessage(error, fallback)
}
