import { buildDanbooruTagUrl, normalizeDanbooruTagQuery } from '../lib/danbooru-tag-links'

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function assertWhitespaceTagsUseDanbooruQuerySyntax() {
  assertEqual(normalizeDanbooruTagQuery('  red hair  '), 'red_hair', 'Danbooru tag query should trim and underscore spaces')
  assertEqual(buildDanbooruTagUrl('red hair'), 'https://danbooru.donmai.us/posts?tags=red_hair', 'General prompt tags should link to Danbooru posts')
}

function assertSpecialCharactersAreEncoded() {
  assertEqual(buildDanbooruTagUrl('rating:safe'), 'https://danbooru.donmai.us/posts?tags=rating%3Asafe', 'Danbooru tag URL should encode query tokens')
}

function assertBlankTagsAreNotLinked() {
  assertEqual(buildDanbooruTagUrl('   '), null, 'Blank prompt tag should not create a link')
}

assertWhitespaceTagsUseDanbooruQuerySyntax()
assertSpecialCharactersAreEncoded()
assertBlankTagsAreNotLinked()

console.log('Prompt tag link contracts verified.')
