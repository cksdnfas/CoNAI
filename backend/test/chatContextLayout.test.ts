import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChatProfile } from '../src/services/codex-chat/chatProfiles'
import { DEFAULT_CHAT_STYLE } from '../src/services/codex-chat/chatStyle'
import type { CodexChatMessageRecord, CodexChatThreadRecord } from '../src/services/codex-chat/codexChatStore'
import type { ChatCompletionMessage } from '../src/services/codex-chat/llmChatCompletion'
import { anchoredSuffix, buildChatMessages, depthBlocks, insertAtDepth, resolveAuthorNote, WINDOW_KEEP_RATIO } from '../src/services/codex-chat/llmChatContext'
import { normalizeLorebook } from '../src/services/codex-chat/chatLorebook'
import type { AttachedLoreBook } from '../src/services/codex-chat/chatLoreContext'

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
  authorNote: '',
  contextTurns: 20,
  contextTokens: null,
  maxTokens: null,
} as unknown as ChatProfile

function record(id: number, role: 'user' | 'assistant', content: string, flags: CodexChatMessageRecord['flags'] = []): CodexChatMessageRecord {
  return { id, thread_id: 7, role, content, speaker_profile_id: null, tool_calls: [], status: 'completed', error: null, alternatives: [], active_alternative: 0, flags, created_date: '2026-10-05 00:00:00' }
}

/** Books as booksForRequest resolves them, without a database: the chat's own book and a global one, no files. */
const books: AttachedLoreBook[] = [
  { id: 1, name: '바다 약속', label: '이 채팅', kind: 'chat', via: 'chat', owner: null, folderId: null, entries: normalizeLorebook([
    { title: '바다 약속', content: '{{char}}는 내일 저녁 바다에서\n반지를 받는다.', constant: true },
    { title: '먹물 실종', keys: ['먹물'], content: '고양이 먹물이 사흘째 안 보인다.' },
  ]) },
  { id: 2, name: '항구 도시 설정', label: '항구 도시 설정', kind: 'global', via: 'profile', owner: null, folderId: null, entries: normalizeLorebook([{ keys: ['항구'], content: '항구 도시.' }]) },
]

test('a request is: system prompt, lore index + always-on entries + summary, examples, the unsummarized turns, flags on the last message', () => {
  const thread = { id: 7, summary: '둘은 친해졌다.', summary_until_message_id: 2, context_turns: null, summary_enabled: 1, memories: JSON.stringify([{ id: 'a', text: '옛 고정 기억' }]) } as unknown as CodexChatThreadRecord
  const messages = [
    record(1, 'user', '처음'), record(2, 'assistant', '응'),
    record(3, 'user', '오늘 뭐 해?'), record(4, 'assistant', '산책'),
    record(5, 'user', '같이 갈까?', [{ id: 1, icon: '', name: '짧게', content: '짧게 답해' }]),
  ]
  const config = { contextTurns: 20, contextTokens: null, replyReserveTokens: 2048, summaryEnabled: true, summaryTriggerTurns: 6, summaryPrompt: '요약해' }
  const result = buildChatMessages({ profile, thread, messages, config, tools: [], books })

  assert.deepEqual(result.map((message) => message.role), ['system', 'system', 'user', 'assistant', 'user', 'assistant', 'user'])
  assert.match(String(result[0].content), /^너는 카이야\./)
  assert.equal(result[1].content, [
    '## 로어북 목차',
    '[이 채팅] 바다 약속 · 먹물 실종',
    '[항구 도시 설정] 항구',
    '(본문은 키워드가 나오면 참고 설정으로 간다.)',
    '',
    '## 상시 항목',
    '- 바다 약속: 카이는 내일 저녁 바다에서 반지를 받는다.',
    '',
    '## 지금까지의 대화 요약',
    '둘은 친해졌다.',
  ].join('\n'), 'pinned memories on the thread are no longer read')
  // The persona prompt does not change with the books: what a server cached stays valid.
  assert.equal(buildChatMessages({ profile, thread, messages, config, tools: [], books: [] })[0].content, result[0].content)
  assert.deepEqual([result[2].content, result[3].content], ['안녕', '반가워'])
  assert.deepEqual([result[4].content, result[5].content], ['[message_id=3; from=user]\n오늘 뭐 해?', '[message_id=4; from=assistant]\n산책'], 'turns up to the summary are left out')
  assert.equal(result[6].content, '[message_id=5; from=user]\n같이 갈까?\n\nCurrent room_id: 7.\n\n[사용자 지시: 이번 메시지에 적용]\n- 짧게 답해')
})

test("a keyword entry of an attached book goes into [참고 설정] at the lore depth, not into the system messages", () => {
  const thread = { id: 9, summary: null, summary_until_message_id: null, context_turns: null, summary_enabled: null } as unknown as CodexChatThreadRecord
  const messages = [record(1, 'user', '먹물 봤어?'), record(2, 'assistant', '아니'), record(3, 'user', '찾아보자')]
  const config = { contextTurns: 20, contextTokens: null, replyReserveTokens: 2048, summaryEnabled: false, summaryTriggerTurns: 6, summaryPrompt: '요약해' }
  const result = buildChatMessages({ profile, thread, messages, config, tools: [], books })
  assert.ok(!JSON.stringify(result.filter((message) => message.role === 'system')).includes('사흘째'))
  assert.deepEqual(userContents(result.slice(4)), ['[참고 설정]\n고양이 먹물이 사흘째 안 보인다.\n[/참고 설정]\n\n[message_id=1; from=user]\n먹물 봤어?', '[message_id=3; from=user]\n찾아보자\n\nCurrent room_id: 9.'])
})

// ---- Author's note ---------------------------------------------------------------------------------------------

const noteProfile = { ...profile, authorNote: '{{char}}는 오늘 들떠 있다.' } as unknown as ChatProfile

test("a chat's own note replaces the profile's default; the depth falls back to the lore depth", () => {
  assert.deepEqual(resolveAuthorNote(null, noteProfile), { text: '카이는 오늘 들떠 있다.', depth: 4 })
  assert.deepEqual(resolveAuthorNote({ author_note: '  ', author_note_depth: null }, noteProfile), { text: '카이는 오늘 들떠 있다.', depth: 4 })
  assert.deepEqual(resolveAuthorNote({ author_note: '비가 온다.', author_note_depth: 1 }, noteProfile), { text: '비가 온다.', depth: 1 })
  assert.deepEqual(resolveAuthorNote(null, profile), { text: '', depth: 4 })
})

test('lore and note share one block at the same depth, two blocks otherwise', () => {
  const lore = { keyed: '카이는 왼손잡이다.' }
  assert.deepEqual(depthBlocks(lore, 4, { text: '비가 온다.', depth: 4 }), [{ depth: 4, block: '[참고 설정]\n카이는 왼손잡이다.\n\n## 작가 노트\n비가 온다.\n[/참고 설정]' }])
  assert.deepEqual(depthBlocks(lore, 4, { text: '비가 온다.', depth: 0 }), [
    { depth: 4, block: '[참고 설정]\n카이는 왼손잡이다.\n[/참고 설정]' },
    { depth: 0, block: '[참고 설정]\n## 작가 노트\n비가 온다.\n[/참고 설정]' },
  ])
  assert.deepEqual(depthBlocks({ keyed: '' }, 4, { text: '비가 온다.', depth: 2 }), [{ depth: 2, block: '[참고 설정]\n## 작가 노트\n비가 온다.\n[/참고 설정]' }])
  assert.deepEqual(depthBlocks({ keyed: '' }, 4, { text: '', depth: 2 }), [])
})

test("the chat's note lands in the conversation at its depth", () => {
  const thread = { id: 8, summary: null, summary_until_message_id: null, context_turns: null, summary_enabled: null, author_note: '비가 온다.', author_note_depth: 1 } as unknown as CodexChatThreadRecord
  const messages = [record(1, 'user', '처음'), record(2, 'assistant', '응'), record(3, 'user', '오늘 뭐 해?'), record(4, 'assistant', '산책'), record(5, 'user', '같이 갈까?')]
  const config = { contextTurns: 20, contextTokens: null, replyReserveTokens: 2048, summaryEnabled: false, summaryTriggerTurns: 6, summaryPrompt: '요약해' }
  const result = buildChatMessages({ profile: noteProfile, thread, messages, config, tools: [], books: [] })
  assert.deepEqual(userContents(result.slice(3)), ['[message_id=1; from=user]\n처음', '[참고 설정]\n## 작가 노트\n비가 온다.\n[/참고 설정]\n\n[message_id=3; from=user]\n오늘 뭐 해?', '[message_id=5; from=user]\n같이 갈까?\n\nCurrent room_id: 8.'])
})
