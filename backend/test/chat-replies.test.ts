import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { ChatExecutionContext, ChatMessageRouting } from '@conai/shared'
import type { CodexChatMessageRecord } from '../src/services/codex-chat/codexChatStore'

test('message replies: storage, delivery, context, and generation ownership', { timeout: 30000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-replies-test-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  t.after(async () => {
    dbModule.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-replies-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { ChatGroupStore } = await import('../src/services/codex-chat/chatGroupStore')
  const { GroupChatService } = await import('../src/services/codex-chat/groupChatService')
  const { LlmChatService } = await import('../src/services/codex-chat/llmChatService')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { AuthAccount } = await import('../src/models/AuthAccount')
  const { AuthAccessControlService } = await import('../src/services/authAccessControlService')
  const { buildReplyContext } = await import('../src/services/codex-chat/chatReplyContext')
  const { buildChatMessages, resolveContextConfig, estimateMessagesTokens } = await import('../src/services/codex-chat/llmChatContext')
  const { requireReplyTarget, quoteMessage } = await import('../src/services/codex-chat/chatReplies')
  const { registerChatReply, routeChatReply, linkChatGeneration } = await import('../src/services/codex-chat/chatReplyRegistry')
  const { attachResolvedJobResults, attachJobResults } = await import('../src/services/codex-chat/codexChatMedia')
  const { readMcpToolResult } = await import('../src/services/codex-chat/chatToolReferences')
  const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
  const { exportChatMarkdown } = await import('../src/services/codex-chat/chatExport')
  const { parseMentions, withChatGenerationProgress } = await import('@conai/shared')
  updateChatSettings({ enabled: true })
  t.mock.method(AuthAccount, 'findById', () => ({ id: 1, status: 'active' }))
  t.mock.method(AuthAccessControlService, 'resolveForAccountId', () => ({ permissionKeys: ['chat.llm.use', 'chat.codex.use'] }))
  t.mock.method(ExternalApiProvider, 'findByName', () => ({ provider_name: 'test', display_name: 'Test', is_enabled: true, provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid/v1', additional_config: JSON.stringify({ max_concurrent_requests: 3 }) }))
  t.mock.method(ExternalApiProvider, 'getDecryptedKey', () => null)
  const requester = { accountId: 1, accountType: 'admin' as const }
  const profiles = ['A', 'B', 'C'].map((name) => ChatProfileStore.create({ name, engine: 'llm', providerName: 'test', model: name, mcpEnabled: false, summaryEnabled: false }))
  const [a, b, c] = profiles
  const createRoom = () => GroupChatService.create(requester, { profileIds: profiles.map((profile) => profile.id), representativeId: a.id, userProfileId: null })
  const response = (content: string, tool?: { name: string; args: unknown }) => Response.json({ choices: [{ message: { content, ...(tool ? { tool_calls: [{ id: `call-${Math.random()}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] } : {}) }, finish_reason: tool ? 'tool_calls' : 'stop' }] })

  await t.test('a concurrent member finishing first cannot consume another member’s call; replies return without mentions', async (s) => {
    const room = createRoom()
    let finishA!: () => void
    let finishC!: () => void
    const aGate = new Promise<void>((resolve) => { finishA = resolve })
    const cGate = new Promise<void>((resolve) => { finishC = resolve })
    s.after(() => { finishA(); finishC() })
    let aCalls = 0
    let bCalls = 0
    let bInput = ''
    let bCallsWhenCFinished = -1
    s.mock.method(globalThis, 'fetch', async (_url, init) => {
      const request = JSON.parse(String(init?.body))
      if (request.model === 'C') { await cGate; return response('C finished independently.') }
      if (request.model === 'B') { bCalls += 1; bInput = JSON.stringify(request.messages); return response('Here is the requested result.') }
      aCalls += 1
      if (aCalls === 1) return response('Please draw the blue bird.', { name: 'room_call_member', args: { room_id: room.id, names: ['B'] } })
      if (aCalls === 2) { finishC(); await aGate; return response('B, the request is ready.') }
      if (aCalls === 3) return response('', { name: 'chat_reply_to', args: { to: ['user'] } })
      return response('The result is ready for you.')
    })
    await GroupChatService.sendMessage(requester, room.id, '@A @C begin', (event) => {
      if (event.type === 'done' && event.message.speaker_profile_id === c.id) { bCallsWhenCFinished = bCalls; finishA() }
    })
    const messages = CodexChatStore.listMessages(room.id)
    const firstA = messages.find((message) => message.speaker_profile_id === a.id)!
    const replyB = messages.find((message) => message.speaker_profile_id === b.id)!
    const finalA = messages.at(-1)!
    assert.equal(bCallsWhenCFinished, 0)
    assert.equal(bCalls, 1)
    assert.ok(bInput.includes('Please draw the blue bird.'))
    assert.equal(replyB.routing?.replyTo?.messageId, firstA.id)
    assert.deepEqual(replyB.routing?.recipients, [a.id])
    assert.equal(finalA.speaker_profile_id, a.id)
    assert.equal(finalA.routing?.replyTo?.messageId, replyB.id)
    assert.deepEqual(finalA.routing?.recipients, ['user'])
  })

  await t.test('user reply selects the quoted member; explicit mentions override without losing the quote', async (s) => {
    const room = createRoom()
    const originalId = CodexChatStore.addMessage({ thread_id: room.id, role: 'assistant', speaker_profile_id: b.id, content: 'Choose the blue one.', tool_calls: [], status: 'completed', error: null })
    const models: string[] = []
    s.mock.method(globalThis, 'fetch', async (_url, init) => { models.push(JSON.parse(String(init?.body)).model); return response('Understood.') })
    await GroupChatService.sendMessage(requester, room.id, 'I choose this.', () => {}, undefined, undefined, undefined, undefined, originalId)
    assert.deepEqual(models, ['B'])
    await GroupChatService.sendMessage(requester, room.id, '@C what do you think?', () => {}, undefined, undefined, undefined, undefined, originalId)
    assert.deepEqual(models, ['B', 'C'])
    const user = CodexChatStore.listMessages(room.id).filter((message) => message.role === 'user').at(-1)!
    assert.equal(user.routing?.replyTo?.messageId, originalId)
    assert.deepEqual(user.routing?.recipients, [c.id])
    const otherRoom = createRoom()
    await assert.rejects(GroupChatService.sendMessage(requester, otherRoom.id, 'foreign reply', () => {}, undefined, undefined, undefined, undefined, originalId), /다른 방/)
    assert.equal(CodexChatStore.listMessages(otherRoom.id).length, 0)
    GroupChatService.removeMember(requester, room.id, b.id)
    await assert.rejects(GroupChatService.sendMessage(requester, room.id, 'reply to absent member', () => {}, undefined, undefined, undefined, undefined, originalId), /참가자/)
    assert.deepEqual(parseMentions('> @A\n`@B`\n@C', profiles), [c.id])
  })

  await t.test('chain limits reject the tool call before claiming delivery', async (s) => {
    const room = createRoom()
    GroupChatService.updateRoom(requester, room.id, { chainLimit: 0 })
    let calls = 0
    let toolOutput = ''
    s.mock.method(globalThis, 'fetch', async (_url, init) => {
      const request = JSON.parse(String(init?.body))
      calls += 1
      if (calls === 1) return response('', { name: 'room_call_member', args: { room_id: room.id, names: ['B'] } })
      toolOutput = request.messages.filter((message: { role: string }) => message.role === 'tool').map((message: { content: string }) => message.content).join('')
      return response('The chain limit prevents that call.')
    })
    await GroupChatService.sendMessage(requester, room.id, '@A ask B', () => {})
    assert.match(toolOutput, /한도/)
    assert.equal(CodexChatStore.listMessages(room.id).filter((message) => message.role === 'assistant').length, 1)
  })

  await t.test('cutting in cancels the old reply and its accepted deliveries before the new message runs', async (s) => {
    const room = createRoom()
    let waiting!: () => void
    const startedWaiting = new Promise<void>((resolve) => { waiting = resolve })
    let aCalls = 0
    const models: string[] = []
    s.mock.method(globalThis, 'fetch', async (_url, init) => {
      const request = JSON.parse(String(init?.body))
      models.push(request.model)
      if (request.model !== 'A') return response('New user request accepted.')
      if (++aCalls === 1) return response('Calling B.', { name: 'room_call_member', args: { room_id: room.id, names: ['B'] } })
      waiting()
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (signal?.aborted) reject(new DOMException('Aborted', 'AbortError'))
        else signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    })
    const oldRun = GroupChatService.sendMessage(requester, room.id, '@A ask B', () => {})
    await startedWaiting
    await GroupChatService.sendMessage(requester, room.id, '@C new request', () => {})
    await oldRun
    const messages = CodexChatStore.listMessages(room.id)
    assert.ok(!models.includes('B'))
    assert.equal(messages.find((message) => message.speaker_profile_id === a.id)?.status, 'interrupted')
    assert.equal(messages.at(-1)?.speaker_profile_id, c.id)
    assert.equal(messages.at(-1)?.routing?.replyTo?.messageId, messages.at(-2)?.id)
  })

  await t.test('a summarized direct quote brings back its surrounding turn, with bounded text and no tool execution', async (s) => {
    const threadId = LlmChatService.createThread(requester, a.id, null)
    for (let index = 0; index < 14; index += 1) CodexChatStore.addMessage({ thread_id: threadId, role: index % 2 ? 'assistant' : 'user', content: `old-${index} ${'scene '.repeat(30)}`, tool_calls: [], status: 'completed', error: null })
    const target = CodexChatStore.listMessages(threadId)[3]
    CodexChatStore.setSummary(threadId, 'Earlier conversation summarized.', CodexChatStore.listMessages(threadId)[11].id)
    CodexChatStore.updateThreadContext(threadId, { summaryEnabled: true, contextTurns: 1 })
    let input = ''
    s.mock.method(globalThis, 'fetch', async (_url, init) => { input = String(init?.body); return response('I understand the earlier scene.') })
    const thread = CodexChatStore.findThreadById(threadId)!
    await LlmChatService.sendMessage(requester, thread, 'About this earlier answer…', () => {}, undefined, undefined, undefined, undefined, target.id)
    assert.ok(input.includes('old-3'))
    assert.ok(input.includes('old-2'))
    assert.ok(input.includes('old-4'))
    const rows = CodexChatStore.listMessages(threadId)
    const user = rows.at(-2)!
    const tiny = buildReplyContext(rows, user.routing, { maxChars: 700 })
    assert.ok(tiny.length < 850)
    assert.ok(tiny.includes(`message ${target.id}`))
    const profile = { ...a, contextTokens: 2200, maxTokens: 100 }
    const built = buildChatMessages({ profile, thread, messages: rows.slice(0, -1), config: resolveContextConfig(thread, profile), tools: [] })
    assert.ok(estimateMessagesTokens(profile.id, built) + 100 <= 2200)
    assert.equal(rows.at(-1)?.routing?.replyTo?.messageId, user.id)
    assert.match(exportChatMarkdown(thread, rows, [], a.name, 'http://localhost'), /받는 사람|원문/)
  })

  await t.test('quote snapshots survive alternative selection and become unavailable after target removal', () => {
    const room = createRoom()
    const id = CodexChatStore.addMessage({ thread_id: room.id, role: 'assistant', speaker_profile_id: a.id, content: 'Original answer', tool_calls: [], status: 'completed', error: null })
    const quote = quoteMessage(room, CodexChatStore.listMessages(room.id)[0])
    const child = CodexChatStore.addMessage({ thread_id: room.id, role: 'user', content: 'Reply', tool_calls: [], status: 'completed', error: null, routing: { replyTo: quote, recipients: [a.id] } })
    CodexChatStore.addAlternative(room.id, id, { content: 'Regenerated answer', tool_calls: [], created_at: '', status: 'completed', error: null })
    const rows = CodexChatStore.listMessages(room.id)
    assert.match(buildReplyContext(rows, rows[1].routing), /Original answer/)
    assert.equal(rows[1].routing?.replyTo?.excerpt, 'Original answer')
    dbModule.getUserSettingsDb().prepare('DELETE FROM codex_chat_messages WHERE id = ?').run(id)
    const saved = CodexChatStore.listMessages(room.id).find((message) => message.id === child)!
    assert.equal(saved.routing?.replyTo?.unavailable, true)
    assert.equal(saved.routing?.replyTo?.excerpt, '')
    assert.throws(() => requireReplyTarget(room.id, id), /메시지/)
  })

  await t.test('lookup calls never own another reply’s image; interrupted submissions retain their original owner', () => {
    const room = createRoom()
    const routing: ChatMessageRouting = { replyId: 'creator-B', replyTo: null, recipients: [a.id] }
    const call = (id: string, tool: string) => ({ id, tool, status: 'completed' as const, arguments: {}, summary: null, jobIds: [100], historyIds: [], compositeHashes: [] })
    const rows = [
      { id: 1, thread_id: room.id, role: 'assistant', tool_calls: [call('lookup', 'wait_generation_job')] },
      { id: 2, thread_id: room.id, role: 'assistant', routing, tool_calls: [call('submit', 'generate_image_2'), call('wait', 'wait_generation_job')] },
    ] as CodexChatMessageRecord[]
    const enriched = attachResolvedJobResults(rows, new Map([[100, [901]]]), new Set(), new Map([[100, 'creator-B']]))
    assert.deepEqual(enriched[0].tool_calls[0].historyIds, [])
    assert.equal(enriched[0].tool_calls[0].generated, false)
    assert.deepEqual(enriched[1].tool_calls[0].historyIds, [901])
    const pending = attachResolvedJobResults(rows, new Map(), new Set([100]), new Map([[100, 'creator-B']]))
    assert.deepEqual(pending[1].tool_calls[0].pendingJobIds, [100])
    assert.deepEqual(pending[0].tool_calls[0].pendingJobIds ?? [], [])
    const live = withChatGenerationProgress([{ ...call('submit', 'generate_image'), pendingJobIds: [100], generated: true }, { ...call('wait', 'wait_generation_job'), historyIds: [901], pendingJobIds: [], generated: false }])
    assert.deepEqual(live[0].pendingJobIds, [])
    assert.deepEqual(live[0].historyIds, [901])
    assert.deepEqual(withChatGenerationProgress(pending[1].tool_calls)[0].pendingJobIds, [100])
    linkChatGeneration({ threadId: room.id, profileId: b.id, kind: 'group', replyId: 'creator-B' }, 100)
    linkChatGeneration({ threadId: room.id, profileId: a.id, kind: 'group', replyId: 'wrong-owner' }, 100)
    CodexChatStore.addMessage({ thread_id: room.id, role: 'assistant', speaker_profile_id: b.id, content: 'Interrupted', tool_calls: [], status: 'interrupted', error: null, routing })
    const recovered = attachJobResults(CodexChatStore.listMessages(room.id)).messages[0]
    assert.deepEqual(recovered.tool_calls[0].jobIds, [100])
    assert.equal(recovered.routing?.replyId, 'creator-B')
    assert.deepEqual(readMcpToolResult({ structuredContent: { id: 100 } }, 'generate_image_2').jobIds, [100])
  })

  await t.test('MCP rejects foreign rooms, forged execution bindings and stale replies', async () => {
    const room = createRoom()
    const other = createRoom()
    const controller = new AbortController()
    const context: ChatExecutionContext = { threadId: room.id, profileId: a.id, kind: 'group', replyId: 'boundary' }
    const close = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge(requester, [], null, { roomTools: 'all', chatContext: context })
    try {
      const result = await bridge.call('room_history_read', { room_id: other.id, message_id: 1 })
      assert.equal(result.isError, true)
      assert.throws(() => routeChatReply({ ...context, profileId: b.id }, { recipients: ['user'] }), /ended|interrupted/)
      controller.abort()
      assert.throws(() => routeChatReply(context, { recipients: ['user'] }), /ended|interrupted/)
    } finally { close(); await bridge.close() }
  })
})
