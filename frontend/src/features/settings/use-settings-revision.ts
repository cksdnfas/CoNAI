import { useCallback, useEffect, useRef } from 'react'

/** Freeze the server version while a native settings draft is dirty, even if another modal refreshes the cache. */
export function useSettingsRevision(revision: string | undefined, dirty: boolean) {
  const baseline = useRef(revision)
  useEffect(() => { if (!dirty) baseline.current = revision }, [revision, dirty])
  return useCallback((savedRevision?: string) => {
    if (savedRevision) baseline.current = savedRevision
    return baseline.current
  }, [])
}
