import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { ChatExecutionContext } from '@conai/shared'

/**
 * What a chat may propose about a profile beyond its texts (model roles, context, summary, translation languages,
 * rating ceiling, lore recursion, linked files), the chat's own settings card (lorebook links, record book, linked
 * files, minutes), and the recursion flags save_lore carries.
 */
test('chat setup: profile settings proposals and the chat settings card', { timeout: 120000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-setup-settings-test-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE']) process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  // The main database holds the rating tiers a content ceiling names.
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  t.after(async () => {
    authModule.getAuthDb().close()
    dbModule.closeUserSettingsDb()
    main.closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-setup-settings-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
  const { OwnedLorebookStore } = await import('../src/services/codex-chat/chatLorebookFiles')
  const { LinkedFileStore } = await import('../src/services/codex-chat/chatLinkedFiles')
  const { RatingScoreModel } = await import('../src/models/RatingScore')
  const { ChatProposalStore } = await import('../src/services/codex-chat/chatProposals')
  const setup = await import('../src/mcp/tools/chatSetupTools')
  const settings = await import('../src/services/codex-chat/chatSettingsProposals')
  const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
  const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')

  updateChatSettings({ enabled: true })
  ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const profile = ChatProfileStore.create({ name: '리나', engine: 'llm', providerName: 'conn', mcpEnabled: true, mcpScopes: ['read', 'configure'] })
  const helper = ChatProfileStore.create({ name: '도우미', engine: 'llm', providerName: 'conn' })
  const me = fileOwnerKey(null)
  const threadId = CodexChatStore.createThread(null, '설정 실험', 'llm', profile.id)
  const journal = FileStoreService.createFolder(me, null, '일지')
  const world = FileStoreService.createFolder(me, null, '세계관')
  const memo = FileStoreService.writeText(me, null, '메모.md', '메모\n', { create: true })
  const book = OwnedLorebookStore.create(me, { name: '장기 기억' })

  await t.test('profile update: newer settings are proposable, clamped and shown by name; grants are not', () => {
    const tiers = RatingScoreModel.getAllTiers()
    assert.ok(tiers.length > 0, 'the default rating tiers exist')
    const { proposal } = setup.buildProfileUpdateProposal({ patch: {
      translation_display_language: 'ja', translationModelLanguage: 'zh', translationInstructions: '  존댓말  ',
      lore_recursion_depth: 9, contextTurns: 0, contextTokens: null, maxToolRounds: 3.6, temperature: 5,
      summaryEnabled: true, summary_trigger_turns: 12, suggestEnabled: true, suggestProfileId: helper.id,
      visionEnabled: true, contentRatingMode: 'custom', contentRatingTierId: tiers[0].id, allowLoreProposals: false,
      linkedFiles: [{ id: journal.id, write: true }, { id: memo.id }],
    } }, profile.id, me)
    assert.equal(proposal.kind, 'profile_update')
    if (proposal.kind !== 'profile_update') return
    assert.equal(proposal.patch.translationDisplayLanguage, 'ja')
    assert.equal(proposal.patch.translationModelLanguage, 'zh')
    assert.equal(proposal.patch.translationInstructions, '존댓말')
    assert.equal(proposal.patch.loreRecursionDepth, 5, 'clamped to the recursion maximum')
    assert.equal(proposal.patch.contextTurns, 1, 'clamped to the minimum')
    assert.equal(proposal.patch.maxToolRounds, 4, 'rounded like the editor')
    assert.equal(proposal.patch.temperature, 2)
    assert.equal('contextTokens' in proposal.patch, false, 'unchanged values are dropped (null already)')
    assert.deepEqual(proposal.patch.linkedFiles, [{ id: journal.id, write: true }, { id: memo.id, write: false }])
    assert.equal(proposal.display?.suggestProfileId?.after, '도우미')
    assert.equal(proposal.display?.contentRatingTierId?.after, tiers[0].tier_name)
    assert.match(proposal.display?.linkedFiles?.after ?? '', /일지\/ \(쓰기\), 메모\.md/)
    // Saving goes through the admin REST; the store accepts exactly this patch.
    ChatProfileStore.update(profile.id, proposal.patch)
    const saved = ChatProfileStore.find(profile.id)!
    assert.equal(saved.translationDisplayLanguage, 'ja')
    assert.equal(saved.loreRecursionDepth, 5)
    assert.equal(saved.allowLoreProposals, false)
    assert.deepEqual(saved.linkedFiles, [{ id: journal.id, write: true }, { id: memo.id, write: false }])

    assert.throws(() => setup.buildProfileUpdateProposal({ patch: { pageAssist: true } }, profile.id, me), /Not proposable: pageAssist.*page assistant/)
    assert.throws(() => setup.buildProfileUpdateProposal({ patch: { engine: 'codex', mcpScopes: ['organize'] } }, profile.id, me), /Not proposable: engine, mcpScopes/)
    assert.throws(() => setup.buildProfileUpdateProposal({ patch: { translationDisplayLanguage: 'fr' } }, profile.id, me), /ko, en, ja, zh/)
    assert.throws(() => setup.buildProfileUpdateProposal({ patch: { contentRatingTierId: 999999 } }, profile.id, me), /unknown rating tier/)
    assert.throws(() => setup.buildProfileUpdateProposal({ patch: { judgePresetId: 4242 } }, profile.id, me), /no such judge preset/)
    assert.throws(() => setup.buildProfileUpdateProposal({ patch: { summaryEnabled: 'yes' } }, profile.id, me), /true or false/)
    assert.throws(() => setup.buildProfileUpdateProposal({ patch: { linkedFiles: [{ id: book.folderId }] } }, profile.id, me), /로어북 폴더/)
    assert.throws(() => setup.buildProfileUpdateProposal({ patch: { linkedFiles: [{ id: 'nope' }] } }, profile.id, me), /32-character id/)
    assert.throws(() => setup.buildProfileUpdateProposal({ patch: { linkedFiles: [{ id: world.id }] } }, profile.id, null), /needs a chat account/)
  })

  await t.test('profile read and guide: current values, read-only grants, ranges instead of "not proposable"', () => {
    const view = setup.profileSetupView(ChatProfileStore.find(profile.id)!, me)
    assert.equal(view.translationDisplayLanguage, 'ja')
    assert.equal(view.loreRecursionDepth, 5)
    assert.deepEqual(view.notProposable, { engine: 'llm', pageAssist: false })
    assert.deepEqual((view.linkedFiles as Array<{ name: string | null }>).map((link) => link.name), ['일지', '메모.md'])
    const created = setup.buildProfileProposal({ name: '새 캐릭터', system_prompt: 'x', settings: { summary_enabled: true, translationDisplayLanguage: 'zh' } }, me)
    assert.equal(created.input.summaryEnabled, true)
    assert.equal(created.input.translationDisplayLanguage, 'zh')
    assert.throws(() => setup.buildProfileProposal({ name: '새 캐릭터', system_prompt: 'x', settings: { name: 'other' } }, me), /own argument/)
    assert.throws(() => setup.buildProfileProposal({ name: '새 캐릭터', system_prompt: 'x', settings: { toolAllowlist: [] } }, me), /Not proposable/)
  })

  await t.test('chat settings card: validated against the owner, saved with the context tab rules', () => {
    const context = (replyId: string): ChatExecutionContext => ({ threadId, profileId: profile.id, kind: 'direct', replyId })
    // The record book must be linked (in the same card or before).
    assert.throws(() => settings.buildChatSettingsProposal(threadId, { record_book_id: book.id }), /linked to this chat/)
    assert.throws(() => settings.buildChatSettingsProposal(threadId, { lorebook_ids: [987654] }), /Not an account lorebook/)
    assert.throws(() => settings.buildChatSettingsProposal(threadId, { minutes_folder_id: world.id }), /writing allowed/)
    assert.throws(() => settings.buildChatSettingsProposal(threadId, {}), /Nothing would change/)
    const card = settings.proposeChatSettings(context('settings-1'), {
      lorebook_ids: [book.id], record_book_id: book.id,
      linked_files: [{ id: world.id, write: true }], minutes_folder_id: world.id,
    })
    assert.equal(card.kind, 'chat_settings')
    if (card.kind !== 'chat_settings') return
    assert.deepEqual(Object.keys(card.patch).sort(), ['linkedFiles', 'loreRecordBookId', 'lorebookIds', 'minutesFolderId'])
    assert.equal(card.display.loreRecordBookId.before, '이 채팅 로어북')
    assert.equal(card.display.loreRecordBookId.after, '장기 기억')
    assert.equal(card.display.minutesFolderId.after, '세계관')
    assert.equal(OwnedLorebookStore.recordBookId(threadId), null, 'nothing changes before 저장')
    const saved = settings.applyChatSettingsProposal({ accountId: null, accountType: 'admin' }, card.id)
    assert.equal((saved as { saved?: boolean }).saved, true)
    assert.equal(OwnedLorebookStore.recordBookId(threadId), book.id)
    assert.deepEqual(LinkedFileStore.threadLinks(threadId), [{ id: world.id, write: true }])
    assert.throws(() => settings.applyChatSettingsProposal({ accountId: null, accountType: 'admin' }, card.id), /이미 저장/)
    const view = settings.chatSettingsView(threadId)
    assert.equal(view.lorebooks.recordBook?.name, '장기 기억')
    assert.equal(view.minutes.folder?.id, world.id)
    assert.ok(view.linkedFiles.some((file) => file.name === '일지' && file.via === 'profile'), 'profile links are listed with the chat\'s own')
    assert.equal(ChatProposalStore.find(card.id)?.kind, 'chat_settings')
  })

  await t.test('chat settings tools: only behind a tool catalog, never direct, never on a public page', async () => {
    const controller = new AbortController()
    const context: ChatExecutionContext = { threadId, profileId: profile.id, kind: 'direct', replyId: 'settings-tools' }
    const unregister = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const names = (bridge: { tools: Array<{ function: { name: string } }>; catalogTools: Set<string> }) => [...bridge.tools.map((tool) => tool.function.name), ...bridge.catalogTools]
    // A chat with no app tools has no catalog: the settings tools would be direct definitions on every request, so they are left out.
    const bare = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, [], null, { chatContext: context })
    try {
      assert.ok(!names(bare).includes('get_chat_settings'), 'no direct definition without a catalog')
      assert.ok(!bare.tools.some((tool) => tool.function.name === 'propose_chat_settings'))
    } finally { await bare.close() }
    const full = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, ['read', 'generate', 'organize'], null, { chatContext: context })
    try {
      assert.ok(full.catalogTools.has('get_chat_settings') && full.catalogTools.has('propose_chat_settings'), 'catalogued, whatever the profile tool list')
      assert.ok(!full.tools.some((tool) => tool.function.name === 'get_chat_settings'), 'never listed directly')
      const read = await full.call('get_chat_settings', {})
      assert.ok(!read.isError, JSON.stringify(read.content))
      assert.match(JSON.stringify(read.content), /장기 기억/)
    } finally { await full.close(); unregister() }
    const { CHAT_FEATURES_GUIDE } = await import('../src/mcp/tools/chatSettingsTools')
    assert.match(CHAT_FEATURES_GUIDE, /나레이션/)
    const page = { instanceId: 'page-1234567890', connectionId: 'conn-1234567890', path: '/settings', title: 'Settings', kind: 'settings' as const, resourceId: null, fields: [] }
    // An app page the account connected keeps them; public page text (anyone's) never reaches the chat's own settings.
    const paged = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, ['read'], null, { chatContext: { ...context, page } })
    try {
      assert.ok(names(paged).includes('get_chat_settings'), 'kept on an app page')
    } finally { await paged.close() }
    const exposed = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, ['read'], null, { chatContext: { ...context, page: { ...page, path: '/public/workflows/demo' } } })
    try {
      assert.ok(!names(exposed).includes('get_chat_settings') && !names(exposed).includes('propose_chat_settings'), 'public page text never reaches the chat\'s own settings')
    } finally { await exposed.close() }
  })
})
