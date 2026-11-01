import './support/testTemp'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChatProfileStore } from '../src/services/codex-chat/chatProfiles'
import { streamChatCompletion, type ChatCompletionMessage, type ChatCompletionTarget } from '../src/services/codex-chat/llmChatCompletion'
import { estimateMessagesTokens, fitChatContext, recordPromptUsage, replyCapFor, replyReserveFor, withChatTokenModel } from '../src/services/codex-chat/llmChatContext'
import { replyRoomFromRefusal } from '../src/services/codex-chat/serverContextLimit'
import { mockModelRows } from './modelRowMocks'
import { parseNumberDraft } from '../../frontend/src/lib/number-shorthand'

const STRATA_REFUSAL = '{"error":{"message":"litellm.BadRequestError: OpenAIException - prompt (15191 tokens) + max tokens (50000) exceeds the context (65000); requests are never truncated. Send a smaller max_tokens (at most 49801 here), or add \\"fit_max_tokens\\": true to the model\'s strata-<model>.json to shorten it to the room left (#545). Received Model Group=strata-a\\nAvailable Model Group Fallbacks=None","type":"invalid_request_error","param":null,"code":"400"}}'

test('the room a refusal names: Strata (with and without "at most") and vLLM', () => {
  assert.equal(replyRoomFromRefusal(STRATA_REFUSAL), 49801)
  assert.equal(replyRoomFromRefusal('prompt (15191 tokens) + max tokens (50000) exceeds the context (65000)'), 65000 - 15191)
  assert.equal(replyRoomFromRefusal("This model's maximum context length is 32768 tokens. However, you requested 40000 tokens (15000 in the messages, 25000 in the completion)."), 32768 - 15000)
  assert.equal(replyRoomFromRefusal('the request exceeds the available context size (8192 tokens)'), null)
})

test('a max_tokens the context cannot hold beside the prompt goes again, once, cut to the room the server names', async (t) => {
  const sent: unknown[] = []
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { max_tokens?: number }
    sent.push(body.max_tokens)
    if (body.max_tokens === 50000) return new Response(STRATA_REFUSAL, { status: 400 })
    return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  })
  const target: ChatCompletionTarget = { providerName: 'reply-cap', displayName: 'Strata', endpoint: 'http://unused.invalid/v1/chat/completions', apiKey: null, model: 'strata-auto', generation: { maxTokens: 50000 }, promptCacheMarks: false }
  const result = await streamChatCompletion({ target, messages: [{ role: 'user', content: 'hi' }], signal: new AbortController().signal })
  assert.equal(result.content, 'ok')
  assert.deepEqual(sent, [50000, 49801])
})

test('a refusal that leaves no real room is not retried', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1
    return new Response('prompt (64900 tokens) + max tokens (50000) exceeds the context (65000)', { status: 400 })
  })
  const target: ChatCompletionTarget = { providerName: 'reply-cap-full', displayName: 'Strata', endpoint: 'http://unused.invalid/v1/chat/completions', apiKey: null, model: 'm', generation: { maxTokens: 50000 }, promptCacheMarks: false }
  await assert.rejects(streamChatCompletion({ target, messages: [{ role: 'user', content: 'hi' }], signal: new AbortController().signal }), /LLM 요청 실패 \(400\)/)
  assert.equal(calls, 1)
})

test('max output tokens are a ceiling: the window keeps room for the conversation and the cap is cut to what is left', (t) => {
  mockModelRows(t, { 1: ['test', 'test'], 2: ['test', 'new-tokenizer'] }, 1)
  // A cap near the whole context books at most a quarter of it for the window; small caps stay as they are.
  assert.equal(replyReserveFor(65000, 50000), 16250)
  assert.equal(replyReserveFor(262144, 50000), 50000)
  assert.equal(replyReserveFor(65000, 1000), 1000)
  assert.equal(replyReserveFor(4000, 50000), 2048)
  assert.equal(replyReserveFor(null, 50000), 50000)

  const profile = ChatProfileStore.draft({ name: 'Character', maxTokens: 50000 })
  const messages: ChatCompletionMessage[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: '안녕 '.repeat(4000) }]
  const prompt = estimateMessagesTokens(profile.id, messages)
  profile.contextTokens = prompt + 20000
  // Prompt + the whole cap is over the context, yet the request goes: the cap is cut, not booked.
  assert.equal(fitChatContext(profile, messages, [], 50000), messages)
  const cap = replyCapFor(profile, messages, [], 50000)!
  assert.ok(cap < 20000 && cap > 19000, `cap ${cap}`)
  assert.equal(replyCapFor(profile, messages, [], 1000), 1000)
  assert.equal(replyCapFor(profile, messages, [], null), null)
  profile.contextTokens = null
  assert.equal(replyCapFor(profile, messages, [], 50000), 50000)
  // Only a prompt that leaves not even a short answer's room fails.
  profile.contextTokens = prompt + 1000
  assert.throws(() => fitChatContext(profile, messages, [], 50000), /컨텍스트 한도를 넘었어/)
  // Reusing a profile after a model change must not reuse the old tokenizer's calibrated ratio.
  t.mock.method(ChatProfileStore, 'find', () => profile)
  withChatTokenModel(profile, () => recordPromptUsage(profile.id, 100, 200))
  assert.equal(withChatTokenModel(profile, () => estimateMessagesTokens(profile.id, messages)), prompt * 2)
  profile.modelSlotId = 2
  assert.equal(withChatTokenModel(profile, () => estimateMessagesTokens(profile.id, messages)), prompt)
})

test('token fields read "260K" as people write it; plain number fields do not', () => {
  assert.equal(parseNumberDraft('260K', true), 260000)
  assert.equal(parseNumberDraft('260k', true), 260000)
  assert.equal(parseNumberDraft('1.5M', true), 1500000)
  assert.equal(parseNumberDraft('262,144', true), 262144)
  assert.equal(parseNumberDraft(' 50000 ', true), 50000)
  assert.ok(Number.isNaN(parseNumberDraft('', true)))
  assert.ok(Number.isNaN(parseNumberDraft('260KB', true)))
  assert.ok(Number.isNaN(parseNumberDraft('260K')))
  assert.equal(parseNumberDraft('0.7'), 0.7)
})

test('profile token and conversation settings preserve finite user values beyond old product ceilings', (t) => {
  mockModelRows(t, { 1: ['test', 'test'] }, 1)
  const settings = { maxTokens: 1_500_000, contextTokens: 8_000_000, contextTurns: 300, summaryTriggerTurns: 250, reasoningBudgetTokens: 1_200_000 }
  const profile = ChatProfileStore.draft({ name: 'Large model', ...settings })
  for (const key of Object.keys(settings) as Array<keyof typeof settings>) assert.equal(profile[key], settings[key])
  assert.equal(ChatProfileStore.draft({ name: 'Small model', contextTokens: 512 }).contextTokens, 512)
  assert.throws(() => ChatProfileStore.draft({ name: 'Invalid', maxTokens: Infinity }), /숫자/)
  for (const key of ['maxTokens', 'contextTokens', 'contextTurns', 'summaryTriggerTurns']) {
    assert.throws(() => ChatProfileStore.draft({ name: 'Unsafe number', [key]: Number.MAX_SAFE_INTEGER + 1 }), /정수/)
  }
})

test('per-chat, group and imported overrides preserve positive safe integers beyond the old ceilings', async (t) => {
  const db = await import('../src/database/userSettingsDb')
  db.initializeUserSettingsDb()
  const { AuthAccount } = await import('../src/models/AuthAccount')
  const { AuthAccessControlService } = await import('../src/services/authAccessControlService')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { CodexChatService } = await import('../src/services/codex-chat/codexChatService')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { GroupChatService } = await import('../src/services/codex-chat/groupChatService')
  const { ChatGroupStore } = await import('../src/services/codex-chat/chatGroupStore')
  const { importChatThread } = await import('../src/services/codex-chat/chatImport')
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  t.after(async () => {
    db.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    await new Promise<void>(async resolve => (await import('../src/utils/logger')).logger.close(resolve))
  })
  t.mock.method(AuthAccount, 'findById', (id: number) => ({ id, status: 'active', account_type: 'admin' }) as never)
  t.mock.method(AuthAccessControlService, 'resolveForAccountId', () => ({ permissionKeys: ['chat.use'] }))
  updateChatSettings({ enabled: true })
  ExternalApiProvider.create({ provider_name: 'overrides', display_name: 'Overrides', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const profiles = ['First', 'Second'].map(name => ChatProfileStore.create({ name, providerName: 'overrides', model: 'm', mcpEnabled: false }))
  const requester = { accountId: 1, accountType: 'admin' as const }
  const importedTarget = {
    direct: (id: number) => CodexChatService.createThread(requester, id),
    group: (profileIds: number[], representativeId: number) => GroupChatService.create(requester, { profileIds, representativeId, userProfileId: null }),
  }
  const thread = importedTarget.direct(profiles[0].id)
  const express = (await import('express')).default
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.session = { accountId: 1, accountType: 'admin' } as typeof req.session; next() })
  app.use('/api/codex-chat', (await import('../src/routes/codex-chat.routes')).default)
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  const address = server.address() as import('node:net').AddressInfo
  const patch = (body: unknown) => fetch(`http://127.0.0.1:${address.port}/api/codex-chat/threads/${thread.id}/context`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const response = await patch({ maxTokens: 1_500_000, contextTurns: 300 })
  assert.equal(response.status, 200, await response.text())
  assert.equal(CodexChatStore.findThreadById(thread.id)!.max_tokens, 1_500_000)
  assert.equal(CodexChatStore.findThreadById(thread.id)!.context_turns, 300)
  for (const value of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    for (const key of ['maxTokens', 'contextTurns']) {
      const rejected = await patch({ [key]: value })
      assert.equal(rejected.status, 400, await rejected.text())
    }
  }
  const room = importedTarget.group(profiles.map(profile => profile.id), profiles[0].id)
  GroupChatService.updateRoom(requester, room.id, { maxTokens: 1_500_000 })
  GroupChatService.updateMember(requester, room.id, profiles[0].id, { maxTokens: 2_000_000 })
  assert.equal(CodexChatStore.findThreadById(room.id)!.max_tokens, 1_500_000)
  assert.equal(ChatGroupStore.member(room.id, profiles[0].id)!.max_tokens, 2_000_000)
  assert.throws(() => GroupChatService.updateRoom(requester, room.id, { maxTokens: Number.MAX_SAFE_INTEGER + 1 }))
  const file = { format: 'conai-chat', version: 1, profileName: profiles[0].name,
    thread: CodexChatStore.findThreadById(thread.id), messages: [{ id: 1, role: 'user', content: 'Imported conversation.' }] }
  const imported = importChatThread(requester, Buffer.from(JSON.stringify(file)), importedTarget)
  assert.equal(CodexChatStore.findThreadById(imported.threadId)!.max_tokens, 1_500_000)
  assert.equal(CodexChatStore.findThreadById(imported.threadId)!.context_turns, 300)
})
