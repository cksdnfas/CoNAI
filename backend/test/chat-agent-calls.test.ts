import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { ChatExecutionContext } from '@conai/shared'

test('profile agents: admission, no recursion, expiry logs and unread isolation', { timeout: 60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-agent-calls-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const { ChatAgentRunner, callChatAgent } = await import('../src/services/codex-chat/chatAgentCalls')
  t.after(async () => {
    ChatAgentRunner.stop()
    authModule.getAuthDb().close()
    dbModule.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>(resolve => logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-agent-calls-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { CodexChatService } = await import('../src/services/codex-chat/codexChatService')
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  const { ensureAutomationRoom, automationRoomKinds, chatUnreadCount } = await import('../src/services/codex-chat/chatRoomWake')
  const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
  const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
  const { AuthAccount } = await import('../src/models/AuthAccount')
  const { AuthAccessControlService } = await import('../src/services/authAccessControlService')
  const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { usableChatAgents } = await import('../src/services/codex-chat/chatAgentCalls')
  const { BoardCallRooms } = await import('../src/services/posts/boardCallRooms')
  const { isContextToolAllowed } = await import('../src/mcp/toolAccess')
  const { attachFileChanges, undoFileChange } = await import('../src/services/codex-chat/chatFileChanges')
  const { FileStoreRevisions } = await import('../src/services/fileStoreRevisions')
  ExternalApiProvider.create({ provider_name: 'agent-test', display_name: 'Test', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  updateChatSettings({ enabled: true })
  t.mock.method(AuthAccount, 'findById', (id: number) => ({ id, status: 'active', account_type: 'guest' }) as never)
  t.mock.method(AuthAccessControlService, 'resolveForAccountId', () => ({ permissionKeys: ['chat.use'], groupKeys: [] }))
  const requester = { accountId: 1, accountType: 'guest' as const }
  const caller = ChatProfileStore.create({ name: 'Caller', engine: 'llm', providerName: 'agent-test', model: 'm', mcpEnabled: true, mcpScopes: ['read'] })
  const agent = ChatProfileStore.create({ name: 'Agent', engine: 'llm', providerName: 'agent-test', model: 'm', agentEnabled: true, agentDescription: 'Work', mcpEnabled: true, mcpScopes: ['read'] })
  const threadId = CodexChatStore.createThread(1, 'Caller room', 'llm', caller.id)
  const chat: ChatExecutionContext = { threadId, profileId: caller.id, kind: 'direct', replyId: 'caller-1' }
  const unregister = registerChatReply(chat, new AbortController().signal, () => ({ replyTo: null, recipients: ['user'] }))
  t.after(unregister)
  await ChatAgentRunner.poll() // first-use schema, without launching timers/models
  const db = dbModule.getUserSettingsDb()

  await t.test('non-agent and inaccessible profiles are refused', () => {
    const ordinary = ChatProfileStore.create({ name: 'Ordinary', engine: 'llm', providerName: 'agent-test', model: 'm' })
    assert.throws(() => callChatAgent(requester, chat, { agentProfileId: ordinary.id, instruction: 'work' }), /사용 가능한 에이전트/)
    t.mock.method(AuthAccessControlService, 'resolveForAccountId', () => ({ permissionKeys: [], groupKeys: [] }))
    assert.throws(() => callChatAgent(requester, chat, { agentProfileId: agent.id, instruction: 'work' }), /사용 가능한 에이전트/)
    t.mock.method(AuthAccessControlService, 'resolveForAccountId', () => ({ permissionKeys: ['chat.use'], groupKeys: [] }))
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM chat_agent_calls').get() as { n: number }).n, 0)
  })

  await t.test('call_agent is offered in caller replies but never in an agent room', async () => {
    ChatProfileStore.update(caller.id, { agentEnabled: true })
    const room = await ensureAutomationRoom(requester, agent.id, 'agent:availability', 'Agent room')
    const inside: ChatExecutionContext = { threadId: room.id, profileId: agent.id, kind: 'direct', replyId: 'inside-1' }
    const end = registerChatReply(inside, new AbortController().signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge(requester, ['read'], null, { chatContext: chat })
    const agentBridge = await openChatMcpBridge(requester, ['read'], null, { chatContext: inside })
    try {
      assert.ok(bridge.tools.some(tool => tool.function.name === 'call_agent'))
      assert.ok(!agentBridge.tools.some(tool => tool.function.name === 'call_agent'))
    } finally { await bridge.close(); await agentBridge.close(); end() }
  })

  await t.test('board calls and public pages cannot list or invoke agents even through the domain entry point', async () => {
    const publicChat: ChatExecutionContext = { ...chat, page: { instanceId: 'public', connectionId: 'public',
      path: '/public/test', title: 'Public', kind: 'page', resourceId: null, fields: [] } }
    for (const restricted of [chat, publicChat]) {
      const unbind = restricted === chat ? BoardCallRooms.bind(threadId, 123, caller.id) : () => {}
      try {
        const context = { requester, scopes: ['read'] as const, source: 'codex-chat' as const, chatContext: restricted }
        assert.equal(isContextToolAllowed({ ...context, scopes: [...context.scopes] }, 'call_agent'), false)
        assert.deepEqual(usableChatAgents(requester, restricted), [])
        assert.throws(() => callChatAgent(requester, restricted, { agentProfileId: agent.id, instruction: 'work' }), /not allowed/)
        const bridge = await openChatMcpBridge(requester, ['read'], null, { chatContext: restricted })
        try { assert.ok(!bridge.tools.some(tool => tool.function.name === 'call_agent')) }
        finally { await bridge.close() }
      } finally { unbind() }
    }
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM chat_agent_calls').get() as { n: number }).n, 0)
  })

  await t.test('expired failed calls write a log before deleting; completed calls delete without a log', async () => {
    const owner = fileOwnerKey(1)
    const files = new Map<number, { created: string; modified: string }>()
    const deleted: number[] = []
    const originalDelete = CodexChatService.deleteThread
    const deletion = t.mock.method(CodexChatService, 'deleteThread', async (who, roomId) => {
      deleted.push(roomId)
      const row = db.prepare('SELECT status, log_file_id FROM chat_agent_calls WHERE agent_thread_id = ?').get(roomId) as { status: string; log_file_id: string | null }
      assert.equal(row.log_file_id !== null, row.status === 'failed', 'log is committed before room deletion')
      return originalDelete(who, roomId)
    })
    for (const [id, status] of [[101, 'failed'], [102, 'completed']] as const) {
      const room = await ensureAutomationRoom(requester, agent.id, `agent:${id}`, `Agent ${id}`)
      const source = { via: 'chat' as const, accountId: 1, threadId: room.id, profileId: agent.id, replyId: `agent-reply:${id}` }
      const created = FileStoreService.writeText(owner, null, `created-${id}.txt`, 'created', { source })
      const modified = FileStoreService.writeText(owner, null, `modified-${id}.txt`, 'original')
      FileStoreService.writeText(owner, null, modified.name, 'first edit', { source })
      FileStoreService.writeText(owner, null, modified.name, 'second edit', { source: { ...source, replyId: `agent-second:${id}` } })
      files.set(id, { created: created.id, modified: modified.id })
      const messageId = CodexChatStore.addMessage({ thread_id: room.id, role: 'assistant', content: 'Agent reply', tool_calls: [], status: 'completed', error: null,
        routing: { replyId: `agent-reply:${id}`, replyTo: null, recipients: ['user'] } })
      db.prepare('INSERT INTO chat_generation_links (job_id, thread_id, reply_id, message_id) VALUES (?, ?, ?, ?)').run(id, room.id, `agent-reply:${id}`, messageId)
      db.prepare(`INSERT INTO chat_agent_calls (id, account_key, caller_thread_id, caller_profile_id, agent_profile_id, agent_thread_id,
        agent_name, caller_name, instruction, on_done, status, error, finished_at, expires_at, created_at)
        VALUES (?, '1', ?, ?, ?, ?, 'Agent', 'Caller', 'instruction', 'notify', ?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T01:00:00.000Z', '2026-01-01T00:00:00.000Z')`)
        .run(id, threadId, caller.id, agent.id, room.id, status, status === 'failed' ? 'failure' : null)
    }
    await ChatAgentRunner.poll(new Date('2026-01-01T02:00:00Z'))
    assert.equal(deleted.length, 2)
    for (const id of deleted) { assert.equal(CodexChatStore.findThread(id, 1), undefined); assert.equal(automationRoomKinds(1).has(id), false) }
    for (const id of [101, 102]) {
      const link = db.prepare('SELECT thread_id, reply_id, message_id FROM chat_generation_links WHERE job_id = ?').get(id) as { thread_id: number; reply_id: string; message_id: number }
      assert.equal(link.thread_id, threadId, 'generation ownership survives deletion of the source messages')
      assert.equal(link.reply_id, `agent-result:${id}`)
      assert.ok(CodexChatStore.findMessage(threadId, link.message_id))
      const result = attachFileChanges([CodexChatStore.findMessage(threadId, link.message_id)!])[0]
      const pair = files.get(id)!
      assert.deepEqual(new Set(result.fileChanges?.map(file => file.fileId)), new Set([pair.created, pair.modified]))
      assert.equal(FileStoreRevisions.writer(pair.created)?.threadId, threadId)
      assert.equal(FileStoreRevisions.writer(pair.created)?.replyId, link.reply_id)
      assert.equal(FileStoreRevisions.beforeReply(owner, pair.modified, threadId, link.reply_id)?.replacedBy?.threadId, threadId)
      undoFileChange({ threadId, accountId: 1, replyId: link.reply_id, fileId: pair.modified })
      assert.equal((await FileStoreService.readText(owner, pair.modified)).text, 'original')
      undoFileChange({ threadId, accountId: 1, replyId: link.reply_id, fileId: pair.created, canDelete: () => {} })
      assert.equal(FileStoreService.findChild(owner, null, `created-${id}.txt`), null)
    }
    const folder = FileStoreService.findChild(owner, null, '에이전트 작업 기록')!
    const day = FileStoreService.findChild(owner, folder.id, '2026-01-01')!
    const failed = FileStoreService.findChild(owner, day.id, 'Agent (#101).json')!
    assert.ok(failed)
    assert.equal(FileStoreService.findChild(owner, day.id, 'Agent (#102).json'), null)
    const log = JSON.parse((await FileStoreService.readText(owner, failed.id)).text)
    assert.equal(log.status, 'failed')
    assert.equal(log.instruction, 'instruction')
    assert.equal(log.agentReply, 'Agent reply')
    deletion.mock.restore()
  })

  await t.test('unread aggregate excludes agents but not other automation rooms', async () => {
    const before = chatUnreadCount(1)
    for (const kind of ['agent', 'routine', 'workflow', 'plugin', 'posts:board']) {
      const room = await ensureAutomationRoom(requester, agent.id, `${kind}:unread`, kind)
      CodexChatStore.addMessage({ thread_id: room.id, role: 'assistant', content: 'unread', tool_calls: [], status: 'completed', error: null })
    }
    assert.equal(chatUnreadCount(1), before + 4)
    assert.equal(chatUnreadCount(2), 0)
  })

  await t.test('direct and group results wait for the caller reply; reactions follow the result exactly once', async child => {
    const { GroupChatService } = await import('../src/services/codex-chat/groupChatService')
    const busy = new Set<number>()
    const callerReplies = new Map<number, number>()
    const wakes: number[] = []
    child.mock.method(CodexChatService, 'isRunning', (id: number) => busy.has(id))
    child.mock.method(GroupChatService, 'isRunning', (id: number) => busy.has(id))
    const wake = async (_requester: unknown, id: number) => {
      const result = CodexChatStore.latestMessage(id)!
      assert.ok(result.routing?.agent, 'the result is already stored when the reaction starts')
      assert.ok(result.id > callerReplies.get(id)!, 'the result follows the caller reply')
      wakes.push(id)
    }
    child.mock.method(CodexChatService, 'sendMessage', wake as typeof CodexChatService.sendMessage)
    child.mock.method(GroupChatService, 'sendMessage', wake as typeof GroupChatService.sendMessage)
    const now = new Date()
    const targets: number[] = []
    const rooms: number[] = []
    for (const [id, kind] of [[201, 'direct'], [202, 'group']] as const) {
      const target = CodexChatStore.createThread(1, `Waiting ${kind}`, 'llm', caller.id)
      db.prepare('UPDATE codex_chat_threads SET kind = ? WHERE id = ?').run(kind, target)
      const room = await ensureAutomationRoom(requester, agent.id, `agent:${id}`, 'Finished agent')
      CodexChatStore.addMessage({ thread_id: room.id, role: 'assistant', content: 'Finished work', tool_calls: [], status: 'completed', error: null })
      db.prepare(`INSERT INTO chat_agent_calls (id, account_key, caller_thread_id, caller_profile_id, agent_profile_id, agent_thread_id,
        agent_name, caller_name, instruction, on_done, status, finished_at, expires_at, created_at)
        VALUES (?, '1', ?, ?, ?, ?, 'Agent', 'Caller', 'work', 'react', 'completed', ?, ?, ?)`)
        .run(id, target, caller.id, agent.id, room.id, now.toISOString(), new Date(now.getTime() + 3_600_000).toISOString(), now.toISOString())
      targets.push(target); rooms.push(room.id); busy.add(target)
    }
    await ChatAgentRunner.poll(new Date(now.getTime() + 7_200_000))
    assert.deepEqual(wakes, [])
    for (const target of targets) assert.equal(CodexChatStore.messageCount(target), 0)
    for (const room of rooms) assert.ok(CodexChatStore.findThread(room, 1), 'unpublished results survive even an expired sweep')
    for (const target of targets) {
      callerReplies.set(target, CodexChatStore.addMessage({ thread_id: target, role: 'assistant', content: 'I have delegated the work', tool_calls: [], status: 'completed', error: null }))
      busy.delete(target)
      await ChatAgentRunner.poll(now)
      assert.equal(wakes.filter(id => id === target).length, 1)
      assert.equal(CodexChatStore.listMessages(target).filter(message => message.routing?.agent).length, 1)
    }
    await ChatAgentRunner.poll(now)
    assert.deepEqual(wakes, targets)
  })

  await t.test('results reuse agent display text or translate with the caller slot without changing model text', async child => {
    const translatedCaller = ChatProfileStore.create({ name: 'Korean reader', engine: 'llm', providerName: 'agent-test', model: 'm',
      translationSlotId: caller.modelSlotId, translationModelLanguage: 'en', translationDisplayLanguage: 'ko' })
    let translations = 0
    child.mock.method(globalThis, 'fetch', async () => {
      translations++
      return Response.json({ choices: [{ message: { content: '작업을 끝냈어요.' }, finish_reason: 'stop' }] })
    })
    const now = new Date()
    const targets: number[] = []
    for (const [id, display] of [[301, null], [302, '에이전트가 번역한 답변이에요.']] as const) {
      const target = CodexChatStore.createThread(1, 'Translation caller', 'llm', translatedCaller.id)
      const room = await ensureAutomationRoom(requester, agent.id, `agent:${id}`, 'English agent')
      CodexChatStore.addMessage({ thread_id: room.id, role: 'assistant', content: 'I have finished the work.', display_content: display,
        tool_calls: [], status: 'completed', error: null })
      db.prepare(`INSERT INTO chat_agent_calls (id, account_key, caller_thread_id, caller_profile_id, agent_profile_id, agent_thread_id,
        agent_name, caller_name, instruction, on_done, status, finished_at, expires_at, created_at)
        VALUES (?, '1', ?, ?, ?, ?, 'Agent', 'Korean reader', 'work', 'notify', 'completed', ?, ?, ?)`)
        .run(id, target, translatedCaller.id, agent.id, room.id, now.toISOString(), new Date(now.getTime() + 3_600_000).toISOString(), now.toISOString())
      targets.push(target)
    }
    await ChatAgentRunner.poll(now)
    assert.equal(translations, 1, 'only missing agent display text uses the existing caller translation path')
    assert.equal(CodexChatStore.latestMessage(targets[0])?.display_content, '작업을 끝냈어요.')
    assert.equal(CodexChatStore.latestMessage(targets[1])?.display_content, '에이전트가 번역한 답변이에요.')
    for (const target of targets) assert.equal(CodexChatStore.latestMessage(target)?.content, 'I have finished the work.')
  })
})
