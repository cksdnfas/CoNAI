import { useCallback, useEffect, useRef } from 'react'
import type { PageSettingsScopeId } from '@conai/shared'

type OwnPageSettingsSave = { scope: PageSettingsScopeId; before: string; after: string }
const ownPageSettingsListeners = new Set<(save: OwnPageSettingsSave) => void>()

/** Tell other mounted editors only about this tab's successfully checked page-settings writes. */
export function publishOwnPageSettingsSave(save: OwnPageSettingsSave) {
  ownPageSettingsListeners.forEach((listener) => listener(save))
}

export function subscribeOwnPageSettingsSave(listener: (save: OwnPageSettingsSave) => void) {
  ownPageSettingsListeners.add(listener)
  return () => { ownPageSettingsListeners.delete(listener) }
}

/** Freeze the server version while a native settings draft is dirty, even if another modal refreshes the cache. */
export function useSettingsRevision(revision: string | undefined, dirty: boolean) {
  const baseline = useRef(revision)
  useEffect(() => { if (!dirty) baseline.current = revision }, [revision, dirty])
  return useCallback((savedRevision?: string) => {
    if (savedRevision) baseline.current = savedRevision
    if (!baseline.current) throw new Error('최신 설정을 먼저 불러와줘.')
    return baseline.current
  }, [])
}
