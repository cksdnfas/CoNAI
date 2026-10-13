import { useState, type PropsWithChildren } from 'react'
import { useLocation } from 'react-router-dom'
import { pageSettingsScopes, pageSettingsPermission, type PageSettingsScopeId } from '@conai/shared'
import { PageSettingsContext } from '@/components/common/page-settings-context'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'

export function PageSettingsProvider({ children }: PropsWithChildren) {
  const { pathname } = useLocation()
  const auth = useAuthStatusQuery().data
  const scopes = auth?.authenticated ? pageSettingsScopes(pathname).filter((id) => auth.permissionKeys.includes(pageSettingsPermission(id))) : []
  const [selection, setSelection] = useState<{ path: string; scope: PageSettingsScopeId } | null>(null)
  const scope = selection?.path === pathname && scopes.includes(selection.scope) ? selection.scope : null
  if (selection && (selection.path !== pathname || (!scope && auth))) setSelection(null)
  return <PageSettingsContext.Provider value={{ scopes, scope, open: (id = scopes[0]) => { if (scopes.includes(id)) setSelection({ path: pathname, scope: id }) }, close: () => setSelection(null) }}>{children}</PageSettingsContext.Provider>
}
