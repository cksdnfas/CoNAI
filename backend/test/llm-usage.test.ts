import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

test('llm usage ledger: reported, estimated, failed and stopped requests; daily summary; judge tokens', { timeout: 60000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const temp = path.resolve(__dirname, '../../temp')
  fs.mkdirSync(temp, { recursive: true })
  const root = fs.mkdtempSync(path.join(temp, 'conai-llm-usage-test-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  process.env.RUNTIME_UPLOADS_DIR = path.join(root, 'uploads')
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  const db = dbModule.getUserSettingsDb()
  const { readUsageCounts, recordLlmUsage, buildLlmUsageSummary } = await import('../src/services/llmUsage')
  const { streamChatCompletion } = await import('../src/services/codex-chat/llmChatCompletion')
  const { ChatJudgeLogStore } = await import('../src/services/codex-chat/chatJudgeLogs')

  await t.test('usage bodies: OpenAI, Anthropic and Ollama shapes', () => {
    assert.deepEqual(readUsageCounts({ usage: { prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 100 } } }), { inputTokens: 120, cachedInputTokens: 100, outputTokens: 30 })
    assert.deepEqual(readUsageCounts({ usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 200, output_tokens: 7 } }), { inputTokens: 215, cachedInputTokens: 200, outputTokens: 7 })
    assert.deepEqual(readUsageCounts({ prompt_eval_count: 40, eval_count: 9 }), { inputTokens: 40, cachedInputTokens: 0, outputTokens: 9 })
    assert.equal(readUsageCounts({ choices: [] }), null)
  })

  const target = { providerName: 'local', displayName: 'Local', endpoint: 'http://local.invalid/v1/chat/completions', apiKey: null, model: 'gemma', generation: {}, promptCacheMarks: false }
  const messages = [{ role: 'user' as const, content: '안녕, 오늘 날씨 어때?' }]
  const rows = () => db.prepare('SELECT purpose, engine, provider_name, model, profile_id, thread_id, input_tokens, cached_input_tokens, output_tokens, estimated, ok FROM llm_usage_events ORDER BY id').all() as Array<Record<string, unknown>>
  const sse = (...chunks: unknown[]) => new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })

  await t.test('a streamed reply with a usage chunk is recorded under its purpose', async () => {
    t.mock.method(globalThis, 'fetch', async () => sse(
      { choices: [{ delta: { content: '맑아.' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 50, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 32 } } },
    ))
    const result = await streamChatCompletion({ target, messages, signal: new AbortController().signal, usage: { purpose: 'chat', profileId: 3, threadId: 9 } })
    assert.equal(result.content, '맑아.')
    assert.deepEqual(result.usage, { inputTokens: 50, cachedInputTokens: 32, outputTokens: 4 })
    assert.deepEqual(rows().at(-1), { purpose: 'chat', engine: 'api', provider_name: 'local', model: 'gemma', profile_id: 3, thread_id: 9, input_tokens: 50, cached_input_tokens: 32, output_tokens: 4, estimated: 0, ok: 1 })
  })

  await t.test('a server without usage gets an estimate, marked as one; an untagged request is "other"', async () => {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{ message: { content: 'hello there' }, finish_reason: 'stop' }] }))
    await streamChatCompletion({ target, messages, signal: new AbortController().signal })
    const row = rows().at(-1)!
    assert.equal(row.purpose, 'other')
    assert.equal(row.estimated, 1)
    assert.ok(Number(row.input_tokens) > 0 && Number(row.output_tokens) > 0)
  })

  await t.test('a failed request counts as a failure; a stop by the caller is not counted', async () => {
    t.mock.method(globalThis, 'fetch', async () => new Response('boom', { status: 500 }))
    await assert.rejects(streamChatCompletion({ target, messages, signal: new AbortController().signal, usage: { purpose: 'summary' } }))
    assert.deepEqual([rows().at(-1)!.purpose, rows().at(-1)!.ok, rows().at(-1)!.input_tokens], ['summary', 0, 0])
    const before = rows().length
    const controller = new AbortController()
    t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
      controller.abort()
      init.signal?.throwIfAborted()
      throw new Error('unreachable')
    })
    await assert.rejects(streamChatCompletion({ target, messages, signal: controller.signal, usage: { purpose: 'chat' } }))
    assert.equal(rows().length, before)
  })

  await t.test('summary: local days by the viewer offset, totals, purposes and models', () => {
    db.prepare('DELETE FROM llm_usage_events').run()
    const insert = db.prepare('INSERT INTO llm_usage_events (created_at, purpose, engine, provider_name, model, input_tokens, output_tokens, latency_ms, ok, estimated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    const at = (hoursAgo: number) => (db.prepare(`SELECT datetime('now', ?) AS at`).get(`-${hoursAgo} hours`) as { at: string }).at
    insert.run(at(1), 'chat', 'api', 'local', 'gemma', 1000, 100, 2000, 1, 0)
    insert.run(at(2), 'judge', 'typesafe', 'jev', 'system-one', 200, 5, 400, 1, 0)
    insert.run(at(3), 'chat', 'api', 'local', 'gemma', 0, 0, 0, 0, 0)
    insert.run(at(30), 'translation', 'api', 'tr', 'qwen', 300, 300, 1000, 1, 1)
    insert.run(at(24 * 40), 'chat', 'api', 'local', 'gemma', 9999, 9999, 1, 1, 0)
    const summary = buildLlmUsageSummary(7, 540)
    assert.equal(summary.daily.length, 7)
    assert.equal(summary.daily.at(-1)!.date, (db.prepare(`SELECT date('now', '+540 minutes') AS d`).get() as { d: string }).d)
    assert.deepEqual(summary.totals, { requests: 4, failed: 1, inputTokens: 1500, cachedInputTokens: 0, outputTokens: 405, estimatedRequests: 1, averageLatencyMs: Math.round((2000 + 400 + 1000) / 3) })
    assert.equal(summary.daily.reduce((sum, day) => sum + day.requests, 0), 4)
    const purposes = new Map<string, number>()
    for (const entry of summary.byPurpose) purposes.set(entry.purpose, (purposes.get(entry.purpose) ?? 0) + entry.tokens)
    assert.deepEqual(Object.fromEntries(purposes), { chat: 1100, judge: 205, translation: 600 })
    assert.deepEqual(summary.models.map((model) => [model.providerName, model.model, model.engine, model.requests, model.failed]), [
      ['local', 'gemma', 'api', 2, 1],
      ['tr', 'qwen', 'api', 1, 0],
      ['jev', 'system-one', 'typesafe', 1, 0],
    ])
    recordLlmUsage({ purpose: 'workflow', engine: 'api', providerName: 'local', model: 'gemma', tokens: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 }, latencyMs: 5, ok: true })
    assert.equal(buildLlmUsageSummary(1, 540).totals.requests >= 1, true)
  })

  await t.test('judge stats average the tokens of runs that reported them', () => {
    const base = { threadId: null, profileId: null, presetId: 1, stage: 'before' as const, messageId: null, replyId: null, engine: 'typesafe' as const, providerName: 'jev', model: 'system-one', latencyMs: 300, error: null, request: {} }
    const item = { itemId: 'lore', name: '로어', stage: 'before' as const, tools: [], probability: 0.8, confidence: null, choice: null, verdict: 'yes' as const, decidedBy: 'judge' as const, action: 'none' as const }
    ChatJudgeLogStore.add({ ...base, tokens: 600, items: [item] })
    ChatJudgeLogStore.add({ ...base, tokens: 400, items: [item] })
    ChatJudgeLogStore.add({ ...base, tokens: null, items: [item] })
    const stats = ChatJudgeLogStore.stats({ days: 7 }).find((entry) => entry.itemId === 'lore')!
    assert.equal(stats.runs, 3)
    assert.equal(stats.averageTokens, 500)
  })
})
