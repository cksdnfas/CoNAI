import { getUploadResultDetailPath } from '../features/upload/upload-result-links'
import { getVisibleUploadResultItems } from '../features/upload/upload-result-list'

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

assertCompositeHashBuildsDetailPath()
assertMissingCompositeHashHasNoDetailPath()
assertHiddenUploadResultsAreCounted()
assertInvalidVisibleLimitShowsNoRows()

console.log('Upload result link contracts verified.')
