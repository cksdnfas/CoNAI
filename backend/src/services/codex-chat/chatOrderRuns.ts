/**
 * Orders running on a chat's replies (see chatOrderRunner): one per chat at a time. It holds the chat like a reply does,
 * so nothing else writes to it meanwhile. Kept free of other chat modules: the reply services and the generation link
 * check it.
 */
type OrderRun = { messageId: number; replyId: string; controller: AbortController; finished: Promise<void> }

const runs = new Map<number, OrderRun>()

export function isChatOrderRunning(threadId: number) {
  return runs.has(threadId)
}

/** The reply an order is working on: the generation jobs it starts never get a reaction message of their own. */
export function isChatOrderReply(threadId: number, replyId: string | undefined) {
  return Boolean(replyId && runs.get(threadId)?.replyId === replyId)
}

/** Reserve the chat for an order on `messageId`; null when one is running there already. */
export function beginChatOrderRun(threadId: number, messageId: number, replyId: string): { signal: AbortSignal; end: () => void } | null {
  if (runs.has(threadId)) return null
  let release: () => void = () => {}
  const run: OrderRun = { messageId, replyId, controller: new AbortController(), finished: new Promise((resolve) => { release = resolve }) }
  runs.set(threadId, run)
  return {
    signal: run.controller.signal,
    end: () => {
      if (runs.get(threadId) === run) runs.delete(threadId)
      release()
    },
  }
}

/** Stop the chat's running order; resolves once it let go of the chat (bounded by `waitMs`). */
export async function stopChatOrderRun(threadId: number, waitMs = 8000) {
  const run = runs.get(threadId)
  if (!run) return
  run.controller.abort()
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([run.finished, new Promise((resolve) => { timer = setTimeout(resolve, waitMs) })])
  } finally {
    clearTimeout(timer)
  }
}
