import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasNarration, narrationForModel, splitNarration, withoutNarrationMarks } from '@conai/shared'
import { chatContentWithAttachments } from '../src/services/codex-chat/chatAttachments'
import { buildChatStyleGuidance, normalizeChatStyle } from '../src/services/codex-chat/chatStyle'

test('narration: a `$` line is narration up to its line break, `$$` is a literal `$`', () => {
  assert.deepEqual(splitNarration('$비가 그쳤다\n$그때 문이 열렸다\n누구야?\n이 시간에.'), [
    { narration: true, text: '비가 그쳤다' },
    { narration: true, text: '그때 문이 열렸다' },
    { narration: false, text: '누구야?\n이 시간에.' },
  ])
  assert.deepEqual(splitNarration('$$5 줘\n아니 $3'), [{ narration: false, text: '$5 줘\n아니 $3' }])
  assert.deepEqual(splitNarration('안녕\n$\n$  \n잘 가'), [{ narration: false, text: '안녕' }, { narration: false, text: '잘 가' }])
  assert.equal(hasNarration('$$5 줘'), false)
  assert.equal(hasNarration('$ '), false)
  assert.equal(hasNarration('응\n$문이 열렸다'), true)
})

test('narration: the model reads tagged lines, other text is untouched', () => {
  assert.equal(narrationForModel('$그때 문이 열렸다\n누구야?\n$$5'), '[나레이션] 그때 문이 열렸다\n누구야?\n$5')
  assert.equal(narrationForModel('그냥 말'), '그냥 말')
  assert.equal(chatContentWithAttachments('$문이 열렸다\n누구야?'), '[나레이션] 문이 열렸다\n누구야?')
})

test('narration: every chat style tells the model what a narration line is', () => {
  for (const roleplay of [true, false]) {
    assert.match(buildChatStyleGuidance(normalizeChatStyle({ roleplay }), 'Yuna'), /\[나레이션\]/)
  }
})

test('narration: a chat title from the first message drops the marks', () => {
  assert.equal(withoutNarrationMarks('$문이 열렸다\n누구야? $$3'), '문이 열렸다\n누구야? $$3')
  assert.equal(withoutNarrationMarks('$$3 줘'), '$3 줘')
})
