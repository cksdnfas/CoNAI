import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import type { RuntimeEventRecord } from '../src/types/runtimeEvents'

test('generation reactions: opt-in, one-shot recovery, user precedence and speaker ownership', { timeout: 60000 }, async (t) => {
  const temp = path.resolve(__dirname, '../../temp')
  const root = fs.mkdtempSync(path.join(temp, 'conai-reactions-test-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  process.env.RUNTIME_UPLOADS_DIR = path.join(root, 'uploads')
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { ChatGenerationReactionService: reactions } = await import('../src/services/codex-chat/chatGenerationReactions')
  const { linkChatGeneration, registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
  const { GroupChatService } = await import('../src/services/codex-chat/groupChatService')
  const { LlmChatService } = await import('../src/services/codex-chat/llmChatService')
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { AuthAccount } = await import('../src/models/AuthAccount')
  const { AuthAccessControlService } = await import('../src/services/authAccessControlService')
  const { acquireLlmRequestSlot } = await import('../src/services/llmRequestScheduler')
  const { ModelSlotStore } = await import('../src/services/codex-chat/modelSlots')
  const { subscribeToRuntimeEvents, publishRuntimeEvent } = await import('../src/services/runtime-events/runtimeEventBus')
  updateChatSettings({ enabled: true, diagnostics: { enabled: true, captureRaw: false } })
  t.mock.method(AuthAccount, 'findById', () => ({ id: 1, account_type: 'admin', status: 'active' }))
  t.mock.method(AuthAccessControlService, 'resolveForAccountId', () => ({ permissionKeys: ['chat.use', 'chat.agent.use'] }))
  t.mock.method(ExternalApiProvider, 'findByName', () => ({ provider_name: 'test', display_name: 'Test', is_enabled: true, provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid/v1', additional_config: '{}' }))
  t.mock.method(ExternalApiProvider, 'getDecryptedKey', () => null)
  // Any request a subtest did not explicitly mock fails locally, never on the network.
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected model request') })
  const requester = { accountId: 1, accountType: 'admin' as const }
  const profile = ChatProfileStore.create({ name: '루나', engine: 'llm', providerName: 'test', model: 'chat-model', summaryEnabled: false, mcpEnabled: false })
  const db = () => dbModule.getUserSettingsDb()
  const replyResponse = (content: string) => Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 50 } })
  const threadOf = (enabled = true, engine: 'llm' | 'codex' = 'llm', profileId = profile.id) => {
    const id = CodexChatStore.createThread(1, '그림', engine, profileId)
    if (enabled) CodexChatStore.updateThreadContext(id, { reactionEnabled: true })
    return CodexChatStore.findThreadById(id)!
  }
  const attach = (thread: ReturnType<typeof threadOf>, statuses = ['completed'], speaker = profile.id, storeSource = true) => {
    const replyId = randomUUID()
    const context = { threadId: thread.id, profileId: speaker, kind: thread.kind, replyId }
    const jobIds = statuses.map((status) => {
      const id = Number(db().prepare("INSERT INTO generation_queue_jobs (service_type, status, request_payload, requested_by_account_id, failure_code, failure_message) VALUES ('novelai', ?, '{}', 1, 'execution_failed', 'secret provider path')").run(status).lastInsertRowid)
      linkChatGeneration(context, id)
      return id
    })
    const sourceId = storeSource ? CodexChatStore.addMessage({ thread_id: thread.id, role: 'assistant', speaker_profile_id: thread.kind === 'group' ? speaker : null, content: '그려볼게.', tool_calls: [], status: 'completed', error: null, routing: { replyId, replyTo: null, recipients: ['user'] } }) : null
    return { replyId, context, jobIds, sourceId }
  }
  const state = (replyId: string) => db().prepare('SELECT * FROM chat_generation_reactions WHERE reply_id = ?').get(replyId) as { state: string; attempts: number; message_id: number | null } | undefined
  t.after(async () => {
    await reactions.stop()
    dbModule.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), temp)
    assert.ok(path.basename(root).startsWith('conai-reactions-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  await t.test('default off and old links after enabling make zero model requests', async (s) => {
    let calls = 0
    s.mock.method(globalThis, 'fetch', async () => { calls++; return replyResponse('완성됐어.') })
    const thread = threadOf(false)
    assert.equal(thread.reaction_enabled, 0)
    const linked = attach(thread)
    await reactions.reconcile(thread.id)
    CodexChatStore.updateThreadContext(thread.id, { reactionEnabled: true })
    await reactions.reconcile(thread.id)
    assert.equal(calls, 0)
    assert.equal(state(linked.replyId), undefined)
    assert.equal(db().prepare('SELECT reaction_target FROM chat_generation_links WHERE job_id = ?').get(linked.jobIds[0])!.reaction_target, 0)
  })

  await t.test('all jobs must end: one reaction, one result block, no tools or user row, with diagnostics and owner event', async (s) => {
    const thread = threadOf()
    const linked = attach(thread, ['completed', 'running'])
    db().prepare("INSERT INTO api_generation_history (service_type, generation_status, composite_hash, queue_job_id, requested_by_account_id) VALUES ('novelai', 'completed', 'image', ?, 1)").run(linked.jobIds[0])
    let calls = 0
    let input: any
    s.mock.method(globalThis, 'fetch', async (_url, init) => { calls++; input = JSON.parse(String(init?.body)); return replyResponse('완성됐어.') })
    const events: RuntimeEventRecord[] = []
    const unsubscribe = subscribeToRuntimeEvents((event) => { if (event.name === 'chat.reaction.created') events.push(event) })
    s.after(unsubscribe)
    await reactions.reconcile(thread.id)
    assert.equal(calls, 0)
    db().prepare("UPDATE generation_queue_jobs SET status = 'failed' WHERE id = ?").run(linked.jobIds[1])
    await Promise.all([reactions.reconcile(thread.id), reactions.reconcile(thread.id)])
    assert.equal(calls, 1)
    assert.equal(input.tools, undefined)
    assert.match(input.messages.at(-1).content, new RegExp(`작업 #${linked.jobIds[0]}: 이미지 1장 첨부됨`))
    assert.match(input.messages.at(-1).content, /실패: 이미지 생성에 실패했어/)
    assert.ok(!input.messages.at(-1).content.includes('secret'))
    assert.equal(input.messages.filter((message: any) => String(message.content).startsWith('[작업 결과]')).length, 1)
    const messages = CodexChatStore.listMessages(thread.id)
    assert.equal(messages.length, 2)
    assert.equal(messages.filter((message) => message.role === 'user').length, 0)
    assert.equal(messages[1].content, '완성됐어.')
    assert.equal(JSON.parse(messages[1].context_meta!).version, 2)
    assert.equal(state(linked.replyId)!.state, 'done')
    assert.equal(state(linked.replyId)!.attempts, 1)
    assert.equal(state(linked.replyId)!.message_id, messages[1].id)
    assert.equal(events.length, 1)
    assert.equal(events[0].visibility, 'owner')
    assert.equal(events[0].accountId, 1)
  })

  await t.test('boot reconciliation resumes pending, fails abandoned running, and never repeats done or historical links', async (s) => {
    let calls = 0
    s.mock.method(globalThis, 'fetch', async () => { calls++; return replyResponse('완성됐어.') })
    const pending = attach(threadOf())
    const abandoned = attach(threadOf())
    db().prepare("INSERT INTO chat_generation_reactions (reply_id, thread_id, state) VALUES (?, ?, 'pending')").run(pending.replyId, pending.context.threadId)
    db().prepare("INSERT INTO chat_generation_reactions (reply_id, thread_id, state, attempts) VALUES (?, ?, 'running', 1)").run(abandoned.replyId, abandoned.context.threadId)
    dbModule.closeUserSettingsDb()
    dbModule.initializeUserSettingsDb()
    reactions.start()
    await reactions.reconcile()
    await reactions.stop()
    assert.equal(state(pending.replyId)!.state, 'done')
    assert.equal(state(abandoned.replyId)!.state, 'failed')
    assert.equal(calls, 1)
    reactions.start()
    await reactions.reconcile()
    await reactions.stop()
    assert.equal(calls, 1)
  })

  await t.test('a newer user message skips without calling the model', async (s) => {
    let calls = 0
    s.mock.method(globalThis, 'fetch', async () => { calls++; return replyResponse('이 반응은 나오면 안 돼.') })
    const thread = threadOf()
    const linked = attach(thread)
    CodexChatStore.addMessage({ thread_id: thread.id, role: 'user', content: '다음 장면', tool_calls: [], status: 'completed', error: null })
    await reactions.reconcile(thread.id)
    assert.equal(calls, 0)
    assert.equal(state(linked.replyId)!.state, 'skipped')
  })

  await t.test('a user request cancels a reaction waiting on the shared connection and takes its slot', async (s) => {
    const thread = threadOf()
    const linked = attach(thread)
    const release = await acquireLlmRequestSlot('test', 1)
    let calls = 0
    s.mock.method(globalThis, 'fetch', async () => { calls++; return replyResponse('사용자에게 답해.') })
    const work = reactions.reconcile(thread.id)
    assert.equal(LlmChatService.isRunning(thread.id), true)
    assert.equal(LlmChatService.running(thread.id), null, 'the browser composer must stay available while a headless reaction waits')
    const user = LlmChatService.sendMessage(requester, thread, '다음 장면', () => {})
    release()
    await Promise.all([work, user])
    assert.equal(state(linked.replyId)!.state, 'skipped')
    assert.equal(calls, 1)
    assert.deepEqual(CodexChatStore.listMessages(thread.id).map((message) => message.content), ['그려볼게.', '다음 장면', '사용자에게 답해.'])
  })

  await t.test('a user request during inference aborts and discards the reaction without deleting the user turn', async (s) => {
    const thread = threadOf()
    const linked = attach(thread)
    let ready!: () => void
    const started = new Promise<void>((resolve) => { ready = resolve })
    let calls = 0
    s.mock.method(globalThis, 'fetch', async (_url, init) => {
      calls++
      if (calls > 1) return replyResponse('새 요청에 답해.')
      ready()
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
      })
    })
    const work = reactions.reconcile(thread.id)
    await started
    await LlmChatService.sendMessage(requester, thread, '새 요청', () => {})
    await work
    assert.equal(state(linked.replyId)!.state, 'skipped')
    assert.equal(CodexChatStore.listMessages(thread.id).length, 3)
    assert.equal(LlmChatService.isRunning(thread.id), false)
  })

  await t.test('empty output is done without a message; failed inference is attempted once', async (s) => {
    const empty = attach(threadOf())
    let calls = 0
    s.mock.method(globalThis, 'fetch', async () => { calls++; return calls === 1 ? replyResponse('') : new Response('failure', { status: 503 }) })
    await reactions.reconcile(empty.context.threadId)
    assert.equal(state(empty.replyId)!.state, 'done')
    assert.equal(state(empty.replyId)!.message_id, null)
    assert.equal(CodexChatStore.listMessages(empty.context.threadId).length, 1)
    const failed = attach(threadOf())
    await reactions.reconcile(failed.context.threadId)
    await reactions.reconcile(failed.context.threadId)
    assert.equal(state(failed.replyId)!.state, 'failed')
    assert.equal(state(failed.replyId)!.attempts, 1)
    assert.equal(calls, 2)
    assert.equal(CodexChatStore.listMessages(failed.context.threadId).length, 1)
  })

  await t.test('compatibility errors cannot resend a one-shot reaction', async (s) => {
    s.mock.method(ExternalApiProvider, 'findByName', () => ({ provider_name: 'test', display_name: 'Test', is_enabled: true, provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid/v1', additional_config: JSON.stringify({ prompt_cache_marks: true }) }))
    let calls = 0
    s.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('stream_options rejected', { status: 400 }) })
    const linked = attach(threadOf())
    await reactions.reconcile(linked.context.threadId)
    assert.equal(calls, 1)
    assert.equal(state(linked.replyId)!.state, 'failed')
    assert.equal(state(linked.replyId)!.attempts, 1)
  })

  await t.test('the requesting group speaker reacts with its context; a selected slot overrides the chat model', async (s) => {
    const speaker = ChatProfileStore.create({ name: '솔', engine: 'llm', providerName: 'test', model: 'speaker-model', systemPrompt: '나는 솔이야.', mcpEnabled: false, summaryEnabled: false })
    const room = GroupChatService.create(requester, { profileIds: [profile.id, speaker.id], representativeId: profile.id, userProfileId: null })
    const slot = ModelSlotStore.create({ name: '반응', providerName: 'test', model: 'reaction-model' }).slot
    CodexChatStore.updateThreadContext(room.id, { reactionEnabled: true, reactionModelSlotId: slot.id })
    const linked = attach(room, ['completed'], speaker.id)
    let body: any
    s.mock.method(globalThis, 'fetch', async (_url, init) => { body = JSON.parse(String(init?.body)); return replyResponse('솔의 반응이야.') })
    await reactions.reconcile(room.id)
    const message = CodexChatStore.listMessages(room.id).at(-1)!
    assert.equal(message.speaker_profile_id, speaker.id)
    assert.equal(message.content, '솔의 반응이야.')
    assert.equal(body.model, 'reaction-model')
    assert.equal(body.tools, undefined)
    assert.ok(JSON.stringify(body.messages).includes('나는 솔이야.'))
    assert.equal(state(linked.replyId)!.state, 'done')
  })

  await t.test('Codex and mismatched job owners cannot trigger model calls', async (s) => {
    const codex = ChatProfileStore.create({ name: 'Codex', engine: 'codex', model: 'codex' })
    const direct = threadOf(true, 'codex', codex.id)
    const excluded = attach(direct, ['completed'], codex.id)
    const room = GroupChatService.create(requester, { profileIds: [profile.id, codex.id], representativeId: profile.id, userProfileId: null })
    CodexChatStore.updateThreadContext(room.id, { reactionEnabled: true })
    const groupExcluded = attach(room, ['completed'], codex.id)
    const privateThread = threadOf()
    const privateReply = attach(privateThread)
    db().prepare('UPDATE generation_queue_jobs SET requested_by_account_id = 2 WHERE id = ?').run(privateReply.jobIds[0])
    let calls = 0
    s.mock.method(globalThis, 'fetch', async () => { calls++; return replyResponse('나오면 안 돼.') })
    await reactions.reconcile()
    assert.equal(calls, 0)
    assert.equal(state(excluded.replyId), undefined)
    assert.equal(state(groupExcluded.replyId), undefined)
    assert.equal(state(privateReply.replyId)!.state, 'skipped')
  })

  await t.test('terminal bus events and reply-close hooks recover fast jobs after their source is stored', async (s) => {
    const thread = threadOf()
    const linked = attach(thread, ['running'], profile.id, false)
    const close = registerChatReply(linked.context, new AbortController().signal, () => ({ replyTo: null, recipients: ['user'] }))
    let calls = 0
    s.mock.method(globalThis, 'fetch', async () => { calls++; return replyResponse('완성됐어.') })
    reactions.start()
    db().prepare("UPDATE generation_queue_jobs SET status = 'completed' WHERE id = ?").run(linked.jobIds[0])
    publishRuntimeEvent({ name: 'queue.job.status', topic: 'generation-queue', payload: { job_id: linked.jobIds[0], status: 'completed' } })
    CodexChatStore.addMessage({ thread_id: thread.id, role: 'assistant', content: '그려볼게.', tool_calls: [], status: 'completed', error: null, routing: { replyId: linked.replyId, replyTo: null, recipients: ['user'] } })
    close()
    await new Promise<void>((resolve) => setImmediate(resolve))
    await reactions.reconcile(thread.id)
    await reactions.stop()
    assert.equal(calls, 1)
    assert.equal(state(linked.replyId)!.state, 'done')
  })

  await t.test('moving jobs to a continued reply preserves the completed reaction and cannot replay it', async (s) => {
    const thread = threadOf()
    const linked = attach(thread)
    let calls = 0
    s.mock.method(globalThis, 'fetch', async () => { calls++; return replyResponse('완성됐어.') })
    await reactions.reconcile(thread.id)
    const continued = randomUUID()
    CodexChatStore.moveGenerationLinks(thread.id, linked.replyId, continued)
    CodexChatStore.addMessage({ thread_id: thread.id, role: 'assistant', content: '이어 쓴 답변', tool_calls: [], status: 'completed', error: null, routing: { replyId: continued, replyTo: null, recipients: ['user'] } })
    await reactions.reconcile(thread.id)
    assert.equal(calls, 1)
    assert.equal(state(continued)!.state, 'done')
    assert.equal(state(continued)!.message_id, state(linked.replyId)!.message_id)
  })

  await t.test('group reactions share the room lock and yield to a new user message', async (s) => {
    const speaker = ChatProfileStore.create({ name: '별', engine: 'llm', providerName: 'test', model: 'group-model', summaryEnabled: false, mcpEnabled: false })
    const room = GroupChatService.create(requester, { profileIds: [profile.id, speaker.id], representativeId: profile.id, userProfileId: null })
    CodexChatStore.updateThreadContext(room.id, { reactionEnabled: true })
    const linked = attach(room, ['completed'], speaker.id)
    let ready!: () => void
    const started = new Promise<void>((resolve) => { ready = resolve })
    let calls = 0
    s.mock.method(globalThis, 'fetch', async (_url, init) => {
      calls++
      if (calls > 1) return replyResponse('사용자 차례야.')
      ready()
      return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }))
    })
    const work = reactions.reconcile(room.id)
    await started
    assert.equal(GroupChatService.isRunning(room.id), true)
    assert.throws(() => GroupChatService.clearThread(requester, room.id), /진행 중/)
    await GroupChatService.sendMessage(requester, room.id, '@별 다음 장면', () => {})
    await work
    assert.equal(state(linked.replyId)!.state, 'skipped')
    assert.equal(CodexChatStore.listMessages(room.id).at(-1)!.speaker_profile_id, speaker.id)
    assert.equal(GroupChatService.isRunning(room.id), false)
  })

  await t.test('vision attaches bounded local previews; image permission and hidden media are respected', async (s) => {
    const images = await import('../src/database/init')
    await images.initializeDatabase()
    const sharp = (await import('sharp')).default
    const file = path.join(root, 'preview.png')
    await sharp({ create: { width: 16, height: 16, channels: 3, background: '#4488aa' } }).png().toFile(file)
    const hash = 'a'.repeat(48)
    images.db.prepare('INSERT INTO media_metadata (composite_hash, rating_score) VALUES (?, NULL)').run(hash)
    const folderId = Number(images.db.prepare('INSERT INTO watched_folders (folder_path, folder_name) VALUES (?, ?)').run(root, 'test').lastInsertRowid)
    images.db.prepare("INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_size, mime_type) VALUES (?, ?, ?, ?, 'image/png')").run(hash, file, folderId, fs.statSync(file).size)
    const visionProfile = ChatProfileStore.create({ name: '비전', engine: 'llm', providerName: 'test', model: 'vision-model', visionEnabled: true, summaryEnabled: false, mcpEnabled: false })
    let canView = true
    s.mock.method(AuthAccessControlService, 'resolveForAccountId', () => ({ permissionKeys: ['chat.use', ...(canView ? ['images.view'] : [])] }))
    const bodies: any[] = []
    s.mock.method(globalThis, 'fetch', async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return replyResponse('그림을 봤어.') })
    const run = async () => {
      const thread = threadOf(true, 'llm', visionProfile.id)
      const linked = attach(thread, ['completed'], visionProfile.id)
      db().prepare("INSERT INTO api_generation_history (service_type, generation_status, composite_hash, queue_job_id, requested_by_account_id) VALUES ('novelai', 'completed', ?, ?, 1)").run(hash, linked.jobIds[0])
      await reactions.reconcile(thread.id)
      assert.equal(state(linked.replyId)!.state, 'done')
      return bodies.at(-1).messages.at(-1).content
    }
    const visible = await run()
    assert.equal(visible[0].type, 'text')
    assert.match(visible[1].image_url.url, /^data:image\/jpeg;base64,/)
    const metadata = await sharp(Buffer.from(visible[1].image_url.url.split(',')[1], 'base64')).metadata()
    assert.ok(metadata.width! <= 512 && metadata.height! <= 512)
    canView = false
    assert.equal(typeof await run(), 'string')
    canView = true
    const { ImageSafetyService } = await import('../src/services/imageSafetyService')
    s.mock.method(ImageSafetyService, 'isHidden', () => true)
    assert.equal(typeof await run(), 'string')
  })
})
