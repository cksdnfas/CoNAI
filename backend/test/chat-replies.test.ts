import './support/testTemp'
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
  const { ChatSummaryStore } = await import('../src/services/codex-chat/chatMemory')
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
  t.mock.method(AuthAccessControlService, 'resolveForAccountId', () => ({ permissionKeys: ['chat.use', 'chat.agent.use'] }))
  t.mock.method(ExternalApiProvider, 'findByName', () => ({ provider_name: 'test', display_name: 'Test', is_enabled: true, provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid/v1', additional_config: JSON.stringify({ max_concurrent_requests: 3 }) }))
  t.mock.method(ExternalApiProvider, 'getDecryptedKey', () => null)
  const requester = { accountId: 1, accountType: 'admin' as const }
  const profiles = ['A', 'B', 'C'].map((name) => ChatProfileStore.create({ name, engine: 'llm', providerName: 'test', model: name, mcpEnabled: false, summaryEnabled: false }))
  const [a, b, c] = profiles
  const createRoom = () => GroupChatService.create(requester, { profileIds: profiles.map((profile) => profile.id), representativeId: a.id, userProfileId: null })
  const response = (content: string, tool?: { name: string; args: unknown }) => Response.json({ choices: [{ message: { content, ...(tool ? { tool_calls: [{ id: `call-${Math.random()}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] } : {}) }, finish_reason: tool ? 'tool_calls' : 'stop' }] })

  await t.test('input translation reaches direct sends, edits and group task continuations before the chat model, including picks', async s => {
    const profile = ChatProfileStore.create({
      name: 'Translator', engine: 'llm', providerName: 'test', model: 'target',
      translationProviderName: 'test', translationModel: 'translator',
      mcpEnabled: false, summaryEnabled: false,
    })
    const requests: Array<{ model: string; messages: Array<{ role: string; content: unknown }> }> = []
    s.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      requests.push(body)
      if (body.model !== 'translator') return response('끝.')
      const input = body.messages.at(-1).content as string
      if (input === '작업 계속') return response('Continue the task.')
      const translations: Record<string, string> = { '다음 장면': 'Next scene.', '검 사용': 'Use the sword.', '장면 수정': 'Edit the scene.', 'Next?': '다음은?', Go: '간다', Stay: '머문다', '간다': 'Go' }
      if (translations[input]) return response(translations[input])
      const texts = JSON.parse(input) as Record<string, string>
      return response(JSON.stringify(Object.fromEntries(Object.entries(texts).map(([key, text]) => {
        assert.ok(translations[text], `unexpected translation input: ${text}`)
        return [key, translations[text]]
      }))))
    })
    const direct = CodexChatStore.findThreadById(LlmChatService.createThread(requester, profile.id))!
    await LlmChatService.sendMessage(requester, direct, '다음 장면', () => {}, undefined, undefined, ['검 사용'])
    const user = CodexChatStore.listMessages(direct.id).find(message => message.role === 'user')!
    assert.equal(user.content, 'Next scene.')
    assert.equal(user.display_content, '다음 장면')
    assert.equal(user.flags?.[0].content, 'Use the sword.')
    assert.equal(user.flags?.[0].name, '검 사용')
    const first = JSON.stringify(requests.find(request => request.model === 'target')?.messages)
    assert.match(first, /Next scene\./)
    assert.match(first, /Use the sword\./)
    assert.ok(!first.includes('다음 장면') && !first.includes('검 사용'))
    await LlmChatService.rewriteMessage(requester, CodexChatStore.findThreadById(direct.id)!, user.id, '장면 수정', () => {})
    assert.equal(CodexChatStore.findMessage(direct.id, user.id)?.content, 'Edit the scene.')

    // A translated card is answered by its display label, but the stored model question/answer stay original.
    const latest = CodexChatStore.latestMessage(direct.id)!
    const context: ChatExecutionContext = { threadId: direct.id, profileId: profile.id, kind: 'direct', replyId: latest.routing!.replyId }
    const controller = new AbortController()
    const unregister = registerChatReply(context, controller.signal, () => latest.routing!)
    const bridge = await openChatMcpBridge(requester, ['read'], null, { chatContext: context })
    let proposalId: number
    try {
      const made = await bridge.call('offer_choices', { question: 'Next?', options: [{ label: 'Go' }, { label: 'Stay' }] })
      assert.ok(!made.isError)
      const { ChatProposalStore } = await import('../src/services/codex-chat/chatProposals')
      const card = ChatProposalStore.forReply(direct.id, context.replyId!, 'choice')[0]
      assert.ok(card.kind === 'choice')
      assert.equal(card.question, '다음은?')
      assert.deepEqual(card.options.map(option => option.label), ['간다', '머문다'])
      const { proposalStatuses } = await import('../src/services/codex-chat/chatPageContext')
      assert.equal(proposalStatuses(direct.id, [card.id])[0].name, '선택지 "Next?"')
      proposalId = card.id
    } finally {
      await bridge.close()
      unregister()
    }
    await LlmChatService.sendMessage(requester, CodexChatStore.findThreadById(direct.id)!, '간다', () => {}, undefined, undefined, undefined, undefined, undefined, undefined, { choice: { proposalId, answers: ['간다'] } })
    const picked = CodexChatStore.listMessages(direct.id).filter(message => message.role === 'user').at(-1)!
    assert.equal(picked.content, 'Go')
    assert.equal(picked.flags?.[0].name, '간다')
    assert.equal(picked.flags?.[0].content, 'Go')
    assert.equal(picked.flags?.[0].choice?.question, 'Next?')
    const pickRequest = JSON.stringify(requests.filter(request => request.model === 'target').at(-1)?.messages)
    assert.match(pickRequest, /Next\?/)
    assert.match(pickRequest, /Go/)
    assert.ok(!pickRequest.includes('간다') && !pickRequest.includes('다음은?'), 'the outgoing model request never uses display-language choice text')

    const room = GroupChatService.create(requester, { profileIds: [profile.id, b.id], representativeId: profile.id, userProfileId: null })
    await GroupChatService.sendMessage(requester, room.id, '작업 계속', () => {}, undefined, undefined, undefined, undefined, undefined, {
      task: { id: 999, step: 1, total: 1, title: '작업', event: 'continue' }, recipients: [profile.id], chainLimit: 0,
    })
    const taskInput = CodexChatStore.listMessages(room.id).find(message => message.role === 'user')!
    assert.equal(taskInput.content, 'Continue the task.')
    assert.equal(taskInput.display_content, '작업 계속')
    assert.equal(requests.filter(request => request.model === 'translator').length, 5, 'one translation per user turn and one for the entire card, not once per pick')
    const last = JSON.stringify(requests.filter(request => request.model === 'target').at(-1)?.messages)
    assert.match(last, /Continue the task\./)
    assert.ok(!last.includes('작업 계속'))
  })

  await t.test('regenerate and continue retry cancelled input translation before sending the model request', async s => {
    for (const action of ['regenerate', 'continue'] as const) {
      await s.test(action, async sub => {
        const profile = ChatProfileStore.create({
          name: `Retry ${action}`, engine: 'llm', providerName: 'test', model: 'retry-target',
          translationProviderName: 'test', translationModel: 'retry-translator', mcpEnabled: false, summaryEnabled: false,
        })
        const thread = CodexChatStore.findThreadById(LlmChatService.createThread(requester, profile.id))!
        let started!: () => void
        const translationStarted = new Promise<void>(resolve => { started = resolve })
        let first = true
        const sent: unknown[] = []
        sub.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
          const request = JSON.parse(init.body as string)
          if (request.model === 'retry-translator') {
            if (first) {
              first = false
              started()
              return new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }))
            }
            return response('Please retry.')
          }
          sent.push(request.messages)
          return response('끝.')
        })
        let running: Promise<CodexChatMessageRecord>
        if (action === 'regenerate') {
          running = LlmChatService.sendMessage(requester, thread, '다시 해줘', () => {})
        } else {
          CodexChatStore.addMessage({ thread_id: thread.id, role: 'user', content: '다시 해줘', display_content: null, tool_calls: [], status: 'completed', error: '입력 번역 실패' })
          const partial = CodexChatStore.addMessage({ thread_id: thread.id, role: 'assistant', content: '앞부분.', tool_calls: [], status: 'completed', error: null, finish_reason: 'length' })
          running = LlmChatService.continueReply(requester, thread, partial, () => {})
        }
        await translationStarted
        await LlmChatService.stop(thread.id)
        await running
        assert.equal(sent.length, 0, 'stopping preparation never sends the untranslated row')
        const user = CodexChatStore.listMessages(thread.id).find(message => message.role === 'user')!
        assert.equal(user.content, '다시 해줘')
        assert.equal(user.display_content, null)
        const latest = CodexChatStore.latestMessage(thread.id)!
        const current = CodexChatStore.findThreadById(thread.id)!
        if (action === 'regenerate') await LlmChatService.rewriteMessage(requester, current, latest.id, undefined, () => {})
        else await LlmChatService.continueReply(requester, current, latest.id, () => {})
        assert.equal(sent.length, 1)
        assert.match(JSON.stringify(sent[0]), /Please retry\./)
        assert.ok(!JSON.stringify(sent[0]).includes('다시 해줘'))
        const translated = CodexChatStore.findMessage(thread.id, user.id)!
        assert.equal(translated.content, 'Please retry.')
        assert.equal(translated.display_content, '다시 해줘')
        assert.equal(translated.error, null)
        CodexChatStore.setUserMessageTranslation(thread.id, user.id, translated.content, null)
        assert.equal(CodexChatStore.findMessage(thread.id, user.id)?.display_content, '다시 해줘', 'a no-op translation cannot erase the saved original')
      })
    }
  })

  await t.test('regenerate retries a failed translation and edit rewind clears its old notice immediately', async s => {
    const profile = ChatProfileStore.create({ name: 'Failed translation', engine: 'llm', providerName: 'test', model: 'failure-target', translationProviderName: 'test', translationModel: 'failure-translator', summaryEnabled: false, mcpEnabled: false })
    const thread = CodexChatStore.findThreadById(LlmChatService.createThread(requester, profile.id))!
    let fail = true
    const inputs: string[] = []
    s.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
      const request = JSON.parse(init.body as string)
      if (request.model === 'failure-translator') return response(fail ? '' : 'Try again.')
      inputs.push(JSON.stringify(request.messages))
      return response('끝.')
    })
    const first = await LlmChatService.sendMessage(requester, thread, '다시 해줘', () => {})
    const user = CodexChatStore.listMessages(thread.id).find(message => message.role === 'user')!
    assert.ok(user.error)
    fail = false
    await LlmChatService.rewriteMessage(requester, CodexChatStore.findThreadById(thread.id)!, first.id, undefined, () => {})
    assert.ok(!inputs.at(-1)!.includes('다시 해줘'))
    assert.equal(CodexChatStore.findMessage(thread.id, user.id)?.error, null)
    CodexChatStore.setUserMessageTranslation(thread.id, user.id, 'Try again.', null, undefined, 'old translation notice')
    let rewind: CodexChatMessageRecord | undefined
    await LlmChatService.rewriteMessage(requester, CodexChatStore.findThreadById(thread.id)!, user.id, '고쳐줘', event => {
      if (event.type === 'rewind') rewind = event.message
    })
    assert.ok(rewind)
    assert.equal(rewind.error, null)
  })

  await t.test('group suggestions use the room translator and keep generated options on a display-translation timeout', async s => {
    const { suggestReplies, ChatSuggestError } = await import('../src/services/codex-chat/chatSuggestions')
    const translator = ChatProfileStore.create({ name: 'Room translator', engine: 'llm', providerName: 'test', model: 'room-chat', translationProviderName: 'test', translationModel: 'room-translator', summaryEnabled: false, mcpEnabled: false })
    const room = GroupChatService.create(requester, { profileIds: [a.id, translator.id], representativeId: a.id, userProfileId: null })
    const representative = { ...a, suggestEnabled: true }
    const history = [{ id: 1, thread_id: room.id, role: 'user', content: '안녕', tool_calls: [], status: 'completed', error: null } as CodexChatMessageRecord]
    const timeout = AbortSignal.timeout.bind(AbortSignal)
    let deadline = new AbortController()
    s.mock.method(AbortSignal, 'timeout', (ms: number) => ms === 60_000 ? deadline.signal : timeout(ms))
    let expire = false
    let cancel: AbortController | undefined
    let translations = 0
    s.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
      const request = JSON.parse(init.body as string)
      if (request.model !== 'room-translator') return response('["Go", "Stay"]')
      translations++
      if (expire) deadline.abort(new DOMException('Suggestion deadline', 'TimeoutError'))
      cancel?.abort()
      init.signal!.throwIfAborted()
      return response('{"0":"가자","1":"기다려"}')
    })
    assert.deepEqual(await suggestReplies(representative, room, history, () => 'A'), ['가자', '기다려'])
    assert.equal(translations, 1, 'a non-translating representative still uses the member translator')
    expire = true
    assert.deepEqual(await suggestReplies(representative, room, history, () => 'A'), ['Go', 'Stay'])
    expire = false
    deadline = new AbortController()
    cancel = new AbortController()
    await assert.rejects(suggestReplies(representative, room, history, () => 'A', cancel.signal), error => error instanceof ChatSuggestError && error.status === 499)
  })

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
    ChatSummaryStore.replaceAll(threadId, 'Earlier conversation summarized.', CodexChatStore.listMessages(threadId)[11].id)
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

  await t.test('bounded reply history preserves older targets, ancestors and the complete request', (s) => {
    const id = LlmChatService.createThread(requester, a.id, null)
    for (let index = 0; index < 120; index += 1) CodexChatStore.addMessage({
      thread_id: id, role: index % 2 ? 'assistant' : 'user', content: `message-${index}`,
      tool_calls: [], status: 'completed', error: null,
    })
    const original = CodexChatStore.listMessages(id)
    const source = { threadId: id, excludeMessageId: original[119].id }
    const thread = CodexChatStore.findThreadById(id)!
    CodexChatStore.setMessageRouting(id, original[31].id, { recipients: ['user'], replyTo: quoteMessage(thread, original[1]) })
    CodexChatStore.setMessageRouting(id, original[118].id, { recipients: [a.id], replyTo: quoteMessage(thread, original[31]) })
    ChatSummaryStore.replaceAll(id, 'Folded history', original[111].id)
    CodexChatStore.updateThreadContext(id, { summaryEnabled: true, contextTurns: 2 })
    const full = CodexChatStore.listMessages(id).filter((message) => message.id !== source.excludeMessageId)
    const bounded = CodexChatStore.listContextMessages(source, { afterId: original[111].id, recentMessages: 4, textMessages: 4 })
    assert.deepEqual(bounded.map((message) => message.id), original.slice(112, 119).map((message) => message.id))
    assert.equal(requireReplyTarget(id, original[1].id, bounded, source)?.content, 'message-1')
    assert.throws(() => requireReplyTarget(id, source.excludeMessageId, bounded, source), /메시지/)
    const other = LlmChatService.createThread(requester, a.id, null)
    const privateId = CodexChatStore.addMessage({ thread_id: other, role: 'user', content: 'private', tool_calls: [], status: 'completed', error: null })
    assert.throws(() => requireReplyTarget(id, privateId, bounded, source), /메시지/)
    const routing = full.at(-1)!.routing
    const restored = buildReplyContext(bounded, routing, { historySource: source })
    assert.equal(restored, buildReplyContext(full, routing))
    assert.match(restored, /message-1\b/)
    assert.match(restored, /message-30\b/)
    const current = CodexChatStore.findThreadById(id)!
    const params = { profile: a, thread: current, config: resolveContextConfig(current, a), tools: [] }
    const positions = s.mock.method(CodexChatStore, 'listMessagePositions')
    assert.deepEqual(buildChatMessages({ ...params, messages: bounded, historySource: source }), buildChatMessages({ ...params, messages: full }))
    assert.equal(positions.mock.callCount(), 1, 'the quote estimate and rendering share one position read')
  })

  await t.test('bounded room history preserves stale wakes, hidden counts, quote ancestors and reset/resumed member windows', async (s) => {
    const { readGroupReplyHistory, buildGroupLlmMessages, buildGroupCodexInput, groupMissedMessages } = await import('../src/services/codex-chat/groupChatContext')
    const { sendableMessages } = await import('../src/services/codex-chat/llmChatContext')
    const room = createRoom()
    ChatGroupStore.setLimits(room.id, { window: 6 })
    for (let i = 0; i < 240; i++) CodexChatStore.addMessage({
      thread_id: room.id, role: i % 2 ? 'assistant' : 'user', content: i % 11 === 0 ? ' \n' : `room-${i}`,
      speaker_profile_id: i % 2 ? (i % 3 ? a.id : b.id) : null,
      routing: i % 4 === 0 ? { recipients: [a.id], routine: { source: 'routine', id: 1, name: 'repeat' } } : null,
      tool_calls: [], status: 'completed', error: null,
    })
    const rows = CodexChatStore.listMessages(room.id)
    const thread = CodexChatStore.findThreadById(room.id)!
    CodexChatStore.setMessageRouting(room.id, rows[31].id, { recipients: ['user'], replyTo: quoteMessage(thread, rows[1]) })
    CodexChatStore.setMessageRouting(room.id, rows.at(-2)!.id, { recipients: [a.id], replyTo: quoteMessage(thread, rows[31]) })
    ChatGroupStore.setLastSeen(room.id, a.id, rows[180].id)
    const source = { threadId: room.id, excludeMessageId: rows.at(-1)!.id }
    const full = CodexChatStore.listMessages(room.id).filter(row => row.id !== source.excludeMessageId)
    const bounded = readGroupReplyHistory(thread, a, source)
    const later = CodexChatStore.addMessage({ thread_id: room.id, role: 'user', content: 'A concurrent message outside this reply snapshot', tool_calls: [], status: 'completed', error: null })
    assert.throws(() => requireReplyTarget(room.id, later, bounded.messages, bounded.history.source))
    assert.deepEqual(bounded.history.outline.filter(row => row.sendable).map(row => row.id), sendableMessages(full).map(row => row.id))
    assert.ok(bounded.messages.length < 30)
    const routing = full.at(-1)!.routing ?? undefined
    const params = { profile: a, thread, members: profiles, routing, windowLimit: 6, tools: [], withTools: false, maxTokens: null }
    let expectedMeta: unknown
    let actualMeta: unknown
    const expected = buildGroupLlmMessages({ ...params, messages: full, onMeta: meta => { expectedMeta = meta } })
    assert.deepEqual(buildGroupLlmMessages({ ...params, ...bounded, onMeta: meta => { actualMeta = meta } }), expected)
    assert.deepEqual(actualMeta, expectedMeta)
    for (const lastSeenMessageId of [null, rows[180].id]) {
      const input = { ...params, self: a, lastSeenMessageId, lore: '', directive: '' }
      assert.equal(buildGroupCodexInput({ ...input, ...bounded }), buildGroupCodexInput({ ...input, messages: full }))
      const complete = groupMissedMessages(full, a.id, lastSeenMessageId, 6)
      const limited = groupMissedMessages(bounded.messages, a.id, lastSeenMessageId, 6, bounded.history)
      assert.deepEqual(limited.shown.map(row => row.id), complete.shown.map(row => row.id))
      assert.equal(limited.missed.length, complete.missed.length)
    }
    assert.equal(requireReplyTarget(room.id, rows[1].id, bounded.messages, source)?.id, rows[1].id)
    assert.throws(() => requireReplyTarget(room.id, source.excludeMessageId, bounded.messages, source))
    s.diagnostic(`group startup bodies: ${full.length} -> ${bounded.messages.length}; outline: ${bounded.history.outline.length} body-free rows`)
    CodexChatStore.setMessageRouting(room.id, rows[1].id, { replyId: 'active-generation-owner', recipients: ['user'] })
    assert.equal(CodexChatStore.findMessageByReplyId(room.id, 'active-generation-owner', 'assistant')?.id, rows[1].id)
    assert.equal(CodexChatStore.findMessageByReplyId(room.id, 'active-generation-owner', 'user'), undefined)
    assert.equal(CodexChatStore.findMessageByReplyId(createRoom().id, 'active-generation-owner'), undefined)
    CodexChatStore.setMessageRouting(room.id, rows[1].id, null)
    assert.equal(CodexChatStore.findMessageByReplyId(room.id, 'active-generation-owner'), undefined)
  })

  await t.test('quote snapshots survive alternative selection and become unavailable after target removal', () => {
    const room = createRoom()
    const id = CodexChatStore.addMessage({ thread_id: room.id, role: 'assistant', speaker_profile_id: a.id, content: 'Original answer', tool_calls: [], status: 'completed', error: null })
    const quote = quoteMessage(room, CodexChatStore.listMessages(room.id)[0])
    const child = CodexChatStore.addMessage({ thread_id: room.id, role: 'user', content: 'Reply', tool_calls: [], status: 'completed', error: null, routing: { replyTo: quote, recipients: [a.id] } })
    CodexChatStore.addAlternative(room.id, id, { content: 'Regenerated answer', tool_calls: [], created_at: '', status: 'completed', error: null })
    const rows = CodexChatStore.listMessages(room.id)
    assert.match(buildReplyContext(rows, rows[1].routing), /Original answer/)
    assert.equal(buildReplyContext(rows.slice(-1), rows[1].routing, { historySource: { threadId: room.id } }), buildReplyContext(rows, rows[1].routing))
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

  // ---- Live test findings (2026-10-06, llama.cpp + Qwen) ---------------------------------------------------------

  const { REPLY_FAILURES } = await import('../src/services/codex-chat/llmChatService')
  const sse = (...chunks: unknown[]) => new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  const text = (content: string, finish: string | null = null) => ({ choices: [{ delta: { content }, finish_reason: finish }] })
  const toolCall = (name: string, args: string, finish: string) => ({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call-${Math.random()}`, type: 'function', function: { name, arguments: args } }] }, finish_reason: finish }] })
  const directChat = () => CodexChatStore.findThreadById(LlmChatService.createThread(requester, a.id))!
  type StreamEvent = Parameters<Parameters<typeof LlmChatService.sendMessage>[3]>[0]

  await t.test('direct chats get no room history tools and always chat_reply_to (a steady tool list); group rooms get all', async () => {
    const names = async (context: ChatExecutionContext) => {
      const bridge = await openChatMcpBridge(requester, [], null, { chatContext: context })
      try { return bridge.tools.map((tool) => tool.function.name) } finally { await bridge.close() }
    }
    const thread = directChat()
    const sayUser = (content: string) => CodexChatStore.addMessage({ thread_id: thread.id, role: 'user', content, tool_calls: [], status: 'completed', error: null })
    const directContext = { threadId: thread.id, profileId: a.id, kind: 'direct' as const, replyId: 'tools-direct' }
    sayUser('안녕')
    const first = await names(directContext)
    assert.ok(first.includes('chat_reply_to'), 'offered from the first message, so the tool list does not change on the second')
    for (const tool of ['room_history_search', 'room_history_read', 'room_call_member']) assert.ok(!first.includes(tool), tool)
    sayUser('아까 그 얘기 말인데')
    const direct = await names(directContext)
    assert.ok(direct.includes('chat_reply_to'), 'an older message to quote')
    for (const tool of ['room_history_search', 'room_history_read', 'room_call_member']) assert.ok(!direct.includes(tool), tool)
    const guidance = String(buildChatMessages({ profile: ChatProfileStore.find(a.id)!, thread, messages: CodexChatStore.listMessages(thread.id), config: resolveContextConfig(thread, ChatProfileStore.find(a.id)!), tools: [] })[0].content)
    assert.ok(guidance.includes('you are already answering the latest message; use chat_reply_to only to quote an older one'))
    const group = await names({ threadId: createRoom().id, profileId: a.id, kind: 'group', replyId: 'tools-group' })
    for (const tool of ['chat_reply_to', 'room_history_search', 'room_history_read', 'room_call_member']) assert.ok(group.includes(tool), tool)
  })

  await t.test('tool calls cut by the output cap fail the reply, never run and never go out again', async (s) => {
    const thread = directChat()
    const bodies: Array<{ messages: Array<{ role: string; tool_calls?: unknown[]; content?: unknown }>; tools?: Array<{ function: { name: string } }> }> = []
    s.mock.method(globalThis, 'fetch', async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return bodies.length === 1
        ? sse(text('잠깐만.'), toolCall('save_lore', '{"title":"등', 'length'))
        : sse(text('응, 알았어.', 'stop'))
    })
    const events: StreamEvent[] = []
    const failed = await LlmChatService.sendMessage(requester, thread, '이거 저장해줘', (event) => events.push(event))
    assert.equal(failed.status, 'failed')
    assert.equal(failed.error, REPLY_FAILURES.toolCallsCut)
    assert.deepEqual(failed.tool_calls, [])
    assert.ok(events.some((event) => event.type === 'error' && event.message === REPLY_FAILURES.toolCallsCut))
    assert.ok(!(bodies[0].tools ?? []).some((tool) => tool.function.name.startsWith('room_')), 'a direct request offers no room tools')
    await LlmChatService.sendMessage(requester, CodexChatStore.findThreadById(thread.id)!, '다시', () => {})
    assert.ok(!bodies[1].messages.some((message) => message.role === 'tool' || message.tool_calls), 'the broken call is not replayed')
  })

  await t.test('an empty reply fails: at the cap it names thinking; regenerating it works', async (s) => {
    const thread = directChat()
    let reply = sse({ choices: [{ delta: { reasoning_content: '음… 어떻게 말하지' }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: 'length' }] })
    s.mock.method(globalThis, 'fetch', async () => reply)
    const events: StreamEvent[] = []
    const atCap = await LlmChatService.sendMessage(requester, thread, '안녕', (event) => events.push(event))
    assert.equal(atCap.status, 'failed')
    assert.equal(atCap.error, REPLY_FAILURES.emptyAtCap)
    assert.ok(events.some((event) => event.type === 'error' && event.message === REPLY_FAILURES.emptyAtCap))
    reply = sse(text('', 'stop'))
    const empty = await LlmChatService.sendMessage(requester, CodexChatStore.findThreadById(thread.id)!, '대답해줘', () => {})
    assert.equal(empty.status, 'failed')
    assert.equal(empty.error, REPLY_FAILURES.empty)
    reply = sse(text('미안, 안녕!', 'stop'))
    const regenerated = await LlmChatService.rewriteMessage(requester, CodexChatStore.findThreadById(thread.id)!, empty.id, undefined, () => {})
    assert.equal(regenerated.status, 'completed')
    assert.equal(regenerated.content, '미안, 안녕!')
  })

  await t.test('a context overflow after a tool result fails the reply on the stream, with the reason', async (s) => {
    const profile = ChatProfileStore.create({ name: 'D', engine: 'llm', providerName: 'test', model: 'D', mcpEnabled: false, summaryEnabled: false, contextTokens: 100000, maxTokens: 100 })
    const live = ChatProfileStore.find(profile.id)!
    const find = ChatProfileStore.find.bind(ChatProfileStore)
    s.mock.method(ChatProfileStore, 'find', (id: number) => (id === profile.id ? live : find(id)))
    const thread = CodexChatStore.findThreadById(LlmChatService.createThread(requester, profile.id))!
    let calls = 0
    s.mock.method(globalThis, 'fetch', async () => {
      calls += 1
      // The budget shrinks under the reply: the request after the tool round cannot fit, whatever is cut.
      live.contextTokens = 50
      return sse(toolCall('chat_reply_to', '{"to":["user"]}', 'tool_calls'))
    })
    const events: StreamEvent[] = []
    const failed = await LlmChatService.sendMessage(requester, thread, '안녕', (event) => events.push(event))
    assert.equal(calls, 1)
    assert.equal(failed.status, 'failed')
    assert.match(failed.error ?? '', /컨텍스트 한도를 넘었어/)
    assert.ok(events.some((event) => event.type === 'error' && /컨텍스트 한도를 넘었어/.test(event.message)))
    assert.equal(events.at(-1)?.type, 'done')
  })

  await t.test('an echoed address label is not streamed, nor stored', async (s) => {
    const thread = directChat()
    s.mock.method(globalThis, 'fetch', async () => sse(text('[message_id='), text('9; to=["user"]'), text(']\n'), text('안녕, '), text('반가워.', 'stop')))
    let streamed = ''
    const reply = await LlmChatService.sendMessage(requester, thread, '안녕', (event) => { if (event.type === 'delta') streamed += event.text })
    assert.equal(streamed, '안녕, 반가워.')
    assert.equal(reply.content, '안녕, 반가워.')
  })

  await t.test('a looping reply is hung up on, and the loop is taken back off the live text and the stored reply', async (s) => {
    const thread = directChat()
    const said = '"좋아, 존. 그땐 네가 1번 회원으로 가입하는 거야.'
    const loop = Array.from({ length: 400 }, () => text('wuwx'))
    let served = 0
    s.mock.method(globalThis, 'fetch', async () => {
      const chunks = [text(said), text('wxwuxwux'), ...loop, text('', 'length')]
      return new Response(new ReadableStream({
        pull(controller) {
          const chunk = chunks[served++]
          if (!chunk) { controller.close(); return }
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`))
        },
      }), { headers: { 'Content-Type': 'text/event-stream' } })
    })
    const events: StreamEvent[] = []
    const reply = await LlmChatService.sendMessage(requester, thread, '계약하자', (event) => events.push(event))
    assert.equal(reply.content, said)
    assert.equal(reply.finish_reason, 'repetition')
    assert.ok(served < 150, `kept reading after the loop (${served} chunks)`)
    const last = events.filter((event) => event.type === 'text').at(-1)
    assert.deepEqual(last && 'text' in last ? last.text : null, said)
  })

  await t.test('the loop check leaves ordinary repeats and long varied text alone', async () => {
    const { repetitionCut, withoutRepetition } = await import('../src/services/codex-chat/repetitionGuard')
    assert.equal(repetitionCut('ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ 진짜 웃기다……'), null)
    assert.equal(repetitionCut(Array.from({ length: 80 }, (_, index) => `${index}번째 줄이야.`).join('\n')), null)
    assert.equal(withoutRepetition(`끝.\n${'같은 문장을 또 쓴다. '.repeat(30)}`), '끝.')
  })

  await t.test('a room reply that rewrites its pre-tool text after the tool round keeps it once', async (s) => {
    const before = '등불 찻집 열던 날이었어. 카운터上等 램프가 번아웃 돼서, 본인이 직접 싣고 내 수리점에 들었지. 그때부터 지금까지 고쳐줘 온 거야.\n\n'
    const after = '등불 찻집 열던 날이었어. 카운터 램프가 번아웃 돼서, 루나가 직접 싣고 내 수리점에 들었지. 그때부터 지금까지 고쳐주고 있다.'
    let final = after
    let calls = 0
    s.mock.method(globalThis, 'fetch', async () => {
      calls += 1
      return calls % 2 === 1 ? sse(text(before), toolCall('chat_reply_to', '{"to":["user"]}', 'tool_calls')) : sse(text(final, 'stop'))
    })
    const room = createRoom()
    const events: StreamEvent[] = []
    await GroupChatService.sendMessage(requester, room.id, '@A 둘이 처음 만난 게 언제야?', (event) => events.push(event))
    const stored = CodexChatStore.listMessages(room.id).filter((message) => message.role === 'assistant')
    assert.equal(stored.length, 1)
    assert.equal(stored[0].content, after)
    const replaced = events.find((event) => event.type === 'text')
    assert.ok(replaced && replaced.type === 'text' && replaced.text === after && replaced.profileId === a.id, 'the live reply gets the text without the repeat')

    // Text before the tool call and a different answer after it both stay, one blank line apart.
    final = '루나가 램프를 들고 온 날이야.'
    const second = createRoom()
    await GroupChatService.sendMessage(requester, second.id, '@A 그게 언제였는데?', () => {})
    const [reply] = CodexChatStore.listMessages(second.id).filter((message) => message.role === 'assistant')
    assert.equal(reply.content, `${before.trim()}\n\n${final}`)
  })
})
