import { useEffect, useMemo, useState } from 'react'

const MAX_VIDEO_CACHE_ENTRIES = 12
const MAX_VIDEO_CACHE_BYTES = 256 * 1024 * 1024
const PERSISTENT_VIDEO_CACHE_NAME = 'conai-video-source-v1'
const PERSISTENT_VIDEO_CACHE_MANIFEST_KEY = 'conai:video-source-cache-manifest:v1'
const FAILED_VIDEO_CACHE_RETRY_MS = 60_000

type CachedVideoEntry = {
  objectUrl: string | null
  size: number
  lastAccessedAt: number
  activeConsumers: number
  promise: Promise<string | null> | null
}

type PersistentVideoCacheManifestEntry = {
  sourceUrl: string
  size: number
  lastAccessedAt: number
}

const cachedVideoEntries = new Map<string, CachedVideoEntry>()
const failedVideoCacheAttempts = new Map<string, number>()

function isCacheableVideoUrl(sourceUrl: string | null | undefined) {
  return Boolean(
    sourceUrl
      && typeof window !== 'undefined'
      && !sourceUrl.startsWith('blob:')
      && !sourceUrl.startsWith('data:'),
  )
}

function canUsePersistentVideoCache() {
  return typeof window !== 'undefined' && 'caches' in window
}

function loadPersistentVideoCacheManifest(): PersistentVideoCacheManifestEntry[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(PERSISTENT_VIDEO_CACHE_MANIFEST_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((entry): entry is PersistentVideoCacheManifestEntry => (
      Boolean(entry)
      && typeof entry.sourceUrl === 'string'
      && typeof entry.size === 'number'
      && typeof entry.lastAccessedAt === 'number'
    ))
  } catch {
    return []
  }
}

function savePersistentVideoCacheManifest(entries: PersistentVideoCacheManifestEntry[]) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(PERSISTENT_VIDEO_CACHE_MANIFEST_KEY, JSON.stringify(entries))
}

function touchCachedEntry(sourceUrl: string) {
  const entry = cachedVideoEntries.get(sourceUrl)
  if (!entry) {
    return
  }

  entry.lastAccessedAt = Date.now()
}

function getTotalCachedVideoBytes() {
  let total = 0

  for (const entry of cachedVideoEntries.values()) {
    total += entry.size
  }

  return total
}

function evictInMemoryCachedVideoEntries(_excludedSourceUrl?: string | null) {
  // Runtime blob URLs proved too fragile to revoke aggressively while virtualized
  // media elements may still be mounting, unmounting, or decoding.
  // Keep object URLs stable for the page lifetime and let page teardown reclaim them.
}

async function enforcePersistentVideoCacheLimits(excludedSourceUrl?: string | null) {
  if (!canUsePersistentVideoCache()) {
    return
  }

  const cache = await window.caches.open(PERSISTENT_VIDEO_CACHE_NAME)
  const manifest = loadPersistentVideoCacheManifest()
  const removableEntries = manifest
    .filter((entry) => entry.sourceUrl !== excludedSourceUrl)
    .sort((left, right) => left.lastAccessedAt - right.lastAccessedAt)

  const getTotalSize = () => manifest.reduce((total, entry) => total + entry.size, 0)

  while (manifest.length > MAX_VIDEO_CACHE_ENTRIES || getTotalSize() > MAX_VIDEO_CACHE_BYTES) {
    const nextEntry = removableEntries.shift()
    if (!nextEntry) {
      break
    }

    const manifestIndex = manifest.findIndex((entry) => entry.sourceUrl === nextEntry.sourceUrl)
    if (manifestIndex >= 0) {
      manifest.splice(manifestIndex, 1)
    }
    await cache.delete(nextEntry.sourceUrl)
  }

  savePersistentVideoCacheManifest(manifest)
}

function getCachedVideoEntry(sourceUrl: string) {
  const entry = cachedVideoEntries.get(sourceUrl)
  if (!entry) {
    return null
  }

  touchCachedEntry(sourceUrl)
  return entry
}

function hasRecentFailedVideoCacheAttempt(sourceUrl: string | null | undefined) {
  if (!sourceUrl) {
    return false
  }

  const lastFailedAt = failedVideoCacheAttempts.get(sourceUrl)
  return Boolean(lastFailedAt && (Date.now() - lastFailedAt) < FAILED_VIDEO_CACHE_RETRY_MS)
}

export function getCachedVideoObjectUrl(sourceUrl: string | null | undefined) {
  if (!sourceUrl || !isCacheableVideoUrl(sourceUrl)) {
    return null
  }

  return getCachedVideoEntry(sourceUrl)?.objectUrl ?? null
}

function retainCachedVideoSource(sourceUrl: string) {
  const entry = cachedVideoEntries.get(sourceUrl)
  if (!entry?.objectUrl) {
    return
  }

  entry.activeConsumers += 1
  touchCachedEntry(sourceUrl)
}

function releaseCachedVideoSource(sourceUrl: string) {
  const entry = cachedVideoEntries.get(sourceUrl)
  if (!entry) {
    return
  }

  entry.activeConsumers = Math.max(0, entry.activeConsumers - 1)
  touchCachedEntry(sourceUrl)
}

async function updatePersistentVideoCacheManifest(sourceUrl: string, size: number) {
  const manifest = loadPersistentVideoCacheManifest()
  const nextEntry: PersistentVideoCacheManifestEntry = {
    sourceUrl,
    size,
    lastAccessedAt: Date.now(),
  }
  const existingIndex = manifest.findIndex((entry) => entry.sourceUrl === sourceUrl)

  if (existingIndex >= 0) {
    manifest.splice(existingIndex, 1, nextEntry)
  } else {
    manifest.push(nextEntry)
  }

  savePersistentVideoCacheManifest(manifest)
  await enforcePersistentVideoCacheLimits(sourceUrl)
}

async function touchPersistentVideoCacheEntry(sourceUrl: string) {
  const manifest = loadPersistentVideoCacheManifest()
  const existingIndex = manifest.findIndex((entry) => entry.sourceUrl === sourceUrl)
  if (existingIndex < 0) {
    return
  }

  manifest[existingIndex] = {
    ...manifest[existingIndex],
    lastAccessedAt: Date.now(),
  }
  savePersistentVideoCacheManifest(manifest)
}

async function createObjectUrlFromResponse(sourceUrl: string, response: Response) {
  const existingEntry = cachedVideoEntries.get(sourceUrl)
  if (existingEntry?.objectUrl) {
    touchCachedEntry(sourceUrl)
    return { objectUrl: existingEntry.objectUrl, size: existingEntry.size }
  }

  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)

  cachedVideoEntries.set(sourceUrl, {
    objectUrl,
    size: blob.size,
    lastAccessedAt: Date.now(),
    activeConsumers: existingEntry?.activeConsumers ?? 0,
    promise: null,
  })

  evictInMemoryCachedVideoEntries(sourceUrl)
  return { objectUrl, size: blob.size }
}

async function loadPersistentCachedVideoSource(sourceUrl: string) {
  if (!canUsePersistentVideoCache()) {
    return null
  }

  const cache = await window.caches.open(PERSISTENT_VIDEO_CACHE_NAME)
  const cachedResponse = await cache.match(sourceUrl)
  if (!cachedResponse) {
    return null
  }

  const { objectUrl, size } = await createObjectUrlFromResponse(sourceUrl, cachedResponse.clone())
  await updatePersistentVideoCacheManifest(sourceUrl, size)
  return objectUrl
}

export function warmCachedVideoSource(sourceUrl: string | null | undefined) {
  if (!sourceUrl || !isCacheableVideoUrl(sourceUrl)) {
    return Promise.resolve(null)
  }

  if (hasRecentFailedVideoCacheAttempt(sourceUrl)) {
    return Promise.resolve(null)
  }

  const existingEntry = cachedVideoEntries.get(sourceUrl)
  if (existingEntry?.objectUrl) {
    touchCachedEntry(sourceUrl)
    void touchPersistentVideoCacheEntry(sourceUrl)
    return Promise.resolve(existingEntry.objectUrl)
  }

  if (existingEntry?.promise) {
    touchCachedEntry(sourceUrl)
    return existingEntry.promise
  }

  const nextEntry: CachedVideoEntry = {
    objectUrl: null,
    size: 0,
    lastAccessedAt: Date.now(),
    activeConsumers: 0,
    promise: Promise.resolve(null),
  }
  cachedVideoEntries.set(sourceUrl, nextEntry)

  const loadPromise = loadPersistentCachedVideoSource(sourceUrl)
    .then(async (persistentObjectUrl) => {
      if (persistentObjectUrl) {
        nextEntry.promise = null
        return persistentObjectUrl
      }

      const response = await fetch(sourceUrl, {
        credentials: 'same-origin',
        cache: 'force-cache',
      })

      if (!response.ok) {
        throw new Error(`Failed to cache video source: ${response.status}`)
      }

      failedVideoCacheAttempts.delete(sourceUrl)

      if (canUsePersistentVideoCache()) {
        const cache = await window.caches.open(PERSISTENT_VIDEO_CACHE_NAME)
        await cache.put(sourceUrl, response.clone())
      }

      const { objectUrl, size } = await createObjectUrlFromResponse(sourceUrl, response.clone())
      await updatePersistentVideoCacheManifest(sourceUrl, size)
      nextEntry.promise = null
      return objectUrl
    })
    .catch((error) => {
      failedVideoCacheAttempts.set(sourceUrl, Date.now())
      console.warn('[CachedVideoSource] Failed to warm video cache.', error)
      cachedVideoEntries.delete(sourceUrl)
      return null
    })

  nextEntry.promise = loadPromise
  return loadPromise
}

interface UseCachedVideoSourceOptions {
  /**
   * When true, keep the original source for the current mount only after the persistent/shared cache lookup misses,
   * while still warming the shared cache in the background.
   */
  backgroundOnly?: boolean
}

/** Share short video payloads across list/detail remounts and page refreshes using in-memory + Cache Storage reuse. */
export function useCachedVideoSource(
  sourceUrl: string | null | undefined,
  { backgroundOnly = false }: UseCachedVideoSourceOptions = {},
) {
  const cacheableSourceUrl = useMemo(
    () => (isCacheableVideoUrl(sourceUrl) ? sourceUrl ?? null : null),
    [sourceUrl],
  )
  const [resolvedSourceUrl, setResolvedSourceUrl] = useState<string | null>(() => {
    if (!cacheableSourceUrl) {
      return sourceUrl ?? null
    }

    if (backgroundOnly) {
      return cacheableSourceUrl
    }

    return getCachedVideoObjectUrl(cacheableSourceUrl)
  })
  const [isCachePending, setIsCachePending] = useState(() => Boolean(cacheableSourceUrl && !getCachedVideoObjectUrl(cacheableSourceUrl)))

  useEffect(() => {
    if (!cacheableSourceUrl) {
      setResolvedSourceUrl(sourceUrl ?? null)
      setIsCachePending(false)
      return
    }

    if (backgroundOnly) {
      setResolvedSourceUrl(cacheableSourceUrl)
      setIsCachePending(false)

      if (!hasRecentFailedVideoCacheAttempt(cacheableSourceUrl)) {
        void warmCachedVideoSource(cacheableSourceUrl)
      }

      return
    }

    const cachedObjectUrl = getCachedVideoObjectUrl(cacheableSourceUrl)
    if (cachedObjectUrl) {
      setResolvedSourceUrl(cachedObjectUrl)
      setIsCachePending(false)
      return
    }

    let cancelled = false
    setResolvedSourceUrl(null)
    setIsCachePending(true)

    void loadPersistentCachedVideoSource(cacheableSourceUrl)
      .then((persistentObjectUrl) => {
        if (cancelled) {
          return null
        }

        if (persistentObjectUrl) {
          setResolvedSourceUrl(persistentObjectUrl)
          setIsCachePending(false)
          return persistentObjectUrl
        }

        return warmCachedVideoSource(cacheableSourceUrl).then((nextObjectUrl) => {
          if (cancelled) {
            return null
          }

          setResolvedSourceUrl(nextObjectUrl ?? cacheableSourceUrl)
          setIsCachePending(false)
          return nextObjectUrl
        })
      })
      .catch((error) => {
        if (cancelled) {
          return
        }

        console.warn('[CachedVideoSource] Failed to resolve cached video source.', error)
        setResolvedSourceUrl(cacheableSourceUrl)
        setIsCachePending(false)
      })

    return () => {
      cancelled = true
    }
  }, [backgroundOnly, cacheableSourceUrl, sourceUrl])

  useEffect(() => {
    if (!cacheableSourceUrl || !resolvedSourceUrl || resolvedSourceUrl === cacheableSourceUrl) {
      return
    }

    retainCachedVideoSource(cacheableSourceUrl)
    return () => {
      releaseCachedVideoSource(cacheableSourceUrl)
    }
  }, [cacheableSourceUrl, resolvedSourceUrl])

  return {
    resolvedSourceUrl,
    isCachePending,
  }
}
