import './support/testTemp'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChatProfile } from '../src/services/codex-chat/chatProfiles'
import { DEFAULT_CHAT_STYLE } from '../src/services/codex-chat/chatStyle'
import type { CodexChatMessageRecord, CodexChatThreadRecord } from '../src/services/codex-chat/codexChatStore'
import type { ChatCompletionMessage } from '../src/services/codex-chat/llmChatCompletion'
import { buildChatMessages, depthBlocks, directContextTurns, insertAtDepth, latestWindow, resolveAuthorNote, type ChatContextMeta } from '../src/services/codex-chat/llmChatContext'
import { contextHash, contextSections } from '../src/services/codex-chat/chatContextDiagnostics'
import { loadChatSettings } from '../src/services/codex-chat/chatSettings'
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

// ---- Window ---------------------------------------------------------------------------------------------------

const ids = (count: number, from = 1) => Array.from({ length: count }, (_, index) => ({ id: from + index }))
const idOf = (item: { id: number }) => item.id

test('everything is sent while it fits', () => {
  assert.equal(latestWindow(ids(5), 20).length, 5)
  assert.deepEqual(latestWindow([], 20), [])
})

test('past the setting the window always holds exactly as many as it says, the latest ones', () => {
  // A 15-turn setting: every request carries the latest 15, moving one at a time (never fewer while there are more).
  for (let total = 16; total <= 40; total += 1) {
    const window = latestWindow(ids(total), 15).map(idOf)
    assert.deepEqual(window, ids(15, total - 14).map(idOf), `turn ${total}`)
  }
})

test('a fit below one still sends the newest item', () => {
  assert.deepEqual(latestWindow(ids(3), 0).map(idOf), [3])
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

test('direct automatic continuations retain turn results and events while replaying the plan only once', () => {
  const thread = { id: 7, summary: null, summary_until_message_id: null } as CodexChatThreadRecord
  const plan = 'Full repeated task plan. '.repeat(80)
  const task = { id: 10, step: 1, total: 3, title: 'Read sources', event: 'previous attempt failed' }
  const messages = [
    { ...record(1, 'user', `${plan} old budget`), routing: { replyTo: null, recipients: [], task } },
    record(2, 'assistant', 'Source read failed: access denied.'),
    { ...record(3, 'user', `${plan} latest budget`), routing: { replyTo: null, recipients: [], task: { ...task, step: 2, event: 'retry' } } },
  ]
  const config = { contextTurns: 20, contextTokens: null, replyReserveTokens: 2048, summaryEnabled: false, summaryTriggerTurns: 6, summaryPrompt: '' }
  const result = buildChatMessages({ profile: { ...profile, promptSections: [] }, thread, messages, config, tools: [], books: [] })
  assert.deepEqual(result.map((message) => message.role), ['system', 'user', 'assistant', 'user'])
  assert.match(String(result[1].content), /previous attempt failed/)
  assert.doesNotMatch(String(result[1].content), /Full repeated task plan/)
  assert.match(String(result[2].content), /access denied/)
  assert.match(String(result[3].content), /latest budget/)
  assert.equal(messages[0].content, `${plan} old budget`, 'stored history remains intact for summaries and explicit references')
  assert.deepEqual(directContextTurns(messages, thread, { ...config, contextTurns: 1 }).flat().map((message) => message.id), [3])
  assert.deepEqual(directContextTurns(messages, { ...thread, summary_until_message_id: 2 }, { ...config, summaryEnabled: true }).flat().map((message) => message.id), [3])
})

test('different routine payloads remain intact; identical repeats keep their turn boundaries', () => {
  const routine = { source: 'workflow' as const, id: 2, name: 'feed' }
  const messages = ['same instruction '.repeat(40), 'new data '.repeat(40), 'same instruction '.repeat(40)]
    .map((content, index) => ({ ...record(index + 1, 'user', content), routing: { replyTo: null, recipients: [], routine } }))
  const turns = directContextTurns(messages, { summary_until_message_id: null }, { contextTurns: 20, summaryEnabled: false })
  assert.equal(turns.length, 3)
  assert.match(turns[0][0].content, /Repeated automatic instruction/)
  assert.equal(turns[1][0].content, messages[1].content)
  assert.equal(turns[2][0].content, messages[2].content)
})

test('diagnostic sections preserve the actual message positions and roles without storing text', () => {
  const thread = { id: 700, summary: null, summary_until_message_id: null } as CodexChatThreadRecord
  let meta: ChatContextMeta | undefined
  const result = buildChatMessages({ profile, thread, messages: [record(1, 'user', '먹물 봤어?')],
    config: { contextTurns: 20, contextTokens: null, replyReserveTokens: 2048, maxTokens: null, summaryEnabled: false, summaryTriggerTurns: 6, summaryPrompt: '' },
    tools: [], books, onMeta: (value) => { meta = value } })
  const sections = contextSections(result, [], (text) => text.length)
  assert.equal(meta?.version, loadChatSettings().diagnostics.enabled ? 2 : undefined)
  assert.equal(sections.length, result.length)
  assert.ok(sections[0].parts?.some((part) => part.kind === 'system-prompt'))
  assert.deepEqual(sections.map(({ position, role }) => [position, role]), result.map((message, position) => [position, message.role]))
  assert.deepEqual(sections.map(({ hash }) => hash), result.map((message) => contextHash(String(message.content))))
  assert.deepEqual(meta?.lore, ['바다 약속', '먹물 실종'])
  if (meta?.version === 2) assert.equal(meta.loreEntries?.find((entry) => entry.entryId === books[0].entries[1].id)?.reason, 'key:먹물')
  assert.ok(!JSON.stringify(meta).includes('사흘째 안 보인다'))
})

test('a request is: one system message (persona, then lore index + always-on entries + summary), examples, the unsummarized turns, flags on the last message', () => {
  const thread = { id: 7, summary: '둘은 친해졌다.', summary_until_message_id: 2, context_turns: null, summary_enabled: 1, memories: JSON.stringify([{ id: 'a', text: '옛 고정 기억' }]) } as unknown as CodexChatThreadRecord
  const messages = [
    record(1, 'user', '처음'), record(2, 'assistant', '응'),
    record(3, 'user', '오늘 뭐 해?'), record(4, 'assistant', '산책'),
    record(5, 'user', '같이 갈까?', [{ id: 1, icon: '', name: '짧게', content: '짧게 답해' }]),
  ]
  const config = { contextTurns: 20, contextTokens: null, replyReserveTokens: 2048, summaryEnabled: true, summaryTriggerTurns: 6, summaryPrompt: '요약해' }
  const result = buildChatMessages({ profile, thread, messages, config, tools: [], books })

  // Chat templates such as Qwen's reject a system message that is not the first one.
  assert.deepEqual(result.map((message) => message.role), ['system', 'user', 'assistant', 'user', 'assistant', 'user'])
  assert.match(String(result[0].content), /^너는 카이야\./)
  // The persona prompt leads and does not change with the books or the summary: what a server cached stays valid.
  const persona = String(buildChatMessages({ profile, thread, messages, config: { ...config, summaryEnabled: false }, tools: [], books: [] })[0].content)
  assert.equal(result[0].content, `${persona}\n\n${[
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
  ].join('\n')}`, 'pinned memories on the thread are no longer read')
  assert.deepEqual([result[1].content, result[2].content], ['안녕', '반가워'])
  assert.deepEqual([result[3].content, result[4].content], ['[message_id=3; from=user]\n오늘 뭐 해?', '[message_id=4; from=assistant]\n산책'], 'turns up to the summary are left out')
  // A direct chat has no room tools, so no room id either.
  assert.equal(result[5].content, '[message_id=5; from=user]\n같이 갈까?\n\n[사용자 지시: 이번 메시지에 적용]\n- 짧게 답해')
})

test('dialogue marked as history follows the examples without the example note; unlabelled dialogue joins after the text sections', () => {
  const thread = { id: 7, summary: null, summary_until_message_id: null } as CodexChatThreadRecord
  const config = { contextTurns: 20, contextTokens: null, replyReserveTokens: 2048, summaryEnabled: false, summaryTriggerTurns: 6, summaryPrompt: '' }
  const seeded = { id: 'seed', title: '지난 대화', content: '사용자: 어제 바다 갔지?\n카이: 응, 노을 봤어', kind: 'dialogue', enabled: true, asHistory: true }
  const run = (promptSections: unknown[]) => buildChatMessages({ profile: { ...profile, promptSections } as unknown as ChatProfile, thread, messages: [record(1, 'user', '오늘은?')], config, tools: [], books: [] })

  const both = run([seeded, ...profile.promptSections])
  assert.deepEqual(both.slice(1, 5).map((message) => message.content), ['안녕', '반가워', '어제 바다 갔지?', '응, 노을 봤어'])
  assert.match(String(both[0].content), /첫 2개 user\/assistant 메시지는 말투와 형식을 보여주는 예시일 뿐/, 'the note says where the examples end')
  assert.match(String(run(profile.promptSections)[0].content), /첫 user\/assistant 대화들은 말투와 형식을 보여주는 예시일 뿐/)
  const onlySeeded = run([seeded])
  assert.doesNotMatch(String(onlySeeded[0].content), /예시일 뿐/)
  assert.deepEqual(onlySeeded.slice(1, 3).map((message) => message.content), ['어제 바다 갔지?', '응, 노을 봤어'])

  const system = String(run([{ id: 'memo', title: '말투', content: '짧게 말해.', kind: 'dialogue', enabled: true }, { id: 'world', title: '세계', content: '항구 도시.', kind: 'text', enabled: true }])[0].content)
  assert.ok(system.indexOf('## 세계') < system.indexOf('## 말투'))
})

test("a keyword entry of an attached book goes into [참고 설정] at the lore depth, not into the system messages", () => {
  const thread = { id: 9, summary: null, summary_until_message_id: null, context_turns: null, summary_enabled: null } as unknown as CodexChatThreadRecord
  const messages = [record(1, 'user', '먹물 봤어?'), record(2, 'assistant', '아니'), record(3, 'user', '찾아보자')]
  const config = { contextTurns: 20, contextTokens: null, replyReserveTokens: 2048, summaryEnabled: false, summaryTriggerTurns: 6, summaryPrompt: '요약해' }
  const result = buildChatMessages({ profile, thread, messages, config, tools: [], books })
  assert.ok(!JSON.stringify(result.filter((message) => message.role === 'system')).includes('사흘째'))
  assert.deepEqual(userContents(result.slice(3)), ['[참고 설정]\n고양이 먹물이 사흘째 안 보인다.\n[/참고 설정]\n\n[message_id=1; from=user]\n먹물 봤어?', '[message_id=3; from=user]\n찾아보자'])
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
  assert.deepEqual(userContents(result.slice(3)), ['[message_id=1; from=user]\n처음', '[참고 설정]\n## 작가 노트\n비가 온다.\n[/참고 설정]\n\n[message_id=3; from=user]\n오늘 뭐 해?', '[message_id=5; from=user]\n같이 갈까?'])
})
