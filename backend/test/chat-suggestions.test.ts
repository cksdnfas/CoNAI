import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { ExternalApiProvider } from '../src/models/ExternalApiProvider'
import { ChatUserProfileStore } from '../src/services/codex-chat/chatUserProfiles'
import { ChatSuggestError, buildSuggestionTranscript, parseSuggestions, suggestReplies, suggestionTargetOf } from '../src/services/codex-chat/chatSuggestions'
import type { ChatProfile } from '../src/services/codex-chat/chatProfiles'
import type { CodexChatMessageRecord, CodexChatThreadRecord } from '../src/services/codex-chat/codexChatStore'

/** The suggestion connection answers `reply`; `requests` collects what was sent to it. */
function mockConnection(t: TestContext, reply: string | (() => Response)) {
  const requests: Array<{ model: string; messages: Array<{ role: string; content: string }> }> = []
  t.mock.method(ExternalApiProvider, 'findByName', (name: string) => name === 'small-llm' || name === 'chat-llm'
    ? { provider_name: name, display_name: name, is_enabled: true, provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', additional_config: {} }
    : undefined)
  t.mock.method(ExternalApiProvider, 'getDecryptedKey', () => null)
  t.mock.method(ChatUserProfileStore, 'forThread', () => ({ id: 1, account_id: null, name: '민수', persona: '대학생. 유나의 소꿉친구.', created_date: '', updated_date: '' }))
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(init.body as string))
    return typeof reply === 'string' ? Response.json({ choices: [{ message: { content: reply }, finish_reason: 'stop' }] }) : reply()
  })
  return requests
}

function message(id: number, role: 'user' | 'assistant', content: string, extra: Partial<CodexChatMessageRecord> = {}): CodexChatMessageRecord {
  return { id, thread_id: 1, role, content, speaker_profile_id: null, tool_calls: [], status: 'completed', error: null, finish_reason: null, alternatives: [], active_alternative: 0, created_date: '', ...extra }
}

const profile = {
  id: 1, name: '유나', tagline: '비 오는 날의 소꿉친구', engine: 'llm', providerName: 'chat-llm', model: 'big',
  suggestEnabled: true, suggestProviderName: 'small-llm', suggestModel: 'tiny',
  style: { blocks: [{ id: 'b', key: 'vitals', instruction: '', example: '', template: '', css: '', rules: '', summary: '', fields: [], enabled: true }] },
} as unknown as ChatProfile
const thread = { id: 1, account_id: null, user_profile_id: 1, profile_id: 1, kind: 'direct' } as unknown as CodexChatThreadRecord

test('parseSuggestions: a JSON array, a fenced one, or lines; trimmed, deduplicated, capped at three', () => {
  assert.deepEqual(parseSuggestions('["a", "b", "c", "d"]'), ['a', 'b', 'c'])
  assert.deepEqual(parseSuggestions('```json\n["\\"안녕\\"", "*웃는다*"]\n```'), ['"안녕"', '*웃는다*'])
  assert.deepEqual(parseSuggestions('1. 첫째\n2. 둘째\n- 둘째\n'), ['첫째', '둘째'])
  assert.deepEqual(parseSuggestions('[{"text": "x"}, 3, ""]'), ['x'])
  assert.deepEqual(parseSuggestions('   '), [])
})

test('suggestionTargetOf: off, the chat connection as fallback for LLM profiles, none for Codex without its own', (t) => {
  mockConnection(t, '')
  assert.equal(suggestionTargetOf({ ...profile, suggestEnabled: false }), null)
  const own = suggestionTargetOf({ ...profile, suggestProviderName: null, suggestModel: '' })
  assert.equal(own?.providerName, 'chat-llm')
  assert.equal(own?.model, 'big')
  assert.equal(suggestionTargetOf({ ...profile, engine: 'codex', providerName: '', suggestProviderName: null }), null)
  assert.equal(suggestionTargetOf(profile)?.model, 'tiny')
})

test('transcript: reader text, no block fences, no reply labels, last turns only', () => {
  const messages = [
    message(1, 'assistant', '[message_id=1]\n"어서 와."\n```vitals\n{"hp": 90}\n```'),
    message(2, 'user', 'Hello', { display_content: '안녕' }),
    message(3, 'assistant', 'failed', { status: 'failed' }),
  ]
  const text = buildSuggestionTranscript(messages, '민수', () => '유나', new Set(['vitals']))
  assert.equal(text, '유나: "어서 와."\n\n민수: 안녕')
})

test('suggestReplies: asks the suggestion model with the persona and transcript, returns the parsed list', async (t) => {
  const requests = mockConnection(t, '["\\"비 많이 오네.\\"", "*수건을 건넨다.*", "\\"뭐 먹을래?\\""]')
  const messages = [message(1, 'assistant', '*유나가 소파에 앉는다.* "비 오는 날은 집이 최고야."')]
  const suggestions = await suggestReplies(profile, thread, messages, () => '유나')
  assert.deepEqual(suggestions, ['"비 많이 오네."', '*수건을 건넨다.*', '"뭐 먹을래?"'])
  assert.equal(requests.length, 1)
  assert.equal(requests[0].model, 'tiny')
  assert.match(requests[0].messages[0].content, /이름: 유나/)
  assert.match(requests[0].messages[0].content, /민수/)
  assert.match(requests[0].messages[0].content, /소꿉친구/)
  assert.match(requests[0].messages.at(-1)?.content ?? '', /유나: \*유나가 소파에 앉는다\.\*/)
})

test('suggestReplies: no usable answer, no transcript, and a failed call each surface as ChatSuggestError', async (t) => {
  mockConnection(t, '')
  await assert.rejects(suggestReplies(profile, thread, [message(1, 'assistant', 'hi')], () => '유나'), (error: unknown) => error instanceof ChatSuggestError && error.status === 502)
  await assert.rejects(suggestReplies(profile, thread, [], () => '유나'), (error: unknown) => error instanceof ChatSuggestError && error.status === 409)
  await assert.rejects(suggestReplies({ ...profile, suggestEnabled: false }, thread, [message(1, 'assistant', 'hi')], () => '유나'), (error: unknown) => error instanceof ChatSuggestError && error.status === 409)
  mockConnection(t, () => new Response('boom', { status: 500 }))
  await assert.rejects(suggestReplies(profile, thread, [message(1, 'assistant', 'hi')], () => '유나'), (error: unknown) => error instanceof ChatSuggestError && error.status === 502)
})
