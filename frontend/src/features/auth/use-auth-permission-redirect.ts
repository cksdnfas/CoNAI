import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

interface UseAuthPermissionRedirectOptions {
  enabled: boolean
  permissionKey: string
}

/**
 * Redirect one blocked page visit to the access overview.
 * The blocked path travels in navigation state; the access overview reads it and explains what was blocked.
 */
export function useAuthPermissionRedirect({ enabled, permissionKey }: UseAuthPermissionRedirectOptions) {
  const location = useLocation()
  const navigate = useNavigate()
  const hasRedirectedRef = useRef(false)

  useEffect(() => {
    if (!enabled || hasRedirectedRef.current) {
      return
    }

    hasRedirectedRef.current = true
    const nextPath = `${location.pathname}${location.search}`
    navigate('/access', {
      replace: true,
      state: nextPath ? { blockedPath: nextPath, blockedPermissionKey: permissionKey } : undefined,
    })
  }, [enabled, location.pathname, location.search, navigate, permissionKey])
}
