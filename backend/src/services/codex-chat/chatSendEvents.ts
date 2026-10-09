/**
 * A message the person sent in a chat (not one the server sent to move a task on). Kept apart from the send services so
 * the task runner can listen without importing them.
 */
type Listener = (threadId: number, withPage: boolean) => void
const listeners = new Set<Listener>()

export function onChatUserSend(listener: Listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function notifyChatUserSend(threadId: number, withPage: boolean) {
  for (const listener of listeners) {
    try { listener(threadId, withPage) } catch (error) { console.warn('Chat send listener failed:', error instanceof Error ? error.message : error) }
  }
}
