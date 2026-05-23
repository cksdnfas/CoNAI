import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { buildDanbooruTagUrl, normalizeDanbooruTagQuery } from '../lib/danbooru-tag-links'

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function assertIncludes(source: string, needle: string, message: string) {
  if (!source.includes(needle)) {
    throw new Error(message)
  }
}

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), 'src', relativePath), 'utf8')
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

function assertPromptTagActionMenuSearchCopy() {
  const source = readSource('components/common/prompt-tag-action-menu.tsx')

  assertIncludes(source, "ko: '검색에 {tag} 추가'", 'Prompt tag action menu should show localized Korean search-filter copy')
  assertIncludes(source, "en: 'Add {tag} to search'", 'Prompt tag action menu should show clear English search-filter copy')
  assertIncludes(source, 'onAddSearchFilter?.(tag)', 'Prompt tag action menu should call the scoped search-filter action with the original tag')
  assertIncludes(source, 'setOpen(false)', 'Prompt tag action menu should close after a menu action')
}

function assertExtractedPromptSearchActionsStayScoped() {
  const source = readSource('components/common/extracted-prompt-sections.tsx')

  assertIncludes(source, "return scope === 'lora' ? null : undefined", 'LoRA prompt chips should not expose Danbooru web-search links')
  assertIncludes(source, 'onAddSearchFilter(scope, tag)', 'Extracted prompt tags should forward their prompt scope with the clicked tag')
}

assertWhitespaceTagsUseDanbooruQuerySyntax()
assertSpecialCharactersAreEncoded()
assertBlankTagsAreNotLinked()
assertPromptTagActionMenuSearchCopy()
assertExtractedPromptSearchActionsStayScoped()

console.log('Prompt tag link/action contracts verified.')
