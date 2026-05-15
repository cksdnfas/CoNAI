import { deepEqual } from 'node:assert/strict'
import { resolveDanbooruBrowserProgress } from '../features/prompts/danbooru-browser-progress'

const firstTagPage = resolveDanbooruBrowserProgress({ page: 1, pageSize: 50, visibleCount: 50, totalCount: 2400 })
deepEqual(firstTagPage, {
  start: 1,
  end: 50,
  visibleCount: 50,
  totalCount: 2400,
  hiddenCount: 2350,
})

const filteredArtistPage = resolveDanbooruBrowserProgress({ page: 3, pageSize: 50, visibleCount: 12, totalCount: 112 })
deepEqual(filteredArtistPage, {
  start: 101,
  end: 112,
  visibleCount: 12,
  totalCount: 112,
  hiddenCount: 0,
})

const characterPage = resolveDanbooruBrowserProgress({ page: 2, pageSize: 30, visibleCount: 30, totalCount: 75 })
deepEqual(characterPage, {
  start: 31,
  end: 60,
  visibleCount: 30,
  totalCount: 75,
  hiddenCount: 15,
})

const emptySearch = resolveDanbooruBrowserProgress({ page: 1, pageSize: 50, visibleCount: 0, totalCount: 0 })
deepEqual(emptySearch, {
  start: 0,
  end: 0,
  visibleCount: 0,
  totalCount: 0,
  hiddenCount: 0,
})

console.log('Danbooru browser progress contracts verified')
