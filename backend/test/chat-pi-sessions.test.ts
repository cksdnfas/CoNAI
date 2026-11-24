import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { test } from 'node:test'
import type { AddressInfo } from 'node:net'

/** A fake OpenAI-compatible server answering from a script: a tool call, a text, or an error; summaries on request. */
function scriptedServer() {
  const script: Array<{ kind: 'tool'; promptTokens?: number; name?: string; args?: Record<string, unknown>; silent?: boolean } | { kind: 'text'; text: string; reasoning?: string; hold?: boolean } | { kind: 'error'; message?: string }> = []
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
        res.end(JSON.stringify({ error: { message: step.message ?? 'bad request from the script' } }))
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const send = (delta: unknown, finish: string | null = null) => res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: request.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
      if (step.kind === 'tool') {
        if (!step.silent) send({ role: 'assistant', content: 'Looking it up.' })
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
  const { piAnthropicRoot, piPromptInput, piSessionFileExists, streamPiChatCompletion, verifyPiTools } = await import('../src/services/codex-chat/piChatCompletion')
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
    const usage = dbModule.getUserSettingsDb().prepare('SELECT round, input_tokens, output_tokens, estimated, ok FROM llm_usage_events ORDER BY id').all()
    assert.deepEqual(usage, [
      { round: 1, input_tokens: 1200, output_tokens: 10, estimated: 0, ok: 1 },
      { round: 2, input_tokens: 0, output_tokens: 0, estimated: 0, ok: 0 },
    ], 'the request before the failure keeps its own row')
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

  await t.test('output follows the profile while unknown context and output retain provider defaults', async () => {
    for (const limits of [
      { contextWindow: 65000, maxTokens: 50000 },
      { contextWindow: null, maxTokens: 50000 },
      { contextWindow: null, maxTokens: null },
    ]) {
      mock.script.push({ kind: 'text', text: 'Configured reply.' })
      const configured = target({ resumeId: null, onDone: (id) => { sessionId = id } })
      const result = await streamPiChatCompletion({
        target: { ...configured, contextWindow: limits.contextWindow, generation: { ...configured.generation, maxTokens: limits.maxTokens } },
        messages: [{ role: 'user', content: 'Use my configured limits.' }],
        signal: new AbortController().signal,
      })
      assert.equal(result.content, 'Configured reply.')
      assert.equal(mock.requests.at(-1)!.body.max_tokens, limits.maxTokens ?? undefined)
    }
  })

  await t.test('compaction leaves the configured output room before the next provider request', async () => {
    mock.requests.length = 0
    mock.script.push({ kind: 'tool', promptTokens: 80000 }, { kind: 'text', text: 'Enough room after folding.' })
    const configured = target({ resumeId: null, onDone: (id) => { sessionId = id } }, 128000)
    const result = await streamPiChatCompletion({
      target: { ...configured, generation: { ...configured.generation, maxTokens: 50000 } },
      messages: [{ role: 'user', content: `Look this up. ${'please '.repeat(400)}` }],
      tools, signal: new AbortController().signal,
      // Pi retains 20k recent tokens; a longer tool result lets it compact the preceding turn prefix.
      callTool: async () => ({ content: [{ type: 'text', text: 'apple fact '.repeat(9000) }] }),
    })
    assert.equal(result.content, 'Looking it up.\n\nEnough room after folding.')
    assert.ok(mock.requests.some(request => request.summary), '80k input plus 50k output does not fit a 128k context')
    assert.ok(mock.requests.every(request => request.body.max_tokens === 50000), 'compaction must not reduce the configured output ceiling')
  })

  await t.test('a metered pi run records one row per provider request: rounds in order, compaction as a summary, the run\'s totals', async () => {
    const { streamChatCompletion } = await import('../src/services/codex-chat/llmChatCompletion')
    mock.requests.length = 0
    mock.script.push({ kind: 'tool', promptTokens: 80000 }, { kind: 'text', text: 'Counted.' })
    const configured = target({ resumeId: null, onDone: () => {} }, 128000)
    const result = await streamChatCompletion({
      target: { ...configured, generation: { ...configured.generation, maxTokens: 50000 } },
      messages: [{ role: 'user', content: `Look this up. ${'please '.repeat(400)}` }],
      tools, signal: new AbortController().signal,
      callTool: async () => ({ content: [{ type: 'text', text: 'apple fact '.repeat(9000) }] }),
      usage: { purpose: 'chat', profileId: 7, replyId: 'pi-rows' },
    })
    assert.ok(mock.requests.some(request => request.summary), 'the run compacted')
    const rows = dbModule.getUserSettingsDb().prepare("SELECT purpose, round, profile_id, provider_name, model, input_tokens, output_tokens, estimated, ok FROM llm_usage_events WHERE reply_id = 'pi-rows' ORDER BY id").all() as Array<{ input_tokens: number; output_tokens: number }>
    let round = 0
    assert.deepEqual(rows, mock.requests.map(request => ({
      purpose: request.summary ? 'summary' : 'chat', round: request.summary ? null : ++round, profile_id: 7, provider_name: 'mock', model: 'mock-model',
      input_tokens: request.usage.inputTokens, output_tokens: request.usage.outputTokens, estimated: 0, ok: 1,
    })))
    assert.equal(round, 2)
    assert.deepEqual(
      { inputTokens: rows.reduce((total, row) => total + row.input_tokens, 0), outputTokens: rows.reduce((total, row) => total + row.output_tokens, 0) },
      { inputTokens: result.usage?.inputTokens, outputTokens: result.usage?.outputTokens },
      'the rows add up to the run\'s usage',
    )
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
    // The last request alone ends with the budget note, after the messages the first one sent, unchanged.
    const { TOOL_BUDGET_NOTE, TOOL_BUDGET_FAILURE } = await import('../src/services/codex-chat/chatSettings')
    const first = mock.requests[0].messages
    assert.deepEqual(mock.requests[1].messages.slice(0, first.length), first)
    assert.deepEqual(mock.requests[1].messages.at(-1), { role: 'user', content: TOOL_BUDGET_NOTE })
    assert.ok(!first.some((message) => JSON.stringify(message).includes(TOOL_BUDGET_NOTE)))
    assert.ok(!fs.readFileSync(path.join(dir, 'sessions', `${done[0]}.jsonl`), 'utf8').includes(TOOL_BUDGET_NOTE), 'the session never holds the note')
    sessionId = done[0]

    // A final answer that is only a DeepSeek DSML call is dropped, never shown or run: with the earlier round's words
    // the reply is those; with none it fails, and the session stays put.
    const dsml = '<｜｜DSML｜｜ calls> <｜｜DSML｜｜ invoke name="lookup"> <｜｜DSML｜｜ parameter name="topic" string="true">pears</｜｜DSML｜｜ parameter> </｜｜DSML｜｜ invoke> </｜｜DSML｜｜ calls>'
    for (const silent of [false, true]) {
      mock.script.push({ kind: 'tool', silent }, { kind: 'text', text: dsml })
      let streamed = ''
      const calls: string[] = []
      const kept: string[] = []
      const answer = streamPiChatCompletion({
        target: target({ resumeId: sessionId, onDone: (id) => kept.push(id) }),
        messages: [{ role: 'system', content: 'You are a test.' }, { role: 'user', content: 'budget again' }],
        tools, signal: new AbortController().signal, maxToolRounds: 1, onContent: (text) => { streamed += text },
        callTool: async (name) => { calls.push(name); return { content: [{ type: 'text', text: 'ok' }] } },
      })
      if (silent) {
        await assert.rejects(answer, new RegExp(TOOL_BUDGET_FAILURE))
        assert.deepEqual(kept, [])
        assert.deepEqual(files(), [`${sessionId}.jsonl`])
      } else {
        assert.equal((await answer).content, 'Looking it up.')
        sessionId = kept[0]
      }
      assert.deepEqual(calls, ['lookup'], 'the written call never runs')
      assert.doesNotMatch(streamed, /DSML/)
    }
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

  await t.test('an api.anthropic.com connection runs on the native API: cache marks, fitted output, whole tool schemas, earlier turns replayed', async () => {
    mock.script.push({ kind: 'tool' }, { kind: 'text', text: 'Apples are red.' })
    let legacyId = ''
    await run({ resumeId: null, onDone: (id) => { legacyId = id } }, 'tell me about apples')
    // Only https and an API key (not a Claude subscription key) take the native path.
    assert.equal(piAnthropicRoot({ endpoint: 'https://api.anthropic.com/v1/chat/completions', apiKey: 'sk-ant-api03-x' }), 'https://api.anthropic.com')
    assert.equal(piAnthropicRoot({ endpoint: 'http://api.anthropic.com/v1/chat/completions', apiKey: 'sk-ant-api03-x' }), null)
    assert.equal(piAnthropicRoot({ endpoint: 'https://api.anthropic.com/v1/chat/completions', apiKey: 'sk-ant-oat01-x' }), null)
    // A root union beside a root property, with one open shape.
    const folders = { type: 'function' as const, function: { name: 'folders', description: 'Manage folders', parameters: {
      type: 'object', $schema: 'https://json-schema.org/draft/2020-12/schema', properties: { dry_run: { type: 'boolean' } }, oneOf: [
        { type: 'object', properties: { action: { type: 'string', const: 'create' }, name: { type: 'string' } }, required: ['action', 'name'], additionalProperties: false },
        { type: 'object', properties: { action: { type: 'string', const: 'delete' }, folder_id: { type: 'integer' } }, required: ['action', 'folder_id'] },
      ],
    } } }
    const reportedLimits: Record<string, object> = {
      'claude-sonnet-4-5': { max_tokens: 32000, max_input_tokens: 200000 },
      'claude-probe-1': { max_tokens: 8000, max_input_tokens: 10000 },
    }
    const realFetch = globalThis.fetch
    const sent: Array<{ url: string; headers: Headers; body: Record<string, any> }> = []
    const lookups: Array<{ url: string; headers: Headers }> = []
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      if (!url.startsWith('https://api.anthropic.com/')) return realFetch(input, init)
      if (url.includes('/v1/models/')) {
        lookups.push({ url, headers: new Headers(init?.headers) })
        const id = url.slice(url.lastIndexOf('/') + 1)
        return reportedLimits[id] ? Response.json({ id, ...reportedLimits[id] }) : Response.json({ type: 'error', error: { type: 'not_found_error' } }, { status: 404 })
      }
      sent.push({ url, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) })
      const events = [
        { type: 'message_start', message: { id: 'msg_1', model: 'claude-sonnet-4-5', usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 900, cache_creation_input_tokens: 100 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Cached answer.' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } },
        { type: 'message_stop' },
      ]
      return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
    }) as typeof fetch
    try {
      // No context size or output limit on the profile: what Anthropic's models API reports for the model wins over
      // pi's catalog (which lists 64000 out for claude-sonnet-4-5).
      const configured = { ...target({ resumeId: legacyId, onDone: () => {} }), contextWindow: null }
      const native = { ...configured, endpoint: 'https://api.anthropic.com/v1/chat/completions', apiKey: 'sk-ant-test', model: 'claude-sonnet-4-5' }
      const result = await streamPiChatCompletion({
        target: { ...native, generation: { ...configured.generation, temperature: 1.2 } },
        messages: [{ role: 'system', content: 'You are a test.' }, { role: 'user', content: 'cache me' }],
        tools: [...tools, folders], signal: new AbortController().signal, callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      })
      assert.equal(result.content, 'Cached answer.')
      assert.deepEqual(result.usage, { inputTokens: 1005, cachedInputTokens: 900, cacheWriteInputTokens: 100, outputTokens: 7 }, 'cache reads and writes count as input')
      assert.equal(sent.length, 1)
      const [{ url, headers, body }] = sent
      assert.equal(url, 'https://api.anthropic.com/v1/messages?beta=true')
      assert.equal(headers.get('x-api-key'), 'sk-ant-test')
      assert.equal(headers.get('authorization'), null)
      assert.equal(body.max_tokens, 32000, 'no profile limit: the ceiling Anthropic reports, with room to spare')
      assert.equal(body.temperature, 1, 'held to Anthropic\'s 0-1')
      assert.deepEqual(body.thinking, { type: 'disabled' })
      assert.deepEqual(Object.keys(body).filter((key) => /reasoning|chat_template|max_completion/.test(key)), [], 'no OpenAI-shaped fields')
      const ephemeral = { type: 'ephemeral' }
      assert.deepEqual(body.system.at(-1).cache_control, ephemeral)
      assert.deepEqual(body.tools.at(-1).cache_control, ephemeral)
      assert.deepEqual(body.messages.at(-1).content.at(-1), { type: 'text', text: 'cache me', cache_control: ephemeral })
      assert.deepEqual(body.tools[0].input_schema, { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] })
      const merged = body.tools[1].input_schema
      assert.equal(merged.type, 'object')
      assert.equal(merged.oneOf, undefined)
      assert.deepEqual(merged.properties, {
        dry_run: { type: 'boolean' },
        action: { anyOf: [{ type: 'string', const: 'create' }, { type: 'string', const: 'delete' }] },
        name: { anyOf: [{ type: 'string' }, {}] },
        folder_id: { type: 'integer' },
      }, 'every shape\'s properties; the open shape leaves `name` free')
      assert.deepEqual(merged.required, ['action'])
      assert.equal(merged.additionalProperties, undefined, 'one shape is open')
      // The resumed turn was written on the OpenAI-compatible API and replays as Anthropic blocks.
      const blocks = body.messages.flatMap((message: { content: unknown }) => Array.isArray(message.content) ? message.content : [])
      const call = blocks.find((block: { type: string }) => block.type === 'tool_use')
      assert.equal(call.name, 'lookup')
      assert.ok(blocks.some((block: { type: string; tool_use_id?: string }) => block.type === 'tool_result' && block.tool_use_id === call.id))
      assert.match(JSON.stringify(body.messages), /tell me about apples[\s\S]*Apples are red\./)

      // A model pi's catalog does not know: its limits from Anthropic's models API, the output cut to the room the
      // prompt leaves in its window, and a thinking budget that fits under it.
      sent.length = 0
      await streamPiChatCompletion({
        target: { ...native, piSession: { dir, resumeId: null, onDone: () => {} }, model: 'claude-probe-1', generation: { reasoningEffort: 'medium' } },
        messages: [{ role: 'system', content: 'You are a test.' }, { role: 'user', content: 'fit me' }],
        signal: new AbortController().signal,
      })
      assert.deepEqual(lookups.map(({ url, headers }) => [url, headers.get('x-api-key'), headers.get('anthropic-version')]), ['claude-sonnet-4-5', 'claude-probe-1'].map((id) => [`https://api.anthropic.com/v1/models/${id}`, 'sk-ant-test', '2023-06-01']))
      const fitted = sent[0].body
      // The request's characters bound its prompt tokens from above.
      assert.ok(fitted.max_tokens < 8000 && fitted.max_tokens + JSON.stringify(fitted).length <= 10000, `output ${fitted.max_tokens} fits the 10000 window, below the 8000 ceiling`)
      assert.equal(fitted.thinking.type, 'enabled')
      assert.ok(fitted.thinking.budget_tokens >= 1024 && fitted.thinking.budget_tokens < fitted.max_tokens)
      assert.equal(fitted.temperature, undefined)

      // An output limit too small for a valid thinking budget goes without thinking.
      sent.length = 0
      await streamPiChatCompletion({
        target: { ...native, piSession: { dir, resumeId: null, onDone: () => {} }, generation: { maxTokens: 1500, reasoningEffort: 'low' } },
        messages: [{ role: 'system', content: 'You are a test.' }, { role: 'user', content: 'small' }],
        signal: new AbortController().signal,
      })
      assert.equal(sent[0].body.max_tokens, 1500)
      assert.deepEqual(sent[0].body.thinking, { type: 'disabled' })
      assert.equal(lookups.length, 2, 'the model\'s limits are looked up once')

      // A model the models API refuses runs on pi's catalog, and the refusal is remembered rather than asked again.
      sent.length = 0
      for (const text of ['refused', 'refused again']) {
        await streamPiChatCompletion({
          target: { ...native, piSession: { dir, resumeId: null, onDone: () => {} }, model: 'claude-haiku-4-5', generation: {} },
          messages: [{ role: 'system', content: 'You are a test.' }, { role: 'user', content: text }],
          signal: new AbortController().signal,
        })
      }
      assert.deepEqual(sent.map(({ body }) => body.max_tokens), [64000, 64000])
      assert.equal(lookups.filter(({ url }) => url.endsWith('/claude-haiku-4-5')).length, 1)
    } finally {
      globalThis.fetch = realFetch
    }
  })

  await t.test('cache marks on an OpenAI-compatible connection reach pi\'s requests; a server refusing them gets the request again without', async () => {
    mock.requests.length = 0
    mock.script.push({ kind: 'error', message: 'cache_control: Extra inputs are not permitted' }, { kind: 'text', text: 'Marked.' }, { kind: 'text', text: 'Again.' })
    const marked = () => streamPiChatCompletion({
      target: { ...target({ resumeId: null, onDone: () => {} }), promptCacheMarks: true },
      messages: [{ role: 'system', content: 'You are a test.' }, { role: 'user', content: 'mark it' }],
      tools, signal: new AbortController().signal,
    })
    assert.equal((await marked()).content, 'Marked.')
    const [request, resent] = mock.requests
    const ephemeral = { type: 'ephemeral' }
    assert.deepEqual(request.messages[0].content, [{ type: 'text', text: 'You are a test.', cache_control: ephemeral }])
    assert.deepEqual((request.tools.at(-1) as { cache_control?: unknown }).cache_control, ephemeral)
    assert.deepEqual(request.messages.at(-1)!.content, [{ type: 'text', text: 'mark it', cache_control: ephemeral }])
    assert.equal(mock.requests.length, 2)
    assert.doesNotMatch(JSON.stringify(resent.body), /cache_control/)
    assert.deepEqual(resent.body.messages, JSON.parse(JSON.stringify(request.body.messages, (key, value) => key === 'cache_control' ? undefined : value)), 'the same request, unmarked')
    assert.equal((await marked()).content, 'Again.')
    assert.equal(mock.requests.length, 3)
    assert.doesNotMatch(JSON.stringify(mock.requests[2].body), /cache_control/, 'the refusal is remembered')
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

  await t.test('screens: a turn after the model\'s own page operation sends none again, a failed one marks none shown, a fold brings the whole screen back, a superseded one keeps its residual, changes to a screen the model lacks claim none', async (sub) => {
    mockModelRows(sub, { 1: ['test', 'test'] }, 1)
    const { normalizeChatPageSnapshot } = await import('@conai/shared')
    const { boundedPageView, notePageViewFolded, notePageViewShown, PAGE_VIEW_UNKNOWN, pageViewKey, pageViewLine, takePageViewFolded } = await import('../src/services/codex-chat/chatPageContext')
    const { chatPageView, pageOperationView } = await import('../src/mcp/tools/chatPageView')
    const { runToolCall } = await import('../src/services/codex-chat/llmChatService')
    const { profileContentLimit } = await import('../src/services/codex-chat/chatContentRating')
    const { piSessionFile } = await import('../src/services/codex-chat/piChatCompletion')
    const admin = { accountId: null, accountType: 'admin' as const }
    const profile = ChatProfileStore.draft({ name: 'Pi pages', llmRuntime: 'pi' })
    const limit = profileContentLimit(profile)
    const threadId = CodexChatStore.createThread(1, 'pi page chat', 'llm', null)
    const long = 'n'.repeat(3000)
    const screen = (name: string, prompt = long, note?: string) => normalizeChatPageSnapshot({ instanceId: 'inst-pi-1', connectionId: 'conn-pi-1', path: '/settings', title: '설정', kind: 'settings', resourceId: 'chat', revision: `rev-page-${name}`,
      fields: [{ id: 'name', label: '이름', type: 'text', value: name }, { id: 'prompt', label: '프롬프트', type: 'text', value: prompt }, ...(note === undefined ? [] : [{ id: 'note', label: '메모', type: 'text', value: note }])],
      actions: [{ id: 'profile.open_create', label: '새 프로필', description: '', effect: 'draft', schema: { type: 'object', properties: {} } }] })
    const pageTools = ['page_fill', 'page_act'].map((name) => ({ type: 'function' as const, function: { name, parameters: { type: 'object', properties: {} } } }))
    const context = { source: 'llm-chat', requester: admin, chatContext: { threadId } } as never
    // A page_fill's result as the tool gives it.
    const filled = (from: ReturnType<typeof screen>, to: ReturnType<typeof screen>) => {
      const view = pageOperationView(admin, from, to, limit)
      return { content: [{ type: 'text', text: JSON.stringify({ status: 'filled', fields: ['이름'], page: view.page }) }], structuredContent: notePageViewShown(context, to, limit, view) }
    }
    // A tool's result through llmChatService's tool path (runToolCall), the way its pi callTool goes.
    const given: unknown[] = []
    const toolPath = (session: object, result: unknown) => async (name: string, _args: unknown, id: string, nested?: boolean) => {
      const turn = { toolCalls: new Map(), listeners: new Set(), controller: new AbortController(), engineSession: session }
      const { nativeResult } = await runToolCall(turn as never, { call: async () => result } as never, { id, function: { name, arguments: '{}' } }, 12_000, [], nested)
      given.push(nativeResult)
      return nativeResult
    }
    // One turn of the chat on a screen, through pi; a page_fill call answers as the tool would.
    const turnOn = async (name: string, script: typeof mock.script, result?: unknown, page = screen(name)) => {
      CodexChatStore.addMessage({ thread_id: threadId, role: 'user', content: `on ${name}`, tool_calls: [], status: 'completed', error: null })
      const turn = await buildClaudeSessionTurn({ requester: admin as never, threadId, profile, history: CodexChatStore.listMessages(threadId), page, withTools: { app: true, generate: true }, runtime: 'pi' })
      mock.requests.length = 0
      mock.script.push(...script)
      const run = streamPiChatCompletion({ target: target(turn.session), messages: turn.messages, tools: pageTools, signal: new AbortController().signal, maxToolRounds: 4,
        ...(result ? { callTool: toolPath(turn.session, result) } : {}) })
      return { text: String(turn.messages[1].content), run }
    }
    const sent = () => JSON.parse(CodexChatStore.findThreadById(threadId)?.codex_lore_sent ?? '[]') as string[]
    const edits = () => {
      const id = readClaudeSession(CodexChatStore.findThreadById(threadId)?.codex_thread_id, 'pi')!.id
      return fs.readFileSync(piSessionFile(claudeSessionDir(threadId, 'pi'), id), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)).filter((entry) => entry.type === 'context_edit')
    }
    const intro = /do not call get_current_page first/

    const first = await turnOn('A', [{ kind: 'tool', name: 'page_fill' }, { kind: 'text', text: 'Filled.' }], filled(screen('A'), screen('B')))
    assert.match(first.text, intro)
    await first.run
    assert.ok(sent().includes(pageViewKey(admin, screen('B'), limit)), 'the screen the page tool showed counts as given')
    assert.ok(!sent().includes(pageViewKey(admin, screen('A'), limit)))
    assert.equal((given[0] as { structuredContent?: unknown }).structuredContent, undefined, 'no transport is given the screen key')
    // A script's page result, a cut one or a shortened change leaves the screen unknown; only a whole screen counts again.
    const held = { runtime: 'pi' } as { runtime: 'pi'; shownPageView?: string }
    await toolPath(held, filled(screen('B'), screen('C')))('page_fill', {}, 'script-1/1', true)
    assert.equal(held.shownPageView, PAGE_VIEW_UNKNOWN, 'the model reads a script\'s result only as the script prints it')
    await toolPath(held, filled(screen('C'), screen('D')))('page_fill', {}, 'call-1')
    assert.equal(held.shownPageView, PAGE_VIEW_UNKNOWN, 'changes do not make up a screen the model lacks')
    const own = { content: [{ type: 'text', text: '{}' }], structuredContent: { pageView: pageViewKey(admin, screen('D'), limit) } }
    assert.deepEqual((await toolPath(held, own)('list_images', {}, 'call-2')).structuredContent, own.structuredContent, 'another tool\'s pageView is its own')
    assert.equal(held.shownPageView, PAGE_VIEW_UNKNOWN)

    const second = await turnOn('B', [{ kind: 'tool', name: 'page_fill' }, { kind: 'error' }], filled(screen('B'), screen('C')))
    assert.match(second.text, /Same screen as the last one you were given/)
    assert.doesNotMatch(second.text, intro)
    await assert.rejects(second.run, /pi 요청에 실패했어/)
    assert.ok(!sent().includes(pageViewKey(admin, screen('C'), limit)), 'a failed turn marks nothing shown')

    // The screen the turn starts on supersedes the first turn's: only the parts it does not repeat stay there.
    const third = await turnOn('C', [{ kind: 'text', text: 'Seen.' }])
    assert.match(third.text, intro)
    await third.run
    const request = JSON.stringify(mock.requests[0].messages)
    assert.equal(request.split(long).length - 1, 1, 'the repeated value goes once, in the newest view')
    assert.match(request, /otherFields/, 'a changed-parts result stays as it was')
    const [edit] = edits()
    const content = edit.replacement.content
    const text = typeof content === 'string' ? content : content.find((part: { type: string }) => part.type === 'text').text
    const line = pageViewLine(text)!
    const residual = JSON.parse(text.slice(line.start, line.end))
    assert.deepEqual(residual.fields.map((field: { id: string; value: string }) => [field.id, field.value]), [['name', 'A']])
    assert.deepEqual([residual.sameInNextView.fields, residual.sameInNextView.actions], [['prompt'], true])

    // A reduced view is left alone; the next superseded one gets its own edit.
    await (await turnOn('D', [{ kind: 'text', text: 'Seen again.' }])).run
    const later = edits()
    assert.equal(later.length, 2)
    assert.equal(new Set(later.map((entry) => entry.targetId)).size, 2)

    // pi folds the memory in the middle of the reply: the page operation after it shows the whole screen.
    mock.requests.length = 0
    mock.script.push({ kind: 'tool', promptTokens: 2000, name: 'page_act' }, { kind: 'tool', name: 'page_act' }, { kind: 'text', text: 'Done after folding.' })
    let shown: unknown
    let calls = 0
    await streamPiChatCompletion({
      target: { ...target({ resumeId: null, onDone: () => {} }, 4096), piSession: { dir, resumeId: null, onDone: () => {}, onCompaction: () => notePageViewFolded(threadId) } },
      messages: [{ role: 'user', content: `act twice ${'please '.repeat(400)}` }],
      tools: pageTools, signal: new AbortController().signal, maxToolRounds: 4,
      callTool: async () => {
        calls += 1
        if (calls === 1) return { content: [{ type: 'text', text: `done${' apple fact'.repeat(600)}` }] }
        shown = pageOperationView(admin, screen('C'), screen('D'), limit, takePageViewFolded(threadId)).page
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'done', page: shown }) }] }
      },
    })
    assert.ok(mock.requests.some((request) => request.summary), 'the reply was folded')
    assert.deepEqual(shown, JSON.parse(boundedPageView(chatPageView(admin, screen('D'), limit))))
    assert.equal(takePageViewFolded(threadId), false, 'one whole screen per fold')

    // Changes count only on the screen the model holds: not on one the connection took up unseen (a workflow capture,
    // another chat's turn), nor on one the model was given shortened. Either way the next turn carries the whole screen.
    const unseen = await turnOn('D', [{ kind: 'tool', name: 'page_fill' }, { kind: 'text', text: 'Filled.' }], filled(screen('X'), screen('E')))
    assert.match(unseen.text, /Same screen as the last one you were given/)
    await unseen.run
    assert.ok(sent().includes(PAGE_VIEW_UNKNOWN), 'changes to a screen replaced unseen')
    const afterUnseen = await turnOn('E', [{ kind: 'text', text: 'Seen.' }])
    assert.match(afterUnseen.text, intro)
    await afterUnseen.run
    const [prompt, note] = ['p'.repeat(7000), 'q'.repeat(7000)]
    const shortened = await turnOn('F', [{ kind: 'tool', name: 'page_fill' }, { kind: 'text', text: 'Filled.' }], filled(screen('F', prompt, note), screen('G', 'short', note)), screen('F', prompt, note))
    assert.match(shortened.text, /long values are shortened here/, 'the model is given the screen shortened')
    await shortened.run
    assert.ok(sent().includes(PAGE_VIEW_UNKNOWN), 'changes to a screen given shortened, its unchanged note held only clipped')
    const afterShortened = await turnOn('G', [{ kind: 'text', text: 'Seen.' }], undefined, screen('G', 'short', note))
    assert.match(afterShortened.text, intro)
    await afterShortened.run
  })
})
