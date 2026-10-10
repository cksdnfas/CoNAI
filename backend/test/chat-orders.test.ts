import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

test('chat orders: done on the reply itself, with the conversation up to it', { timeout: 60000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const temp = path.resolve(__dirname, '../../temp')
  fs.mkdirSync(temp, { recursive: true })
  const root = fs.mkdtempSync(path.join(temp, 'conai-orders-test-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  process.env.RUNTIME_UPLOADS_DIR = path.join(root, 'uploads')
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
    assert.equal(path.dirname(path.resolve(root)), temp)
    assert.ok(path.basename(root).startsWith('conai-orders-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { ChatProposalStore } = await import('../src/services/codex-chat/chatProposals')
  const { LlmChatService } = await import('../src/services/codex-chat/llmChatService')
  const { runChatOrder } = await import('../src/services/codex-chat/chatOrderRunner')
  const { beginChatOrderRun } = await import('../src/services/codex-chat/chatOrderRuns')
  const { linkChatGeneration } = await import('../src/services/codex-chat/chatReplyRegistry')
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { AuthAccount } = await import('../src/models/AuthAccount')
  const { AuthAccessControlService } = await import('../src/services/authAccessControlService')
  updateChatSettings({ enabled: true, diagnostics: { enabled: true, captureRaw: false } })
  t.mock.method(AuthAccount, 'findById', () => ({ id: 1, account_type: 'admin', status: 'active' }))
  t.mock.method(AuthAccessControlService, 'resolveForAccountId', () => ({ permissionKeys: ['chat.use', 'chat.agent.use'] }))
  t.mock.method(ExternalApiProvider, 'findByName', () => ({ provider_name: 'chat', display_name: 'Chat', is_enabled: true, provider_type: 'llm_openai_compatible', base_url: 'http://chat.invalid/v1', additional_config: '{}' }))
  t.mock.method(ExternalApiProvider, 'getDecryptedKey', () => 'key')
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected request') })

  const requester = { accountId: 1, accountType: 'admin' as const }
  const profile = ChatProfileStore.create({ name: '솔', engine: 'llm', providerName: 'chat', model: 'chat-model', summaryEnabled: false, mcpEnabled: true, mcpScopes: ['read'], allowLoreProposals: true, contextTurns: 3 })
  const toolCall = (name: string, args: unknown) => Response.json({ choices: [{ message: { content: '', tool_calls: [{ id: `call-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 50 } })
  const text = (content: string) => Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 50 } })
  /** The chat model's requests; `answer` gives each its response (by request count). */
  const route = (s: { mock: typeof t.mock }, answer: (count: number, body: any) => Response) => {
    const bodies: any[] = []
    s.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') return new Response('', { status: 404 })
      const body = JSON.parse(String(init.body))
      bodies.push(body)
      return answer(bodies.length, body)
    })
    return bodies
  }
  const textsOf = (body: any) => (body.messages as any[]).map((message) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? ''))
  const lastUser = (body: any) => textsOf(body)[(body.messages as any[]).map((message) => message.role).lastIndexOf('user')]
  /** A chat of `turns` exchanges; the replies carry reply ids `r1`… */
  const chatWith = (turns: number) => {
    const threadId = CodexChatStore.createThread(1, '지시', 'llm', profile.id)
    const replies: number[] = []
    for (let turn = 1; turn <= turns; turn += 1) {
      CodexChatStore.addMessage({ thread_id: threadId, role: 'user', content: `질문 ${turn}`, display_content: null, tool_calls: [], status: 'completed', error: null })
      replies.push(CodexChatStore.addMessage({ thread_id: threadId, role: 'assistant', content: `답변 ${turn}: 바닷가 등대 이야기`, display_content: null, tool_calls: [], status: 'completed', error: null, routing: { replyId: `r${threadId}-${turn}`, replyTo: null, recipients: ['user'] } }))
    }
    return { threadId, replies }
  }

  await t.test('choices on the latest reply: the card lands on it, no new message, the window the setting gives', async (s) => {
    const { threadId, replies } = chatWith(6)
    const target = replies.at(-1)!
    let heldWhileRunning = false
    const bodies = route(s, (count) => {
      heldWhileRunning = LlmChatService.isRunning(threadId)
      return count === 1 ? toolCall('offer_choices', { question: '다음엔 뭘 할까?', options: [{ label: '등대에 오르기' }, { label: '바다로 가기' }] }) : text('여기서 고르면 돼.')
    })
    const before = CodexChatStore.listMessages(threadId).length
    const events: string[] = []
    const message = await runChatOrder(requester, threadId, target, 'choices', (event) => events.push(event.type))

    assert.equal(CodexChatStore.listMessages(threadId).length, before, 'no message is added')
    assert.equal(bodies.length, 1, 'the rounds end once the job went through')
    assert.ok(heldWhileRunning, 'the chat is held while the order runs')
    assert.equal(LlmChatService.isRunning(threadId), false)
    const sent = textsOf(bodies[0]).join('\n')
    for (const turn of [4, 5, 6]) assert.match(sent, new RegExp(`질문 ${turn}`), `turn ${turn} is in the window`)
    assert.doesNotMatch(sent, /질문 3/, 'three context turns: earlier turns stay out')
    assert.match(lastUser(bodies[0]), new RegExp(`\\[사용자 지시: 바로 위 네 답변\\(message_id=${target}\\)에 덧붙일 작업\\]\\n- .*offer_choices`))
    assert.equal(message.id, target)
    assert.deepEqual(message.tool_calls.map((call) => call.tool), ['offer_choices'], 'the call is the reply\'s own now')
    assert.equal(ChatProposalStore.forReply(threadId, `r${threadId}-6`, 'choice').length, 1, 'the card belongs to the reply')
    assert.deepEqual(events, ['tool', 'tool', 'done'])
  })

  await t.test('lore on an older reply: the request ends at that reply, the card lands on it', async (s) => {
    const { threadId, replies } = chatWith(6)
    const target = replies[3]
    const bodies = route(s, () => toolCall('save_lore', { title: '등대', keys: ['등대'], content: '바닷가에 오래된 등대가 있다.' }))
    const message = await runChatOrder(requester, threadId, target, 'lore', () => {})
    const sent = textsOf(bodies[0]).join('\n')
    for (const turn of [2, 3, 4]) assert.match(sent, new RegExp(`질문 ${turn}`))
    assert.doesNotMatch(sent, /질문 1\b|질문 5|답변 5|질문 6/, 'nothing from before the window or after the reply')
    assert.equal(message.tool_calls.at(-1)?.tool, 'save_lore')
    assert.equal(ChatProposalStore.forReply(threadId, `r${threadId}-4`, 'lore').length, 1)
    assert.equal(CodexChatStore.listMessages(threadId).length, 12)
    // A second lore order on a reply soon after: the user's order lifts the spacing between lore cards.
    route(s, () => toolCall('save_lore', { title: '바닷가', keys: ['바닷가'], content: '둘은 바닷가에서 만났다.' }))
    await runChatOrder(requester, threadId, replies[4], 'lore', () => {})
    assert.equal(ChatProposalStore.forReply(threadId, `r${threadId}-5`, 'lore').length, 1)
  })

  await t.test('a reply without a reply id (a greeting) gets one', async (s) => {
    const threadId = CodexChatStore.createThread(1, '인사', 'llm', profile.id)
    const greeting = CodexChatStore.addMessage({ thread_id: threadId, role: 'assistant', content: '어서 와, 등대지기의 집이야.', display_content: null, tool_calls: [], status: 'completed', error: null })
    route(s, () => toolCall('save_lore', { title: '등대지기', keys: ['등대지기'], content: '나는 등대지기의 집에 산다.' }))
    const message = await runChatOrder(requester, threadId, greeting, 'lore', () => {})
    const replyId = message.routing?.replyId
    assert.ok(replyId)
    assert.equal(ChatProposalStore.forReply(threadId, replyId, 'lore').length, 1)
  })

  await t.test('generation jobs an order starts belong to the reply and start no reaction message', () => {
    const { threadId } = chatWith(1)
    CodexChatStore.updateThreadContext(threadId, { reactionEnabled: true })
    const linkOf = (jobId: number) => dbModule.getUserSettingsDb().prepare('SELECT reply_id, reaction_target FROM chat_generation_links WHERE job_id = ?').get(jobId)
    linkChatGeneration({ threadId, profileId: profile.id, kind: 'direct', replyId: 'live' }, 9001)
    assert.deepEqual({ ...linkOf(9001) as object }, { reply_id: 'live', reaction_target: 1 }, 'a reply\'s own job gets its reaction')
    const run = beginChatOrderRun(threadId, 1, 'ordered')!
    assert.equal(beginChatOrderRun(threadId, 2, 'other'), null, 'one order at a time')
    linkChatGeneration({ threadId, profileId: profile.id, kind: 'direct', replyId: 'ordered' }, 9002)
    run.end()
    assert.deepEqual({ ...linkOf(9002) as object }, { reply_id: 'ordered', reaction_target: 0 })
  })

  await t.test('orders that cannot be given there, or a job not done, change nothing', async (s) => {
    const { threadId, replies } = chatWith(2)
    const user = CodexChatStore.listMessages(threadId).find((message) => message.role === 'user')!
    await assert.rejects(runChatOrder(requester, threadId, replies[0], 'choices', () => {}), /마지막 답변에서만/)
    await assert.rejects(runChatOrder(requester, threadId, replies[1], 'redraw', () => {}), /다시 그릴 이미지가 없어/)
    await assert.rejects(runChatOrder(requester, threadId, replies[1], 'dance', () => {}), /알 수 없는 지시/)
    await assert.rejects(runChatOrder(requester, threadId, user.id, 'lore', () => {}), /캐릭터 답변에만/)
    await assert.rejects(runChatOrder(requester, threadId, replies[1], 'image', () => {}), /그 도구를 쓸 수 없어/, 'no generation scope')
    route(s, () => text('그냥 얘기만 할게.'))
    await assert.rejects(runChatOrder(requester, threadId, replies[1], 'lore', () => {}), /하지 않았어/)
    assert.deepEqual(CodexChatStore.listMessages(threadId).find((message) => message.id === replies[1])!.tool_calls, [])
    assert.equal(LlmChatService.isRunning(threadId), false, 'a failed order lets go of the chat')
  })
})
