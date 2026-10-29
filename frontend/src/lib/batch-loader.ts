/**
 * Coalesce per-key loads made in the same task into one request per `maxBatch` keys. Each caller still gets its own
 * promise (so per-key query caches keep working); keys missing from the answer resolve to `missing`.
 */
export function createBatchLoader<K, V>(loadMany: (keys: K[]) => Promise<Map<K, V>>, options: { maxBatch: number; missing: V }) {
  let queued = new Map<K, Array<{ resolve: (value: V) => void; reject: (error: unknown) => void }>>()
  let scheduled = false

  const flush = () => {
    const batch = queued
    queued = new Map()
    scheduled = false
    const keys = [...batch.keys()]
    for (let start = 0; start < keys.length; start += options.maxBatch) {
      const chunk = keys.slice(start, start + options.maxBatch)
      loadMany(chunk).then(
        (values) => { for (const key of chunk) for (const waiter of batch.get(key) ?? []) waiter.resolve(values.get(key) ?? options.missing) },
        (error: unknown) => { for (const key of chunk) for (const waiter of batch.get(key) ?? []) waiter.reject(error) },
      )
    }
  }

  return (key: K) => new Promise<V>((resolve, reject) => {
    queued.set(key, [...(queued.get(key) ?? []), { resolve, reject }])
    if (!scheduled) {
      scheduled = true
      setTimeout(flush, 0)
    }
  })
}
