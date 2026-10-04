/**
 * Group rooms working through their reply queue register here, so the `room_call_member` tool (MCP, also reached by
 * Codex over HTTP) can ask the room to wake members without importing the room service.
 */
type WakeHandler = (names: string[]) => { woken: string[]; unknown: string[]; members: string[] } | { error: string }

const handlers = new Map<number, WakeHandler>()

export function registerGroupWake(threadId: number, handler: WakeHandler) {
  handlers.set(threadId, handler)
  return () => {
    if (handlers.get(threadId) === handler) handlers.delete(threadId)
  }
}

export function requestGroupWake(threadId: number, names: string[]) {
  return handlers.get(threadId)?.(names) ?? { error: 'This room is not answering right now, so nobody can be called.' }
}
