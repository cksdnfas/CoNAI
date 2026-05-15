import { deepEqual } from 'node:assert/strict'
import { resolveModuleWorkflowOutputProgress } from '../features/module-graph/module-workflow-output-progress'

const firstPage = resolveModuleWorkflowOutputProgress({ page: 1, pageSize: 50, visibleCount: 50, totalCount: 180 })
deepEqual(firstPage, {
  start: 1,
  end: 50,
  visibleCount: 50,
  totalCount: 180,
  hiddenCount: 130,
})

const middlePage = resolveModuleWorkflowOutputProgress({ page: 2, pageSize: 50, visibleCount: 50, totalCount: 180 })
deepEqual(middlePage, {
  start: 51,
  end: 100,
  visibleCount: 50,
  totalCount: 180,
  hiddenCount: 80,
})

const lastPage = resolveModuleWorkflowOutputProgress({ page: 4, pageSize: 50, visibleCount: 30, totalCount: 180 })
deepEqual(lastPage, {
  start: 151,
  end: 180,
  visibleCount: 30,
  totalCount: 180,
  hiddenCount: 0,
})

const empty = resolveModuleWorkflowOutputProgress({ page: 1, pageSize: 50, visibleCount: 0, totalCount: 0 })
deepEqual(empty, {
  start: 0,
  end: 0,
  visibleCount: 0,
  totalCount: 0,
  hiddenCount: 0,
})

const clamped = resolveModuleWorkflowOutputProgress({ page: 99, pageSize: 50, visibleCount: 5, totalCount: 55 })
deepEqual(clamped, {
  start: 51,
  end: 55,
  visibleCount: 5,
  totalCount: 55,
  hiddenCount: 0,
})

console.log('Module workflow output progress contracts verified')
