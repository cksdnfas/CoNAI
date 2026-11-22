import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { ChatProposal } from '@conai/shared'
import { createRandomUuid } from '@/lib/random-uuid'

/*
 * Auto-approve, the composer's switch for working without review cards (like a coding agent's auto mode). It belongs
 * to this tab and lasts until the tab reloads. A message sent with it on carries this tab's id: the server then runs
 * the connected page's saves within the turn (the tab checks the switch again before running one), and cards that
 * reply creates name the tab, which saves them as they arrive. Deletions and plugin code installs always stay cards.
 */

/** Identifies this tab to the server for the replies it sent with auto-approve on. */
export const CHAT_AUTO_APPROVE_TAB = createRandomUuid()

let on = false
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const read = () => on

export function setChatAutoApprove(next: boolean) {
  if (on === next) return
  on = next
  for (const listener of listeners) listener()
}

/** Read at the moment of acting (sending, running a save, saving a card), never from a stale render. */
export function chatAutoApproveOn() { return on }

export function useChatAutoApprove() {
  const value = useSyncExternalStore(subscribe, read, read)
  return { on: value, toggle: () => setChatAutoApprove(!on) }
}

/** Card ids this tab already saved (or tried to) on its own; a failure leaves the card's button, never a retry loop. */
const attempted = new Set<number>()
/**
 * One save at a time: cards of one reply often touch the same record (two blocks linked to one profile each read the
 * profile and write its links), so concurrent saves could lose one. A failed save never stops the ones after it.
 */
let queue: Promise<unknown> = Promise.resolve()

/**
 * Saves a review card unasked when this tab sent its reply with auto-approve on and the switch is still on. `ready`:
 * the card could be saved by a click now (the person may, and what it needs has loaded); `handled`: saved, applied or
 * set aside already. Deletions pass `ready: false`.
 */
export function useAutoApproveCard(proposal: Pick<ChatProposal, 'id' | 'autoApprove'>, ready: boolean, handled: boolean, save: () => Promise<unknown> | void) {
  const { on: enabled } = useChatAutoApprove()
  const saveRef = useRef(save)
  useEffect(() => { saveRef.current = save })
  const eligible = enabled && ready && !handled && proposal.autoApprove === CHAT_AUTO_APPROVE_TAB && !attempted.has(proposal.id)
  useEffect(() => {
    if (!eligible || attempted.has(proposal.id) || !chatAutoApproveOn()) return
    attempted.add(proposal.id)
    // The card's own error handling reports a failure; the queue only keeps going.
    queue = queue.then(() => chatAutoApproveOn() ? saveRef.current() : undefined).catch(() => undefined)
  }, [eligible, proposal.id])
}
