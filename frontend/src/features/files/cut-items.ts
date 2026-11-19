import { useEffect } from 'react'
import { createSessionStore } from './session-store'

/**
 * Items marked with Ctrl/⌘+X, waiting for a paste. `scope` is the store or workspace project they belong to, `account`
 * who marked them, `from` the folder they were cut in (a paste there moves nothing) and `revisions` the file revisions
 * the workspace listing showed then (a paste is checked against those, not against a fresh read). Kept outside the
 * browsers: the files page remounts its browser when the folder changes, and the mark must survive that.
 */
export type CutItems = { scope: string; account: string | number; ids: string[]; from: string; revisions?: Readonly<Record<string, string>> }

const cutStore = createSessionStore<CutItems | null>(null)

export const STORE_CUT_SCOPE = 'store'
export const workspaceCutScope = (projectId: string) => `workspace:${projectId}`

export const cutItems = (mark: CutItems) => cutStore.set(mark)
export const clearCutItems = () => cutStore.set(null)
/** Drops the mark of `scope` when `affects` says a change (delete, move, rename; any route) reaches its items. */
export const forgetCutItems = (scope: string, affects: (cut: CutItems) => boolean) => {
  const cut = cutStore.get()
  if (cut?.scope === scope && affects(cut)) cutStore.set(null)
}

/** The current cut of this scope, or null. Another account's mark is dropped. */
export function useCutItems(scope: string, account: string | number) {
  const cut = cutStore.useValue()
  const foreign = cut !== null && cut.scope === scope && cut.account !== account
  useEffect(() => {
    if (foreign) cutStore.set(null)
  }, [foreign])
  return cut?.scope === scope && !foreign ? cut : null
}
