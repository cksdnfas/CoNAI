import { createContext, useContext } from 'react'
import type { PageSettingsScopeId } from '@conai/shared'

export const PageSettingsContext = createContext<{
  scopes: PageSettingsScopeId[]
  open: (scope?: PageSettingsScopeId) => void
  scope: PageSettingsScopeId | null
  close: () => void
}>({ scopes: [], scope: null, open: () => {}, close: () => {} })
export const usePageSettings = () => useContext(PageSettingsContext)
