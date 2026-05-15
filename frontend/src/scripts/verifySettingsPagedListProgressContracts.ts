import { deepEqual } from 'node:assert/strict'
import { resolveSettingsPagedListProgress } from '../features/settings/components/settings-searchable-paged-list-progress'

const firstPage = resolveSettingsPagedListProgress({ page: 1, pageSize: 5, visibleCount: 5, totalCount: 12 })
deepEqual(firstPage, {
  start: 1,
  end: 5,
  visibleCount: 5,
  totalCount: 12,
})

const middlePage = resolveSettingsPagedListProgress({ page: 2, pageSize: 5, visibleCount: 5, totalCount: 12 })
deepEqual(middlePage, {
  start: 6,
  end: 10,
  visibleCount: 5,
  totalCount: 12,
})

const lastPage = resolveSettingsPagedListProgress({ page: 3, pageSize: 5, visibleCount: 2, totalCount: 12 })
deepEqual(lastPage, {
  start: 11,
  end: 12,
  visibleCount: 2,
  totalCount: 12,
})

const empty = resolveSettingsPagedListProgress({ page: 1, pageSize: 5, visibleCount: 0, totalCount: 0 })
deepEqual(empty, {
  start: 0,
  end: 0,
  visibleCount: 0,
  totalCount: 0,
})

const clamped = resolveSettingsPagedListProgress({ page: 99, pageSize: 5, visibleCount: 2, totalCount: 12 })
deepEqual(clamped, {
  start: 11,
  end: 12,
  visibleCount: 2,
  totalCount: 12,
})

console.log('Settings paged list progress contracts verified')
