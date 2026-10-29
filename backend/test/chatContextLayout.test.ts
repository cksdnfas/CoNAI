import './support/testTemp'
import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
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

test('new chats and resets save the filled history around the greeting as ordinary conversation', async (t) => {
  // runtimePaths gives this test process a scratch root (support/testTemp is imported first).
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  t.after(async () => {
    dbModule.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
  })
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { AuthAccount } = await import('../src/models/AuthAccount')
  const { AuthAccessControlService } = await import('../src/services/authAccessControlService')
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { ChatUserProfileStore } = await import('../src/services/codex-chat/chatUserProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { CodexChatService, codexHistoryRecap } = await import('../src/services/codex-chat/codexChatService')
  const { GroupChatService } = await import('../src/services/codex-chat/groupChatService')
  const { buildClaudeSessionTurn } = await import('../src/services/codex-chat/claudeChatSessions')
  const { piPromptInput } = await import('../src/services/codex-chat/piChatCompletion')
  const { userPersonaOf } = await import('../src/services/codex-chat/chatUserProfiles')
  t.mock.method(AuthAccount, 'findById', (id: number) => ({ id, status: 'active', account_type: 'admin' }) as never)
  t.mock.method(AuthAccessControlService, 'resolveForAccountId', () => ({ permissionKeys: ['chat.use', 'chat.agent.use'] }))
  t.mock.method(Math, 'random', () => 0.5)
  updateChatSettings({ enabled: true })
  ExternalApiProvider.create({ provider_name: 'opening', display_name: 'Opening', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const requester = { accountId: 1, accountType: 'admin' as const }
  const user = ChatUserProfileStore.create(1, { name: '민준', persona: '' })
  const config = { contextTurns: 20, contextTokens: null, replyReserveTokens: 2048, summaryEnabled: false, summaryTriggerTurns: 6, summaryPrompt: '' }
  const openingHistory = [{ role: 'user' as const, content: '{{char}}, 나는 {{user}}야.' }, { role: 'assistant' as const, content: '{{user}}, 어서 와. {{char}}는 웃었다.' }]
  const expected = [
    { role: 'user', content: '카이, 나는 민준야.' },
    { role: 'assistant', content: '다시 만난 민준, 나는 카이.' },
    { role: 'assistant', content: '민준, 어서 와. 카이는 웃었다.' },
  ]
  for (const engine of ['llm', 'codex', 'claude', 'pi'] as const) {
    const saved = ChatProfileStore.create({ name: '카이', engine: engine === 'pi' ? 'llm' : engine, llmRuntime: engine === 'pi' ? 'pi' : 'direct', providerName: 'opening',
      greeting: '안녕 {{user}}', alternateGreetings: ['다시 만난 {{user}}, 나는 {{char}}.'], openingHistory, greetingPosition: 1, promptSections: profile.promptSections })
    const preview = CodexChatService.previewGreeting(requester, saved.id, user.id)
    assert.deepEqual(preview.before, expected.slice(0, 1))
    assert.deepEqual(preview.after, expected.slice(2))
    assert.equal(preview.text, expected[1].content)
    const thread = CodexChatService.createThread(requester, saved.id, user.id, preview.index)
    const messages = () => CodexChatStore.listMessages(thread.id)
    const checkOpening = () => {
      assert.deepEqual(messages().map(({ role, content }) => ({ role, content })), expected, engine)
      assert.ok(messages().every((message) => message.status === 'completed'))
      assert.equal(messages()[1].active_alternative, preview.index)
      assert.deepEqual(messages()[1].alternatives.map(({ content }) => content), preview.greetings)
    }
    checkOpening()
    const latest = CodexChatStore.addMessage({ thread_id: thread.id, role: 'user', content: '오늘은?', tool_calls: [], status: 'completed', error: null })
    const historySource = { threadId: thread.id }
    if (engine === 'llm') {
      const run = (options = config, current = thread) => buildChatMessages({ profile: saved, thread: current, messages: messages(), config: options, tools: [], books: [], user: userPersonaOf(user) })
      const sent = run()
      assert.match(String(sent[0].content), /첫 user\/assistant 대화들은 말투와 형식을 보여주는 예시일 뿐/)
      assert.deepEqual(sent.slice(1, 3).map(({ content }) => content), ['안녕', '반가워'])
      assert.deepEqual(sent.slice(3, 6).map(({ role, content }) => ({ role, content: String(content).split('\n').slice(1).join('\n') })), expected)
      assert.ok(!JSON.stringify(run({ ...config, contextTurns: 1 })).includes(expected[0].content), 'the saved opening scrolls out of the normal window')
      assert.ok(!JSON.stringify(run({ ...config, summaryEnabled: true }, { ...thread, summary_until_message_id: latest - 1 })).includes(expected[0].content), 'summarized opening messages are not injected again')
      const system = String(buildChatMessages({ profile: { ...saved, promptSections: [{ id: 'memo', title: '말투', content: '짧게 말해.', kind: 'dialogue', enabled: true }, { id: 'world', title: '세계', content: '항구 도시.', kind: 'text', enabled: true }] }, thread, messages: [], config, tools: [], books: [] })[0].content)
      assert.ok(system.indexOf('## 세계') < system.indexOf('## 말투'), 'unlabelled dialogue still follows text sections')
    } else if (engine === 'codex') {
      const recap = codexHistoryRecap(thread, messages().slice(0, -1), saved, userPersonaOf(user), historySource, latest)
      for (const message of expected) assert.ok(recap.includes(`${message.role === 'user' ? user.name : saved.name}: ${message.content}`))
    } else {
      const turn = await buildClaudeSessionTurn({ requester, threadId: thread.id, profile: saved, history: messages(), historySource, withTools: false, runtime: engine })
      const input = engine === 'pi' ? piPromptInput(turn.messages).text : String(turn.messages.at(-1)!.content)
      for (const message of expected) assert.ok(input.includes(`${message.role === 'user' ? user.name : saved.name}: ${message.content}`))
    }
    CodexChatService.clearThread(requester, thread.id)
    checkOpening()
    if (engine === 'llm') {
      const companion = ChatProfileStore.create({ name: '동행', engine: 'llm', providerName: 'opening', openingHistory, greeting: '반가워' })
      const room = GroupChatService.create(requester, { profileIds: [saved.id, companion.id], representativeId: saved.id, userProfileId: user.id })
      assert.deepEqual(CodexChatStore.listMessages(room.id), [], 'group creation does not post member openings')
      CodexChatStore.addMessage({ thread_id: room.id, role: 'user', content: '안녕', tool_calls: [], status: 'completed', error: null })
      GroupChatService.clearThread(requester, room.id)
      assert.deepEqual(CodexChatStore.listMessages(room.id), [], 'group reset does not post member openings')
    }
    const quiet = ChatProfileStore.update(saved.id, { greeting: '', alternateGreetings: [], greetingPosition: 999 })!
    assert.equal(quiet.greetingPosition, openingHistory.length)
    const historyOnly = CodexChatService.createThread(requester, saved.id, user.id)
    assert.deepEqual(CodexChatStore.listMessages(historyOnly.id).map(({ role, content }) => ({ role, content })), [expected[0], expected[2]])
  }

  await t.test('Codex retries the opening after a failure or cancellation before turn/start', async (s) => {
    const { CodexAppServerClient } = await import('../src/services/codex-chat/codexAppServerClient')
    const { chatFeatureOverrides } = await import('../src/services/codex-chat/codexChatRuntime')
    const features = new Set(['shell_tool', 'unified_exec', 'hooks', 'plugins', 'apps', 'code_mode_host', 'code_mode', 'browser_use', 'computer_use', 'multi_agent', 'image_generation', 'view_image', 'skill_mcp_dependency_install', 'skill_search', 'skip_host_skill_discovery'])
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-opening-auth-'))
    fs.writeFileSync(path.join(home, 'auth.json'), '{}')
    const previousHome = process.env.CODEX_HOME
    process.env.CODEX_HOME = home
    s.after(async () => {
      await CodexChatService.stopAllSessions('opening regression complete')
      if (previousHome === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = previousHome
      fs.rmSync(home, { recursive: true, force: true })
    })
    s.mock.method(childProcess, 'spawn', (_command: string, args: string[]) => {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true })
      setImmediate(() => {
        if (args.includes('features')) child.stdout.write([...features].map((name) => `${name} stable false`).join('\n'))
        else {
          assert.ok(args.includes('mcp'))
          child.stdout.write('[]')
        }
        child.emit('close', 0)
      })
      return child
    })
    let threadNumber = 0
    let codexId = ''
    let chatId = 0
    let preparing = false
    let failBeforeStart: 'failure' | 'cancellation' | 'registration' | null = null
    const rename = CodexChatStore.renameThreadIf
    s.mock.method(CodexChatStore, 'renameThreadIf', (...args: Parameters<typeof rename>) => {
      if (failBeforeStart === 'registration') {
        failBeforeStart = null
        throw new Error('failure immediately after turn registration')
      }
      return rename(...args)
    })
    const inputs: string[] = []
    s.mock.method(CodexAppServerClient, 'start', async (options: Parameters<typeof CodexAppServerClient.start>[0]) => {
      const client = Object.assign(new EventEmitter(), { whenExited: Promise.resolve(), close: () => {}, isAlive: true,
        request: async (method: string, params: Record<string, unknown>) => {
          if (method === 'config/read') {
            if (preparing) {
              preparing = false
              const failure = failBeforeStart
              failBeforeStart = null
              if (failure === 'failure') throw new Error('pre-start preparation failed')
              if (failure === 'cancellation') await CodexChatService.interrupt(requester, chatId)
            }
            return { config: { approval_policy: 'never', sandbox_mode: 'read-only', web_search: 'disabled', project_doc_max_bytes: 0,
              features: chatFeatureOverrides(features), mcp_servers: { conai: { url: `http://127.0.0.1:${process.env.PORT || 1666}/mcp` } }, projects: { [options.cwd]: { trust_level: 'untrusted' } } } }
          }
          if (method === 'mcpServerStatus/list') return { data: [{ name: 'conai' }] }
          if (method === 'model/list') return { data: [{ id: 'opening-test-model', isDefault: true }] }
          if (method === 'thread/start') {
            preparing = true
            codexId = `opening-memory-${++threadNumber}`
            return { thread: { id: codexId } }
          }
          assert.equal(method, 'turn/start')
          assert.equal(params.threadId, codexId)
          inputs.push(JSON.stringify(params.input))
          setImmediate(() => {
            client.emit('notification', { method: 'item/completed', params: { threadId: codexId, item: { id: 'reply', type: 'agentMessage', text: '답장' } } })
            client.emit('notification', { method: 'turn/completed', params: { threadId: codexId, turn: { id: 'turn', status: 'completed' } } })
          })
          return { turn: { id: 'turn' } }
        },
      })
      return client as unknown as CodexAppServerClient
    })
    const saved = ChatProfileStore.create({ name: '카이', engine: 'codex', openingHistory, greetingPosition: 1, greeting: expected[1].content })
    for (const failure of ['failure', 'cancellation', 'registration'] as const) {
      chatId = CodexChatService.createThread(requester, saved.id, user.id).id
      failBeforeStart = failure
      const before = inputs.length
      assert.equal((await CodexChatService.sendMessage(requester, chatId, '첫 시도', () => {})).status, 'failed')
      assert.equal(CodexChatService.isRunning(chatId), false, 'every post-registration failure releases the turn')
      assert.equal(inputs.length, before, 'the failed/cancelled preparation never starts a Codex turn')
      assert.equal(CodexChatStore.findThreadById(chatId)!.codex_thread_id, null, 'an unused memory is not committed')
      const resumed = await CodexChatService.sendMessage(requester, chatId, '다시 시도', () => {})
      assert.equal(resumed.status, 'completed')
      assert.equal(resumed.context_meta, CodexChatStore.findMessage(chatId, resumed.id)?.context_meta, 'done includes the persisted diagnostics')
      for (const message of expected) assert.ok(inputs[before].includes(message.content), 'the first accepted turn contains the whole opening')
      assert.equal(CodexChatStore.findThreadById(chatId)!.codex_thread_id, codexId)
      await CodexChatService.sendMessage(requester, chatId, '계속', () => {})
      assert.ok(!inputs[before + 1].includes(expected[0].content), 'a successfully started memory does not repeat the recap')
    }
    const other = ChatProfileStore.create({ name: '동행 Codex', engine: 'codex' })
    const room = GroupChatService.create(requester, { profileIds: [saved.id, other.id], representativeId: saved.id })
    s.mock.method(CodexChatStore, 'setContextMeta', () => { throw new Error('metadata persistence failed after the reply was stored') })
    await GroupChatService.sendMessage(requester, room.id, '한 번만 답해줘', () => {})
    const answers = CodexChatStore.listMessages(room.id).filter(message => message.role === 'assistant')
    assert.equal(answers.length, 1, 'metadata failure cannot cause a second failed room reply')
    assert.equal(answers[0].status, 'completed')
    assert.equal(answers[0].content, '답장')
  })

  await t.test('legacy history sections migrate once, preserving disabled or unparseable sections as examples', async () => {
    const { createUserSettingsSchema } = await import('../src/database/userSettingsSchema')
    const legacy = ChatProfileStore.create({ name: '카이', engine: 'codex' })
    const untouched = ChatProfileStore.create({ name: 'untouched', engine: 'codex' })
    const malformed = ChatProfileStore.create({ name: 'malformed', engine: 'codex' })
    const capped = ChatProfileStore.create({ name: 'capped', engine: 'codex' })
    const existing = ChatProfileStore.create({ name: 'existing', engine: 'codex', openingHistory })
    const sections = [
      { id: 'one', kind: 'dialogue', enabled: true, content: '{{user}}: {{char}}, 안녕\n카이: 반가워', asHistory: true },
      { id: 'disabled', kind: 'dialogue', enabled: false, content: '사용자: 꺼짐', asHistory: true },
      { id: 'leading', kind: 'dialogue', enabled: true, content: '설명\n사용자: 안녕', asHistory: true },
      { id: 'no-turns', kind: 'dialogue', enabled: true, content: '줄글', asHistory: true },
      { id: 'two', kind: 'dialogue', enabled: true, content: '카이: 혼자 말해', asHistory: true },
      { id: 'example', kind: 'dialogue', enabled: true, content: '사용자: 예시\n카이: 응' },
    ]
    const db = dbModule.getUserSettingsDb()
    const unmarkedSections = JSON.stringify([{ kind: 'dialogue', content: '사용자: 예시\n카이: 응', enabled: true }], null, 2)
    const cappedSections = [
      { id: 'fits', kind: 'dialogue', enabled: true, asHistory: true, content: Array.from({ length: 99 }, (_, index) => `${index % 2 ? '{{char}}' : '{{user}}'}: turn ${index}`).join('\n') },
      { id: 'overflow', kind: 'dialogue', enabled: true, asHistory: true, content: '{{user}}: must stay\n{{char}}: together' },
      { id: 'later', kind: 'dialogue', enabled: true, asHistory: true, content: '{{char}}: must also stay' },
    ]
    db.prepare('UPDATE llm_chat_profiles SET opening_history = NULL, prompt_sections = ? WHERE id = ?').run(JSON.stringify(sections), legacy.id)
    db.prepare('UPDATE llm_chat_profiles SET opening_history = NULL, prompt_sections = ? WHERE id = ?').run(unmarkedSections, untouched.id)
    db.prepare('UPDATE llm_chat_profiles SET opening_history = NULL, prompt_sections = ? WHERE id = ?').run('not JSON', malformed.id)
    db.prepare('UPDATE llm_chat_profiles SET opening_history = NULL, prompt_sections = ? WHERE id = ?').run(JSON.stringify(cappedSections), capped.id)
    db.prepare('UPDATE llm_chat_profiles SET prompt_sections = ? WHERE id = ?').run(JSON.stringify(sections), existing.id)
    createUserSettingsSchema(db)
    assert.deepEqual(ChatProfileStore.find(legacy.id)!.openingHistory, [
      { role: 'user', content: '{{char}}, 안녕' }, { role: 'assistant', content: '반가워' }, { role: 'assistant', content: '혼자 말해' },
    ])
    assert.equal(ChatProfileStore.find(legacy.id)!.greetingPosition, 0)
    const row = db.prepare('SELECT opening_history, prompt_sections FROM llm_chat_profiles WHERE id = ?')
    const migrated = row.get(legacy.id) as { opening_history: string; prompt_sections: string }
    assert.deepEqual(JSON.parse(migrated.prompt_sections), sections.filter((section) => !['one', 'two'].includes(section.id)).map(({ asHistory: _old, ...section }) => section))
    assert.deepEqual(row.get(untouched.id), { opening_history: '[]', prompt_sections: unmarkedSections }, 'checked unmarked profiles are recorded without rewriting their sections')
    assert.deepEqual(row.get(malformed.id), { opening_history: '[]', prompt_sections: 'not JSON' }, 'malformed sections are recorded as checked too')
    const cappedResult = row.get(capped.id) as { opening_history: string; prompt_sections: string }
    assert.equal(JSON.parse(cappedResult.opening_history).length, 99)
    assert.deepEqual(JSON.parse(cappedResult.prompt_sections), cappedSections.slice(1).map(({ asHistory: _old, ...section }) => section), 'overflow retains the entire section and every later section, even one that would fit')
    assert.equal((row.get(existing.id) as { prompt_sections: string }).prompt_sections, JSON.stringify(sections), 'existing opening history is never overwritten')
    createUserSettingsSchema(db)
    assert.deepEqual(row.get(legacy.id), migrated, 'rerunning setup does not duplicate or change the opening')
    assert.deepEqual(row.get(capped.id), cappedResult, 'overflow sections are not migrated on the next startup')
    assert.deepEqual(row.get(untouched.id), { opening_history: '[]', prompt_sections: unmarkedSections })
    assert.deepEqual(row.get(malformed.id), { opening_history: '[]', prompt_sections: 'not JSON' })
  })
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
