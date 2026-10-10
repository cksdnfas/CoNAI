import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { ExternalApiProvider } from '../src/models/ExternalApiProvider'
import { maskCodeBlocks, modelLanguageGuidance, restoreCodeBlocks, translateReply, translateUserInput, translatorOf } from '../src/services/codex-chat/chatTranslation'
import type { ChatProfile } from '../src/services/codex-chat/chatProfiles'
import { mockModelRows } from './modelRowMocks'

// Model rows: 1 the translator's small model, 2 a model whose connection is gone, 3 a chat model.
const translating = { translationSlotId: 1 }

/** The translation connection answers `reply`; `requests` collects what was sent to it. */
function mockTranslator(t: TestContext, reply: string | (() => Response)) {
  const requests: Array<{ model: string; messages: Array<{ role: string; content: string }> }> = []
  mockModelRows(t, { 1: ['translator', 'small'], 2: ['gone', 'x'], 3: ['test', 'test'] })
  t.mock.method(ExternalApiProvider, 'findByName', (name: string) => name === 'translator'
    ? { provider_name: 'translator', display_name: 'Translator', is_enabled: true, provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', additional_config: {} }
    : undefined)
  t.mock.method(ExternalApiProvider, 'getDecryptedKey', () => null)
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(init.body as string))
    return typeof reply === 'string' ? Response.json({ choices: [{ message: { content: reply }, finish_reason: 'stop' }] }) : reply()
  })
  return requests
}

test('user input: Korean goes to the model in English with the translation model, English is left alone', async (t) => {
  const requests = mockTranslator(t, 'Hello, how are you?')
  assert.equal(await translateUserInput(translating, '안녕, 잘 지내?'), 'Hello, how are you?')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].model, 'small')
  assert.equal(requests[0].messages.at(-1)?.content, '안녕, 잘 지내?')
  assert.equal(await translateUserInput(translating, 'Hello there'), null)
  assert.equal(requests.length, 1, 'text without Korean is not sent for translation')
})

test('no translation model, or a missing connection, leaves messages untranslated', async (t) => {
  t.mock.method(console, 'warn', () => {})
  const requests = mockTranslator(t, 'unused')
  assert.equal(await translateUserInput({ translationSlotId: null }, '안녕'), null)
  assert.equal(await translateUserInput(null, '안녕'), null)
  assert.equal(await translateUserInput({ translationSlotId: 2 }, '안녕'), null)
  assert.equal(await translateReply({ translationSlotId: 2 }, 'Hello'), null)
  assert.equal(requests.length, 0)
})

test('replies: English becomes Korean; a reply already in Korean is not sent', async (t) => {
  const requests = mockTranslator(t, '*미소 짓는다* 안녕! 잘 지냈어?')
  assert.equal(await translateReply(translating, '*smiles* Hi! How have you been?'), '*미소 짓는다* 안녕! 잘 지냈어?')
  assert.equal(requests.length, 1)
  assert.equal(await translateReply(translating, '안녕! 잘 지냈어? (ok)'), null)
  assert.equal(requests.length, 1)
})

test('the profile picks the languages: messages go into the model language, replies into the display language', async (t) => {
  const requests = mockTranslator(t, 'translated')
  const japaneseReader = { ...translating, translationModelLanguage: 'ko' as const, translationDisplayLanguage: 'ja' as const }
  assert.equal(await translateUserInput(japaneseReader, 'こんにちは、元気？'), 'translated')
  assert.match(requests[0].messages[0].content, /into natural, fluent Korean/)
  assert.equal(await translateUserInput(japaneseReader, '안녕'), null, 'text with nothing in the display language is not sent')
  assert.equal(await translateReply(japaneseReader, '안녕하세요, 오늘 어때?'), 'translated')
  assert.match(requests[1].messages[0].content, /into natural, fluent Japanese/)
  assert.ok(!requests[1].messages[0].content.includes('반말'), 'the Korean register note is only for Korean readers')
  assert.equal(await translateReply(japaneseReader, 'こんにちは、今日はどう？'), null, 'a reply already in the display language is not sent')
  const same = { ...translating, translationModelLanguage: 'ko' as const, translationDisplayLanguage: 'ko' as const }
  assert.equal(await translateUserInput(same, '안녕'), null, 'one language both ways translates nothing')
  assert.equal(requests.length, 2)
})

test('the chat model is told to write in the model language only when the profile translates', (t) => {
  mockTranslator(t, 'unused')
  assert.match(modelLanguageGuidance(translating), /Write every reply in English/)
  assert.match(modelLanguageGuidance({ ...translating, translationModelLanguage: 'ja' }), /Write every reply in Japanese/)
  assert.equal(modelLanguageGuidance({ translationSlotId: null }), '')
  assert.equal(modelLanguageGuidance({ ...translating, translationModelLanguage: 'ko', translationDisplayLanguage: 'ko' }), '')
})

test('a translation that loses display-block fences, emoticon tokens or cast tags is dropped', async (t) => {
  t.mock.method(console, 'warn', () => {})
  const original = '[Mina] Hi &*smile*& there {{user}}.\n```status\n{"hp": 5}\n```\nBye.'
  let answer = '[미나] 안녕 &*smile*& {{user}}.\n{{code-block-1}}\n잘 가.'
  mockTranslator(t, () => Response.json({ choices: [{ message: { content: answer }, finish_reason: 'stop' }] }))
  assert.equal(await translateReply(translating, original), '[미나] 안녕 &*smile*& {{user}}.\n```status\n{"hp": 5}\n```\n잘 가.')
  answer = '[미나] 안녕 &*smile*& {{user}}.\n상태: hp 5\n잘 가.'
  assert.equal(await translateReply(translating, original), null, 'block placeholder removed')
  answer = '[미나] 안녕 (웃음) {{user}}.\n{{code-block-1}}\n잘 가.'
  assert.equal(await translateReply(translating, original), null, 'emoticon token translated away')
  answer = '미나: 안녕 &*smile*& {{user}}.\n{{code-block-1}}\n잘 가.'
  assert.equal(await translateReply(translating, original), null, 'cast tag rewritten')
})

test('a status block ending the reply is held back from the translator, so losing its placeholder cannot drop it', async (t) => {
  t.mock.method(console, 'warn', () => {})
  const vitals = '```vitals\n{"mood": 32}\n```'
  // A translator that forgets the last placeholder used to get the whole reply shown untranslated.
  const requests = mockTranslator(t, '*베이스가 바닥을 타고 올라온다.*')
  assert.equal(await translateReply(translating, `*The bassline crawls through the floor.*\n\n${vitals}`), `*베이스가 바닥을 타고 올라온다.*\n\n${vitals}`)
  assert.equal(requests[0].messages.at(-1)?.content, '*The bassline crawls through the floor.*')
  // A translator that invents the held-back placeholder doubles the block: dropped.
  mockTranslator(t, '*베이스가 올라온다.*\n{{code-block-1}}')
  assert.equal(await translateReply(translating, `*The bassline crawls.*\n${vitals}`), null)
})

test('code blocks never reach the translator and come back untouched', async (t) => {
  t.mock.method(console, 'warn', () => {})
  const code = '```\n1girl, school uniform, (sitting:1.2), looking at viewer\n```'
  const original = `Tag list (NAI v5):\n\n${code}\n\nWant me to add more?`
  // A translator that "helpfully" mangles a fence used to get the whole reply dropped.
  const requests = mockTranslator(t, '태그 목록 (NAI v5):\n\n{{code-block-1}}\n\n더 추가해 줄까?')
  assert.equal(await translateReply(translating, original), `태그 목록 (NAI v5):\n\n${code}\n\n더 추가해 줄까?`)
  const sent = requests[0].messages.at(-1)?.content ?? ''
  assert.ok(!sent.includes('1girl') && !sent.includes('```'), 'the code is not sent')

  // Korean prose with long English code: the prose decides, so it is not sent at all.
  assert.equal(await translateReply(translating, `태그 목록이야:\n${code}`), null)
  // Only code: nothing to translate.
  assert.equal(await translateReply(translating, code), null)
  // ~~~ fences, an unclosed fence, and a user message with code are masked too.
  assert.equal(await translateUserInput(translating, '이 태그 고쳐줘\n~~~\n1girl, 안경\n~~~\n어때?'), '태그 목록 (NAI v5):\n\n~~~\n1girl, 안경\n~~~\n\n더 추가해 줄까?')
  assert.equal(requests.at(-1)?.messages.at(-1)?.content, '이 태그 고쳐줘\n{{code-block-1}}\n어때?')
  await translateReply(translating, 'Here:\n```\nunclosed, tags')
  assert.equal(requests.at(-1)?.messages.at(-1)?.content, 'Here:', 'an unclosed fence runs to the end (and, ending the text, is held back)')
  assert.equal(requests.length, 3)
})

test('masked code blocks: nested fence lengths, and a lost or doubled placeholder fails', () => {
  const text = 'A\n````md\n```\ninner\n```\n````\nB\n```js\nx()\n```'
  const masked = maskCodeBlocks(text)
  assert.equal(masked.text, 'A\n{{code-block-1}}\nB\n{{code-block-2}}')
  assert.equal(restoreCodeBlocks(masked.text, masked.blocks), text)
  assert.equal(restoreCodeBlocks('A\nB\n{{code-block-2}}', masked.blocks), null)
  assert.equal(restoreCodeBlocks('{{code-block-1}} {{code-block-1}} {{code-block-2}}', masked.blocks), null)
  assert.deepEqual(maskCodeBlocks('no code here'), { text: 'no code here', blocks: [] })
})

test('a failed or empty translation falls back to the original without throwing', async (t) => {
  t.mock.method(console, 'warn', () => {})
  mockTranslator(t, () => new Response('boom', { status: 500 }))
  assert.equal(await translateReply(translating, 'Hello'), null)
  mockTranslator(t, '')
  assert.equal(await translateReply(translating, 'Hello'), null)
})

test('group rooms translate the user with the first member that has a translation model', (t) => {
  mockTranslator(t, 'unused')
  const plain = { id: 1, name: 'A', engine: 'llm', modelSlotId: 3, translationSlotId: null } as unknown as ChatProfile
  const translator = { ...plain, id: 2, name: 'B', translationSlotId: 1 } as ChatProfile
  assert.equal(translatorOf([plain, translator])?.id, 2)
  assert.equal(translatorOf([plain]), null)
})

test('an address label the model copied from history is cut from its reply, so the translator sees only the text', async (t) => {
  const { stripEchoedAddresses } = await import('@conai/shared')
  assert.equal(stripEchoedAddresses('[message_id=759; to=["user"]; reply_to=758; from=assistant] The reply.'), 'The reply.')
  assert.equal(stripEchoedAddresses('[message_id=12; to=["user"]; from=3]\n*smiles* Hi.\n\n[message_id=12; to=["user"]; from=3]\nMore.'), '*smiles* Hi.\n\nMore.')
  assert.equal(stripEchoedAddresses('**[Mina; message_id=40; to=[3]]** Hello @Yuki'), 'Hello @Yuki')
  assert.equal(stripEchoedAddresses('[Mina] Hi [id=3] there.\nSee [message_id=5] inline.'), '[Mina] Hi [id=3] there.\nSee [message_id=5] inline.')
  const requests = mockTranslator(t, '답장이야.')
  assert.equal(await translateReply(translating, stripEchoedAddresses('[message_id=759; to=["user"]; reply_to=758; from=assistant]\nThe reply.')), '답장이야.')
  assert.equal(requests.length, 1)
})
