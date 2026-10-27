import { useMemo, useState, type PropsWithChildren } from 'react'
import { useLocation } from 'react-router-dom'
import { pageSettingsScopes, pageSettingsPermission, type PageSettingsScopeId } from '@conai/shared'
import { PageSettingsContext } from '@/components/common/page-settings-context'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'

export function PageSettingsProvider({ children }: PropsWithChildren) {
  const { pathname, key: pageKey } = useLocation()
  const auth = useAuthStatusQuery().data
  const authenticated = auth?.authenticated === true
  const permissionKeys = auth?.permissionKeys
  const scopes = useMemo(
    // Permission groups can delegate each shared page-settings scope to non-admin accounts (SECURITY_AND_PERMISSIONS.md).
    () => authenticated && permissionKeys ? pageSettingsScopes(pathname).filter((id) => permissionKeys.includes(pageSettingsPermission(id))) : [],
    [authenticated, permissionKeys, pathname],
  )
  const [selection, setSelection] = useState<{ path: string; scope: PageSettingsScopeId } | null>(null)
  const scope = selection?.path === pageKey && scopes.includes(selection.scope) ? selection.scope : null
  if (selection && (selection.path !== pageKey || (!scope && auth))) setSelection(null)
  const value = useMemo(() => ({
    scopes,
    scope,
    open: (id: PageSettingsScopeId = scopes[0]) => { if (scopes.includes(id)) setSelection({ path: pageKey, scope: id }) },
    close: () => setSelection(null),
  }), [scopes, scope, pageKey])
  return <PageSettingsContext.Provider value={value}>{children}</PageSettingsContext.Provider>
}
