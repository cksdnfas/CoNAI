import { deepEqual } from 'node:assert/strict'
import { resolvePromptListProgress } from '../features/prompts/prompt-list-progress'

const firstPage = resolvePromptListProgress({ page: 1, pageSize: 40, visibleCount: 40, totalCount: 125 })
deepEqual(firstPage, {
  start: 1,
  end: 40,
  visibleCount: 40,
  totalCount: 125,
  hiddenCount: 85,
})

const lastPage = resolvePromptListProgress({ page: 3, pageSize: 40, visibleCount: 30, totalCount: 110 })
deepEqual(lastPage, {
  start: 81,
  end: 110,
  visibleCount: 30,
  totalCount: 110,
  hiddenCount: 0,
})

const empty = resolvePromptListProgress({ page: 1, pageSize: 40, visibleCount: 0, totalCount: 0 })
deepEqual(empty, {
  start: 0,
  end: 0,
  visibleCount: 0,
  totalCount: 0,
  hiddenCount: 0,
})

const clamped = resolvePromptListProgress({ page: 99, pageSize: 40, visibleCount: 5, totalCount: 45 })
deepEqual(clamped, {
  start: 41,
  end: 45,
  visibleCount: 5,
  totalCount: 45,
  hiddenCount: 0,
})

console.log('Prompt list progress contracts verified')
