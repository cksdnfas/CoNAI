import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { ChatExecutionContext, ChatTaskRouting } from '@conai/shared'

/** The assistant agent: card outcomes reach the next request, page operations leave a chip, and tasks move on by themselves. */
test('assistant agent: proposal outcomes, page operation records, task plan and runner', { timeout: 60000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-agent-test-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  t.after(async () => {
    authModule.getAuthDb().close()
    dbModule.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.ok(path.basename(root).startsWith('conai-agent-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const { ChatProposalStore } = await import('../src/services/codex-chat/chatProposals')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { proposalOutcomeNote } = await import('../src/services/codex-chat/chatPageContext')
  const { readMcpToolResult } = await import('../src/services/codex-chat/chatToolReferences')
  const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
  const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
  const { ChatTaskStore, ChatTaskRunner } = await import('../src/services/codex-chat/chatTasks')
  const { CodexChatService } = await import('../src/services/codex-chat/codexChatService')
  const { buildProfileProposal } = await import('../src/mcp/tools/chatSetupTools')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  ;(await import('../src/services/codex-chat/chatSettings')).updateChatSettings({ enabled: true })

  ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const profile = ChatProfileStore.create({ name: 'Agent', engine: 'llm', providerName: 'conn', mcpEnabled: true, mcpScopes: ['read', 'configure'] })
  const threadId = CodexChatStore.createThread(null, 'agent chat', 'llm', profile.id)
  const controller = new AbortController()
  const reply = (replyId: string): ChatExecutionContext => ({ threadId, profileId: profile.id, kind: 'direct', replyId })

  await t.test('the next request hears what happened to recent cards', () => {
    assert.equal(proposalOutcomeNote(threadId), '')
    const saved = ChatProposalStore.add(reply('r1'), { kind: 'profile', input: { name: 'Sera' } })
    const dismissed = ChatProposalStore.add(reply('r1'), { kind: 'display_block', name: 'status', block: {}, linkProfileId: null })
    const open = ChatProposalStore.add(reply('r1'), { kind: 'profile_update', profileId: profile.id, profileName: 'Agent', patch: { tagline: 'x' }, before: { tagline: '' } })
    ChatProposalStore.markSaved(saved.id, 42)
    ChatProposalStore.markDismissed(dismissed.id)
    const note = proposalOutcomeNote(threadId)
    assert.match(note, new RegExp(`#${saved.id} 새 프로필 "Sera": 저장됨 \\(id 42\\)`))
    assert.match(note, new RegExp(`#${dismissed.id} .*무시됨`))
    assert.match(note, new RegExp(`#${open.id} .*아직 대기`))
  })

  await t.test('appearance can be proposed with a new profile', () => {
    const { input } = buildProfileProposal({ name: 'Sera', system_prompt: 'You are Sera.', appearance: 'silver hair, blue eyes' })
    assert.equal(input.appearance, 'silver hair, blue eyes')
  })

  await t.test('the request already carries what the screen can do, so the model acts without reading it first', async () => {
    const { normalizeChatPageSnapshot } = await import('@conai/shared')
    const { chatPageReference } = await import('../src/services/codex-chat/chatPageContext')
    const page = normalizeChatPageSnapshot({ instanceId: 'inst-ref-1', connectionId: 'conn-ref-1', path: '/settings', title: '설정 · 채팅 프로필', kind: 'settings', resourceId: 'chat', fields: [], revision: 'rev-ref-1',
      actions: [{ id: 'profile.open_create', label: '새 프로필 편집기 열기', description: '빈 편집기를 열어.', effect: 'draft', schema: { type: 'object', properties: {} } }], data: { profiles: [{ id: 1, name: 'A' }] } })
    const reference = chatPageReference(page, { accountId: null, accountType: 'admin' })
    assert.match(reference, /"id":"profile\.open_create"/)
    assert.match(reference, /"tier":"view"/)
    assert.match(reference, /"profiles":\[\{"id":1,"name":"A"\}\]/, 'a small collection travels whole, so an item is picked by name without reading it')
    const { chatPageView } = await import('../src/mcp/tools/chatPageView')
    const many = chatPageView({ accountId: null, accountType: 'admin' }, normalizeChatPageSnapshot({ ...page, data: { profiles: Array.from({ length: 40 }, (_, index) => ({ id: index + 1, name: `P${index}` })) } }))
    assert.deepEqual(many.data?.profiles, { count: 40, readWith: 'read_page_data' }, 'a larger one travels as its size')
    assert.match(reference, /do not call get_current_page first/)
    const big = normalizeChatPageSnapshot({ ...page, fields: Array.from({ length: 40 }, (_, index) => ({ id: `f${index}`, label: `Field ${index}`, type: 'text', value: 'x'.repeat(2000) })) })
    const shortened = chatPageReference(big, { accountId: null, accountType: 'admin' })
    assert.match(shortened, /shortened/)
    assert.ok(shortened.length < 30_000, 'a large screen stays bounded')
  })

  await t.test('Codex is given the screen and the fixed guidance only when they change', async () => {
    const { normalizeChatPageSnapshot } = await import('@conai/shared')
    const { pendingPageReference, boundedPageView, NO_PAGE_NOTE } = await import('../src/services/codex-chat/chatPageContext')
    const { chatPageView } = await import('../src/mcp/tools/chatPageView')
    const admin = { accountId: null, accountType: 'admin' as const }
    const page = normalizeChatPageSnapshot({ instanceId: 'inst-codex-1', connectionId: 'conn-codex-1', path: '/settings', title: '설정', kind: 'settings', resourceId: 'chat', revision: 'rev-codex-1',
      fields: [{ id: 'name', label: '이름', type: 'text', value: 'A' }], actions: [{ id: 'profile.open_create', label: '새 프로필', description: '', effect: 'draft', schema: { type: 'object', properties: {} } }] })
    const sent = new Set<string>()
    const first = pendingPageReference(page, admin, sent)
    assert.match(first.text, /profile\.open_create/)
    assert.match(first.text, /untrusted data/)
    assert.equal(first.keys.length, 2, 'view and guide')
    first.keys.forEach((key) => sent.add(key))
    const again = pendingPageReference(page, admin, sent)
    assert.deepEqual(again.keys, [])
    assert.match(again.text, /Same screen/)
    assert.doesNotMatch(again.text, /profile\.open_create|untrusted data/)
    const changed = pendingPageReference(normalizeChatPageSnapshot({ ...page, fields: [{ id: 'name', label: '이름', type: 'text', value: 'B' }] }), admin, sent)
    assert.equal(changed.keys.length, 1, 'a changed screen goes again, the guidance does not')
    assert.match(changed.text, /"value":"B"/)
    const none = pendingPageReference(undefined, admin, sent)
    assert.equal(none.text, NO_PAGE_NOTE)
    none.keys.forEach((key) => sent.add(key))
    assert.equal(pendingPageReference(undefined, admin, sent).text, '', 'the no-page note goes once')
    const huge = normalizeChatPageSnapshot({ ...page, fields: Array.from({ length: 30 }, (_, index) => ({ id: `f${index}`, label: `Field ${index}`, type: 'text', value: 'x'.repeat(500) })) })
    const bounded = boundedPageView(chatPageView(admin, huge), 2000)
    assert.doesNotThrow(() => JSON.parse(bounded), 'a shortened screen is still valid JSON')
    assert.match(bounded, /Field values are left out/)
  })

  await t.test('a page operation on the same screen answers with what changed only', async () => {
    const { normalizeChatPageSnapshot } = await import('@conai/shared')
    const { pageOperationView } = await import('../src/mcp/tools/chatPageView')
    const admin = { accountId: null, accountType: 'admin' as const }
    const before = normalizeChatPageSnapshot({ instanceId: 'inst-op-1', connectionId: 'conn-op-1', path: '/settings', title: '설정', kind: 'settings', resourceId: 'chat', revision: 'rev-op-1',
      fields: [{ id: 'name', label: '이름', type: 'text', value: '' }, { id: 'prompt', label: '프롬프트', type: 'text', value: 'p'.repeat(4000) }],
      actions: [{ id: 'profile.open_create', label: '새 프로필', description: '', effect: 'draft', schema: { type: 'object', properties: {} } }] })
    const filled = normalizeChatPageSnapshot({ ...before, revision: 'rev-op-2', fields: [{ ...before.fields[0], value: '세라' }, before.fields[1]] })
    const same = pageOperationView(admin, before, filled) as { fields: Array<{ id: string }>; actions: unknown; otherFields?: string }
    assert.deepEqual(same.fields.map((field) => field.id), ['name'])
    assert.match(String(same.actions), /unchanged/)
    assert.ok(same.otherFields)
    const elsewhere = pageOperationView(admin, before, normalizeChatPageSnapshot({ ...filled, instanceId: 'inst-op-2' })) as { fields: unknown[]; actions: unknown }
    assert.equal(elsewhere.fields.length, 2, 'another screen comes back whole')
    assert.ok(Array.isArray(elsewhere.actions))
  })

  await t.test('the LLM engine merges the page reference into the latest user message', async () => {
    const { withPageReference } = await import('../src/services/codex-chat/llmChatService')
    const merged = withPageReference([{ role: 'system', content: 'S' }, { role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }, { role: 'user', content: 'open it' }], '[page]')
    assert.deepEqual(merged.map((message) => message.role), ['system', 'user', 'assistant', 'user'], 'roles still alternate')
    assert.equal(merged[3].content, '[page]\n\nopen it')
    assert.equal(merged[1].content, 'hi')
  })

  await t.test('a profile with nothing to work with gets no task tools', async () => {
    const plain = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, [], null, { chatContext: reply('r-plain') })
    try {
      assert.ok(!plain.tools.some((tool) => tool.function.name.startsWith('task_')), plain.tools.map((tool) => tool.function.name).join(','))
    } finally { await plain.close() }
    const working = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, ['read'], null, { chatContext: reply('r-working') })
    try {
      assert.ok(working.tools.some((tool) => tool.function.name === 'task_propose'))
    } finally { await working.close() }
  })

  await t.test('profiles whose reply and judge share a connection are listed for its editor', async () => {
    const { ChatJudgePresetStore } = await import('../src/services/codex-chat/chatJudgePresets')
    const { sharedServerProfiles } = await import('../src/services/codex-chat/chatServerSharing')
    const preset = ChatJudgePresetStore.create({ name: 'same server', providerName: 'conn', items: [{ id: 'x', name: 'X', stage: 'before', instructions: 'X?', directive: '[x]' }] as never })
    const judged = ChatProfileStore.create({ name: 'Judged', engine: 'llm', providerName: 'conn', judgePresetId: preset.id })
    const shared = sharedServerProfiles().get('conn') ?? []
    assert.deepEqual(shared.find((entry) => entry.id === judged.id)?.roles, ['judge'])
    assert.ok(!shared.some((entry) => entry.id === profile.id), 'a profile without a judge or translation shares nothing')
    ChatProfileStore.delete(judged.id)
  })

  await t.test('the connection test finds the way that turns thinking off', async (sub) => {
    const { checkThinkingSwitch } = await import('../src/services/codex-chat/thinkingSwitchProbe')
    const seen: unknown[] = []
    sub.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'))
      seen.push(body.reasoning_effort ?? body.chat_template_kwargs ?? null)
      const off = body.chat_template_kwargs?.enable_thinking === false
      return Response.json({ choices: [{ message: { content: 'ok', ...(off ? {} : { reasoning_content: 'hmm' }) }, finish_reason: 'stop' }] })
    })
    const check = await checkThinkingSwitch('conn', 'reasoning_effort')
    assert.deepEqual(check, { model: 'm', current: 'reasoning_effort', found: 'enable_thinking' })
    assert.deepEqual(seen, ['none', { enable_thinking: false }], 'the saved way first, then the next')
  })

  await t.test('a server that cannot take tools is recognized', async () => {
    const { isToolsRefusal } = await import('../src/services/codex-chat/llmChatCompletion')
    assert.ok(isToolsRefusal('{"error":"registry.ollama.ai/library/gemma2:latest does not support tools"}'))
    assert.ok(isToolsRefusal('tools param requires --jinja flag'))
    assert.ok(!isToolsRefusal('Invalid tool_call_id: call_1 not found'))
    assert.ok(!isToolsRefusal('the request exceeds the available context size'))
  })

  await t.test('a page operation is kept as a small record, never its screen', () => {
    const { pageOperation } = readMcpToolResult({ content: [{ type: 'text', text: '{"page":{"fields":[]}}' }], structuredContent: { pageOperation: { commandId: 'cmd-1', tier: 'draft', label: '이름, 인사말' } } }, 'page_fill')
    assert.deepEqual(pageOperation, { commandId: 'cmd-1', tier: 'draft', label: '이름, 인사말' })
    assert.equal(readMcpToolResult({ structuredContent: { pageOperation: { commandId: 'x', tier: 'commit', label: 'y' } } }).pageOperation, undefined, 'only view and draft operations are recorded')
  })

  await t.test('a plan card starts nothing until approved; the runner then moves the task on', async (sub) => {
    ChatTaskRunner.start()
    const scheduled: string[] = []
    sub.mock.method(ChatTaskRunner, 'schedule', (_thread: number, event: string) => { scheduled.push(event) })
    const context = reply('r-plan')
    const stop = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, ['read', 'configure'], null, { chatContext: context })
    try {
      const names = bridge.tools.map((tool) => tool.function.name)
      for (const name of ['task_propose', 'task_status', 'task_update', 'task_wait', 'task_finish']) assert.ok(names.includes(name), `${name} is offered in a 1:1 chat`)
      assert.ok((await bridge.call('task_update', { step: 1, status: 'done' })).isError, 'no task yet')
      const proposed = await bridge.call('task_propose', { goal: '세라 프로필 완성', steps: [{ title: '초안' }, { title: '저장', approval: true }, { title: '이미지' }], budget: { continuations: 5 } })
      assert.ok(!proposed.isError, JSON.stringify(proposed.content))
      const { taskId, proposalId } = JSON.parse((proposed.content?.[0] as { text: string }).text)
      assert.equal(ChatTaskStore.find(taskId)?.status, 'awaiting_plan')
      assert.equal(ChatTaskStore.find(taskId)?.budget.continuations, 5)
      assert.ok((await bridge.call('task_update', { step: 1, status: 'done' })).isError, 'steps wait for the approved plan')
      assert.deepEqual(scheduled, [])

      ChatTaskRunner.approve(taskId)
      ChatProposalStore.markSaved(proposalId, taskId)
      assert.equal(ChatTaskStore.find(taskId)?.status, 'running')
      assert.equal(scheduled.length, 1, 'approval starts the first turn')

      assert.ok(!(await bridge.call('task_update', { step: 1, status: 'done' })).isError)
      assert.ok(!(await bridge.call('task_update', { step: 2, status: 'doing' })).isError)
      const card = ChatProposalStore.add(context, { kind: 'profile', input: { name: 'Sera' } })
      assert.ok(!(await bridge.call('task_wait', { for: 'approval', reason: '프로필 저장 카드' })).isError)
      assert.equal(ChatTaskStore.find(taskId)?.status, 'waiting')
      ChatProposalStore.markSaved(card.id, 7)
      assert.equal(ChatTaskStore.find(taskId)?.status, 'running', 'saving the awaited card resumes the task')
      assert.match(scheduled.at(-1)!, /저장했어/)

      const finished = await bridge.call('task_finish', { outcome: 'done', summary: '다 했어' })
      assert.ok(!finished.isError)
      assert.equal(ChatTaskStore.find(taskId)?.status, 'done')
      assert.equal(ChatTaskStore.live(threadId), null)
    } finally { stop(); await bridge.close() }
  })

  await t.test('dismissing a plan cancels it', async () => {
    const stop = registerChatReply(reply('r-plan-2'), controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, ['read'], null, { chatContext: reply('r-plan-2') })
    try {
      const { taskId, proposalId } = JSON.parse(((await bridge.call('task_propose', { goal: 'x', steps: [{ title: 'a' }] })).content?.[0] as { text: string }).text)
      ChatProposalStore.markDismissed(proposalId)
      assert.equal(ChatTaskStore.find(taskId)?.status, 'cancelled')
    } finally { stop(); await bridge.close() }
  })

  await t.test('a continuation is a marked request within budget; no progress pauses it', async (sub) => {
    const sent: Array<{ text: string; task?: ChatTaskRouting }> = []
    sub.mock.method(CodexChatService, 'sendMessage', async (_requester: unknown, _thread: number, text: string, _listener: unknown, ...rest: unknown[]) => {
      sent.push({ text, task: (rest[6] as { task?: ChatTaskRouting } | undefined)?.task })
    })
    const task = ChatTaskStore.create(threadId, '목표', [{ title: '하나' }, { title: '둘' }], { continuations: 10 })
    ChatTaskStore.update(task.id, { status: 'running' })
    await ChatTaskRunner.continue(threadId, '플랜 승인')
    assert.equal(sent.length, 1)
    assert.match(sent[0].text, /Task continuation/)
    assert.deepEqual(sent[0].task, { id: task.id, step: 1, total: 2, title: '하나', event: '플랜 승인' })
    assert.equal(ChatTaskStore.find(task.id)?.used.continuations, 1)
    await ChatTaskRunner.continue(threadId, 'again')
    await ChatTaskRunner.continue(threadId, 'again')
    await ChatTaskRunner.continue(threadId, 'again')
    assert.equal(ChatTaskStore.find(task.id)?.status, 'paused', 'three continuations without any step change stop the task')
    assert.match(ChatTaskStore.find(task.id)?.reason ?? '', /진전/)
    assert.equal(sent.length, 3)

    ChatTaskRunner.resume(threadId)
    sub.mock.method(ChatTaskRunner, 'schedule', () => {})
    const spent = ChatTaskStore.create(threadId, '예산', [{ title: 'a' }], { continuations: 1 })
    assert.equal(ChatTaskStore.live(threadId)?.id, spent.id)
    ChatTaskStore.update(spent.id, { status: 'running', used: { continuations: 1, images: 0 } })
    await ChatTaskRunner.continue(threadId, 'x')
    assert.equal(ChatTaskStore.find(spent.id)?.status, 'paused')
    assert.match(ChatTaskStore.find(spent.id)?.reason ?? '', /예산/)
  })
  await t.test('new page operations: the registry decides tier, route and whether they leave the screen', async () => {
    const { chatPageActionTier, chatPageActionLeavesScreen, chatPageActionAllowed, normalizeChatPageActions } = await import('@conai/shared')
    for (const id of ['resource.save', 'wallpaper.save', 'metadata.save']) assert.equal(chatPageActionTier(id), 'commit', id)
    for (const id of ['lorebook.entries', 'wallpaper.add_widget']) assert.equal(chatPageActionTier(id), 'draft', id)
    for (const id of ['resource.open', 'chat.open', 'chat.prepare', 'audio.open', 'audio.filter', 'audio.select', 'sprite.select', 'wallpaper.select', 'wallpaper.open_preset', 'library.select']) assert.equal(chatPageActionTier(id), 'view', id)
    assert.equal(chatPageActionLeavesScreen('audio.open'), true, 'opening another group leaves the screen')
    assert.equal(chatPageActionLeavesScreen('audio.select'), false, 'picking a take stays on it')
    assert.equal(chatPageActionLeavesScreen('resource.open'), false, 'an editor opens over the settings list')
    assert.ok(chatPageActionAllowed('/settings', 'resource.open') && !chatPageActionAllowed('/chat', 'resource.open'))
    assert.ok(chatPageActionAllowed('/chat', 'chat.prepare') && !chatPageActionAllowed('/settings', 'chat.prepare'))
    assert.ok(chatPageActionAllowed('/images/abc123/metadata', 'metadata.save') && !chatPageActionAllowed('/images/abc123', 'metadata.save'))
    assert.ok(chatPageActionAllowed('/audio', 'audio.filter') && chatPageActionAllowed('/sprite', 'sprite.select') && chatPageActionAllowed('/wallpaper', 'wallpaper.add_widget'))
    const save = { id: 'resource.save', label: 'Save', description: 'Save', schema: { type: 'object' as const, properties: {} } }
    assert.equal(normalizeChatPageActions('/settings', [{ ...save, effect: 'save' }])[0].id, 'resource.save')
    assert.throws(() => normalizeChatPageActions('/settings', [{ ...save, effect: 'draft' }]), /저장 범위/, 'a page cannot register a save as a draft')
  })

  await t.test('a person answering or reconnecting brings a waiting task back', async () => {
    const { notifyChatUserSend } = await import('../src/services/codex-chat/chatSendEvents')
    ChatTaskRunner.start()
    const thread = CodexChatStore.createThread(null, 'waiting chat', 'llm', profile.id)
    const task = ChatTaskStore.create(thread, '대기', [{ title: 'a' }])
    ChatTaskStore.update(task.id, { status: 'waiting', wait: 'user', reason: '이름을 물었어' })
    notifyChatUserSend(thread, false)
    assert.equal(ChatTaskStore.find(task.id)?.status, 'running', 'the answer resumes a task waiting for the person')
    ChatTaskStore.update(task.id, { status: 'waiting', wait: 'page', reason: '페이지가 필요해' })
    notifyChatUserSend(thread, false)
    assert.equal(ChatTaskStore.find(task.id)?.status, 'waiting', 'a message without the page keeps a page wait')
    notifyChatUserSend(thread, true)
    assert.equal(ChatTaskStore.find(task.id)?.status, 'running')
    ChatTaskStore.update(task.id, { status: 'waiting', wait: 'approval', reason: '카드' })
    notifyChatUserSend(thread, true)
    assert.equal(ChatTaskStore.find(task.id)?.status, 'waiting', 'an approval wait ends only with the card')
  })

  await t.test('a long-running task stops for the person; resuming starts the clock again', async (sub) => {
    const { getUserSettingsDb } = await import('../src/database/userSettingsDb')
    sub.mock.method(CodexChatService, 'sendMessage', async () => {})
    sub.mock.method(ChatTaskRunner, 'schedule', () => {})
    const thread = CodexChatStore.createThread(null, 'long chat', 'llm', profile.id)
    const task = ChatTaskStore.create(thread, '오래', [{ title: 'a' }, { title: 'b' }])
    ChatTaskRunner.approve(task.id)
    getUserSettingsDb().prepare("UPDATE chat_tasks SET active_since = datetime('now', '-4 hours') WHERE id = ?").run(task.id)
    await ChatTaskRunner.continue(thread, 'x')
    assert.equal(ChatTaskStore.find(task.id)?.status, 'paused')
    assert.match(ChatTaskStore.find(task.id)?.reason ?? '', /시간/)
    ChatTaskRunner.resume(thread)
    assert.ok(ChatTaskStore.activeMs(task.id) < 60_000)
    await ChatTaskRunner.continue(thread, 'y')
    assert.equal(ChatTaskStore.find(task.id)?.status, 'running')
    assert.equal(ChatTaskStore.find(task.id)?.used.continuations, 1)
  })

  await t.test('chat lists carry each unfinished task as a progress summary', () => {
    const thread = CodexChatStore.createThread(null, 'ring chat', 'llm', profile.id)
    const task = ChatTaskStore.create(thread, '링', [{ title: '하나' }, { title: '둘' }, { title: '셋' }])
    assert.equal(ChatTaskStore.summaries([thread]).size, 0, 'a plan not approved yet shows no ring')
    ChatTaskStore.update(task.id, { status: 'waiting', wait: 'approval', steps: [{ title: '하나', status: 'done' }, { title: '둘', status: 'doing' }, { title: '셋', status: 'todo' }] })
    assert.deepEqual(ChatTaskStore.summaries([thread, 999999]).get(thread), { status: 'waiting', wait: 'approval', done: 1, total: 3, step: '둘' })
  })

  await t.test('the chat reads what happened to its cards and the newest character image batch', async () => {
    const context = reply('r-status')
    const stop = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, ['read', 'configure'], null, { chatContext: context })
    try {
      const card = ChatProposalStore.add(context, { kind: 'profile', input: { name: 'Status' } })
      const dismissed = ChatProposalStore.add(context, { kind: 'profile', input: { name: 'Gone' } })
      ChatProposalStore.markSaved(card.id, 42)
      ChatProposalStore.markDismissed(dismissed.id)
      const read = await bridge.call('get_proposal_status', { proposal_ids: [card.id, dismissed.id] })
      assert.ok(!read.isError, JSON.stringify(read.content))
      const { proposals } = JSON.parse((read.content?.[0] as { text: string }).text)
      assert.deepEqual(proposals.map((entry: { id: number; state: string; savedId: number | null }) => [entry.id, entry.state, entry.savedId]), [[card.id, 'saved', 42], [dismissed.id, 'dismissed', null]])
      const batch = await bridge.call('get_asset_batch', {})
      assert.ok(!batch.isError, JSON.stringify(batch.content))
      assert.equal(JSON.parse((batch.content?.[0] as { text: string }).text).batch, null, 'a profile without batches says so')
    } finally { stop(); await bridge.close() }
  })
})
