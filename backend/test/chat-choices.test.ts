import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { chatFormLayout, decodeChatForm, type ChatExecutionContext, type ChatFormProposal } from '@conai/shared'

test('chat question cards: offer_choices, answers checked against the open card, directive', { timeout: 60000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-choices-test-'))
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
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-choices-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const { ChatProposalStore } = await import('../src/services/codex-chat/chatProposals')
  const { attachProposals } = await import('../src/services/codex-chat/codexChatMedia')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  updateChatSettings({ enabled: true })
  const { readChoiceAnswer } = await import('../src/services/codex-chat/chatChoices')
  const { buildFlagDirective } = await import('../src/services/codex-chat/chatFlags')
  const { proposalOutcomeNote } = await import('../src/services/codex-chat/chatPageContext')
  const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
  const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')

  ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const profile = ChatProfileStore.create({ name: 'Luna', engine: 'llm', providerName: 'conn', systemPrompt: 'p', mcpEnabled: true, mcpScopes: ['read'] })
  const threadId = CodexChatStore.createThread(null, 'choice chat', 'llm', profile.id)
  const otherThreadId = CodexChatStore.createThread(null, 'other chat', 'llm', profile.id)
  const admin = { accountId: null, accountType: 'admin' as const }
  const controller = new AbortController()
  const reply = (replyId: string) => CodexChatStore.addMessage({ thread_id: threadId, role: 'assistant', content: 'pick one', display_content: null, tool_calls: [{ id: 'c1', tool: 'offer_choices', status: 'completed', arguments: null, summary: null, historyIds: [], compositeHashes: [] }], status: 'completed', error: null, routing: { replyId, replyTo: null, recipients: ['user'] } })

  await t.test('offer_choices stores a card for the reply; without_page needs a page', async () => {
    const context: ChatExecutionContext = { threadId, profileId: profile.id, kind: 'direct', replyId: 'ask-1' }
    const unregister = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge(admin, ['read'], null, { chatContext: context })
    try {
      assert.ok(bridge.tools.some((tool) => tool.function.name === 'offer_choices'), 'offered in a 1:1 chat with tools')
      const refused = await bridge.call('offer_choices', { question: 'How?', options: [{ label: 'Here' }, { label: 'Tools', without_page: true }] })
      assert.ok(refused.isError, 'without_page with no page connected is refused')
      assert.ok((await bridge.call('offer_choices', { question: 'How?', options: [{ label: 'Same' }, { label: 'Same' }] })).isError, 'labels are unique')
      const made = await bridge.call('offer_choices', { question: '배경 분위기', options: [{ label: '비 오는 밤', detail: '어두운 톤' }, { label: '노을' }, { label: '설경' }], multiple: true })
      assert.ok(!made.isError)
      const card = ChatProposalStore.forReply(threadId, 'ask-1', 'choice')[0]
      assert.deepEqual({ ...card, id: 0 }, { id: 0, kind: 'choice', question: '배경 분위기', options: [{ label: '비 오는 밤', detail: '어두운 톤' }, { label: '노을' }, { label: '설경' }], multiple: true })
      assert.equal(proposalOutcomeNote(threadId), '', 'question cards stay out of the review-card outcome note')
    } finally {
      await bridge.close()
      unregister()
    }
    const group: ChatExecutionContext = { threadId, profileId: profile.id, kind: 'group', replyId: 'ask-g' }
    const unregisterGroup = registerChatReply(group, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const groupBridge = await openChatMcpBridge(admin, ['read'], null, { chatContext: group })
    try {
      assert.ok(!groupBridge.tools.some((tool) => tool.function.name === 'offer_choices'), 'not offered in group rooms')
    } finally {
      await groupBridge.close()
      unregisterGroup()
    }
  })

  await t.test('answers: only the newest reply\'s card, only its labels, one for a single-answer card', () => {
    const messageId = reply('ask-1')
    const card = ChatProposalStore.forReply(threadId, 'ask-1', 'choice')[0]
    const answer = readChoiceAnswer(threadId, { proposalId: card.id, answers: ['비 오는 밤', '노을'] })
    assert.ok(answer && !('error' in answer))
    assert.deepEqual(answer.flags.map((flag) => [flag.content, flag.pick, flag.choice]), [['비 오는 밤', true, { id: card.id, question: '배경 분위기' }], ['노을', true, { id: card.id, question: '배경 분위기' }]])
    assert.equal(answer.withoutPage, false)
    assert.ok('error' in (readChoiceAnswer(threadId, { proposalId: card.id, answers: ['없는 답'] }) ?? {}), 'unknown label')
    assert.ok('error' in (readChoiceAnswer(threadId, { proposalId: card.id, answers: [] }) ?? {}), 'no label')
    assert.ok('error' in (readChoiceAnswer(otherThreadId, { proposalId: card.id, answers: ['노을'] }) ?? {}), 'another chat\'s card')
    assert.equal(readChoiceAnswer(threadId, undefined), null, 'no answer sent')

    // The tool call stored with the reply carries its card when the chat is read.
    const stored = CodexChatStore.listMessages(threadId).find((message) => message.id === messageId)!
    assert.equal(attachProposals([stored])[0].tool_calls[0].proposal?.kind, 'choice')

    const single = ChatProposalStore.add({ threadId, profileId: profile.id, kind: 'direct', replyId: 'ask-2' }, { kind: 'choice', question: '어떻게 할까?', options: [{ label: '페이지 이동해서 진행' }, { label: '화면 참조 없이 진행', withoutPage: true }], multiple: false })
    assert.ok('error' in (readChoiceAnswer(threadId, { proposalId: single.id, answers: ['페이지 이동해서 진행'] }) ?? {}), 'a card of an older reply has passed')
    reply('ask-2')
    assert.ok('error' in (readChoiceAnswer(threadId, { proposalId: card.id, answers: ['노을'] }) ?? {}), 'the earlier card passed once a newer reply came')
    assert.ok('error' in (readChoiceAnswer(threadId, { proposalId: single.id, answers: ['페이지 이동해서 진행', '화면 참조 없이 진행'] }) ?? {}), 'one answer for a single-answer card')
    const withoutPage = readChoiceAnswer(threadId, { proposalId: single.id, answers: ['화면 참조 없이 진행'] })
    assert.ok(withoutPage && !('error' in withoutPage) && withoutPage.withoutPage, 'an answer that asks to go without the page says so')

    CodexChatStore.addMessage({ thread_id: threadId, role: 'user', content: '다른 얘기', display_content: null, tool_calls: [], status: 'completed', error: null })
    assert.ok('error' in (readChoiceAnswer(threadId, { proposalId: single.id, answers: ['화면 참조 없이 진행'] }) ?? {}), 'a message in between passes the card')
  })

  await t.test('show_form: a catalogued card, answered with its own button and values only', async () => {
    const context: ChatExecutionContext = { threadId, profileId: profile.id, kind: 'direct', replyId: 'ask-3' }
    const unregister = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge(admin, ['read'], null, { chatContext: context })
    const components = [
      { id: 'root', component: 'Column', children: ['size', 'steps', 'seed', 'go', 'skip'] },
      { id: 'size', component: 'ChoicePicker', label: '크기', options: [{ label: '세로', value: 'portrait' }, { label: '가로', value: 'landscape' }], value: { '@path': '/size' } },
      { id: 'steps', component: 'Slider', label: '스텝', min: 1, max: 50, value: { '@path': '/steps' } },
      { id: 'seed', component: 'CheckBox', label: '시드 고정', value: { '@path': '/seed' } },
      { id: 'go', component: 'Button', child: 'goText', variant: 'primary', action: { event: { name: 'generate' } } },
      { id: 'goText', component: 'Text', text: '생성' },
      { id: 'skip', component: 'Button', child: 'skipText', action: { event: { name: 'skip' } } },
      { id: 'skipText', component: 'Text', text: '건너뛰기' },
    ]
    try {
      assert.ok(!bridge.tools.some((tool) => tool.function.name === 'show_form'), 'its catalog text stays behind open_tools')
      const refused = await bridge.call('run_tool', { tool: 'show_form', arguments: { title: '생성 설정', components: [...components, { id: 'x', component: 'Modal' }] } })
      assert.ok(refused.isError, 'a component outside the catalog is refused')
      const made = await bridge.call('run_tool', { tool: 'show_form', arguments: { title: '생성 설정', components, dataModel: { size: ['portrait'], steps: 28 } } })
      assert.ok(!made.isError)
      assert.ok((await bridge.call('run_tool', { tool: 'show_form', arguments: { title: '또', components } })).isError, 'one form per reply')
    } finally {
      await bridge.close()
      unregister()
    }
    const form = ChatProposalStore.forReply(threadId, 'ask-3', 'form')[0]
    assert.deepEqual((form as { dataModel?: unknown }).dataModel, { size: ['portrait'], steps: 28, seed: false }, 'starting values are held to the inputs')
    reply('ask-3')
    const answer = readChoiceAnswer(threadId, { proposalId: form.id, action: 'generate', values: { size: ['landscape'], steps: 30, seed: true, extra: 'dropped' } })
    assert.ok(answer && !('error' in answer))
    assert.deepEqual(answer.flags.map((flag) => [flag.name, flag.content]), [['가로', '크기: landscape'], ['스텝 30', '스텝: 30'], ['시드 고정', '시드 고정: yes'], ['생성', 'Pressed: 생성']])
    assert.ok(answer.flags.every((flag) => flag.pick && flag.choice?.id === form.id && flag.choice.question === '생성 설정'))
    assert.ok('error' in (readChoiceAnswer(threadId, { proposalId: form.id, action: 'delete', values: { size: ['landscape'], steps: 30, seed: true } }) ?? {}), 'a button the card does not have')
    assert.ok('error' in (readChoiceAnswer(threadId, { proposalId: form.id, action: 'generate', values: { size: ['square'], steps: 30, seed: true } }) ?? {}), 'a choice the card does not offer')
    assert.ok('error' in (readChoiceAnswer(threadId, { proposalId: form.id, action: 'generate', values: { size: ['landscape'], steps: 500, seed: true } }) ?? {}), 'a number outside the slider')
    assert.equal(proposalOutcomeNote(threadId), '', 'forms stay out of the review-card outcome note')
  })

  await t.test('show_form formats: the compact fields call and A2UI slips decode to the stored card', async () => {
    // The shape models guess without opening the definition: aliases, string options, a default by label.
    const guessed = decodeChatForm({ title: '캐릭터', description: '원하는 걸 골라 줘', fields: [
      { key: 'hair', label: '머리색', type: 'select', options: ['Black', 'Blond'], default: 'blond', required: true },
      { name: 'height', label: '키', type: 'number', min: 140, max: 200 },
      { key: 'glasses', label: '안경', type: 'switch', default: 'yes' },
    ], submit_label: '만들기' })
    assert.ok(!('error' in guessed), JSON.stringify(guessed))
    assert.deepEqual(guessed.components, [
      { id: 'root', component: 'Column', children: ['note', 'f1', 'f2', 'f3', 'b1'] },
      { id: 'note', component: 'Text', text: '원하는 걸 골라 줘', variant: 'caption' },
      { id: 'f1', component: 'ChoicePicker', label: '머리색', options: [{ label: 'Black', value: 'Black' }, { label: 'Blond', value: 'Blond' }], value: { '@path': '/hair' }, variant: 'mutuallyExclusive' },
      { id: 'f2', component: 'Slider', label: '키', min: 140, max: 200, value: { '@path': '/height' } },
      { id: 'f3', component: 'CheckBox', label: '안경', value: { '@path': '/glasses' } },
      { id: 'b1', component: 'Button', child: 't1', variant: 'primary', action: { event: { name: 'button_1' } } },
      { id: 't1', component: 'Text', text: '만들기', variant: 'body' },
    ])
    assert.deepEqual(guessed.dataModel, { hair: ['Blond'], height: 140, glasses: true })

    // A step size becomes steps; steps read as a size or as positions are dropped.
    const sliders = decodeChatForm({ title: '설정', fields: [{ key: 'scale', label: 'Scale', type: 'slider', min: 0, max: 1, step: 0.05 }, { key: 'n', label: 'N', type: 'range', min: 10, max: 50, steps: 9 }], buttons: [{ label: 'Go', event: 'go' }] })
    assert.ok(!('error' in sliders), JSON.stringify(sliders))
    assert.deepEqual(sliders.components.filter((row) => row.component === 'Slider').map((row) => [row.id, 'steps' in row ? row.steps : null]), [['f1', 20], ['f2', null]])
    const slips = decodeChatForm({ title: '설정', components: [
      { id: 'root', component: 'Column', children: ['intro', 'hairText', 'hair', 'steps', 'cfg', 'ok'] },
      { id: 'intro', component: 'Text', text: '한 번에 정해 줘' },
      { id: 'hairText', component: 'Text', text: 'Hair' },
      { id: 'hair', component: 'TextField', label: 'Hair (color)', value: { '@path': '/look/hair' } },
      { id: 'steps', component: 'Slider', label: '스텝', min: 1, max: 50, steps: 1, value: { '@path': '/steps' } },
      { id: 'cfg', component: 'Slider', label: 'CFG', min: 0, max: 1, steps: 20, value: { '@path': '/cfg' } },
      { id: 'ok', component: 'Button', child: 'okText', action: { event: { name: 'ok' } } },
      { id: 'okText', component: 'Text', text: 'OK' },
    ], dataModel: { '/look/hair': 'black', '/steps': 20, steps: 30 } })
    assert.ok(!('error' in slips), JSON.stringify(slips))
    assert.deepEqual(slips.components[0], { id: 'root', component: 'Column', children: ['intro', 'hair', 'steps', 'cfg', 'ok'] }, 'the caption repeating the next label goes, the note stays')
    assert.deepEqual(slips.components.filter((row) => row.component === 'Slider').map((row) => [row.id, 'steps' in row ? row.steps : null]), [['steps', null], ['cfg', 20]])
    assert.deepEqual(slips.dataModel, { look: { hair: 'black' }, steps: 30, cfg: 0 }, 'path keys are read; a plain key wins')

    assert.deepEqual(decodeChatForm({ title: 'x', fields: [{ key: 'when', label: '언제', type: 'date' }] }), { error: 'Field "when": type "date" is not offered (text, longtext, number, select, multi, slider, switch, media).' })
    assert.deepEqual(decodeChatForm({ title: 'x', fields: [{ key: 'size', label: '크기', type: 'radio', options: ['S', 'M'], default: 'XL' }] }), { error: 'Field "size": default "XL" is not one of its options.' })
    assert.deepEqual(decodeChatForm({ title: 'x' }), { error: 'Give "fields": a list of {key, label, type}.' })

    // Through the real tool: the input schema lets the alias keys reach the decoder.
    const context: ChatExecutionContext = { threadId, profileId: profile.id, kind: 'direct', replyId: 'ask-4' }
    const unregister = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge(admin, ['read'], null, { chatContext: context })
    try {
      const made = await bridge.call('run_tool', { tool: 'show_form', arguments: { title: '머리', description: '골라 줘', fields: [{ name: 'hair', label: '머리색', type: 'radio', options: ['검정', '금발'], value: '금발' }], submitLabel: '확인' } })
      assert.ok(!made.isError, JSON.stringify(made.content))
    } finally {
      await bridge.close()
      unregister()
    }
    const form = ChatProposalStore.forReply(threadId, 'ask-4', 'form')[0] as unknown as ChatFormProposal
    assert.equal(form.kind, 'form')
    assert.deepEqual(form.dataModel, { hair: ['금발'] })
    assert.deepEqual(chatFormLayout(form).buttons, [{ event: 'button_1', label: '확인', primary: true }])
    assert.deepEqual(chatFormLayout(form).rows.map((row) => row.component), ['Text', 'ChoicePicker'])
  })

  await t.test('cards on the stream: a running reply is told of each stored card once; others store as before', () => {
    const card = { kind: 'choice' as const, question: '어디로?', options: [{ label: '여기' }, { label: '저기' }], multiple: false }
    const context: ChatExecutionContext = { threadId: otherThreadId, profileId: profile.id, kind: 'direct', replyId: 'live-1' }
    const announced: Array<{ id: number }> = []
    const unregister = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }), (proposal) => { announced.push(proposal) })
    const stored = ChatProposalStore.add(context, card)
    assert.deepEqual(announced, [ChatProposalStore.find(stored.id)], 'the stored card, with its id, once')
    unregister()
    ChatProposalStore.add(context, card)
    assert.equal(announced.length, 1, 'an ended reply is not told')
    assert.doesNotThrow(() => ChatProposalStore.add({ ...context, replyId: 'headless' }, card), 'a reply with no listener stores as before')
    const unregisterThrowing = registerChatReply({ ...context, replyId: 'live-2' }, controller.signal, () => ({ replyTo: null, recipients: ['user'] }), () => { throw new Error('closed stream') })
    try {
      assert.ok(ChatProposalStore.add({ ...context, replyId: 'live-2' }, card).id > 0, 'a failing listener does not fail the store')
    } finally {
      unregisterThrowing()
    }
  })

  await t.test('directive: answers grouped under their question, apart from status picks', () => {
    const directive = buildFlagDirective([
      { id: 0, icon: 'lucide:target', name: '검', content: '검', pick: true },
      { id: 0, icon: 'lucide:list-checks', name: '노을', content: '노을', pick: true, choice: { id: 1, question: '배경 분위기' } },
      { id: 0, icon: 'lucide:list-checks', name: '설경', content: '설경', pick: true, choice: { id: 1, question: '배경 분위기' } },
    ])
    assert.equal(directive, '[User picks from the status panel]\n- 검\n\n[Answer to the choice: 배경 분위기]\n- 노을\n- 설경')
  })
})
