import { randomUUID } from 'crypto'

// The project uses the v11 API through require because its ambient declaration is for an older version.
const { LRUCache } = require('lru-cache') as {
  LRUCache: new <K, V>(options: Record<string, unknown>) => {
    get(key: K): V | undefined
    set(key: K, value: V): void
    delete(key: K): void
    values(): IterableIterator<V>
  }
}

type DirectoryOrder = { name: string; key: string; modifiedAt: string }
type DirectoryCursor = { snapshot: string; after: DirectoryOrder }

export type DirectoryPageRequest = {
  limit: number
  search: string
  cursor?: DirectoryCursor
  snapshot?: string
  refresh: boolean
}

type Snapshot<T> = { id: string; key: string; items: T[]; stale: boolean }

/** Keep fresh first-page snapshots briefly, and older versions for active pagers. */
export class DirectoryListingSnapshots<T> {
  private snapshots = new LRUCache<string, Snapshot<T>>({
    max: 64,
    maxSize: 64 * 1024 * 1024,
    ttl: 5 * 60 * 1000,
    ttlAutopurge: true,
    updateAgeOnGet: true,
    sizeCalculation: (snapshot: Snapshot<T>) => JSON.stringify(snapshot.items).length * 2 + snapshot.items.length * 128 + 256,
  })
  private latest = new LRUCache<string, string>({ max: 64, ttl: 5000, ttlAutopurge: true })
  private pending = new Map<string, { promise: Promise<Snapshot<T>>; invalidated: boolean }>()

  invalidate(key: string) {
    this.latest.delete(key)
    for (const snapshot of this.snapshots.values()) {
      if (snapshot.key === key) snapshot.stale = true
    }
    const pending = this.pending.get(key)
    if (pending) pending.invalidated = true
  }

  async read(key: string, load: () => Promise<T[]>, options?: DirectoryPageRequest): Promise<Snapshot<T>> {
    if (options?.refresh) {
      this.invalidate(key)
    } else {
      const id = options?.cursor?.snapshot ?? options?.snapshot
      const snapshot = id ? this.snapshots.get(id) : undefined
      if (snapshot?.key === key && (options?.cursor || !snapshot.stale)) return snapshot
      if (!options?.cursor) {
        const latestId = this.latest.get(key)
        const latest = latestId ? this.snapshots.get(latestId) : undefined
        if (latest?.key === key && !latest.stale) return latest
      }
    }

    let existing = this.pending.get(key)
    while (existing?.invalidated) {
      await existing.promise.catch(() => undefined)
      existing = this.pending.get(key)
    }
    if (existing) return existing.promise

    const pending = { invalidated: false, promise: Promise.resolve(null as unknown as Snapshot<T>) }
    pending.promise = load().then((items) => {
      const snapshot = { id: randomUUID(), key, items, stale: pending.invalidated }
      this.snapshots.set(snapshot.id, snapshot)
      // An oversized snapshot is not retained by the bounded LRU. Its cursor still works:
      // the next request rebuilds the snapshot and resumes after the last sort key.
      if (!pending.invalidated && this.snapshots.get(snapshot.id)) this.latest.set(key, snapshot.id)
      return snapshot
    }).finally(() => {
      this.pending.delete(key)
    })
    this.pending.set(key, pending)
    return pending.promise
  }
}

function compareOrder(a: DirectoryOrder, b: DirectoryOrder) {
  return b.modifiedAt.localeCompare(a.modifiedAt)
    || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
}

export function sortDirectoryItems<T>(items: T[], order: (item: T) => DirectoryOrder) {
  return items.sort((a, b) => compareOrder(order(a), order(b)))
}

/** A cursor includes its sort boundary so eviction never turns into an offset shift. */
export function pageDirectorySnapshot<T>(snapshot: Snapshot<T>, options: DirectoryPageRequest, order: (item: T) => DirectoryOrder) {
  const search = options.search.trim().toLowerCase()
  const items: T[] = []
  let total = 0
  let hasMore = false
  for (const item of snapshot.items) {
    const position = order(item)
    if (search && !position.name.toLowerCase().includes(search)) continue
    total += 1
    if (options.cursor && compareOrder(position, options.cursor.after) <= 0) continue
    if (items.length < options.limit) items.push(item)
    else hasMore = true
  }
  const nextCursor = hasMore
    ? Buffer.from(JSON.stringify({ snapshot: snapshot.id, after: order(items[items.length - 1]) })).toString('base64url')
    : null
  return { items, total, nextCursor, snapshot: snapshot.id }
}

/** No parameters means the original, unpaged listing contract. */
export function parseDirectoryPageRequest(query: Record<string, unknown>): DirectoryPageRequest | undefined {
  if (query.limit === undefined && query.cursor === undefined && query.search === undefined && query.snapshot === undefined && query.refresh === undefined) return undefined
  const limit = query.limit === undefined ? 60 : Number(query.limit)
  if (typeof query.limit === 'object' || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Invalid listing page size')
  if (query.search !== undefined && typeof query.search !== 'string') throw new Error('Invalid listing search')
  if (query.snapshot !== undefined && (typeof query.snapshot !== 'string' || !query.snapshot)) throw new Error('Invalid listing snapshot')
  let cursor: DirectoryCursor | undefined
  if (query.cursor !== undefined) {
    if (typeof query.cursor !== 'string') throw new Error('Invalid listing cursor')
    try {
      cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as DirectoryCursor
    } catch {
      throw new Error('Invalid listing cursor')
    }
    if (!cursor || typeof cursor.snapshot !== 'string' || !cursor.after
      || typeof cursor.after.name !== 'string' || typeof cursor.after.key !== 'string'
      || typeof cursor.after.modifiedAt !== 'string') throw new Error('Invalid listing cursor')
  }
  return { limit, search: typeof query.search === 'string' ? query.search : '', cursor, snapshot: query.snapshot as string | undefined, refresh: query.refresh === '1' }
}
