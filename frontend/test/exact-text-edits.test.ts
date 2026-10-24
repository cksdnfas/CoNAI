import assert from 'node:assert/strict'
import { test } from 'node:test'
import { replaceExactText } from '../src/lib/exact-text-edits'

test('ordered edits see earlier replacements and keep replacement text literal', () => {
  assert.equal(replaceExactText('alpha beta', [
    { find: 'alpha', replace: 'gamma' },
    { find: 'gamma', replace: 'delta' },
  ], '문서'), 'delta beta')
  const replacement = "$&/$`/$'/$$"
  assert.equal(replaceExactText('price = old', [{ find: 'old', replace: replacement }], '문서'), `price = ${replacement}`)
  assert.equal(replaceExactText('unchanged', [], '본문'), 'unchanged')
})

test('repeated matches require all and replace every occurrence without expansion', () => {
  assert.throws(() => replaceExactText('cat cat', [{ find: 'cat', replace: 'dog' }], '본문'), {
    message: '본문에 2번 나와. 앞뒤 글을 더 넣거나 all을 켜줘: cat',
  })
  assert.equal(replaceExactText('cat cat', [{ find: 'cat', replace: '$&', all: true }], '본문'), '$& $&')
})

test('missing and empty matches preserve each editor error label', () => {
  for (const subject of ['문서', '본문']) {
    assert.throws(() => replaceExactText('text', [{ find: 'missing', replace: 'new' }], subject), {
      message: `${subject}에 없는 글이야: missing`,
    })
    assert.throws(() => replaceExactText('text', [{ find: '', replace: 'new' }], subject), {
      message: `${subject}에 없는 글이야: `,
    })
  }
})

test('a later invalid edit rejects instead of returning a partially edited draft', () => {
  assert.throws(() => replaceExactText('alpha beta', [
    { find: 'alpha', replace: 'gamma' },
    { find: 'missing', replace: 'delta' },
  ], '문서'), { message: '문서에 없는 글이야: missing' })
})
