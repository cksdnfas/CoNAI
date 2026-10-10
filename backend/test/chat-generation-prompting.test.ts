import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { z } from 'zod'

test('chat generation prompting: preset settings, guide, writer answers and deferred placeholders', { timeout: 60000 }, async (t) => {
  const temp = path.resolve(__dirname, '../../temp')
  fs.mkdirSync(temp, { recursive: true })
  const root = fs.mkdtempSync(path.join(temp, 'conai-prompting-test-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  ;(await import('../src/models/ExternalApiProvider')).ExternalApiProvider.create({ provider_name: 'test', display_name: 'test', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const { ChatGenerationPresetStore, readGenerationPresetFile } = await import('../src/services/codex-chat/chatGenerationPresets')
  const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
  const { presetGuideText, parseWriterAnswer, buildWriterMessages, withGeneratedImages, GENERATED_IMAGES_NOTE } = await import('../src/services/codex-chat/chatGenerationPrompting')
  const { presetInputShape } = await import('../src/services/codex-chat/chatGenerationInputs')
  const { ChatDeferredGenerationStore, DEFERRED_PER_REPLY_MAX } = await import('../src/services/codex-chat/chatDeferredGenerations')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { attachJobResults } = await import('../src/services/codex-chat/codexChatMedia')
  t.after(async () => {
    dbModule.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), temp)
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const owner = fileOwnerKey(1)
  const guideOwner = () => owner

  await t.test('a preset starts inline with no guide; settings are kept, clamped and patched', () => {
    const preset = ChatGenerationPresetStore.create({ name: '장면', kind: 'nai' })
    assert.deepEqual(preset.prompting, { timing: 'inline', guide: '', guideFile: null, previousImages: 0 })
    const updated = ChatGenerationPresetStore.update(preset.id, { prompting: { timing: 'after', guide: '  1girl 위주로  ', previousImages: 9 } })!
    assert.equal(updated.prompting.timing, 'after')
    assert.equal(updated.prompting.guide, '1girl 위주로')
    assert.equal(updated.prompting.previousImages, 4)
    // A patch without prompting leaves it alone.
    assert.equal(ChatGenerationPresetStore.update(preset.id, { name: '장면 2' })!.prompting.timing, 'after')
    assert.throws(() => ChatGenerationPresetStore.update(preset.id, { prompting: { timing: 'later' } }), /inline 또는 after/)
  })

  await t.test('a guide file links from the saver store, follows renames and reads into the guide', () => {
    const folder = FileStoreService.ensureFolder(owner, null, '가이드')
    const file = FileStoreService.writeText(owner, folder.id, 'nai.md', '태그는 영어로.\n표정을 꼭 넣어.')
    const other = FileStoreService.writeText(owner, folder.id, 'notes.txt', 'x')
    const preset = ChatGenerationPresetStore.create({ name: '가이드', kind: 'nai', prompting: { guide: '짧게.', guideFileId: file.id } }, { guideOwner })
    assert.equal(preset.prompting.guideFile?.path, '가이드/nai.md')
    assert.equal(preset.prompting.guideFile?.owner, owner)
    assert.equal(presetGuideText(preset), '짧게.\n\n[가이드/nai.md]\n태그는 영어로.\n표정을 꼭 넣어.')
    FileStoreService.rename(owner, file.id, 'scene.md')
    assert.equal(ChatGenerationPresetStore.find(preset.id)!.prompting.guideFile?.path, '가이드/scene.md')
    // Linking needs the saver's store; keeping the same file does not ask for it again.
    assert.throws(() => ChatGenerationPresetStore.update(preset.id, { prompting: { guideFileId: other.id } }), /설정 화면에서/)
    assert.equal(ChatGenerationPresetStore.update(preset.id, { prompting: { guideFileId: file.id, guide: '' } })!.prompting.guideFile?.fileId, file.id)
    assert.equal(ChatGenerationPresetStore.update(preset.id, { prompting: { guideFileId: null } })!.prompting.guideFile, null)
    // An imported preset keeps how it writes but not another store's file.
    const [imported] = readGenerationPresetFile({ kind: 'nai', name: 'x', prompting: { timing: 'after', guide: 'g', guideFileId: file.id, previousImages: 2 } })
    assert.deepEqual(imported.prompting, { timing: 'after', guide: 'g', previousImages: 2 })
  })

  await t.test('the writer is asked for the tool fields and its answer is read out of prose', () => {
    const preset = ChatGenerationPresetStore.update(ChatGenerationPresetStore.create({ name: '크기', kind: 'nai' }).id, { nai: { sizes: [{ label: 'Portrait', width: 832, height: 1216 }, { label: 'Wide', width: 1216, height: 832 }] } })!
    const { shape } = presetInputShape(preset)
    const messages = buildWriterMessages({ preset, shape, guide: '표정 필수', character: { name: '루나', appearance: 'silver hair' }, userName: '나', transcript: '나: 안녕', reply: '루나가 웃었다.', focus: '', images: [{ url: 'data:image/jpeg;base64,AA' }] })
    assert.equal(messages[0].role, 'system')
    assert.match(messages[0].content as string, /"prompt"/)
    assert.match(messages[0].content as string, /표정 필수/)
    const user = messages[1].content as Array<{ type: string; text?: string }>
    assert.ok(Array.isArray(user) && user.some((part) => part.type === 'image_url'))
    assert.ok(user.some((part) => part.text === GENERATED_IMAGES_NOTE))
    const parsed = z.object(shape).safeParse(parseWriterAnswer('<think>hm</think>Here:\n```json\n{"prompt": "1girl, smile", "size": "Wide"}\n```'))
    assert.ok(parsed.success)
    assert.deepEqual(parsed.data, { prompt: '1girl, smile', size: 'Wide' })
    assert.equal(z.object(shape).safeParse(parseWriterAnswer('{"size": "Huge"}')).success, false)
    assert.equal(parseWriterAnswer('no json'), null)
  })

  await t.test('generated pictures join the latest user message', () => {
    const merged = withGeneratedImages([{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }, { role: 'user', content: 'again' }], [{ url: 'data:image/jpeg;base64,BB' }])
    assert.equal(merged.length, 4)
    assert.equal(merged[1].content, 'hi')
    const last = merged[3].content as Array<{ type: string; text?: string; image_url?: { url: string } }>
    assert.equal(last[0].text, 'again')
    assert.equal(last.at(-1)?.image_url?.url, 'data:image/jpeg;base64,BB')
    assert.deepEqual(withGeneratedImages([{ role: 'user', content: 'x' }], []), [{ role: 'user', content: 'x' }])
  })

  await t.test('a deferred request shows on its reply while written, then its failure; queued ones show through their job', () => {
    const profile = ChatProfileStore.create({ name: '루나', engine: 'llm', providerName: 'test', model: 'm' })
    const thread = CodexChatStore.findThreadById(CodexChatStore.createThread(1, '장면', 'llm', profile.id))!
    const context = { scopes: [], source: 'llm-chat' as const, requester: { accountId: 1, accountType: null }, chatContext: { threadId: thread.id, profileId: profile.id, kind: 'direct' as const, replyId: 'reply-a' } }
    const messageId = CodexChatStore.addMessage({ thread_id: thread.id, role: 'assistant', content: '루나가 웃었다.', tool_calls: [], status: 'completed', error: null, routing: { replyId: 'reply-a', replyTo: null, recipients: [] } })
    assert.throws(() => ChatDeferredGenerationStore.add({ ...context, chatContext: { ...context.chatContext, replyId: undefined } }, 1, 'generate_image', ''), /inside a chat reply/)
    const ids = Array.from({ length: DEFERRED_PER_REPLY_MAX }, () => ChatDeferredGenerationStore.add(context, 1, 'generate_image', '웃는 순간'))
    assert.throws(() => ChatDeferredGenerationStore.add(context, 1, 'generate_image', ''), /at most/)
    const stored = JSON.parse((dbModule.getUserSettingsDb().prepare('SELECT context FROM chat_deferred_generations WHERE id = ?').get(ids[0]) as { context: string }).context)
    assert.equal(stored.chatContext.page, undefined)
    const callsOf = () => attachJobResults(CodexChatStore.listMessages(thread.id)).messages.find((message) => message.id === messageId)!.tool_calls.filter((call) => call.deferred)
    assert.equal(callsOf().length, DEFERRED_PER_REPLY_MAX)
    assert.equal(callsOf()[0].deferred?.state, 'writing')
    assert.ok(ChatDeferredGenerationStore.claim(ids[0]))
    assert.equal(ChatDeferredGenerationStore.claim(ids[0]), false)
    ChatDeferredGenerationStore.settle(ids[0], 'failed', { error: '모델이 쓴 프롬프트를 읽지 못했어.' })
    ChatDeferredGenerationStore.settle(ids[1], 'queued', { jobId: 99 })
    ChatDeferredGenerationStore.settle(ids[2], 'skipped')
    const calls = callsOf()
    assert.equal(calls.length, 2)
    assert.equal(calls[0].status, 'failed')
    assert.equal(calls[0].deferred?.error, '모델이 쓴 프롬프트를 읽지 못했어.')
    // A restart fails a write it cut off; pending ones are left for the service to pick up.
    ChatDeferredGenerationStore.claim(ids[3])
    ChatDeferredGenerationStore.failInterrupted()
    assert.equal(callsOf().filter((call) => call.status === 'failed').length, 2)
    CodexChatStore.clearThread(thread.id, '')
    assert.equal((dbModule.getUserSettingsDb().prepare('SELECT COUNT(*) AS count FROM chat_deferred_generations WHERE thread_id = ?').get(thread.id) as { count: number }).count, 0)
  })

  await t.test('once the reply is saved the chat model writes the prompt from it; a cut-off reply is skipped', async (s) => {
    const { ChatGenerationPromptingService } = await import('../src/services/codex-chat/chatGenerationPrompting')
    const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
    s.mock.method(ExternalApiProvider, 'findByName', () => ({ provider_name: 'test', display_name: 'Test', is_enabled: true, provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid/v1', additional_config: '{}' }))
    s.mock.method(ExternalApiProvider, 'getDecryptedKey', () => null)
    const bodies: Array<{ model: string; messages: Array<{ role: string; content: unknown }> }> = []
    s.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') return new Response('', { status: 404 })
      bodies.push(JSON.parse(String(init.body)))
      return Response.json({ choices: [{ message: { content: '{"prompt": "1girl, smile, rooftop"}' }, finish_reason: 'stop' }] })
    })
    const preset = ChatGenerationPresetStore.create({ name: '뒤에', kind: 'nai', prompting: { timing: 'after', guide: '표정을 꼭 넣어.' } })
    const profile = ChatProfileStore.create({ name: '루나', engine: 'llm', providerName: 'test', model: 'chat-model', appearance: 'silver hair' })
    const thread = CodexChatStore.findThreadById(CodexChatStore.createThread(1, '옥상', 'llm', profile.id))!
    const contextOf = (replyId: string) => ({ scopes: [], source: 'llm-chat' as const, requester: { accountId: 1, accountType: null }, chatContext: { threadId: thread.id, profileId: profile.id, kind: 'direct' as const, replyId } })
    CodexChatStore.addMessage({ thread_id: thread.id, role: 'user', content: '옥상에 가자', tool_calls: [], status: 'completed', error: null })
    CodexChatStore.addMessage({ thread_id: thread.id, role: 'assistant', content: '루나가 난간에 기대 웃었다.', tool_calls: [], status: 'completed', error: null, routing: { replyId: 'reply-done', replyTo: null, recipients: [] } })
    CodexChatStore.addMessage({ thread_id: thread.id, role: 'assistant', content: '루나가', tool_calls: [], status: 'interrupted', error: null, routing: { replyId: 'reply-cut', replyTo: null, recipients: [] } })
    const done = ChatDeferredGenerationStore.add(contextOf('reply-done'), preset.id, 'generate_image', '웃는 얼굴')
    const cut = ChatDeferredGenerationStore.add(contextOf('reply-cut'), preset.id, 'generate_image', '')
    const process = (ChatGenerationPromptingService as unknown as { process: (replyId: string) => Promise<void> }).process.bind(ChatGenerationPromptingService)
    await process('reply-done')
    await process('reply-cut')
    assert.equal(bodies.length, 1)
    assert.equal(bodies[0].model, 'chat-model')
    const [system, user] = bodies[0].messages
    assert.match(String(system.content), /표정을 꼭 넣어/)
    assert.match(String(user.content), /루나가 난간에 기대 웃었다/)
    assert.match(String(user.content), /옥상에 가자/)
    assert.match(String(user.content), /웃는 얼굴/)
    assert.match(String(user.content), /silver hair/)
    const row = (id: number) => dbModule.getUserSettingsDb().prepare('SELECT state, error FROM chat_deferred_generations WHERE id = ?').get(id) as { state: string; error: string | null }
    // The written prompt reaches the job submission (refused here: the profile does not link the preset's tool).
    assert.equal(row(done).state, 'failed')
    assert.equal(row(done).error, 'Unknown or not permitted tool.')
    assert.equal(row(cut).state, 'skipped')
  })
})
