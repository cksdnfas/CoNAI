import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { ExternalApiProvider } from '../src/models/ExternalApiProvider'
import { translateReply, translateUserInput, translatorOf } from '../src/services/codex-chat/chatTranslation'
import { ChatProfileStore } from '../src/services/codex-chat/chatProfiles'

const translating = { translationProviderName: 'translator', translationModel: 'small' }

/** The translation connection answers `reply`; `requests` collects what was sent to it. */
function mockTranslator(t: TestContext, reply: string | (() => Response)) {
  const requests: Array<{ model: string; messages: Array<{ role: string; content: string }> }> = []
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
  assert.equal(await translateUserInput({ translationProviderName: null, translationModel: '' }, '안녕'), null)
  assert.equal(await translateUserInput(null, '안녕'), null)
  assert.equal(await translateUserInput({ translationProviderName: 'gone', translationModel: '' }, '안녕'), null)
  assert.equal(await translateReply({ translationProviderName: 'gone', translationModel: '' }, 'Hello'), null)
  assert.equal(requests.length, 0)
})

test('replies: English becomes Korean; a reply already in Korean is not sent', async (t) => {
  const requests = mockTranslator(t, '*미소 짓는다* 안녕! 잘 지냈어?')
  assert.equal(await translateReply(translating, '*smiles* Hi! How have you been?'), '*미소 짓는다* 안녕! 잘 지냈어?')
  assert.equal(requests.length, 1)
  assert.equal(await translateReply(translating, '안녕! 잘 지냈어? (ok)'), null)
  assert.equal(requests.length, 1)
})

test('a translation that loses display-block fences, emoticon tokens or cast tags is dropped', async (t) => {
  t.mock.method(console, 'warn', () => {})
  const original = '[Mina] Hi &*smile*& there {{user}}.\n```status\n{"hp": 5}\n```'
  let answer = '[미나] 안녕 &*smile*& {{user}}.\n```status\n{"hp": 5}\n```'
  mockTranslator(t, () => Response.json({ choices: [{ message: { content: answer }, finish_reason: 'stop' }] }))
  assert.equal(await translateReply(translating, original), answer)
  answer = '[미나] 안녕 &*smile*& {{user}}.\n상태: hp 5'
  assert.equal(await translateReply(translating, original), null, 'fence removed')
  answer = '[미나] 안녕 (웃음) {{user}}.\n```status\n{"hp": 5}\n```'
  assert.equal(await translateReply(translating, original), null, 'emoticon token translated away')
  answer = '미나: 안녕 &*smile*& {{user}}.\n```status\n{"hp": 5}\n```'
  assert.equal(await translateReply(translating, original), null, 'cast tag rewritten')
})

test('a failed or empty translation falls back to the original without throwing', async (t) => {
  t.mock.method(console, 'warn', () => {})
  mockTranslator(t, () => new Response('boom', { status: 500 }))
  assert.equal(await translateReply(translating, 'Hello'), null)
  mockTranslator(t, '')
  assert.equal(await translateReply(translating, 'Hello'), null)
})

test('group rooms translate the user with the first member that has a translation model', () => {
  const plain = ChatProfileStore.draft({ name: 'A', providerName: 'test', model: 'test' }, 1)
  const translator = ChatProfileStore.draft({ name: 'B', providerName: 'test', model: 'test', translationProviderName: 'translator', translationModel: 'small' }, 2)
  assert.equal(translatorOf([plain, translator])?.id, 2)
  assert.equal(translatorOf([plain]), null)
  assert.equal(translator.translationProviderName, 'translator')
  assert.equal(translator.translationModel, 'small')
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
