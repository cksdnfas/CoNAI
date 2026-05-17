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

  console.log('✅ Query cache debounce contracts passed (background invalidations coalesce)')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
