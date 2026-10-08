import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { ExternalApiProvider } from '../src/models/ExternalApiProvider'
import { acquireLlmRequestSlot } from '../src/services/llmRequestScheduler'
import { foldBlockState } from '../src/services/codex-chat/chatBlockState'
import { ChatProfileStore } from '../src/services/codex-chat/chatProfiles'
import { normalizeChatStyle } from '../src/services/codex-chat/chatStyle'
import { CodexChatStore, type CodexChatMessageRecord, type CodexChatThreadRecord } from '../src/services/codex-chat/codexChatStore'
import { streamChatCompletion, type ChatCompletionMessage, type ChatCompletionTarget, type ChatCompletionTool } from '../src/services/codex-chat/llmChatCompletion'
import { buildChatMessages, buildChatPromptPreview, completeSummary, cutToolOutput, estimateMessagesTokens, fitChatContext, fitThreadSummary, groupTranscript, rawMessagesEstimate, resolveContextConfig, summaryTranscriptText, toCompletionMessages } from '../src/services/codex-chat/llmChatContext'
import { applyGenerationOutcomes, generationOutcomeNote } from '../src/services/codex-chat/codexChatMedia'
import { addressLabelFilter, restatement, roundSeparator } from '../src/services/codex-chat/chatReplyText'
import { buildOpenAiGenerationFields, readLlmConnectionConfig, summaryGenerationOptions, thinkingIsOff } from '../src/services/llmGenerationOptions'
import { buildGroupLlmMessages } from '../src/services/codex-chat/groupChatContext'
import { ChatSummaryStore, renderSummary, type ChatSummarySegment } from '../src/services/codex-chat/chatMemory'
import { OwnedLorebookStore } from '../src/services/codex-chat/chatLorebookFiles'
import { parseChatFeatureInventory, chatFeatureOverrides, chatRuntimeArgs, chatTurnRestrictions, verifyChatRuntime } from '../src/services/codex-chat/codexChatRuntime'
import { declineServerRequest } from '../src/services/codex-chat/codexAppServerClient'
import { isolatedChatPreview } from '../../frontend/src/features/codex-chat/chat-preview'
import { describeChatWorkflowModule } from '../../shared/src/utils/chatWorkflow'
import { requireChatWorkflowInputs } from '../src/mcp/tools/mcpComfyWorkflowService'
import { claudeChatArgs, claudeChatInput, verifyClaudeTools } from '../src/services/codex-chat/claudeChatCompletion'
import { claudeLoginUrl, claudeModelOptions } from '../src/services/claudeCli'

test('Claude chat rejects unexpected host tools, keeps vision data and restricts OAuth links', () => {
  const tools = [{ type: 'function' as const, function: { name: 'search_images', parameters: { type: 'object' } } }]
  assert.doesNotThrow(() => verifyClaudeTools(['mcp__conai__search_images', 'EndConversation'], tools))
  for (const inventory of [null, ['Bash'], ['Read'], ['Agent'], ['mcp__external__search'], ['mcp__conai__delete_images']]) assert.throws(() => verifyClaudeTools(inventory, tools), /격리/)
  const args = claudeChatArgs('sonnet', 'system.txt', 'mcp.json', 4)
  assert.equal(args[args.indexOf('--tools') + 1], '')
  assert.equal(args[args.indexOf('--setting-sources') + 1], '')
  assert.ok(args.includes('--restricted') && args.includes('--strict-mcp-config') && args.includes('--disable-slash-commands'))
  assert.ok(!args.includes('--bare') && !args.includes('--dangerously-skip-permissions'))
  const xhigh = claudeChatArgs('opus', 'system.txt', 'mcp.json', 4, 'xhigh')
  assert.equal(xhigh[xhigh.indexOf('--effort') + 1], 'xhigh')
  assert.ok(!claudeChatArgs('opus', 'system.txt', 'mcp.json', 4, 'none').includes('--effort'))
  const input = JSON.parse(claudeChatInput([{ role: 'system', content: 'private instructions' }, { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,YQ==' } }] }]))
  assert.equal(input.message.content[1].source.data, 'YQ==')
  assert.ok(!input.message.content[0].text.includes('private instructions'))
  assert.throws(() => claudeChatInput([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'http://127.0.0.1/private' } }] }]), /인라인/)
  assert.equal(claudeLoginUrl('Open https://claude.ai/oauth/authorize?state=abc'), 'https://claude.ai/oauth/authorize?state=abc')
  assert.equal(claudeLoginUrl('Open https://claude.com/cai/oauth/authorize?state=abc'), 'https://claude.com/cai/oauth/authorize?state=abc')
  assert.equal(claudeLoginUrl('https://claude.ai.attacker.test/oauth/authorize'), null)
  assert.equal(claudeLoginUrl('https://attacker.test/oauth/authorize'), null)
  assert.deepEqual(claudeModelOptions([
    { value: 'default', displayName: 'Default (recommended)', resolvedModel: 'claude-opus-5-5' },
    { value: 'opus', displayName: 'Opus 5.5', resolvedModel: 'claude-opus-5-5', supportedEffortLevels: ['low', 'max', 3] },
    { value: 'claude-haiku-4-5-20251001' },
    { value: '' }, null,
  ]), [
    { id: 'opus', label: 'Opus 5.5', resolvedModel: 'claude-opus-5-5', supportedEffortLevels: ['low', 'max'] },
    { id: 'claude-haiku-4-5-20251001', label: 'claude-haiku-4-5-20251001', resolvedModel: 'claude-haiku-4-5-20251001', supportedEffortLevels: [] },
  ])
  assert.deepEqual(claudeModelOptions(undefined), [])
})

// These requests run without a settings database: their chats have no lorebooks of their own.
mock.method(OwnedLorebookStore, 'chatBookOf', () => null)
mock.method(OwnedLorebookStore, 'threadLinks', () => [])

test('chat runtime fails closed on unknown host capabilities, invalid inventories and inherited MCP', async () => {
  const features = parseChatFeatureInventory(['shell_tool', 'unified_exec', 'hooks', 'plugins', 'apps', 'code_mode_host', 'code_mode', 'browser_use', 'computer_use', 'multi_agent', 'image_generation', 'view_image', 'skill_mcp_dependency_install', 'skill_search', 'skip_host_skill_discovery', 'future_host_tool'].map((name) => `${name} stable true`).join('\n'))
  assert.throws(() => parseChatFeatureInventory(''), /cannot enforce/)
  assert.throws(() => parseChatFeatureInventory('shell_tool ??? true'), /could not be verified/)
  assert.equal(chatFeatureOverrides(features).future_host_tool, false)
  assert.equal(chatFeatureOverrides(features).skip_host_skill_discovery, true)
  assert.ok(chatRuntimeArgs(features, 'private-work', '1666').some((arg) => arg.includes('"future_host_tool"=false')))
  assert.throws(() => chatRuntimeArgs(features, 'private-work', '1666/injected'), /port/)
  assert.deepEqual(chatTurnRestrictions('private-work'), { cwd: 'private-work', approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly', networkAccess: false } })
  assert.equal(declineServerRequest('item/commandExecution/requestApproval').result !== undefined, true)
  assert.equal(declineServerRequest('item/fileChange/requestApproval').result !== undefined, true)
  assert.equal(declineServerRequest('unknown/host/request').error?.code, -32601)
  const config = { approval_policy: 'never', sandbox_mode: 'read-only', web_search: 'disabled', project_doc_max_bytes: 0, features: chatFeatureOverrides(features), mcp_servers: { conai: { url: 'http://127.0.0.1:1666/mcp' } }, projects: { 'private-work': { trust_level: 'untrusted' } } }
  const client = (configuration: unknown, pages: unknown[]) => ({ request: async (method: string) => method === 'config/read' ? { config: configuration } : pages.shift() }) as never
  await assert.doesNotReject(verifyChatRuntime(client(config, [{ data: [{ name: 'conai' }], nextCursor: null }]), features, 'private-work', '1666'))
  await assert.rejects(verifyChatRuntime(client({ ...config, features: { ...config.features, shell_tool: true } }, []), features, 'private-work', '1666'), /restriction/)
  await assert.rejects(verifyChatRuntime(client({ ...config, mcp_servers: { conai: { ...config.mcp_servers.conai, command: 'host-tool' } } }, []), features, 'private-work', '1666'), /not isolated/)
  await assert.rejects(verifyChatRuntime(client(config, [{ data: [{ name: 'conai' }], nextCursor: 'second' }, { data: [{ name: 'external-host-tool' }], nextCursor: null }]), features, 'private-work', '1666'), /unexpected MCP/)
  await assert.rejects(verifyChatRuntime(client(config, [{ data: 'invalid' }]), features, 'private-work', '1666'), /unexpected MCP/)
})

test('generated HTML preview has a trusted network-denying CSP before all untrusted markup', () => {
  const untrusted = '<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body><script>fetch("http://localhost:1666/private")</script></body></html>'
  const document = isolatedChatPreview(untrusted)
  assert.ok(document.indexOf("connect-src 'none'") < document.indexOf(untrusted))
  for (const directive of ["frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "script-src 'none'"]) assert.ok(document.includes(directive))
  assert.ok(document.endsWith(untrusted))
})

test('chat cannot fill or wire exact code/path controls while ordinary prompt inputs remain available', () => {
  const module = describeChatWorkflowModule({ id: 1, name: 'Protected controls', engine_type: 'system', version: 1, template_defaults: {}, exposed_inputs: [
    { key: 'code', label: 'Program', data_type: 'text' }, { key: 'prompt', label: 'Prompt', data_type: 'text' },
  ], output_ports: [] })
  assert.equal(module.fields.find((field) => field.key === 'code')?.editable, false)
  assert.equal(module.inputs.find((field) => field.key === 'code')?.connectable, false)
  assert.equal(module.fields.find((field) => field.key === 'prompt')?.editable, true)
  const context = { source: 'llm-chat' as const, scopes: [] }
  const fields = [{ id: 'code', label: 'Program', type: 'text' as const, jsonPath: '1.inputs.value' }, { id: 'prompt', label: 'Prompt', type: 'text' as const, jsonPath: '2.inputs.text' }]
  assert.throws(() => requireChatWorkflowInputs(context, fields, { code: 'must not execute' }), /protected workflow input/)
  assert.doesNotThrow(() => requireChatWorkflowInputs(context, fields, { prompt: 'ordinary image request' }))
})

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
  const profile = ChatProfileStore.draft({ name: 'Character', providerName: 'test' })
  // Resolved profiles carry linked shared blocks; draft() no longer accepts inline blocks.
  profile.style = normalizeChatStyle({ blocks: [{ key: 'status', enabled: true, template: '{{hp}}', example: '{"hp":20}', fields: [{ name: 'hp', step: 5, min: 0, max: 100 }] }] })
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
  t.mock.method(CodexChatStore, 'setSummaryError', () => {})
  const segments: ChatSummarySegment[] = []
  t.mock.method(ChatSummaryStore, 'list', () => segments)
  t.mock.method(ChatSummaryStore, 'addSegment', (_id: number, segment: { from: number; until: number; content: string }, revision: number) => {
    assert.equal(revision, thread.context_revision)
    segments.push({ id: segments.length + 1, thread_id: thread.id, level: 0, from_message_id: segment.from, until_message_id: segment.until, content: segment.content, backed: 1, created_date: '', updated_date: '' })
    thread.summary = renderSummary(segments)
    thread.summary_until_message_id = segment.until
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
  const profile = ChatProfileStore.draft({ name: 'Character', providerName: 'test', authorNote: 'Keep the scene short.' })
  profile.style = normalizeChatStyle({ blocks: [{ key: 'status', enabled: true, template: '{{hp}}', example: '{"hp":20}' }] })
  const thread = { id: 789, account_id: null, user_profile_id: null, context_turns: null, max_tokens: null, summary_enabled: null, summary: null, summary_until_message_id: null, block_edits: null, author_note: null, author_note_depth: null } as CodexChatThreadRecord
  const preview = buildChatPromptPreview(profile, [])
  const actual = buildChatMessages({ profile, thread, messages: [], config: resolveContextConfig(thread, profile), tools: [] })
  assert.deepEqual(preview, actual)
  assert.ok(JSON.stringify(preview).includes('Keep the scene short.'))
  assert.ok(JSON.stringify(preview).includes('현재 상태'))
})

// ---- Live test findings (2026-10-06, llama.cpp + Qwen) -----------------------------------------------------------

const sse = (...chunks: unknown[]) => new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })

test('a streamed request asks for usage and reads the final usage chunk with empty choices', async (t) => {
  const bodies: Record<string, unknown>[] = []
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)))
    return sse({ choices: [{ delta: { content: 'hi' }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 77, completion_tokens: 1 } })
  })
  const result = await streamChatCompletion({ target, messages: [], signal: new AbortController().signal })
  assert.deepEqual(bodies[0].stream_options, { include_usage: true })
  assert.equal(result.content, 'hi')
  assert.equal(result.finishReason, 'stop')
  assert.equal(result.promptTokens, 77)
})

test('a server that refuses stream_options gets the request again without it', async (t) => {
  const bodies: Record<string, unknown>[] = []
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)))
    return bodies.length === 1 ? new Response('unknown field stream_options', { status: 400 }) : sse({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })
  })
  const result = await streamChatCompletion({ target, messages: [], signal: new AbortController().signal })
  assert.equal(bodies.length, 2)
  assert.equal(bodies[1].stream_options, undefined)
  assert.equal(result.content, 'ok')
})

test("no reasoning goes out the way the connection's thinking switch says", () => {
  assert.equal(readLlmConnectionConfig({}).thinkingSwitch, 'reasoning_effort')
  assert.equal(readLlmConnectionConfig({ thinking_switch: 'enable_thinking' }).thinkingSwitch, 'enable_thinking')
  assert.equal(readLlmConnectionConfig({ thinking_switch: 'bogus' }).thinkingSwitch, 'reasoning_effort')
  const off = { reasoningEffort: 'none' as const, extraParams: { chat_template_kwargs: { foo: 1 } } }
  assert.deepEqual(buildOpenAiGenerationFields(off), { chat_template_kwargs: { foo: 1 }, reasoning_effort: 'none' })
  assert.deepEqual(buildOpenAiGenerationFields(off, 'enable_thinking'), { chat_template_kwargs: { foo: 1, enable_thinking: false } })
  assert.deepEqual(buildOpenAiGenerationFields(off, 'none'), { chat_template_kwargs: { foo: 1 } })
  // Other efforts are the profile's choice and go out as they are.
  assert.deepEqual(buildOpenAiGenerationFields({ reasoningEffort: 'high' }, 'enable_thinking'), { reasoning_effort: 'high' })
  // A summary turns thinking off on an enable_thinking connection even when the profile sets no effort.
  assert.equal(summaryGenerationOptions({}).reasoningEffort, null)
  assert.equal(summaryGenerationOptions({}, 'enable_thinking').reasoningEffort, 'none')
  assert.equal(summaryGenerationOptions({ reasoningEffort: 'low' }).reasoningEffort, 'none')
  assert.ok(thinkingIsOff({ reasoningEffort: 'none' }, 'enable_thinking'))
  assert.ok(!thinkingIsOff({ reasoningEffort: 'none' }, 'none'))
})

test('a summary on an enable_thinking connection sends chat_template_kwargs and keeps the 2048 cap', async (t) => {
  const profile = ChatProfileStore.draft({ name: 'Character', providerName: 'test', model: 'test' })
  t.mock.method(ExternalApiProvider, 'findByName', () => ({ provider_name: 'test', display_name: 'Test', is_enabled: true, provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid/v1', additional_config: { thinking_switch: 'enable_thinking' } }))
  t.mock.method(ExternalApiProvider, 'getDecryptedKey', () => null)
  const bodies: Record<string, unknown>[] = []
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)))
    return sse({ choices: [{ delta: { content: '요약' }, finish_reason: 'stop' }] })
  })
  assert.equal(await completeSummary(profile, '요약해', '대화'), '요약')
  assert.deepEqual(bodies[0].chat_template_kwargs, { enable_thinking: false })
  assert.equal(bodies[0].reasoning_effort, undefined)
  assert.equal(bodies[0].max_tokens, 2048)
})

test('an echoed address label never reaches the stream, whatever the chunking', () => {
  const run = (chunks: string[]) => {
    const out: string[] = []
    const filter = addressLabelFilter((text) => out.push(text))
    for (const chunk of chunks) filter.push(chunk)
    filter.flush()
    return out.join('')
  }
  const label = '[message_id=65; to=["user"]; reply_to=63]'
  assert.equal(run([label, '\n등불 찻집']), '등불 찻집')
  assert.equal(run(['[mess', 'age_id=65; to=[', '"user"]] 안', '녕']), '안녕')
  assert.equal(run(['[카이; message_id=12; to=[3]]\n', '안녕']), '안녕')
  assert.equal(run([label]), '')
  // Plain text, and brackets that are not a label, pass as written.
  assert.equal(run(['안녕', ' 반가워']), '안녕 반가워')
  assert.equal(run(['[속삭이며', '] 안녕']), '[속삭이며] 안녕')
  assert.equal(run(['**굵게** 말해']), '**굵게** 말해')
  // Only the start is held: a later line passes at once.
  const out: string[] = []
  const filter = addressLabelFilter((text) => out.push(text))
  filter.push('첫 줄\n')
  filter.push('둘째')
  assert.deepEqual(out, ['첫 줄\n', '둘째'])
})

test('a round that restates the text before its tool call takes its place', () => {
  // Room message 65 of the live test: the pre-tool paragraph, then the same paragraph rewritten after the tool result.
  const before = '등불 찻집 열던 날이었어. 카운터上等 램프가 번아웃 돼서, 본인이 직접 싣고 내 수리점에 들었지. 그때부터 지금까지 고쳐줘 온 거야.'
  const after = '등불 찻집 열던 날이었어. 카운터 램프가 번아웃 돼서, 루나가 직접 싣고 내 수리점에 들었지. 그때부터 지금까지 고쳐주고 있다.'
  assert.equal(restatement(before, after), 'replaces')
  assert.equal(restatement('그림 그려볼게.', '그림 그려볼게. 다 됐어, 마음에 들어?'), 'replaces')
  assert.equal(restatement('잠깐, 기록을 찾아볼게. 금요일 밤 등불 찻집이었지.', '금요일 밤 등불 찻집이었지.'), 'repeats')
  assert.equal(restatement('잠깐 찾아볼게.', '금요일 밤, 등불 찻집이야. 늦지 마.'), null)
  assert.equal(roundSeparator(''), '')
  assert.equal(roundSeparator('앞 문단\n\n'), '')
  assert.equal(roundSeparator('앞 문단\n'), '\n')
  assert.equal(roundSeparator('앞 문단'), '\n\n')
})

test('a tool round that does not fit is retried with the tool result cut shorter, then fails', () => {
  const profile = ChatProfileStore.draft({ name: 'Character', providerName: 'test', maxTokens: 100 })
  const messages: ChatCompletionMessage[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'read it' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_lore_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: 'x'.repeat(40000) },
  ]
  const cut = messages.map((message) => (message.role === 'tool' ? { ...message, content: `${'x'.repeat(4000)}\n…(잘림: 이 결과의 4000자까지만 보임)` } : message))
  profile.contextTokens = estimateMessagesTokens(profile.id, cut) + 100
  const fitted = fitChatContext(profile, messages, [], 100)
  assert.notEqual(fitted, messages)
  assert.equal((fitted[3] as { content: string }).content, (cut[3] as { content: string }).content)
  assert.equal(fitChatContext(profile, fitted, [], 100), fitted, 'what fits goes as it is')
  profile.contextTokens = estimateMessagesTokens(profile.id, messages.slice(0, 3)) + 100
  assert.throws(() => fitChatContext(profile, messages, [], 100), /컨텍스트 한도를 넘었어/)
  // The error gives the estimate of the shortest cut tried, not of the uncut request.
  const shortest = messages.map((message) => (message.role === 'tool' ? { ...message, content: cutToolOutput(message.content, 1000) } : message))
  const expected = estimateMessagesTokens(profile.id, shortest) + 100
  assert.throws(() => fitChatContext(profile, messages, [], 100), (error: Error) => error.message.includes(`예상 ${expected} /`))
  assert.ok(estimateMessagesTokens(profile.id, messages) + 100 > expected)
})

test('the summary transcript leaves out the chat\'s own tools, quoted lore files and address labels', () => {
  const profile = ChatProfileStore.draft({ name: '카이', providerName: 'test' }, 1)
  const call = (tool: string, summary: string) => ({ id: tool, tool, status: 'completed' as const, arguments: {}, summary, historyIds: [], compositeHashes: [] })
  const lineOf = groupTranscript([profile], { name: '한별', persona: '' } as never)
  const reply = {
    id: 5, role: 'assistant', speaker_profile_id: 1,
    content: '[message_id=5; to=["user"]]\n금요일 밤이야.\n[자료 자료/일지.md]\n# 일지\n비밀 암호\n[/자료]\n또 봐 [message_id=4; from=user]',
    tool_calls: [call('save_lore', '제안으로 올렸어.'), call('read_lore_file', '[자료 자료/일지.md] …'), call('room_history_read', '(기록 ID 50)'), call('chat_reply_to', 'ok'), call('submit_generation_job', 'job 12 queued')],
  } as unknown as CodexChatMessageRecord
  const line = lineOf(reply)
  assert.equal(line, '카이: 금요일 밤이야.\n또 봐\n[도구 submit_generation_job: job 12 queued]')
  assert.equal(summaryTranscriptText('[카이; message_id=3; to=[1]] 안녕'), '안녕')
  // A reply that only used the chat's own tools leaves no line at all.
  assert.equal(lineOf({ ...reply, content: '', tool_calls: [call('save_lore', '제안으로 올렸어.')] } as CodexChatMessageRecord), '')
})

test('a generation is summarized by the scene the model asked for, and replays with its outcome, not the queued job JSON', () => {
  const profile = ChatProfileStore.draft({ name: '카이', providerName: 'test' }, 1)
  const lineOf = groupTranscript([profile], { name: '한별', persona: '' } as never)
  const queued = JSON.stringify({ id: 12, status: 'queued', request_summary: '채팅 프리셋 · 기본' })
  const call = (id: string, tool: string, args: unknown) => ({ id, tool, status: 'completed' as const, arguments: args, summary: queued, output: queued, jobIds: [12], historyIds: [], compositeHashes: [] })
  const reply = {
    id: 7, role: 'assistant', speaker_profile_id: 1, content: '자, 봐봐.',
    tool_calls: [call('g', 'generate_image_3', { prompt: '1girl, smiling, cafe, window light', size: 'portrait' })],
  } as unknown as CodexChatMessageRecord
  // The summary keeps the scene: the job JSON says nothing about the picture.
  assert.equal(lineOf(reply), '카이: 자, 봐봐.\n[이미지 생성: 1girl, smiling, cafe, window light]')
  // submit_generation_job carries its prompt in the payload; a call without any prompt falls back to its summary.
  assert.match(lineOf({ ...reply, tool_calls: [call('s', 'submit_generation_job', { service_type: 'novelai', request_payload: { prompt: 'forest, night' } })] } as CodexChatMessageRecord), /\[이미지 생성: forest, night\]$/)
  assert.match(lineOf({ ...reply, tool_calls: [call('s', 'submit_generation_job', {})] } as CodexChatMessageRecord), /\[도구 submit_generation_job: \{"id":12/)

  // Without the outcome pass the model would read the submission's "queued" JSON forever.
  assert.equal(toCompletionMessages(reply)[1].content, queued)
  const finished = applyGenerationOutcomes([reply], new Map([[12, { status: 'completed', images: 1 }]]))
  assert.equal(toCompletionMessages(finished[0])[1].content, generationOutcomeNote(12, { status: 'completed', images: 1 }))
  assert.match(generationOutcomeNote(12, { status: 'completed', images: 1 }), /1 image attached to this reply/)
  assert.match(generationOutcomeNote(12, { status: 'failed', images: 0 }), /failed/)
  assert.match(generationOutcomeNote(12, { status: 'executing', images: 0 }), /still running/)
  assert.match(generationOutcomeNote(12, undefined), /no longer in the queue/)
  // The stored record is untouched, and a lookup call (not a creation) keeps its own output.
  assert.equal(reply.tool_calls[0].output, queued)
  const lookup = { ...reply, tool_calls: [call('w', 'wait_generation_job', {})] } as CodexChatMessageRecord
  assert.equal(applyGenerationOutcomes([lookup], new Map())[0], lookup)
})


test('portraits follow the last standalone sticker of the active variant and fold backwards through edits and branches', async () => {
  const { resolveChatPortrait, lastChatSticker } = await import('@conai/shared')
  const profile = { id: 1, expressionGroupId: 7, expressions: new Map([['기쁨', 'happy'], ['슬픔', 'sad']]), referenceHash: 'reference', avatarHash: 'avatar' }
  const first = { role: 'assistant', content: '&*기쁨*&' }
  const variant = { role: 'assistant', content: 'server-selected text', alternatives: [{ content: '&*기쁨*&\n&*슬픔*&' }, { content: '&*기쁨*&' }], active_alternative: 0 }
  assert.equal(resolveChatPortrait([first, variant], [profile], 1)?.compositeHash, 'sad')
  assert.equal(resolveChatPortrait([first, { ...variant, active_alternative: 1 }], [profile], 1)?.compositeHash, 'happy')
  assert.equal(resolveChatPortrait([first, { role: 'assistant', content: 'signal removed by edit' }], [profile], 1)?.compositeHash, 'happy')
  assert.equal(resolveChatPortrait([first], [profile], 1)?.compositeHash, 'happy')
  assert.equal(resolveChatPortrait([{ role: 'assistant', content: '&*기쁨*&\n&*일반*&' }], [profile], 1)?.source, 'reference')
  assert.equal(resolveChatPortrait([{ role: 'assistant', content: 'English', display_content: '&*슬픔*&' }], [profile], 1)?.compositeHash, 'sad')
  assert.equal(lastChatSticker('inline &*슬픔*&\n&*기쁨*&\n```text\n&*슬픔*&\n```'), '기쁨')
  assert.equal(lastChatSticker('~~~text\n&*슬픔*&\n~~~\ninline &*기쁨*&'), null)
})

test('portraits prefer retained stickers, then enum emotion, reference and avatar; rooms use the last member', async () => {
  const { resolveChatPortrait } = await import('@conai/shared')
  const first = { id: 1, expressionGroupId: 7, expressions: new Map([['기쁨', 'happy']]), emotion: '기쁨', referenceHash: 'reference', avatarHash: 'avatar' }
  const second = { id: 2, expressionGroupId: 8, expressions: new Map([['슬픔', 'sad']]), referenceHash: 'second-ref' }
  assert.equal(resolveChatPortrait([], [first], 1)?.source, 'expression')
  assert.equal(resolveChatPortrait([{ role: 'assistant', content: '&*기쁨*&' }, { role: 'assistant', content: 'no sticker' }], [{ ...first, emotion: '슬픔', expressions: new Map([['기쁨', 'happy'], ['슬픔', 'sad']]) }], 1)?.compositeHash, 'happy')
  assert.equal(resolveChatPortrait([], [{ ...first, emotion: 'unknown' }], 1)?.source, 'reference')
  assert.equal(resolveChatPortrait([], [{ ...first, emotion: null, referenceHash: null }], 1)?.compositeHash, 'avatar')
  assert.equal(resolveChatPortrait([], [{ ...first, expressionGroupId: null }], 1), null)
  const messages = [{ role: 'assistant', content: '&*슬픔*&', speaker_profile_id: 2 }, { role: 'assistant', content: '&*기쁨*&', speaker_profile_id: 1 }, { role: 'assistant', content: 'no sticker', speaker_profile_id: 2 }, { role: 'user', content: '&*기쁨*&' }]
  assert.deepEqual(resolveChatPortrait(messages, [first, second], 1), { profileId: 2, source: 'expression', compositeHash: 'sad', emotion: '슬픔' })
  assert.equal(resolveChatPortrait(messages.slice(1), [first, second], 1)?.compositeHash, 'second-ref')
})

test('portrait hiding removes only its group stickers without blank rows, leaving inline, ordinary, unknown and code tokens', async () => {
  const { injectChatEmoticons } = await import('@conai/shared')
  const emoticons = { profileId: 1, byKeyword: new Map([['기쁨', 'same-image'], ['일반', 'same-image']]), groupByKeyword: new Map([['기쁨', 7], ['일반', 9]]) }
  const source = '앞\n&*기쁨*&\n뒤\n&*일반*&\ninline &*기쁨*&\n```text\n&*기쁨*&\n```\n&*미등록*&'
  const hidden = injectChatEmoticons(source, emoticons, new Set([7]))
  assert.ok(hidden.startsWith('앞\n뒤\n![일반](emote-sticker:same-image)'))
  assert.ok(hidden.includes('inline ![기쁨](emote:same-image)'))
  assert.ok(hidden.includes('```text\n&*기쁨*&\n```'))
  assert.ok(hidden.includes('&\\*미등록\\*&'))
  assert.ok(injectChatEmoticons(source, emoticons).includes('![기쁨](emote-sticker:same-image)'))
  assert.equal(injectChatEmoticons('앞\n\n&*기쁨*&\n\n뒤', emoticons, new Set([7])), '앞\n\n뒤')
  assert.equal(injectChatEmoticons('&*기쁨*&\n\n```text\n\n\nbody\n```', emoticons, new Set([7])), '```text\n\n\nbody\n```')
})
