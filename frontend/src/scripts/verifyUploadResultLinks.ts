import { getUploadResultDetailPath } from '../features/upload/upload-result-links'
import { getVisibleUploadResultItems, getVisibleUploadResultLists } from '../features/upload/upload-result-list'

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function assertCompositeHashBuildsDetailPath() {
  assertEqual(
    getUploadResultDetailPath({ composite_hash: 'abc123:def456' }),
    '/images/abc123%3Adef456',
    'upload result should link to detail route by composite hash',
  )
}

function assertMissingCompositeHashHasNoDetailPath() {
  assertEqual(getUploadResultDetailPath({ composite_hash: null }), null, 'missing composite hash should not build detail route')
  assertEqual(getUploadResultDetailPath({}), null, 'absent composite hash should not build detail route')
}

function assertHiddenUploadResultsAreCounted() {
  const result = getVisibleUploadResultItems(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 6)
  assertEqual(result.visible.join(','), 'a,b,c,d,e,f', 'upload result list should keep first visible rows')
  assertEqual(result.hiddenCount, 1, 'upload result list should expose hidden successful row count')
}

function assertInvalidVisibleLimitShowsNoRows() {
  const result = getVisibleUploadResultItems(['a', 'b'], -1)
  assertEqual(result.visible.length, 0, 'invalid upload result visible limit should show no rows')
  assertEqual(result.hiddenCount, 2, 'invalid upload result visible limit should count hidden rows')
}

function assertSuccessfulAndFailedRowsAreCappedTogether() {
  const result = getVisibleUploadResultLists(
    {
      uploaded: ['s1', 's2', 's3'],
      failed: ['f1', 'f2', 'f3', 'f4'],
    },
    2,
  )

  assertEqual(result.uploaded.visible.join(','), 's1,s2', 'upload result summary should cap successful rows')
  assertEqual(result.uploaded.hiddenCount, 1, 'upload result summary should count hidden successful rows')
  assertEqual(result.failed.visible.join(','), 'f1,f2', 'upload result summary should cap failed rows')
  assertEqual(result.failed.hiddenCount, 2, 'upload result summary should count hidden failed rows')
}

assertCompositeHashBuildsDetailPath()
assertMissingCompositeHashHasNoDetailPath()
assertHiddenUploadResultsAreCounted()
assertInvalidVisibleLimitShowsNoRows()
assertSuccessfulAndFailedRowsAreCappedTogether()

console.log('Upload result link contracts verified.')
