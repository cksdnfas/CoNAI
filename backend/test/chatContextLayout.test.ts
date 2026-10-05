import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChatProfile } from '../src/services/codex-chat/chatProfiles'
import { DEFAULT_CHAT_STYLE } from '../src/services/codex-chat/chatStyle'
import type { CodexChatMessageRecord, CodexChatThreadRecord } from '../src/services/codex-chat/codexChatStore'
import type { ChatCompletionMessage } from '../src/services/codex-chat/llmChatCompletion'
import { anchoredSuffix, buildChatMessages, insertAtDepth, WINDOW_KEEP_RATIO } from '../src/services/codex-chat/llmChatContext'

const BLOCK = '[참고 설정]\n카이는 왼손잡이다.\n[/참고 설정]'

/** `turns` user/assistant pairs: u1 a1 u2 a2 … */
function conversation(turns: number): ChatCompletionMessage[] {
  return Array.from({ length: turns }, (_, index) => [
    { role: 'user' as const, content: `u${index + 1}` },
    { role: 'assistant' as const, content: `a${index + 1}` },
  ]).flat()
}

const userContents = (messages: ChatCompletionMessage[]) => messages.filter((message) => message.role === 'user').map((message) => message.content)

test('depth 0 puts the lore in front of the latest user message', () => {
  const result = insertAtDepth(conversation(3), 0, BLOCK)
  assert.deepEqual(userContents(result), ['u1', 'u2', `${BLOCK}\n\nu3`])
  assert.equal(result.length, 6)
})

test('depth N lands N turns earlier and leaves the other messages untouched', () => {
  const original = conversation(6)
  const result = insertAtDepth(original, 4, BLOCK)
  assert.deepEqual(userContents(result), ['u1', `${BLOCK}\n\nu2`, 'u3', 'u4', 'u5', 'u6'])
  assert.deepEqual(userContents(original), ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'], 'the input is not mutated')
  assert.deepEqual(result.filter((message) => message.role === 'assistant'), original.filter((message) => message.role === 'assistant'))
})

test('a depth beyond the conversation lands on its oldest user message', () => {
  assert.deepEqual(userContents(insertAtDepth(conversation(2), 10, BLOCK)), [`${BLOCK}\n\nu1`, 'u2'])
})

test('without a user message the block becomes one; an empty block changes nothing', () => {
  const greetingOnly: ChatCompletionMessage[] = [{ role: 'assistant', content: '안녕!' }]
  assert.deepEqual(insertAtDepth(greetingOnly, 4, BLOCK), [...greetingOnly, { role: 'user', content: BLOCK }])
  const messages = conversation(2)
  assert.equal(insertAtDepth(messages, 4, ''), messages)
})

test('multimodal user content gets the block as a leading text part', () => {
  const image = { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,AAAA' } }
  const result = insertAtDepth([{ role: 'user', content: [{ type: 'text', text: '이거 봐' }, image] }], 0, BLOCK)
  assert.deepEqual(result[0], { role: 'user', content: [{ type: 'text', text: BLOCK }, { type: 'text', text: '이거 봐' }, image] })
})

// ---- Window start ---------------------------------------------------------------------------------------------

const ids = (count: number, from = 1) => Array.from({ length: count }, (_, index) => ({ id: from + index }))
const idOf = (item: { id: number }) => item.id

test('everything is sent while it fits, anchored at the first item', () => {
  const result = anchoredSuffix(ids(5), 20, idOf, undefined)
  assert.equal(result.window.length, 5)
  assert.equal(result.anchorId, 1)
  assert.deepEqual(anchoredSuffix([], 20, idOf, 3), { window: [], anchorId: undefined })
})

test('on overflow the window jumps to the keep share of what fits and then holds its start', () => {
  const fit = 20
  const keep = Math.floor(fit * WINDOW_KEEP_RATIO)
  assert.equal(keep, 15)
  let anchor: number | undefined
  const starts: number[] = []
  for (let total = 1; total <= 40; total += 1) {
    const result = anchoredSuffix(ids(total), fit, idOf, anchor)
    anchor = result.anchorId
    assert.ok(result.window.length <= fit, `turn ${total}: ${result.window.length} sent`)
    assert.ok(result.window.length >= Math.min(total, keep), `turn ${total}: only ${result.window.length} sent`)
    assert.equal(result.window[result.window.length - 1].id, total, 'the newest item is always sent')
    starts.push(result.window[0].id)
  }
  // 1..20 fit whole; 21 jumps to 7..21 (15 items); the start then holds through 26 (20 items) and jumps again at 27.
  assert.deepEqual(starts.slice(0, 20), Array(20).fill(1))
  assert.deepEqual(starts.slice(20, 27), [7, 7, 7, 7, 7, 7, 13])
  assert.equal(new Set(starts).size, 5, 'the start moved 4 times in 40 turns instead of 20')
})

test('a remembered start that would send too little (limit raised, items removed) is dropped', () => {
  const result = anchoredSuffix(ids(21), 20, idOf, 20)
  assert.deepEqual(result.window.map(idOf), ids(15, 7).map(idOf))
  assert.equal(result.anchorId, 7)
})

test('an anchor that no longer exists (edited away) is recalculated', () => {
  const result = anchoredSuffix(ids(21), 20, idOf, 999)
  assert.equal(result.window[0].id, 7)
})

test('a fit below one still sends the newest item', () => {
  const result = anchoredSuffix(ids(3), 0, idOf, undefined)
  assert.deepEqual(result.window.map(idOf), [3])
})

// ---- Whole request ---------------------------------------------------------------------------------------------

const profile = {
  id: 1,
  name: '카이',
  systemPrompt: '너는 카이야.',
  promptSections: [{ id: 'ex', title: '예시', content: '사용자: 안녕\n카이: 반가워', kind: 'dialogue', enabled: true }],
  style: DEFAULT_CHAT_STYLE,
  lorebookIds: [],
  loreScanDepth: 4,
  loreTokenBudget: 1024,
  loreDepth: 4,
  contextTurns: 20,
  contextTokens: null,
  maxTokens: null,
} as unknown as ChatProfile

function record(id: number, role: 'user' | 'assistant', content: string, flags: CodexChatMessageRecord['flags'] = []): CodexChatMessageRecord {
  return { id, thread_id: 7, role, content, speaker_profile_id: null, tool_calls: [], status: 'completed', error: null, alternatives: [], active_alternative: 0, flags, created_date: '2026-10-05 00:00:00' }
}

test('a request is: system prompt, summary, examples, the unsummarized turns, flags on the last message', () => {
  const thread = { id: 7, summary: '둘은 친해졌다.', summary_until_message_id: 2, context_turns: null, summary_enabled: 1 } as unknown as CodexChatThreadRecord
  const messages = [
    record(1, 'user', '처음'), record(2, 'assistant', '응'),
    record(3, 'user', '오늘 뭐 해?'), record(4, 'assistant', '산책'),
    record(5, 'user', '같이 갈까?', [{ id: 1, icon: '', name: '짧게', content: '짧게 답해' }]),
  ]
  const config = { contextTurns: 20, contextTokens: null, replyReserveTokens: 2048, summaryEnabled: true, summaryTriggerTurns: 6, summaryPrompt: '요약해' }
  const result = buildChatMessages({ profile, thread, messages, config, tools: [] })

  assert.deepEqual(result.map((message) => message.role), ['system', 'system', 'user', 'assistant', 'user', 'assistant', 'user'])
  assert.match(String(result[0].content), /^너는 카이야\./)
  assert.equal(result[1].content, '## 지금까지의 대화 요약\n둘은 친해졌다.')
  assert.deepEqual([result[2].content, result[3].content], ['안녕', '반가워'])
  assert.deepEqual([result[4].content, result[5].content], ['오늘 뭐 해?', '산책'], 'turns up to the summary are left out')
  assert.equal(result[6].content, '같이 갈까?\n\n[사용자 지시: 이번 메시지에 적용]\n- 짧게 답해')
})
