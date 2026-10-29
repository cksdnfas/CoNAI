import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { test } from 'node:test'
import type { AddressInfo } from 'node:net'

/** A fake OpenAI-compatible server answering from a script: a tool call, a text, or an error; summaries on request. */
function scriptedServer() {
  const script: Array<{ kind: 'tool'; promptTokens?: number; name?: string; args?: Record<string, unknown> } | { kind: 'text'; text: string; reasoning?: string; hold?: boolean } | { kind: 'error' }> = []
  let closedStreams = 0
  const requests: Array<{ messages: Array<{ role: string; content: unknown }>; tools: unknown[]; summary: boolean; body: Record<string, unknown>; usage: { inputTokens: number; outputTokens: number } }> = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      const request = JSON.parse(body || '{}')
      const messages = request.messages ?? []
      const summary = !request.tools?.length && /summar/i.test(JSON.stringify(messages.at(-1) ?? ''))
      const captured = { messages, tools: request.tools ?? [], summary, body: request, usage: { inputTokens: 0, outputTokens: 0 } }
      requests.push(captured)
      const step = summary ? { kind: 'text' as const, text: '## Goal\nfruits\n## Progress\nlooked some up' } : script.shift() ?? { kind: 'text' as const, text: 'fallback' }
      if (step.kind === 'error') {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'bad request from the script' } }))
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const send = (delta: unknown, finish: string | null = null) => res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: request.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
      if (step.kind === 'tool') {
        send({ role: 'assistant', content: 'Looking it up.' })
        send({ tool_calls: [{ index: 0, id: `call_${requests.length}`, type: 'function', function: { name: step.name ?? 'lookup', arguments: JSON.stringify(step.args ?? { topic: 'apples' }) } }] })
        send({}, 'tool_calls')
      } else {
        send({ role: 'assistant', content: step.text, reasoning_content: step.reasoning })
        if (step.hold) {
          res.on('close', () => { closedStreams += 1 })
          return
        }
        send({}, 'stop')
      }
      const prompt = step.kind === 'tool' && step.promptTokens ? step.promptTokens : Math.ceil(JSON.stringify(messages).length / 4)
      captured.usage = { inputTokens: prompt, outputTokens: 10 }
      res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: request.model, choices: [], usage: { prompt_tokens: prompt, completion_tokens: 10, total_tokens: prompt + 10 } })}\n\n`)
      res.end('data: [DONE]\n\n')
    })
  })
  return { server, script, requests, get closedStreams() { return closedStreams } }
}

test('pi sessions: tool rounds, forked turns, failures leave no trace, compaction, cleanup', { timeout: 120000 }, async (t) => {
  const temp = path.resolve(__dirname, '../../temp')
  fs.mkdirSync(temp, { recursive: true })
  const root = fs.mkdtempSync(path.join(temp, 'conai-pi-session-test-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  const { mockModelRows } = await import('./modelRowMocks')
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  const { piPromptInput, piSessionFileExists, streamPiChatCompletion, verifyPiTools } = await import('../src/services/codex-chat/piChatCompletion')
  const { buildClaudeSessionTurn, claudeSessionDir, deleteClaudeSessions, isClaudeSessionValue, readClaudeSession } = await import('../src/services/codex-chat/claudeChatSessions')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { ChatProfileStore, sessionRuntimeOf } = await import('../src/services/codex-chat/chatProfiles')
  const mock = scriptedServer()
  await new Promise<void>((resolve) => mock.server.listen(0, '127.0.0.1', resolve))
  const port = (mock.server.address() as AddressInfo).port
  t.after(async () => {
    mock.server.close()
    dbModule.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), temp)
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const tools = [{ type: 'function' as const, function: { name: 'lookup', description: 'Look a topic up', parameters: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] } } }]
  const dir = claudeSessionDir(1, 'pi')
  const target = (session: { resumeId: string | null; onDone: (id: string, compacted: boolean) => void }, contextWindow = 32768) => ({
    providerName: 'mock', displayName: 'mock', endpoint: `http://127.0.0.1:${port}/v1/chat/completions`, apiKey: null, model: 'mock-model',
    generation: { reasoningEffort: 'none' as const, reasoningBudgetTokens: 128 }, thinkingSwitch: 'enable_thinking' as const,
    promptCacheMarks: false, transport: 'pi' as const, contextWindow, piSession: { dir, ...session },
  })
  const run = (session: Parameters<typeof target>[0], text: string, calls: Array<Record<string, unknown>> = [], contextWindow?: number, resultPadding = 0) => streamPiChatCompletion({
    target: target(session, contextWindow),
    messages: [{ role: 'system', content: 'You are a test.' }, { role: 'user', content: text }],
    tools,
    signal: new AbortController().signal,
    callTool: async (name, args) => { calls.push({ name, ...args }); return { content: [{ type: 'text', text: `fact about ${String(args.topic)}${' apple fact'.repeat(resultPadding)}` }] } },
    maxToolRounds: 4,
  })
  const files = () => fs.readdirSync(path.join(dir, 'sessions')).sort()

  await t.test('the prompt is the latest user message with its inline images', () => {
    const input = piPromptInput([{ role: 'user', content: 'old' }, { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,YQ==' } }] }])
    assert.deepEqual(input, { text: 'look', images: [{ type: 'image', mimeType: 'image/png', data: 'YQ==' }] })
    assert.throws(() => piPromptInput([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }] }]), /인라인/)
    assert.throws(() => verifyPiTools(['lookup', 'bash'], tools), /격리/)
    assert.doesNotThrow(() => verifyPiTools(['lookup'], tools))
  })

  let sessionId = ''
  await t.test('a new session runs the tool rounds through CoNAI and keeps the conversation in a file', async () => {
    mock.script.push({ kind: 'tool' }, { kind: 'text', text: 'Apples are red.' })
    const calls: Array<Record<string, unknown>> = []
    const done: Array<[string, boolean]> = []
    const result = await run({ resumeId: null, onDone: (id, compacted) => done.push([id, compacted]) }, 'tell me about apples', calls)
    assert.deepEqual(calls, [{ name: 'lookup', topic: 'apples' }])
    assert.equal(result.content, 'Looking it up.\n\nApples are red.')
    assert.equal(result.promptTokens, null)
    assert.equal(done.length, 1)
    assert.equal(done[0][1], false)
    sessionId = done[0][0]
    assert.ok(piSessionFileExists(dir, sessionId))
    // Only CoNAI's tool reaches the model: none of pi's own.
    assert.deepEqual(mock.requests[0].tools.map((tool) => (tool as { function: { name: string } }).function.name), ['lookup'])
    assert.equal(mock.requests[0].messages[0].role, 'system')
    assert.equal(mock.requests[0].messages[0].content, 'You are a test.')
    assert.deepEqual(mock.requests[0].body.chat_template_kwargs, { enable_thinking: false })
    assert.equal(mock.requests[0].body.reasoning_budget_tokens, 128)
  })

  await t.test('native tool lifecycle spans the awaited call', async () => {
    mock.script.push({ kind: 'tool' }, { kind: 'text', text: 'Tool finished.' })
    let release!: () => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const held = new Promise<void>((resolve) => { release = resolve })
    const lifecycle: string[] = []
    const result = streamPiChatCompletion({
      target: target({ resumeId: sessionId, onDone: (id) => { sessionId = id } }),
      messages: [{ role: 'system', content: 'You are a test.' }, { role: 'user', content: 'wait for the tool' }],
      tools, signal: new AbortController().signal,
      onToolStart: () => lifecycle.push('start'),
      onToolEnd: () => lifecycle.push('end'),
      callTool: async () => { entered(); await held; return { content: [{ type: 'text', text: 'done' }] } },
    })
    await started
    assert.deepEqual(lifecycle, ['start'])
    release()
    assert.match((await result).content, /Tool finished/)
    assert.deepEqual(lifecycle, ['start', 'end'])
  })

  await t.test('a later turn forks the session: the model sees the earlier turn, the old file goes', async () => {
    mock.requests.length = 0
    mock.script.push({ kind: 'text', text: 'Still red.' })
    const done: string[] = []
    const result = await run({ resumeId: sessionId, onDone: (id) => done.push(id) }, 'and now?')
    assert.equal(result.content, 'Still red.')
    assert.ok(JSON.stringify(mock.requests[0].messages).includes('tell me about apples'), 'the earlier turn is in the request')
    assert.notEqual(done[0], sessionId)
    assert.ok(!piSessionFileExists(dir, sessionId))
    assert.deepEqual(files(), [`${done[0]}.jsonl`])
    sessionId = done[0]
  })

  await t.test('a failed turn leaves the chat on the session it was on', async () => {
    mock.script.push({ kind: 'tool', promptTokens: 1200 }, { kind: 'error' })
    const done: string[] = []
    const { streamChatCompletion } = await import('../src/services/codex-chat/llmChatCompletion')
    await assert.rejects(streamChatCompletion({
      target: target({ resumeId: sessionId, onDone: (id) => done.push(id) }),
      messages: [{ role: 'system', content: 'You are a test.' }, { role: 'user', content: 'fail after lookup' }],
      tools, signal: new AbortController().signal,
      callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    }), /pi 요청에 실패했어/)
    const usage = dbModule.getUserSettingsDb().prepare('SELECT input_tokens, output_tokens, estimated, ok FROM llm_usage_events ORDER BY id DESC LIMIT 1').get()
    assert.deepEqual(usage, { input_tokens: 1200, output_tokens: 10, estimated: 0, ok: 0 })
    assert.deepEqual(done, [])
    assert.deepEqual(files(), [`${sessionId}.jsonl`])
  })

  await t.test('a context that fills in the middle of a tool run is folded and the run goes on', async () => {
    mock.requests.length = 0
    mock.script.push({ kind: 'tool', promptTokens: 2000 }, { kind: 'text', text: 'Done after folding.' })
    const done: Array<[string, boolean]> = []
    // A 4k window: the result (~1.7k tokens) on top of the conversation tips it over the fold threshold (3k).
    const result = await run({ resumeId: sessionId, onDone: (id, compacted) => done.push([id, compacted]) }, `one more lookup ${'please '.repeat(400)}`, [], 4096, 600)
    assert.ok(mock.requests.some((request) => request.summary), 'a summary was asked for')
    assert.match(result.content, /Done after folding\./)
    assert.equal(done[0][1], true)
    assert.deepEqual(result.usage, {
      inputTokens: mock.requests.reduce((total, request) => total + request.usage.inputTokens, 0),
      outputTokens: mock.requests.reduce((total, request) => total + request.usage.outputTokens, 0),
      cachedInputTokens: 0,
    }, 'the compaction request is included in the run usage')
  })

  await t.test('a tool call written as text runs as a call, and a catalogued name goes through run_tool', async () => {
    const offered = [...tools, { type: 'function' as const, function: { name: 'run_tool', parameters: { type: 'object', properties: { tool: { type: 'string' }, arguments: { type: 'object' } } } } }]
    mock.script.push({ kind: 'text', text: 'Checking.\n\n<tool_call>\n<function=lookup>\n<parameter=topic>\npears\n</parameter>\n</function>\n</tool_call>' }, { kind: 'tool', name: 'hidden_lookup' }, { kind: 'text', text: 'Pears are green.' })
    const calls: Array<Record<string, unknown>> = []
    const result = await streamPiChatCompletion({
      target: target({ resumeId: null, onDone: () => {} }),
      messages: [{ role: 'system', content: 'You are a test.' }, { role: 'user', content: 'pears' }],
      tools: offered, catalogued: new Set(['hidden_lookup']), signal: new AbortController().signal, maxToolRounds: 4,
      callTool: async (name, args) => { calls.push({ name, ...args }); return { content: [{ type: 'text', text: 'ok' }] } },
    })
    assert.deepEqual(calls, [{ name: 'lookup', topic: 'pears' }, { name: 'run_tool', tool: 'hidden_lookup', arguments: { topic: 'apples' } }])
    assert.doesNotMatch(result.content, /tool_call|function=/)
    assert.match(result.content, /Checking\.[\s\S]*Pears are green\./)
  })

  await t.test('past the profile\'s tool rounds the tools go, so the model answers in text', async () => {
    mock.requests.length = 0
    mock.script.push({ kind: 'tool' }, { kind: 'text', text: 'Answering now.' })
    const done: string[] = []
    const result = await streamPiChatCompletion({
      target: target({ resumeId: null, onDone: (id) => done.push(id) }),
      messages: [{ role: 'system', content: 'You are a test.' }, { role: 'user', content: 'budget' }],
      tools, signal: new AbortController().signal, maxToolRounds: 1,
      callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    })
    assert.match(result.content, /Answering now\./)
    assert.equal(mock.requests[0].tools.length, 1)
    assert.equal(mock.requests[1].tools.length, 0)
    sessionId = done[0]
  })

  await t.test('with codemode on, a script\'s calls run through CoNAI and stop at the per-script cap', async () => {
    const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
    updateChatSettings({ piCodemode: true })
    t.after(() => { updateChatSettings({ piCodemode: false }) })
    mock.requests.length = 0
    const code = "const out = []\nfor (let i = 0; i < 9; i++) { try { await tools.lookup({ topic: 't' + i }); out.push('ok') } catch (error) { out.push(error.message) } }\nreturn out.join('|')"
    mock.script.push({ kind: 'tool', name: 'codemode', args: { code } }, { kind: 'text', text: 'Scripted.' })
    const calls: Array<Record<string, unknown>> = []
    const result = await streamPiChatCompletion({
      target: target({ resumeId: null, onDone: () => {} }),
      messages: [{ role: 'system', content: 'You are a test.' }, { role: 'user', content: 'script it' }],
      tools, signal: new AbortController().signal, maxToolRounds: 4,
      callTool: async (name, args) => { calls.push({ name, ...args }); return { content: [{ type: 'text', text: 'ok' }] } },
    })
    assert.match(result.content, /Scripted\./)
    assert.deepEqual(mock.requests[0].tools.map((tool) => (tool as { function: { name: string } }).function.name).sort(), ['codemode', 'lookup'])
    assert.equal(calls.length, 4, 'one script makes as many calls as the reply has tool rounds')
    assert.match(JSON.stringify(mock.requests[1].messages), /at most 4 tool calls/)
    updateChatSettings({ piCodemode: false })
  })

  await t.test('research uses native turn limits, removes tools for the final answer, and never fabricates provider-call counts', async () => {
    const { ChatResearchExecution } = await import('../src/services/codex-chat/chatResearch')
    const research = new ChatResearchExecution({ slotId: 'a', activityId: 'b', allowedPostIds: [1] }, 'pi', 1)
    mock.requests.length = 0
    mock.script.push({ kind: 'tool' }, { kind: 'text', text: 'Research summary.' })
    const result = await streamPiChatCompletion({
      target: target({ resumeId: null, onDone: () => {} }),
      messages: [{ role: 'system', content: 'Use only supplied tools.' }, { role: 'user', content: 'Research apples.' }],
      tools, signal: new AbortController().signal, maxToolRounds: 1, research,
      callTool: async () => {
        assert.equal(research.takeTool(), true)
        return { content: [{ type: 'text', text: 'Original evidence.' }] }
      },
    })
    assert.match(result.content, /Research summary/)
    assert.equal(mock.requests.length, 2)
    assert.equal(mock.requests[1].tools.length, 0)
    assert.equal(research.result.turns, 2)
    assert.equal(research.result.modelCalls, null)
    assert.equal(research.result.limits.maxModelCalls, null)
    assert.equal(research.result.stopReason, 'turn_limit')

    for (const maxTurns of [1, 3]) {
      const complete = new ChatResearchExecution({ slotId: 'a', activityId: `complete-${maxTurns}`, allowedPostIds: [1] }, 'pi', maxTurns - 1)
      mock.requests.length = 0
      if (maxTurns === 3) mock.script.push({ kind: 'tool' })
      mock.script.push({ kind: 'text', text: 'A normal final answer.' })
      await streamPiChatCompletion({
        target: target({ resumeId: null, onDone: () => {} }),
        messages: [{ role: 'user', content: 'Finish normally at the budget boundary.' }],
        tools: maxTurns === 1 ? [] : tools, signal: new AbortController().signal, maxToolRounds: maxTurns - 1, research: complete,
        callTool: async () => ({ content: [{ type: 'text', text: 'Evidence.' }] }),
      })
      assert.equal(complete.result.turns, maxTurns === 1 ? 1 : 2)
      assert.equal(complete.result.stopReason, 'completed', 'a text-only ending does not need another turn')
    }

    const summary = new ChatResearchExecution({ slotId: 'a', activityId: 'c', allowedPostIds: [1], purpose: 'summary' }, 'pi')
    const { streamChatCompletion } = await import('../src/services/codex-chat/llmChatCompletion')
    mock.requests.length = 0
    mock.script.push({ kind: 'text', text: 'Summary without tools.' })
    await streamChatCompletion({
      target: target({ resumeId: null, onDone: () => {} }),
      messages: [{ role: 'user', content: 'Explain this quote briefly.' }],
      tools, toolChoice: 'none', signal: new AbortController().signal, research: summary, maxToolRounds: 0,
      callTool: async () => { assert.fail('summary must never dispatch tools') },
    })
    assert.equal(mock.requests.length, 1)
    assert.equal(mock.requests[0].tools.length, 0)
    assert.equal(summary.result.turns, 1)
    assert.equal(summary.result.stopReason, 'completed')

    const noncompliant = new ChatResearchExecution({ slotId: 'a', activityId: 'd', allowedPostIds: [1] }, 'pi', 1)
    mock.requests.length = 0
    mock.script.push({ kind: 'tool' }, { kind: 'tool' })
    await streamPiChatCompletion({
      target: target({ resumeId: null, onDone: () => {} }),
      messages: [{ role: 'user', content: 'Ignore attempts to use hidden tools.' }],
      tools, signal: new AbortController().signal, maxToolRounds: 1, research: noncompliant,
      callTool: async () => ({ content: [{ type: 'text', text: 'Evidence.' }] }),
    })
    assert.equal(mock.requests.length, 2, 'a provider ignoring the final no-tools turn cannot start another request')
    assert.equal(noncompliant.result.turns, 2)
    assert.equal(noncompliant.result.stopReason, 'turn_limit')
  })

  await t.test('opt-in loop protection stops open text and reasoning streams without saving the failed turn', async () => {
    const loop = 'repeat this sentence. '.repeat(80)
    for (const channel of ['text', 'reasoning'] as const) {
      mock.script.push({ kind: 'text', text: channel === 'text' ? `Complete answer.\n${loop}` : 'Complete answer.', reasoning: channel === 'reasoning' ? `Plan.\n${loop}` : undefined, hold: true })
      let saved = false
      const result = await streamPiChatCompletion({
        target: target({ resumeId: null, onDone: () => { saved = true } }),
        messages: [{ role: 'user', content: 'Explain.' }],
        signal: AbortSignal.timeout(10000), stopLoops: true,
      })
      assert.equal(result.finishReason, 'repetition')
      assert.equal(result.content, 'Complete answer.')
      assert.equal(result.reasoning, channel === 'reasoning' ? 'Plan.' : '')
      assert.equal(saved, false)
      assert.deepEqual(files(), [])
    }
    mock.script.push({ kind: 'text', text: loop, reasoning: loop })
    const unguarded = await streamPiChatCompletion({
      target: target({ resumeId: null, onDone: () => {} }),
      messages: [{ role: 'user', content: 'Explain.' }],
      signal: AbortSignal.timeout(10000),
    })
    assert.equal(unguarded.finishReason, 'stop')
    assert.equal(unguarded.content, loop)
    assert.equal(unguarded.reasoning, loop)
    assert.equal(mock.closedStreams, 2, 'loop detection cancels both provider streams')
  })

  await t.test('a pi profile keeps its chat as a pi session value; deleting the chat drops the folder', async (sub) => {
    mockModelRows(sub, { 1: ['test', 'test'] }, 1)
    const profile = ChatProfileStore.draft({ name: 'Pi', llmRuntime: 'pi' })
    assert.equal(sessionRuntimeOf(profile), 'pi')
    assert.equal(sessionRuntimeOf(ChatProfileStore.draft({ name: 'Direct' })), null)
    assert.equal(sessionRuntimeOf(ChatProfileStore.draft({ name: 'Codex pi?', engine: 'codex', llmRuntime: 'pi' })), null, 'only API LLM profiles run through pi')
    const threadId = CodexChatStore.createThread(1, 'pi chat', 'llm', null)
    CodexChatStore.addMessage({ thread_id: threadId, role: 'user', content: 'hello', tool_calls: [], status: 'completed', error: null })
    const history = CodexChatStore.listMessages(threadId)
    const turn = await buildClaudeSessionTurn({ requester: { accountId: 1 } as never, threadId, profile, history, withTools: false, runtime: 'pi' })
    assert.equal(turn.session.runtime, 'pi')
    assert.equal(turn.session.resumeId, null)
    turn.session.onDone('2026-10-12T00-00-00-000Z_abc', false)
    const stored = CodexChatStore.findThreadById(threadId)?.codex_thread_id ?? null
    assert.ok(isClaudeSessionValue(stored))
    assert.equal(readClaudeSession(stored, 'pi')?.id, '2026-10-12T00-00-00-000Z_abc')
    assert.equal(readClaudeSession(stored, 'claude'), null, 'a pi session is never resumed as a Claude one')
    fs.mkdirSync(path.join(claudeSessionDir(threadId, 'pi'), 'sessions'), { recursive: true })
    deleteClaudeSessions(threadId)
    assert.ok(!fs.existsSync(claudeSessionDir(threadId, 'pi')))
  })
})
