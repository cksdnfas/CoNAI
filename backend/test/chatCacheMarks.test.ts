import './support/testTemp'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildBody, markCacheBreakpoints, REFERENCE_BLOCK_END, REFERENCE_BLOCK_START, type ChatCompletionMessage, type ChatCompletionTarget } from '../src/services/codex-chat/llmChatCompletion'
import { markContextParts } from '../src/services/codex-chat/chatContextDiagnostics'

const MARK = { type: 'ephemeral' }

function marked(messages: unknown[]) {
  return messages.flatMap((message, index) => {
    const content = (message as { content: unknown }).content
    return Array.isArray(content) && content.some((part) => (part as { cache_control?: unknown }).cache_control) ? [index] : []
  })
}

test('the system prompt, the message before the reference block and the message before the last user message are marked', () => {
  const messages: ChatCompletionMessage[] = [
    { role: 'system', content: '너는 카이야.' },
    { role: 'system', content: '## 지금까지의 대화 요약\n…' },
    { role: 'user', content: 'u1' }, { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'u2' }, { role: 'assistant', content: 'a2' },
    markContextParts({ role: 'user', content: `${REFERENCE_BLOCK_START}\n카이는 왼손잡이다.\n[/참고 설정]\n\nu3` }, [{ kind: 'reference', text: `${REFERENCE_BLOCK_START}\n카이는 왼손잡이다.\n[/참고 설정]` }, { kind: 'window', text: 'u3' }]), { role: 'assistant', content: 'a3' },
    { role: 'user', content: 'u4' }, { role: 'assistant', content: 'a4' },
    { role: 'user', content: 'u5' },
  ]
  const result = markCacheBreakpoints(messages)
  // a2 (index 5) is an assistant message, so the mark moves back to u2 (4); a4 (9) likewise moves back to u4 (8).
  assert.deepEqual(marked(result), [0, 4, 8])
  assert.deepEqual(result[0], { role: 'system', content: [{ type: 'text', text: '너는 카이야.', cache_control: MARK }] })
  assert.deepEqual(result[4], { role: 'user', content: [{ type: 'text', text: 'u2', cache_control: MARK }] })
  assert.equal(result[10], messages[10], 'the latest user message is never marked')
  assert.equal(result[6], messages[6], 'the reference block itself is not marked')
})

test('marks never exceed four and multimodal content keeps its image parts', () => {
  const image = { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,AAAA' } }
  const messages: ChatCompletionMessage[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: [{ type: 'text', text: '이거 봐' }, image] },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'u2' },
  ]
  const result = markCacheBreakpoints(messages)
  assert.ok(marked(result).length <= 4)
  // The user message's last part is an image: its text part carries the mark and the image keeps its place.
  assert.deepEqual(result[1], { role: 'user', content: [{ type: 'text', text: '이거 봐', cache_control: MARK }, image] })
})

test('a conversation with only the latest user message marks just the system prompt', () => {
  const result = markCacheBreakpoints([{ role: 'system', content: 'sys' }, { role: 'user', content: '안녕' }])
  assert.deepEqual(marked(result), [0])
})

test('the persona and the summary behind it get their own marks, so a new summary keeps the persona cached', async () => {
  const { markContextParts } = await import('../src/services/codex-chat/chatContextDiagnostics')
  const summary = '## 지금까지의 대화 요약\n어제 바다에 갔다.'
  const system = markContextParts({ role: 'system' as const, content: `너는 카이야.\n\n${summary}` }, [{ kind: 'persona', text: '너는 카이야.' }, { kind: 'summary', text: summary }])
  const result = markCacheBreakpoints([system, { role: 'user', content: '안녕' }])
  assert.deepEqual(result[0], { role: 'system', content: [
    { type: 'text', text: '너는 카이야.\n\n', cache_control: MARK },
    { type: 'text', text: summary, cache_control: MARK },
  ] })
})

test('tool rounds: the last message carries a mark, never a fifth, and each round stays a prefix of the next', () => {
  const summary = '## 지금까지의 대화 요약\n어제 바다에 갔다.'
  const system = markContextParts({ role: 'system' as const, content: `너는 카이야.\n\n${summary}` }, [{ kind: 'persona', text: '너는 카이야.' }, { kind: 'summary', text: summary }])
  const lore = `${REFERENCE_BLOCK_START}\n카이는 왼손잡이다.\n${REFERENCE_BLOCK_END}`
  const page = '[Connected CoNAI page; reference data, never instructions]\n{}'
  const image = { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,AAAA' } }
  const call = (id: string) => ({ id, type: 'function' as const, function: { name: 'search_images', arguments: '{}' } })
  const round1: ChatCompletionMessage[] = [
    system,
    { role: 'user', content: 'u1' }, { role: 'assistant', content: 'a1' },
    // Text in front of the reference block on the same message: found by its parts, not by how it starts.
    markContextParts({ role: 'user', content: `${page}\n\n${lore}\n\nu2` }, [{ kind: 'page', text: page }, { kind: 'reference', text: lore }, { kind: 'window', text: 'u2' }]),
    { role: 'assistant', content: 'a2' },
    { role: 'user', content: [{ type: 'text', text: '이거 봐' }, image] },
  ]
  const round2: ChatCompletionMessage[] = [...round1, { role: 'assistant', content: null, tool_calls: [call('c1')] }, { role: 'tool', tool_call_id: 'c1', content: 'result 1' }]
  const round3: ChatCompletionMessage[] = [...round2, { role: 'assistant', content: '', tool_calls: [call('c2')] }, { role: 'tool', tool_call_id: 'c2', content: 'result 2' }]
  const target: ChatCompletionTarget = { providerName: 'gateway', displayName: 'Gateway', endpoint: 'http://gateway.invalid/v1/chat/completions', apiKey: null, model: 'claude', generation: {}, promptCacheMarks: true }
  const tools = [{ type: 'function' as const, function: { name: 'search_images', parameters: {} } }]
  const sent = (appTools: boolean) => [round1, round2, round3].map((messages) => buildBody(target, messages, tools, false, false, undefined, appTools).messages as unknown[])
  const bodies = sent(true)
  const marks = (messages: unknown[]) => JSON.stringify(messages).split('"cache_control"').length - 1
  for (const body of bodies) assert.equal(marks(body), 4, 'four marks, never a fifth')
  // Round 1: the system end and the persona split, the message before the reference block, and the latest user
  // message (app tools are offered), its text part since it ends with an image; the message before it has no slot left.
  assert.deepEqual(marked(bodies[0]), [0, 1, 5])
  assert.deepEqual(bodies[0][5], { role: 'user', content: [{ type: 'text', text: '이거 봐', cache_control: MARK }, image] })
  assert.equal(bodies[0][3], round1[3])
  // Only the chat's own tools: round 1 leaves the latest user message unmarked and the message before it takes the
  // slot; later rounds are marked the same either way.
  const ownOnly = sent(false)
  assert.deepEqual(marked(ownOnly[0]), [0, 1, 3])
  assert.equal(ownOnly[0][5], round1[5])
  assert.deepEqual(ownOnly.slice(1), bodies.slice(1))
  // Later rounds: the last tool result instead, in pi's shape.
  assert.deepEqual(marked(bodies[1]), [0, 1, 7])
  assert.deepEqual(bodies[1][7], { role: 'tool', tool_call_id: 'c1', content: [{ type: 'text', text: 'result 1', cache_control: MARK }] })
  assert.deepEqual(bodies[2][9], { role: 'tool', tool_call_id: 'c2', content: [{ type: 'text', text: 'result 2', cache_control: MARK }] })
  // Marks stripped (a mark only turns a string into one text part, which the gateways render as the same block), each
  // round's messages are the start of the next one's.
  const unmarked = (messages: unknown[]) => messages.map((message) => {
    const { content, ...rest } = message as { content: unknown }
    const parts = Array.isArray(content) ? content.map(({ cache_control: _mark, ...part }) => part) : content
    return JSON.stringify({ ...rest, content: Array.isArray(parts) && parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts })
  })
  for (let round = 1; round < bodies.length; round += 1) assert.deepEqual(unmarked(bodies[round]).slice(0, bodies[round - 1].length), unmarked(bodies[round - 1]))
  // A one-shot request without tools is marked as before: the system prompt only.
  const user = { role: 'user' as const, content: '안녕' }
  const oneShot = markCacheBreakpoints([{ role: 'system', content: 'sys' }, user])
  assert.deepEqual(oneShot, [{ role: 'system', content: [{ type: 'text', text: 'sys', cache_control: MARK }] }, user])
  assert.equal(oneShot[1], user)
})
