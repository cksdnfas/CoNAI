import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ExternalApiProvider } from '../src/models/ExternalApiProvider'
import { acquireLlmRequestSlot } from '../src/services/llmRequestScheduler'
import { foldBlockState } from '../src/services/codex-chat/chatBlockState'
import { ChatProfileStore } from '../src/services/codex-chat/chatProfiles'
import { normalizeChatStyle } from '../src/services/codex-chat/chatStyle'
import { CodexChatStore, type CodexChatMessageRecord, type CodexChatThreadRecord } from '../src/services/codex-chat/codexChatStore'
import { streamChatCompletion, type ChatCompletionTarget, type ChatCompletionTool } from '../src/services/codex-chat/llmChatCompletion'
import { buildChatMessages, buildChatPromptPreview, estimateMessagesTokens, fitThreadSummary, rawMessagesEstimate, resolveContextConfig } from '../src/services/codex-chat/llmChatContext'
import { buildGroupLlmMessages } from '../src/services/codex-chat/groupChatContext'

const target: ChatCompletionTarget = {
  providerName: 'test', displayName: 'Test', endpoint: 'http://unused.invalid/chat/completions',
  apiKey: null, model: 'test', generation: {}, promptCacheMarks: false,
}

test('JSON fallback delivers text and reasoning once and preserves tool calls and usage', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    choices: [{ message: { content: 'answer', reasoning_content: 'reason', tool_calls: [{ id: 'call1', type: 'function', function: { name: 'read', arguments: '{}' } }] }, finish_reason: 'tool_calls' }],
    usage: { prompt_tokens: 42 },
  }))
  const content: string[] = []
  const reasoning: string[] = []
  const result = await streamChatCompletion({ target, messages: [], signal: new AbortController().signal, onContent: (text) => content.push(text), onReasoning: (text) => reasoning.push(text) })
  assert.deepEqual(content, ['answer'])
  assert.deepEqual(reasoning, ['reason'])
  assert.equal(result.content, 'answer')
  assert.equal(result.toolCalls[0].function.name, 'read')
  assert.equal(result.finishReason, 'tool_calls')
  assert.equal(result.promptTokens, 42)
})

test('SSE text is delivered once without JSON fallback duplication', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('data: {"choices":[{"delta":{"content":"hello"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))
  const chunks: string[] = []
  const result = await streamChatCompletion({ target, messages: [], signal: new AbortController().signal, onContent: (text) => chunks.push(text) })
  assert.deepEqual(chunks, ['hello', ' world'])
  assert.equal(result.content, chunks.join(''))
})

test('cache fallback keeps one deadline and releases the connection slot on timeout', async (t) => {
  const signals: AbortSignal[] = []
  t.mock.method(console, 'warn', () => {})
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const signal = init.signal as AbortSignal
    signals.push(signal)
    if (signals.length === 1) return new Response('unsupported cache marks', { status: 400 })
    return new Promise<Response>((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason)
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  })
  await assert.rejects(streamChatCompletion({ target: { ...target, timeoutMs: 25, promptCacheMarks: true }, messages: [], signal: new AbortController().signal }), { name: 'TimeoutError' })
  assert.equal(signals.length, 2)
  assert.equal(signals[0], signals[1])
  const release = await acquireLlmRequestSlot('test', 1, AbortSignal.timeout(1000))
  release()
})

test('connection slots span callers, remove cancelled waiters and release idempotently', async () => {
  const releaseFirst = await acquireLlmRequestSlot('slots', 1)
  let secondStarted = false
  const second = acquireLlmRequestSlot('slots', 1).then((release) => { secondStarted = true; return release })
  const controller = new AbortController()
  const cancelled = assert.rejects(acquireLlmRequestSlot('slots', 1, controller.signal), { name: 'AbortError' })
  controller.abort()
  await cancelled
  assert.equal(secondStarted, false)
  const otherRelease = await acquireLlmRequestSlot('other-connection', 1)
  otherRelease()
  releaseFirst()
  releaseFirst()
  const releaseSecond = await second
  releaseSecond()
  const finalRelease = await acquireLlmRequestSlot('slots', 1)
  finalRelease()
})

test('cancelled queued chat never starts an HTTP request', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({}))
  const release = await acquireLlmRequestSlot('test', 1)
  const controller = new AbortController()
  const rejected = assert.rejects(streamChatCompletion({ target, messages: [], signal: controller.signal }), { name: 'AbortError' })
  controller.abort()
  await rejected
  release()
  assert.equal(fetch.mock.callCount(), 0)
})

test('image budget does not tokenize base64 transport bytes as text', () => {
  const estimate = (length: number) => rawMessagesEstimate([{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${'A'.repeat(length)}` } }] }])
  assert.equal(estimate(1000), estimate(100000))
  assert.ok(estimate(1000) > 0)
})

test('multiple status fences share the reply-start value for turn limits', () => {
  const profile = ChatProfileStore.draft({ name: 'Character', providerName: 'test', style: normalizeChatStyle({ blocks: [{ key: 'status', enabled: true, template: '{{hp}}', example: '{"hp":20}', fields: [{ name: 'hp', step: 5, min: 0, max: 100 }] }] }) })
  const messages = [
    { id: 1, role: 'assistant' as const, content: '```status\n{"hp":100}\n```\n\n```status\n{"hp":100}\n```' },
    { id: 2, role: 'assistant' as const, content: '```status\n{"hp":0}\n```' },
  ]
  assert.equal(foldBlockState(profile, messages.slice(0, 1), [])?.state.status.hp, 25)
  assert.equal(foldBlockState(profile, messages, [])?.state.status.hp, 20)
  assert.equal(foldBlockState(profile, messages, [{ id: 'edit', key: 'status', afterMessageId: 1, data: { hp: 80 }, at: '' }])?.state.status.hp, 75)
})

test('summary includes tool schema cost before old turns leave the request', async (t) => {
  const profile = ChatProfileStore.draft({ name: 'Character', providerName: 'test', model: 'test', contextTurns: 50, maxTokens: 100, summaryEnabled: true, summaryTriggerTurns: 1, mcpEnabled: true })
  const thread = { id: 123, account_id: null, user_profile_id: null, context_turns: null, max_tokens: null, summary_enabled: null, summary: null, summary_until_message_id: null, context_revision: 0, block_edits: null, author_note: null, author_note_depth: null } as CodexChatThreadRecord
  const messages = Array.from({ length: 21 }, (_, index) => ({ id: index + 1, role: index % 2 === 0 ? 'user' : 'assistant', content: `message-${index + 1}: ${'a'.repeat(400)}`, tool_calls: [] })) as CodexChatMessageRecord[]
  const tools: ChatCompletionTool[] = [{ type: 'function', function: { name: 'read', description: 'schema '.repeat(1800), parameters: {} } }]
  const full = buildChatMessages({ profile, thread, messages, config: resolveContextConfig(thread, profile), tools })
  profile.contextTokens = estimateMessagesTokens(profile.id, full, tools) + 100 - 500
  t.mock.method(CodexChatStore, 'findThreadById', () => thread)
  t.mock.method(CodexChatStore, 'setSummary', (_id: number, summary: string, until: number, revision: number) => {
    assert.equal(revision, thread.context_revision)
    thread.summary = summary
    thread.summary_until_message_id = until
    thread.context_revision += 1
    return true
  })
  t.mock.method(ExternalApiProvider, 'findByName', () => ({ provider_name: 'test', display_name: 'Test', is_enabled: true, provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', additional_config: {} }))
  t.mock.method(ExternalApiProvider, 'getDecryptedKey', () => null)
  t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{ message: { content: 'summary' }, finish_reason: 'stop' }] }))
  await fitThreadSummary(thread.id, profile, messages, new AbortController().signal, tools)
  assert.ok((thread.summary_until_message_id ?? 0) > 0)
  const sent = buildChatMessages({ profile, thread, messages, config: resolveContextConfig(thread, profile), tools })
  for (const message of messages.filter((entry) => entry.id > thread.summary_until_message_id!)) {
    assert.ok(JSON.stringify(sent).includes(`message-${message.id}:`), `unsummarized message ${message.id} was dropped`)
  }
  assert.ok(estimateMessagesTokens(profile.id, sent, tools) + 100 <= profile.contextTokens)
})

test('group history fits the member token budget while retaining the latest message', () => {
  const profile = ChatProfileStore.draft({ name: 'Character', providerName: 'test', maxTokens: 100 }, 7)
  const thread = { id: 456, account_id: null, user_profile_id: null, profile_id: 7, title: 'Room', block_edits: null, author_note: null, author_note_depth: null } as CodexChatThreadRecord
  const messages = Array.from({ length: 15 }, (_, index) => ({ id: index + 1, role: 'user', content: `message-${index + 1}: ${'a'.repeat(400)}`, tool_calls: [] })) as CodexChatMessageRecord[]
  const params = { profile, thread, members: [profile], messages, windowLimit: 20, withTools: false, tools: [], maxTokens: 100 }
  const full = buildGroupLlmMessages(params)
  profile.contextTokens = estimateMessagesTokens(profile.id, full) + 100 - 600
  const fitted = buildGroupLlmMessages(params)
  assert.ok(estimateMessagesTokens(profile.id, fitted) + 100 <= profile.contextTokens)
  assert.ok(JSON.stringify(fitted).includes('message-15:'))
  assert.ok(!JSON.stringify(fitted).includes('message-1:'))
})

test('prompt preview uses the same author note and block state as a new direct request', () => {
  const profile = ChatProfileStore.draft({ name: 'Character', providerName: 'test', authorNote: 'Keep the scene short.', style: normalizeChatStyle({ blocks: [{ key: 'status', enabled: true, template: '{{hp}}', example: '{"hp":20}' }] }) })
  const thread = { id: 789, account_id: null, user_profile_id: null, context_turns: null, max_tokens: null, summary_enabled: null, summary: null, summary_until_message_id: null, block_edits: null, author_note: null, author_note_depth: null } as CodexChatThreadRecord
  const preview = buildChatPromptPreview(profile, [])
  const actual = buildChatMessages({ profile, thread, messages: [], config: resolveContextConfig(thread, profile), tools: [] })
  assert.deepEqual(preview, actual)
  assert.ok(JSON.stringify(preview).includes('Keep the scene short.'))
  assert.ok(JSON.stringify(preview).includes('현재 상태'))
})
