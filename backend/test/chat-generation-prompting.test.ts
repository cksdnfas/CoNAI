import './support/testTemp'
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
  await (await import('../src/database/init')).initializeDatabase()
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  ;(await import('../src/models/ExternalApiProvider')).ExternalApiProvider.create({ provider_name: 'test', display_name: 'test', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const { ChatGenerationPresetStore, readGenerationPresetFile } = await import('../src/services/codex-chat/chatGenerationPresets')
  const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
  const { presetGuideText, parseWriterAnswer, buildWriterMessages, withGeneratedImages, generatedImagesTokens, GENERATED_IMAGES_NOTE } = await import('../src/services/codex-chat/chatGenerationPrompting')
  const { estimateMessagesTokens } = await import('../src/services/codex-chat/llmChatContext')
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
  const { ChatSkillStore } = await import('../src/services/codex-chat/chatSkills')

  await t.test('a preset starts inline with no guide; settings are kept, clamped and patched', () => {
    const preset = ChatGenerationPresetStore.create({ name: '장면', kind: 'nai' })
    assert.deepEqual(preset.prompting, { timing: 'inline', guide: '', guideSkill: null, previousImages: 0 })
    const updated = ChatGenerationPresetStore.update(preset.id, { prompting: { timing: 'after', guide: '  1girl 위주로  ', previousImages: 9 } })!
    assert.equal(updated.prompting.timing, 'after')
    assert.equal(updated.prompting.guide, '1girl 위주로')
    assert.equal(updated.prompting.previousImages, 4)
    // A patch without prompting leaves it alone.
    assert.equal(ChatGenerationPresetStore.update(preset.id, { name: '장면 2' })!.prompting.timing, 'after')
    assert.throws(() => ChatGenerationPresetStore.update(preset.id, { prompting: { timing: 'later' } }), /inline 또는 after/)
  })

  await t.test('a guide is a skill section (or a group) that reads into the guide and follows its edits', () => {
    const skill = ChatSkillStore.create({ name: '이미지 생성', description: 'Use when drawing.', instructions: 'Pick the section of the model.', sections: [
      { path: 'models/nai', title: 'NAI', summary: 'NAI presets', content: '태그는 영어로.\n표정을 꼭 넣어.' },
      { path: 'models/comfy', title: 'Comfy', summary: 'ComfyUI presets', content: '문장으로 써.' },
    ] })
    const preset = ChatGenerationPresetStore.create({ name: '가이드', kind: 'nai', prompting: { guide: '짧게.', guideSkill: { skillId: skill.id, path: 'models/nai' } } })
    assert.deepEqual({ ...preset.prompting.guideSkill, updatedDate: null }, { skillId: skill.id, path: 'models/nai', skillName: '이미지 생성', title: 'NAI', updatedDate: null })
    assert.equal(presetGuideText(preset), '짧게.\n\n[이미지 생성 › models/nai]\n태그는 영어로.\n표정을 꼭 넣어.')
    const completeGuide = '가이드 전체 문장. '.repeat(1500) + '끝까지 보존'
    ChatSkillStore.update(skill.id, { sectionChanges: [{ action: 'update', path: 'models/nai', content: completeGuide, before: { title: 'NAI', summary: 'NAI presets', content: '태그는 영어로.\n표정을 꼭 넣어.' } }] })
    assert.ok(presetGuideText(ChatGenerationPresetStore.find(preset.id)!).endsWith(completeGuide), 'the whole section reads, as edited')
    const group = ChatGenerationPresetStore.update(preset.id, { prompting: { guideSkill: { skillId: skill.id, path: 'models/' } } })!
    assert.equal(group.prompting.guideSkill?.title, 'models/ (2)')
    assert.match(presetGuideText(group), /### NAI \(models\/nai\)[\s\S]*### Comfy \(models\/comfy\)\n\n문장으로 써\./, 'a group reads its sections in order')
    assert.throws(() => ChatGenerationPresetStore.update(preset.id, { prompting: { guideSkill: { skillId: skill.id, path: 'models/none' } } }), /찾을 수 없어/)
    assert.equal(ChatGenerationPresetStore.update(preset.id, { prompting: { guideSkill: null } })!.prompting.guideSkill, null)
    // An imported preset keeps how it writes but not this server's skill.
    const [imported] = readGenerationPresetFile({ kind: 'nai', name: 'x', prompting: { timing: 'after', guide: 'g', guideSkill: { skillId: skill.id, path: 'models/nai' }, previousImages: 2 } })
    assert.deepEqual(imported.prompting, { timing: 'after', guide: 'g', previousImages: 2 })
  })

  await t.test('presets that link a guide file move it into a skill once, whole', async () => {
    const { migratePresetGuideFiles } = await import('../src/services/codex-chat/chatGenerationPresets')
    const { getUserSettingsDb } = await import('../src/database/userSettingsDb')
    const folder = FileStoreService.ensureFolder(owner, null, '가이드')
    const short = FileStoreService.writeText(owner, folder.id, 'nai.md', '태그는 영어로.')
    const completeGuide = '가이드 전체 문장. '.repeat(4000) + '끝까지 보존'
    const long = FileStoreService.writeText(owner, folder.id, 'long.md', completeGuide)
    const legacy = (name: string, fileId: string) => {
      const preset = ChatGenerationPresetStore.create({ name, kind: 'nai', prompting: { guide: '짧게.' } })
      getUserSettingsDb().prepare('UPDATE chat_generation_presets SET prompting = ? WHERE id = ?').run(JSON.stringify({ timing: 'inline', guide: '짧게.', guideFile: { owner, fileId }, previousImages: 0 }), preset.id)
      return preset.id
    }
    const first = legacy('짧은 가이드', short.id)
    const second = legacy('같은 파일', short.id)
    const third = legacy('긴 가이드', long.id)
    const gone = legacy('지워진 파일', 'f'.repeat(32))
    // A file name longer than a section title fits once shortened instead of stopping the migration.
    const named = legacy('긴 이름', FileStoreService.writeText(owner, folder.id, `${'n'.repeat(150)}.md`, '긴 이름의 가이드').id)
    migratePresetGuideFiles()
    assert.equal(ChatGenerationPresetStore.find(named)!.prompting.guideSkill?.path, 'guide', 'a long file name does not stop the move')
    const [a, b, c, d] = [first, second, third, gone].map((id) => ChatGenerationPresetStore.find(id)!.prompting)
    assert.equal(a.guideSkill?.path, 'guide')
    assert.deepEqual(b.guideSkill?.skillId, a.guideSkill?.skillId, 'presets sharing a file share its skill')
    assert.match(a.guideSkill?.skillName ?? '', /^생성 가이드 · nai/)
    assert.equal(presetGuideText(ChatGenerationPresetStore.find(first)!), `짧게.\n\n[${a.guideSkill?.skillName} › guide]\n태그는 영어로.`)
    assert.equal(c.guideSkill?.path, 'guide/', 'a long file becomes a group of sections')
    assert.equal(presetGuideText(ChatGenerationPresetStore.find(third)!).replace(/### [^\n]+\n\n/g, '').replace(/\s+/g, ''), `짧게.[${c.guideSkill?.skillName}›guide/]${completeGuide}`.replace(/\s+/g, ''), 'nothing of the file is lost')
    assert.equal(d.guideSkill, null, 'an unreadable file only loses the link')
    const skills = ChatSkillStore.list().length
    migratePresetGuideFiles()
    assert.equal(ChatSkillStore.list().length, skills, 'a second run changes nothing')
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

  await t.test('a ComfyUI preset offers a dropdown its list, always asks for text and refuses a value outside the list', async () => {
    const { WorkflowModel } = await import('../src/models/Workflow')
    const { CustomDropdownListModel } = await import('../src/models/CustomDropdownList')
    const { normalizeMcpWorkflowInputs, parseMcpMarkedFields } = await import('../src/services/comfyui/comfyWorkflowInputs')
    const ratios = ['1:1 (Square)', '9:16 (Portrait Widescreen)', '16:9 (Widescreen)']
    const models = Array.from({ length: 80 }, (_, index) => `MOSS\\checkpoint_${String(index).padStart(3, '0')}_${index === 7 ? 'animeUWU' : 'base'}.safetensors`)
    CustomDropdownListModel.create({ name: '종횡비', items: ratios })
    CustomDropdownListModel.create({ name: 'models', items: models })
    const workflowId = WorkflowModel.create({
      name: 'dropdown wf',
      workflow_json: JSON.stringify({ '1': { class_type: 'CLIPTextEncode', inputs: { text: 'saved prompt' } }, '2': { class_type: 'ResolutionSelector', inputs: { aspect_ratio: ratios[2] } }, '3': { class_type: 'UNETLoader', inputs: { unet_name: models[0] } } }),
      marked_fields: [
        { id: 'positive', label: 'Positive', type: 'textarea', jsonPath: '1.inputs.text', default_value: 'saved prompt' },
        // As the form saves them: the list is named, the field itself holds no options.
        { id: 'ratio', label: 'Ratio', type: 'select', jsonPath: '2.inputs.aspect_ratio', default_value: ratios[2], dropdown_list_name: '종횡비' },
        { id: 'model', label: 'Model', type: 'select', jsonPath: '3.inputs.unet_name', default_value: models[0], dropdown_list_name: 'models' },
      ],
    })
    const preset = ChatGenerationPresetStore.create({ name: '드롭다운', kind: 'comfyui', comfyui: { workflowId, exposedFieldIds: ['positive', 'ratio', 'model'], fixedInputs: {} } })
    const { shape, problem } = presetInputShape(preset)
    assert.equal(problem, null)
    const input = z.object(shape)
    const schema = z.toJSONSchema(input) as { required?: string[]; properties: Record<string, { enum?: string[]; description?: string }> }
    assert.deepEqual(schema.properties.ratio.enum, ratios)
    assert.match(schema.properties.ratio.description ?? '', /Leave out to keep the preset value "16:9 \(Widescreen\)"/)
    assert.deepEqual(schema.required, ['positive'], 'a dropdown with a saved value may be left out; text may not')
    assert.equal(input.safeParse({ positive: '1girl', ratio: '9:16 (Portrait)' }).success, false)
    assert.equal(input.safeParse({ ratio: ratios[0] }).success, false, 'the saved prompt is never generated in place of a written one')
    assert.ok(input.safeParse({ positive: '1girl' }).success)
    // A long list is not sent with every request: the field names it and a wrong value comes back with the closest items.
    assert.equal(schema.properties.model.enum, undefined)
    assert.match(schema.properties.model.description ?? '', /dropdown list "models" \(80 items\); any other value is refused with the closest items/, 'a caller without the search tool is not sent to it')
    assert.match((z.toJSONSchema(z.object(presetInputShape(preset, { canSearch: true }).shape)) as typeof schema).properties.model.description ?? '', /find it with search_custom_dropdown_items first/)
    const wrong = input.safeParse({ positive: '1girl', model: 'animeUWU' })
    assert.equal(wrong.success, false)
    assert.match(z.prettifyError(wrong.error!), /Closest 1 of 80: "MOSS\\\\checkpoint_007_animeUWU\.safetensors"\./)
    assert.match(z.prettifyError(input.safeParse({ positive: '1girl', model: '없는 모델' }).error!), /First 12 of 80: "MOSS\\\\checkpoint_000_base\.safetensors"/, 'a value like nothing in the list still comes back with items to pick from')
    assert.ok(input.safeParse({ positive: '1girl', model: models[7] }).success)
    // A caller that sends free-form inputs (submit_generation_job) is held to the same lists before its job is queued.
    const fields = parseMcpMarkedFields(WorkflowModel.findById(workflowId)!)
    assert.throws(() => normalizeMcpWorkflowInputs(fields, { ratio: '9:16 (Portrait)' }), /Ratio \(ratio\): "9:16 \(Portrait\)" is not a choice of this dropdown\. Use exactly one of: .*"9:16 \(Portrait Widescreen\)"/)
    assert.deepEqual(normalizeMcpWorkflowInputs(fields, { ratio: '9:16 (portrait widescreen)', model: 'moss/checkpoint_007_animeuwu' }), { positive: 'saved prompt', ratio: ratios[1], model: models[7] }, 'case, slash direction and a model file extension apart, a value is taken as the listed item')
    assert.equal(normalizeMcpWorkflowInputs(fields, {}).ratio, ratios[2])
    // A fixed value its dropdown does not offer fails every call the same way: the preset reports it instead of offering the tool.
    const broken = ChatGenerationPresetStore.create({ name: '고정 값', kind: 'comfyui', comfyui: { workflowId, exposedFieldIds: ['positive'], fixedInputs: { ratio: '9:16 (Portrait)' } } })
    assert.match(presetInputShape(broken).problem ?? '', /고정 값 "9:16 \(Portrait\)"이\(가\) "Ratio" 드롭다운에 없어/)
    assert.equal(presetInputShape(ChatGenerationPresetStore.update(broken.id, { comfyui: { workflowId, exposedFieldIds: ['positive'], fixedInputs: { ratio: '__random__', model: models[3] } } })!).problem, null)
    // Left on a field the model fills, the same value blocks nothing: the model's choice replaces it, so it is asked for.
    const overridden = presetInputShape(ChatGenerationPresetStore.update(broken.id, { comfyui: { workflowId, exposedFieldIds: ['positive', 'ratio'], fixedInputs: { ratio: '9:16 (Portrait)' } } })!)
    assert.equal(overridden.problem, null)
    const overriddenSchema = z.toJSONSchema(z.object(overridden.shape)) as typeof schema
    assert.deepEqual(overriddenSchema.required, ['positive', 'ratio'])
    assert.doesNotMatch(overriddenSchema.properties.ratio.description ?? '', /Leave out/)
    // A workflow whose field settings cannot be read is a problem of its presets, never a failed preset list.
    const { presetProblem } = await import('../src/services/codex-chat/chatGenerationInputs')
    const unreadable = WorkflowModel.create({ name: 'unreadable wf', workflow_json: '{}', marked_fields: { not: 'an array' } as never })
    const lost = ChatGenerationPresetStore.create({ name: '읽을 수 없음', kind: 'comfyui', comfyui: { workflowId: unreadable, exposedFieldIds: [], fixedInputs: {} } })
    assert.match(presetProblem(lost) ?? '', /입력 필드 설정을 읽을 수 없어/)
    assert.equal(presetProblem(ChatGenerationPresetStore.find(broken.id)!), null)
    // A saved value no longer in its list is what leaving the field out sends: the input template sent back is taken too.
    const stale = [{ ...fields[1], default_value: '4:3 (Standard)' }]
    assert.equal(normalizeMcpWorkflowInputs(stale, { ratio: '4:3 (Standard)' }).ratio, '4:3 (Standard)')
  })

  await t.test('a guide whose skill is gone never prevents inline tool registration', async () => {
    const { registerChatGenerationTools } = await import('../src/mcp/tools/chatGenerationTools')
    const skill = ChatSkillStore.create({ name: 'bad guide skill', description: 'Use when testing.', instructions: 'x', sections: [{ path: 'guide', title: 'Guide', summary: '', content: 'valid' }] })
    const preset = ChatGenerationPresetStore.create({ name: 'bad guide', kind: 'nai', prompting: { guide: 'inline fallback', guideSkill: { skillId: skill.id, path: 'guide' } } })
    ChatSkillStore.delete(skill.id)
    const descriptions: string[] = []
    registerChatGenerationTools({ registerTool: (_name: string, options: { description: string }) => { descriptions.push(options.description) } } as never,
      { scopes: ['generate'], source: 'llm-chat', generationPresetIds: [preset.id] })
    assert.equal(descriptions.length, 1)
    assert.match(descriptions[0], /inline fallback/)
    assert.match(descriptions[0], /Linked guide "guide" of skill #\d+ is gone/)
  })

  await t.test('generated pictures join the latest user message', () => {
    const merged = withGeneratedImages([{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }, { role: 'user', content: 'again' }], [{ url: 'data:image/jpeg;base64,BB' }])
    assert.equal(merged.length, 4)
    assert.equal(merged[1].content, 'hi')
    const last = merged[3].content as Array<{ type: string; text?: string; image_url?: { url: string } }>
    assert.equal(last[0].text, 'again')
    assert.equal(last.at(-1)?.image_url?.url, 'data:image/jpeg;base64,BB')
    assert.deepEqual(withGeneratedImages([{ role: 'user', content: 'x' }], []), [{ role: 'user', content: 'x' }])
    const profile = ChatProfileStore.create({ name: 'Vision budget', engine: 'llm', providerName: 'test', model: 'm' })
    const images = [{ url: 'data:image/jpeg;base64,BB' }]
    const reserved = generatedImagesTokens(profile.id, images)
    const base = [{ role: 'user' as const, content: 'again' }]
    assert.ok(reserved > 2000, 'the context reserves the image allowance plus its note')
    assert.ok(Math.abs(estimateMessagesTokens(profile.id, withGeneratedImages(base, images)) - estimateMessagesTokens(profile.id, base) - reserved) <= 1)
    assert.equal(generatedImagesTokens(profile.id, []), 0)
    assert.equal(generatedImagesTokens(profile.id, [{ url: `data:image/jpeg;base64,${'A'.repeat(10000)}` }]), reserved, 'base64 transport length does not affect image cost')
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
    const { initializeAuthDb, getAuthDb } = await import('../src/database/authDb')
    const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
    const { GenerationQueueService } = await import('../src/services/generationQueueService')
    initializeAuthDb()
    s.after(() => getAuthDb().close())
    updateChatSettings({ enabled: true })
    s.mock.method(GenerationQueueService, 'requestDispatch', () => {})
    s.mock.method(ExternalApiProvider, 'findByName', () => ({ provider_name: 'test', display_name: 'Test', is_enabled: true, provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid/v1', additional_config: '{}' }))
    s.mock.method(ExternalApiProvider, 'getDecryptedKey', () => null)
    const bodies: Array<{ model: string; messages: Array<{ role: string; content: unknown }> }> = []
    s.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') return new Response('', { status: 404 })
      bodies.push(JSON.parse(String(init.body)))
      return Response.json({ choices: [{ message: { content: '{"prompt": "1girl, smile, rooftop"}' }, finish_reason: 'stop' }] })
    })
    const preset = ChatGenerationPresetStore.create({ name: '뒤에', kind: 'nai', prompting: { timing: 'after', guide: '표정을 꼭 넣어.' } })
    const profile = ChatProfileStore.create({ name: '루나', engine: 'llm', providerName: 'test', model: 'chat-model', appearance: 'silver hair', mcpEnabled: true, generationPresetIds: [preset.id] })
    const { learnServerContextLimit } = await import('../src/services/codex-chat/serverContextLimit')
    learnServerContextLimit({ providerName: 'test', model: 'chat-model' }, 'context length (8192 tokens)')
    const thread = CodexChatStore.findThreadById(CodexChatStore.createThread(null, '옥상', 'llm', profile.id))!
    const contextOf = (replyId: string) => ({
      scopes: ['generate' as const], source: 'llm-chat' as const, requester: { accountId: null, accountType: null },
      generationPresetIds: [preset.id], generationPresetSnapshot: JSON.stringify(ChatGenerationPresetStore.resolve([preset.id])),
      chatContext: { threadId: thread.id, profileId: profile.id, kind: 'direct' as const, replyId },
    })
    CodexChatStore.addMessage({ thread_id: thread.id, role: 'user', content: 'OLDER-TURN ' + 'older context '.repeat(5000), tool_calls: [], status: 'completed', error: null })
    CodexChatStore.addMessage({ thread_id: thread.id, role: 'assistant', content: 'OLDER-ANSWER', tool_calls: [], status: 'completed', error: null })
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
    assert.doesNotMatch(String(user.content), /OLDER-TURN|OLDER-ANSWER/, 'only the oversized older turn is dropped')
    const row = (id: number) => dbModule.getUserSettingsDb().prepare('SELECT state, error FROM chat_deferred_generations WHERE id = ?').get(id) as { state: string; error: string | null }
    assert.equal(row(done).state, 'queued', row(done).error ?? undefined)
    assert.equal(row(cut).state, 'skipped')
    ChatProfileStore.update(profile.id, { generationPresetIds: [] })
    const revoked = ChatDeferredGenerationStore.add(contextOf('reply-done'), preset.id, 'generate_image', '')
    await process('reply-done')
    assert.equal(row(revoked).state, 'failed')
    assert.equal(bodies.length, 1, 'revoked authorization must stop before another paid prompt-writing request')
  })
})
