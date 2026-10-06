import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { ExternalApiProvider } from '../src/models/ExternalApiProvider'
import { ChatUserProfileStore } from '../src/services/codex-chat/chatUserProfiles'
import { ChatSuggestError, buildSuggestionTranscript, canSuggest, parseSuggestions, suggestReplies, suggestionRunnerOf, userWriterReady } from '../src/services/codex-chat/chatSuggestions'
import { ModelSlotStore } from '../src/services/codex-chat/modelSlots'
import { ChatProfileStore, type ChatProfile } from '../src/services/codex-chat/chatProfiles'
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

const modelOf = (runner: ReturnType<typeof suggestionRunnerOf>) => runner?.kind === 'llm' ? [runner.target.providerName, runner.target.model] : runner ? ['codex', runner.model] : null

test('suggestionRunnerOf: off, own connection, the chat connection for LLM profiles, the own Codex model for Codex', (t) => {
  mockConnection(t, '')
  assert.equal(suggestionRunnerOf({ ...profile, suggestEnabled: false }), null)
  assert.deepEqual(modelOf(suggestionRunnerOf(profile)), ['small-llm', 'tiny'])
  assert.deepEqual(modelOf(suggestionRunnerOf({ ...profile, suggestProviderName: null, suggestModel: '' })), ['chat-llm', 'big'])
  const codex = suggestionRunnerOf({ ...profile, engine: 'codex', providerName: '', model: 'gpt-5.5', suggestProviderName: null })
  assert.deepEqual(modelOf(codex), ['codex', 'gpt-5.5'])
  assert.equal(codex?.kind === 'codex' ? codex.reasoningEffort : null, 'low')
  assert.equal(canSuggest({ ...profile, suggestProviderName: 'gone' }), false, 'a connection that cannot be used offers no button')
})

const writer = {
  id: 2, name: '대필', engine: 'llm', providerName: 'small-llm', model: 'writer-model', isEnabled: true, temperature: null,
  maxTokens: null, reasoningEffort: '', reasoningBudgetTokens: null, extraParams: '',
  systemPrompt: '{{user}}답게, {{char}}를 놀리는 쪽으로.', promptSections: [{ id: 's', title: '말투', content: '짧게 끊어 말함.', kind: 'text', enabled: true }, { id: 'x', title: '끔', content: '안 보임', kind: 'text', enabled: false }],
} as unknown as ChatProfile

const writerIdOf = (runner: ReturnType<typeof suggestionRunnerOf>) => runner?.writer ? `${runner.writer.kind}:${runner.writer.profile.id}` : null

test('suggestionRunnerOf: a linked writer profile, or the profile itself, wins with its own model; a missing or disabled one does not', (t) => {
  mockConnection(t, '')
  const found = new Map<number, ChatProfile>([[2, writer], [3, { ...writer, id: 3, isEnabled: false }], [4, { ...writer, id: 4, engine: 'codex', model: 'gpt-5.5', reasoningEffort: 'medium' }]])
  t.mock.method(ChatProfileStore, 'find', (id: number) => found.get(id) ?? null)
  assert.deepEqual(modelOf(suggestionRunnerOf({ ...profile, suggestProfileId: 2 })), ['small-llm', 'writer-model'])
  assert.equal(writerIdOf(suggestionRunnerOf({ ...profile, suggestProfileId: 2 })), 'profile:2')
  const itself = suggestionRunnerOf({ ...profile, suggestProfileId: 1 })
  assert.deepEqual([modelOf(itself), writerIdOf(itself)], [['chat-llm', 'big'], 'profile:1'])
  for (const id of [3, 99]) assert.deepEqual(modelOf(suggestionRunnerOf({ ...profile, suggestProfileId: id })), ['small-llm', 'tiny'])
  const codexWriter = suggestionRunnerOf({ ...profile, suggestProfileId: 4 })
  assert.deepEqual(modelOf(codexWriter), ['codex', 'gpt-5.5'])
  assert.equal(codexWriter?.kind === 'codex' ? codexWriter.reasoningEffort : null, 'medium')
})

const userWriter = { id: 7, accountId: 5, name: '나', persona: '{{char}}한테는 늘 장난스럽게 군다.', avatar: null, isDefault: false, sortOrder: 0, modelSlotId: 9 }

test('suggestionRunnerOf: a user profile writes with its model, only in its own account and only with a model', (t) => {
  mockConnection(t, '')
  t.mock.method(ChatUserProfileStore, 'findById', (id: number) => (id === 7 ? userWriter : id === 8 ? { ...userWriter, id: 8, modelSlotId: null } : null))
  t.mock.method(ModelSlotStore, 'target', (id: number | null) => (id === 9 ? { id: 9, name: '작은 모델', providerName: 'small-llm', model: 'slot-model' } : null))
  const linked = { ...profile, suggestUserProfileId: 7 }
  assert.deepEqual([modelOf(suggestionRunnerOf(linked, 5)), writerIdOf(suggestionRunnerOf(linked, 5))], [['small-llm', 'slot-model'], 'user:7'])
  assert.equal(writerIdOf(suggestionRunnerOf(linked, 6)), null, 'another account falls back to the role')
  assert.equal(writerIdOf(suggestionRunnerOf({ ...profile, suggestUserProfileId: 8 }, 5)), null, 'no model falls back to the role')
  assert.equal(userWriterReady({ modelSlotId: 9 }), true)
  assert.equal(userWriterReady({ modelSlotId: null }), false)
})

test('suggestReplies: a user profile writer adds its description, unless it is the chat\'s own user', async (t) => {
  const requests = mockConnection(t, '["a"]')
  t.mock.method(ChatUserProfileStore, 'findById', (id: number) => (id === 7 ? { ...userWriter, accountId: null } : id === 1 ? { ...userWriter, id: 1, accountId: null } : null))
  t.mock.method(ModelSlotStore, 'target', (id: number | null) => (id === 9 ? { id: 9, name: '작은 모델', providerName: 'small-llm', model: 'slot-model' } : null))
  await suggestReplies({ ...profile, suggestUserProfileId: 7 }, thread, [message(1, 'assistant', 'hi')], () => '유나')
  assert.match(requests[0].messages[0].content, /## 추천 지시 \(나\)\n유나한테는 늘 장난스럽게 군다\./)
  await suggestReplies({ ...profile, suggestUserProfileId: 1 }, thread, [message(1, 'assistant', 'hi')], () => '유나')
  assert.doesNotMatch(requests[1].messages[0].content, /추천 지시/)
})

test('suggestReplies: a writer profile adds its prompt, placeholders filled, disabled sections left out', async (t) => {
  const requests = mockConnection(t, '["a"]')
  t.mock.method(ChatProfileStore, 'find', (id: number) => (id === 2 ? writer : null))
  await suggestReplies({ ...profile, suggestProfileId: 2 }, thread, [message(1, 'assistant', 'hi')], () => '유나')
  assert.equal(requests[0].model, 'writer-model')
  const system = requests[0].messages[0].content
  assert.match(system, /## 추천 지시 \(대필\)\n민수답게, 유나를 놀리는 쪽으로\./)
  assert.match(system, /### 말투\n짧게 끊어 말함\./)
  assert.doesNotMatch(system, /안 보임/)
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
