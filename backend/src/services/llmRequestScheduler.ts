/** Connection-wide slots shared by direct chats, group members, summaries and workflow requests. */
type Waiter = { limit: number; start: () => void }
type Pool = { active: number; waiting: Waiter[] }
const pools = new Map<string, Pool>()

export function acquireLlmRequestSlot(providerName: string, concurrency: number, signal?: AbortSignal): Promise<() => void> {
  signal?.throwIfAborted()
  const limit = Math.max(1, Math.floor(concurrency))
  const pool = pools.get(providerName) ?? { active: 0, waiting: [] }
  pools.set(providerName, pool)
  const drain = () => {
    while (pool.waiting.length && pool.active < pool.waiting[0].limit) pool.waiting.shift()!.start()
    if (pool.active === 0 && pool.waiting.length === 0 && pools.get(providerName) === pool) pools.delete(providerName)
  }
  return new Promise((resolve, reject) => {
    const cancel = () => {
      const index = pool.waiting.indexOf(waiter)
      if (index >= 0) pool.waiting.splice(index, 1)
      signal?.removeEventListener('abort', cancel)
      reject(signal?.reason)
      drain()
    }
    const waiter: Waiter = { limit, start: () => {
      signal?.removeEventListener('abort', cancel)
      pool.active += 1
      let released = false
      resolve(() => {
        if (released) return
        released = true
        pool.active -= 1
        drain()
      })
    } }
    pool.waiting.push(waiter)
    signal?.addEventListener('abort', cancel, { once: true })
    drain()
  })
}

export async function withLlmRequestSlot<T>(providerName: string, concurrency: number, signal: AbortSignal | undefined, request: () => Promise<T>): Promise<T> {
  const release = await acquireLlmRequestSlot(providerName, concurrency, signal)
  try {
    signal?.throwIfAborted()
    return await request()
  } finally {
    release()
  }
}
