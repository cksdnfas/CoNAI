import { getUploadResultDetailPath } from '../features/upload/upload-result-links'

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

assertCompositeHashBuildsDetailPath()
assertMissingCompositeHashHasNoDetailPath()

console.log('Upload result link contracts verified.')
