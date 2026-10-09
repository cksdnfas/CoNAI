import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { ChatExecutionContext } from '@conai/shared'

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

  await t.test('directive: answers grouped under their question, apart from status picks', () => {
    const directive = buildFlagDirective([
      { id: 0, icon: 'lucide:target', name: '검', content: '검', pick: true },
      { id: 0, icon: 'lucide:list-checks', name: '노을', content: '노을', pick: true, choice: { id: 1, question: '배경 분위기' } },
      { id: 0, icon: 'lucide:list-checks', name: '설경', content: '설경', pick: true, choice: { id: 1, question: '배경 분위기' } },
    ])
    assert.equal(directive, '[사용자 선택: 상태창에서 고른 항목]\n- 검\n\n[선택지 답: 배경 분위기]\n- 노을\n- 설경')
  })
})
