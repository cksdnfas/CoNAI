import './support/testTemp'
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { ExternalApiProvider } from '../src/models/ExternalApiProvider'
import { maskCodeBlocks, modelLanguageGuidance, planStructuredTranslation, restoreCodeBlocks, structuredProseIn, translateReply, translateUserInput, translateUserMessage, translatorOf, translateStructuredFields } from '../src/services/codex-chat/chatTranslation'
import type { ChatProfile } from '../src/services/codex-chat/chatProfiles'
import { mockModelRows } from './modelRowMocks'
import { buildFlagDirective } from '../src/services/codex-chat/chatFlags'

// Model rows: 1 the translator's small model, 2 a model whose connection is gone, 3 a chat model.
const translating = { translationSlotId: 1 }

test('structured translation chunks all wildcard leaves and discards partial failures', async t => {
  let failSecond = false
  const requests = mockTranslator(t, () => {
    const values = JSON.parse(requests.at(-1)!.messages.at(-1)!.content) as Record<string, string>
    return Response.json({ choices: [{ message: { content: JSON.stringify(failSecond && requests.length === 2 ? {} : Object.fromEntries(Object.keys(values).map(key => [key, '번역']))) }, finish_reason: 'stop' }] })
  })
  const original = { entries: Array.from({ length: 130 }, (_, id) => ({ id, text: 'Hello' })) }
  const translated = await translateStructuredFields(translating, original, ['entries.*.text'], 'ko') as typeof original
  assert.deepEqual(requests.map(request => Object.keys(JSON.parse(request.messages.at(-1)!.content)).length), [128, 2])
  assert.equal(translated.entries.length, 130)
  assert.ok(translated.entries.every((entry, id) => entry.id === id && entry.text === '번역'))
  assert.ok(original.entries.every(entry => entry.text === 'Hello'))
  assert.ok(requests.every(request => !('max_tokens' in request)), 'translation never sends the planning reserve as a cap')
  requests.length = 0; failSecond = true
  assert.equal(await translateStructuredFields(translating, original, ['entries.*.text'], 'ko'), null)
  assert.equal(requests.length, 2)
})

test('structured translation sizes chunks for the translator context, not the chat profile', async t => {
  const { learnServerContextLimit } = await import('../src/services/codex-chat/serverContextLimit')
  const { rawMessagesEstimate } = await import('../src/services/codex-chat/llmChatContext')
  const requests = mockTranslator(t, () => {
    const values = JSON.parse(requests.at(-1)!.messages.at(-1)!.content)
    return Response.json({ choices: [{ message: { content: JSON.stringify(values) }, finish_reason: 'stop' }] })
  }, 'budgeted')
  learnServerContextLimit({ providerName: 'translator', model: 'budgeted' }, 'context length (1024 tokens)')
  const original = { entries: Array.from({ length: 10 }, () => ({ text: 'A sentence. '.repeat(30) })) }
  const translated = await translateStructuredFields(translating, original, ['entries.*.text'], 'en')
  assert.deepEqual(translated, original)
  assert.ok(requests.length > 1)
  assert.ok(requests.every(request => request.max_tokens === undefined || Math.ceil(rawMessagesEstimate(request.messages as import('../src/services/codex-chat/llmChatCompletion').ChatCompletionMessage[]) * 1.05) + request.max_tokens <= 1024))
  learnServerContextLimit({ providerName: 'translator', model: 'budgeted' }, 'context length (1024 tokens)')
  for (const maxTokens of [null, 512, 1024, 8192]) {
    requests.length = 0
    const profile = { ...translating, maxTokens }
    const input = { first: 'Hello', second: 'Good morning' }
    const plan = planStructuredTranslation(profile, input, ['first', 'second'], 'en')!
    assert.ok(plan.chunks.every(chunk => chunk.fits), `allowance ${maxTokens} must not book the whole context`)
    assert.deepEqual(await translateStructuredFields(profile, input, ['first', 'second'], 'en'), input)
    if (maxTokens === null) assert.ok(requests.every(request => request.max_tokens === undefined), 'an unset allowance keeps the server default when fitting is unnecessary')
    else {
      assert.ok(requests.every(request => request.max_tokens! <= 1024 - Math.ceil(rawMessagesEstimate(request.messages as import('../src/services/codex-chat/llmChatCompletion').ChatCompletionMessage[]) * 1.05)))
      assert.ok(requests.every(request => request.max_tokens! <= maxTokens))
    }
  }
})

test('an unknown translation output budget does not reject a single long leaf', async t => {
  const requests = mockTranslator(t, () => {
    const values = JSON.parse(requests.at(-1)!.messages.at(-1)!.content)
    return Response.json({ choices: [{ message: { content: JSON.stringify(values) }, finish_reason: 'stop' }] })
  })
  const input = { say: 'A long prose passage. '.repeat(1500) }
  assert.deepEqual(await translateStructuredFields(translating, input, ['say'], 'en'), input)
  assert.equal(requests.length, 1)
  assert.equal((requests[0] as { max_tokens?: number }).max_tokens, undefined)
})

test('structured translation changes prose leaves only and rejects incomplete translations', async t => {
  const original = { say: 'I will bring a potion.', action: { type: 'draw', prompt: 'forest, watercolor' }, entries: [{ id: 'promise-1', title: 'Potion', keys: ['potion'], content: 'Bring a potion.', state: 'active', sourceIds: [17] }] }
  let answer = JSON.stringify({ '0': '회복약을 가져올게.', '1': '회복약', '2': '회복약', '3': '회복약을 가져온다.' })
  mockTranslator(t, () => Response.json({ choices: [{ message: { content: answer }, finish_reason: 'stop' }] }))
  const translated = await translateStructuredFields(translating, original, ['say', 'entries.*.title', 'entries.*.keys.*', 'entries.*.content'], 'ko') as typeof original
  assert.equal(original.say, 'I will bring a potion.')
  assert.equal(translated.say, '회복약을 가져올게.')
  assert.deepEqual(translated.action, original.action)
  assert.equal(translated.entries[0].id, 'promise-1'); assert.equal(translated.entries[0].state, 'active'); assert.deepEqual(translated.entries[0].sourceIds, [17])
  assert.deepEqual(translated.entries[0].keys, ['회복약'])
  answer = JSON.stringify({ '0': '일부만 번역' })
  assert.equal(await translateStructuredFields(translating, original, ['say', 'entries.*.content'], 'ko'), null)
  const controller = new AbortController(); controller.abort()
  assert.equal(await translateStructuredFields(translating, original, ['say'], 'ko', controller.signal), null)
})

/** The translation connection answers `reply`; `requests` collects what was sent to it. */
function mockTranslator(t: TestContext, reply: string | (() => Response), model = 'small') {
  const requests: Array<{ model: string; max_tokens?: number; messages: Array<{ role: string; content: string }> }> = []
  mockModelRows(t, { 1: ['translator', model], 2: ['gone', 'x'], 3: ['test', 'test'] })
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

test('an answer already written in the display language is recognised, so it is not sent for translation', () => {
  const fields = ['summary', 'entries.*.title', 'entries.*.content']
  assert.equal(structuredProseIn({ summary: '보리와 이야기했다.', entries: [{ title: '보리', content: '고향 이야기를 들었다.', sourceIds: [1] }] }, fields, 'ko'), true)
  assert.equal(structuredProseIn({ summary: 'Talked with Bori.', entries: [] }, fields, 'ko'), false)
  assert.equal(structuredProseIn({ summary: '', entries: [] }, fields, 'ko'), false, 'nothing selected is not "already translated"')
})

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

test('translation retries a transient failure before any output', async (t) => {
  let calls = 0
  const requests = mockTranslator(t, () => ++calls === 1
    ? new Response('temporarily unavailable', { status: 503 })
    : Response.json({ choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }] }))
  assert.equal(await translateUserInput(translating, '안녕'), 'Hello')
  assert.equal(requests.length, 2)
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

test('user input: narration lines keep their `$`; a translation that loses one is dropped', async (t) => {
  mockTranslator(t, '$The door bursts open\nWho is it?')
  assert.equal(await translateUserInput(translating, '$그때 문이 벌컥 열렸다\n누구야?'), '$The door bursts open\nWho is it?')
  t.mock.restoreAll()
  mockTranslator(t, 'The door bursts open\nWho is it?')
  assert.equal(await translateUserInput(translating, '$그때 문이 벌컥 열렸다\n누구야?'), null)
})

test('user turns translate selected instructions and picks in one batch, including input outside the display language; failures are visible and cancellation never sends', async t => {
  let answer = JSON.stringify({ '0': 'Hello', '1': 'Answer briefly.', '2': 'Use the sword.' })
  const requests = mockTranslator(t, () => Response.json({ choices: [{ message: { content: answer }, finish_reason: 'stop' }] }))
  const profile = { ...translating, translationDisplayLanguage: 'ja' } as ChatProfile
  const flags = [
    { id: 1, icon: '', name: '짧게', content: '짧게 답해줘.' },
    { id: 0, icon: '', name: '검 사용', content: '검을 써.', pick: true as const },
  ]
  const translated = await translateUserMessage(profile, '안녕', flags)
  assert.equal(requests.length, 1, 'body, flag and pick share one translation request')
  assert.equal(translated.content, 'Hello')
  assert.equal(translated.display_content, '안녕')
  assert.deepEqual(translated.flags.map(flag => [flag.name, flag.content]), [['짧게', 'Answer briefly.'], ['검 사용', 'Use the sword.']])
  assert.equal(flags[0].content, '짧게 답해줘.', 'UI source snapshots are not mutated')
  assert.equal(translated.error, null)
  answer = '{}'
  const failed = await translateUserMessage(profile, '안녕', flags)
  assert.equal(failed.content, '안녕')
  assert.match(failed.error!, /입력 번역.*원문/)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(translateUserMessage(profile, '안녕', flags, controller.signal), { name: 'AbortError' })
  assert.equal(requests.length, 2, 'cancelled input never requests a translation')
  await translateUserMessage({ ...profile, translationSlotId: null }, '안녕', flags)
  assert.equal(requests.length, 2, 'translation off makes no translation calls')
})

test('preserved tokens and unchanged mixed-script input never produce translation failure notices', async t => {
  const requests = mockTranslator(t, () => Response.json({ choices: [{ message: { content: requests.at(-1)!.messages.at(-1)!.content }, finish_reason: 'stop' }] }))
  const english = translating as ChatProfile
  for (const text of ['@하나 hi', 'Hello &*미소*&', 'Hello `한글`', 'https://example.test/한글', '{{사용자}} hi']) {
    const result = await translateUserMessage(english, text, [])
    assert.equal(result.content, text)
    assert.equal(result.error, null)
    assert.equal(result.display_content, null)
  }
  assert.equal(requests.length, 0, 'preserved tokens do not trigger translation')
  // One-letter replies and a user's own bracketed scene notes are prose: translated, and an echo is no failure.
  for (const text of ['응', '한 hi', '[다음 날 아침]']) {
    const before = requests.length
    const result = await translateUserMessage(english, text, [])
    assert.equal(requests.length, before + 1, `${text} is sent to the translator`)
    assert.equal(result.error, null)
  }
  requests.length = 0
  for (const language of ['ja', 'zh'] as const) {
    const profile = { ...english, translationModelLanguage: language, translationDisplayLanguage: 'ko' as const }
    for (const text of ['OK', 'https://example.test/hello']) {
      const result = await translateUserMessage(profile, text, [])
      assert.equal(result.content, text)
      assert.equal(result.error, null)
    }
  }
  const text = '안녕 hi'
  assert.equal((await translateUserMessage(english, text, [])).error, null, 'unchanged plain translation is successful')
  const flags = [{ id: 1, icon: '', name: '짧게', content: '짧게' }]
  const result = await translateUserMessage(english, text, flags)
  assert.equal(result.content, text)
  assert.deepEqual(result.flags, flags, 'unchanged JSON leaves are retained')
  assert.equal(result.error, null)
})

test('body-only translation stays plain with an active model-language flag', async t => {
  const requests = mockTranslator(t, 'Hello')
  const flags = [{ id: 1, icon: '', name: 'Brief', content: 'Answer briefly.' }]
  const result = await translateUserMessage(translating as ChatProfile, '안녕', flags)
  assert.equal(requests[0].messages.at(-1)?.content, '안녕')
  assert.equal(result.content, 'Hello')
  assert.deepEqual(result.flags, flags)
  assert.equal(result.error, null)
})

test('multi-select input translates a repeated question once and keeps its answers in one directive group', async t => {
  let questions = 0
  const requests = mockTranslator(t, () => {
    const strings = JSON.parse(requests.at(-1)!.messages.at(-1)!.content) as Record<string, string>
    const translations: Record<string, string> = { '간다': 'Go', '기다린다': 'Wait' }
    const answer = Object.fromEntries(Object.entries(strings).map(([key, text]) => [key, text === '어떻게 할까?' ? (++questions === 1 ? 'What now?' : 'What should we do?') : translations[text]]))
    return Response.json({ choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: 'stop' }] })
  })
  const flags = ['간다', '기다린다'].map(content => ({ id: 0, icon: '', name: content, content, pick: true as const, choice: { id: 7, question: '어떻게 할까?' } }))
  const result = await translateUserMessage(translating as ChatProfile, 'Both, please.', flags)
  assert.equal(requests.length, 1)
  assert.equal(questions, 1)
  assert.equal(result.error, null)
  assert.equal(buildFlagDirective(result.flags), '[선택지 답: What now?]\n- Go\n- Wait')
})
