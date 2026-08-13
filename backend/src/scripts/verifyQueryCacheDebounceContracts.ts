import * as assert from 'node:assert/strict'

import { QueryCacheService } from '../services/QueryCacheService'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  QueryCacheService.initialize()
  QueryCacheService.setGalleryCache(1, 25, 'first_seen_date', 'DESC', { items: ['cached'] })

  QueryCacheService.scheduleGalleryCacheInvalidation(25)
  QueryCacheService.scheduleGalleryCacheInvalidation(25)
  QueryCacheService.scheduleGalleryCacheInvalidation(25)

  assert.deepEqual(
    QueryCacheService.getGalleryCache(1, 25, 'first_seen_date', 'DESC'),
    { items: ['cached'] },
    'scheduled gallery invalidation must not clear the cache synchronously per item',
  )

  await wait(60)

  assert.equal(
    QueryCacheService.getGalleryCache(1, 25, 'first_seen_date', 'DESC'),
    null,
    'scheduled gallery invalidation must clear the gallery cache after the debounce window',
  )

  verifySingleImageInvalidation()
  verifyGalleryTotalCache()

  console.log('✅ Query cache debounce contracts passed (background invalidations coalesce)')
}

/** Verify one image change invalidates every cached gallery page and sort. */
function verifySingleImageInvalidation() {
  QueryCacheService.initialize()
  QueryCacheService.setGalleryCache(1, 20, 'first_seen_date', 'DESC', { items: ['default-page'] })
  QueryCacheService.setGalleryCache(2, 37, 'height', 'ASC', { items: ['custom-page'] })

  QueryCacheService.invalidateImageCache('changed-image')

  assert.equal(
    QueryCacheService.getGalleryCache(1, 20, 'first_seen_date', 'DESC'),
    null,
    'single-image invalidation must clear the default gallery cache key',
  )
  assert.equal(
    QueryCacheService.getGalleryCache(2, 37, 'height', 'ASC'),
    null,
    'single-image invalidation must clear non-default pages, limits, and sorts',
  )
}

/**
 * The home feed total is a full-library count (~60ms at 200k rows) that every
 * visitor would otherwise recompute. It is cached server-side, and — because an
 * active generation queue invalidates the gallery cache every few seconds — an
 * invalidation must not be able to hand the very next request a fresh count.
 */
function verifyGalleryTotalCache() {
  QueryCacheService.initialize()

  assert.equal(
    QueryCacheService.getGalleryTotalCache('visible-feed'),
    null,
    'an unseeded feed total must report a cache miss so the caller computes it',
  )

  QueryCacheService.setGalleryTotalCache('visible-feed', 1234)
  assert.equal(
    QueryCacheService.getGalleryTotalCache('visible-feed'),
    1234,
    'a cached feed total must be served without recomputing',
  )
  assert.equal(
    QueryCacheService.getGalleryTotalCache('other-scope'),
    null,
    'feed totals must not leak across scope keys',
  )

  QueryCacheService.invalidateGalleryCache()
  assert.equal(
    QueryCacheService.getGalleryTotalCache('visible-feed'),
    1234,
    'invalidation must not force an immediate recount while the last value is still recent',
  )

  QueryCacheService.initialize()
  assert.equal(
    QueryCacheService.getGalleryTotalCache('visible-feed'),
    null,
    're-initialization must drop every cached feed total',
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
