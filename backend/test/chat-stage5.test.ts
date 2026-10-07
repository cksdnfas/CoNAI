import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { chatBlockToneText, unknownChatMacros } from '@conai/shared'

test('stage 5: lore provenance, usage, undo, branches, greetings and tone', { timeout: 60000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-stage5-test-'))
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
    assert.ok(path.basename(root).startsWith('conai-stage5-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const db = dbModule.getUserSettingsDb()
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { ChatProposalStore } = await import('../src/services/codex-chat/chatProposals')
  const { applyLoreProposal, undoLoreProposal } = await import('../src/services/codex-chat/chatLoreProposals')
  const { OwnedLorebookStore, loreEntryFile, readEntryFileText } = await import('../src/services/codex-chat/chatLorebookFiles')
  const { normalizeLorebook } = await import('../src/services/codex-chat/chatLorebook')
  const { threadLorebooks } = await import('../src/services/codex-chat/chatLoreContext')
  const { branchChatThread } = await import('../src/services/codex-chat/chatBranch')
  const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
  const { normalizeBlock } = await import('../src/services/codex-chat/chatStyle')
  const { blockStateText } = await import('../src/services/codex-chat/chatBlockState')
  const { buildChatMessages, resolveContextConfig } = await import('../src/services/codex-chat/llmChatContext')
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  updateChatSettings({ enabled: true, diagnostics: { enabled: true } })
  const { addChatGreeting } = await import('../src/services/codex-chat/chatGreeting')
  const { userPersonaOf } = await import('../src/services/codex-chat/chatUserProfiles')
  ExternalApiProvider.create({ provider_name: 'stage5', display_name: 'Stage 5', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const profile = ChatProfileStore.create({ name: '카이', engine: 'llm', providerName: 'stage5', greeting: '안녕 {{user}}', alternateGreetings: ['{{char}}가 웃어', '세 번째 인사'] })
  const owner = fileOwnerKey(1)
  const freshThread = () => CodexChatStore.createThread(1, '5단계', 'llm', profile.id)
  const thread = (id: number) => CodexChatStore.findThreadById(id)!
  const say = (threadId: number, replyId?: string) => CodexChatStore.addMessage({ thread_id: threadId, role: 'assistant', content: '답변', tool_calls: [], status: 'completed', error: null, ...(replyId ? { routing: { replyId, recipients: [] } } : {}) })
  const proposal = (threadId: number, replyId: string, replaces?: string) => ChatProposalStore.add({ threadId, replyId, profileId: profile.id, kind: 'direct' }, { kind: 'lore', title: '약속', keys: ['바다'], content: '새 약속', constant: true, ...(replaces ? { replaces, before: { title: '약속', keys: [], content: '옛 약속', constant: false, file: null } } : {}) })

  await t.test('E1: saving new and replacement proposals preserves source through normalization and JSON import', () => {
    const id = freshThread()
    const first = proposal(id, 'reply-first')
    const saved = applyLoreProposal(first.id).book
    assert.deepEqual(saved.entries[0].source, { threadId: id, replyId: 'reply-first', proposalId: first.id })
    const update = proposal(id, 'reply-update', saved.entries[0].id)
    const replaced = applyLoreProposal(update.id).book
    assert.deepEqual(replaced.entries[0].source, { threadId: id, replyId: 'reply-update', proposalId: update.id })
    assert.deepEqual(normalizeLorebook(JSON.stringify(replaced.entries))[0].source, replaced.entries[0].source)
    assert.equal(normalizeLorebook([{ content: '구형 항목' }])[0].source, undefined)
    assert.equal(normalizeLorebook([{ content: '손상된 출처', source: { threadId: -1 } }])[0].source, undefined)
  })

  await t.test('E1: usage follows active variants, ignores unselected entries, and resolves missing/private sources', () => {
    const id = freshThread()
    const firstId = say(id, 'source-reply')
    const book = OwnedLorebookStore.saveChatBook(id, [{ id: 'used', content: '본문', source: { threadId: id, replyId: 'source-reply', proposalId: 1 } }, { id: 'never', content: '미사용' }])!
    const meta = { version: 2, loreEntries: [{ bookId: book.id, entryId: 'used', selected: true }, { bookId: book.id, entryId: 'never', selected: false }] }
    db.prepare('UPDATE codex_chat_messages SET context_meta = ? WHERE id = ?').run(JSON.stringify(meta), firstId)
    const secondId = say(id, 'second')
    const usage = () => threadLorebooks(thread(id), [profile]).entryUsage
    assert.deepEqual(usage()[`${book.id}:used`], { turnsAgo: 1, sourceMessageId: firstId })
    assert.equal(usage()[`${book.id}:never`], undefined)
    CodexChatStore.addAlternative(id, secondId, { content: '변형', tool_calls: [], status: 'completed', error: null, created_at: new Date().toISOString(), context_meta: JSON.stringify(meta), routing: { replyId: 'variant', recipients: [] } })
    assert.equal(usage()[`${book.id}:used`].turnsAgo, 0)
    CodexChatStore.selectAlternative(id, secondId, 0)
    assert.equal(usage()[`${book.id}:used`].turnsAgo, 1)
    db.prepare('DELETE FROM codex_chat_messages WHERE id = ?').run(firstId)
    assert.equal(usage()[`${book.id}:used`].sourceMessageId, null)
    const privateId = CodexChatStore.createThread(2, '다른 계정', 'llm', profile.id)
    say(privateId, 'private-reply')
    OwnedLorebookStore.saveChatBook(id, [{ ...book.entries[0], source: { threadId: privateId, replyId: 'private-reply', proposalId: 1 } }])
    assert.equal(usage()[`${book.id}:used`].sourceMessageId, null)
  })

  await t.test('E1: exported entries import and merge with optional source fields', async () => {
    const { readLorebookFile } = await import('../src/services/codex-chat/chatCardImport')
    const { applyMerge } = await import('../src/services/codex-chat/chatLorebookMerge')
    const source = { threadId: 1, replyId: 'source', proposalId: 1 }
    const imported = readLorebookFile(Buffer.from(JSON.stringify({ name: '내보낸 책', entries: [{ id: 'sourced', title: '출처 있음', content: '내용', source }, { id: 'plain', title: '손글씨', content: '내용' }] })), 'book.json')
    assert.deepEqual(imported.entries[0].source, source)
    assert.equal(imported.entries[1].source, undefined)
    const from = OwnedLorebookStore.create(owner, imported)
    const into = OwnedLorebookStore.create(owner, { name: '병합 대상', entries: [{ title: '다른 항목', content: '기존' }] })
    const merged = applyMerge(from.id, into.id, owner, []).book
    assert.deepEqual(merged.entries.find((entry) => entry.id === 'sourced')!.source, source)
  })

  await t.test('E1: undo restores the entire prior entry and requires confirmation after edits', () => {
    const id = freshThread()
    const book = OwnedLorebookStore.saveChatBook(id, [{ id: 'promise', title: '약속', content: '옛 약속', enabled: false, secondaryKeys: ['밤'], order: 12 }])!
    const before = book.entries[0]
    const card = proposal(id, 'replacement', before.id)
    applyLoreProposal(card.id)
    const restored = undoLoreProposal(card.id)
    assert.deepEqual(restored.book!.entries[0], before)
    assert.equal((restored.proposal as { undone?: boolean }).undone, true)
    assert.throws(() => undoLoreProposal(card.id), /되돌릴/)
    const second = proposal(id, 'replacement-2', before.id)
    applyLoreProposal(second.id)
    const current = OwnedLorebookStore.chatBookOf(id)!
    OwnedLorebookStore.saveChatBook(id, [{ ...current.entries[0], content: '손으로 고침' }])
    const check = undoLoreProposal(second.id)
    assert.equal(check.changed, true)
    assert.equal(typeof check.currentHash, 'string')
    assert.equal(OwnedLorebookStore.chatBookOf(id)!.entries[0].content, '손으로 고침')
    OwnedLorebookStore.saveChatBook(id, [{ ...current.entries[0], content: '확인 중 다시 고침' }])
    const changedAgain = undoLoreProposal(second.id, true, check.currentHash)
    assert.equal(changedAgain.changed, true)
    assert.equal(OwnedLorebookStore.chatBookOf(id)!.entries[0].content, '확인 중 다시 고침')
    assert.deepEqual(undoLoreProposal(second.id, true, changedAgain.currentHash).book!.entries[0], before)
  })

  await t.test('E1: replacement files keep their original bytes for undo', () => {
    const id = freshThread()
    let book = OwnedLorebookStore.saveChatBook(id, [{ id: 'file-entry', title: '약속', content: '옛 약속' }])!
    const materials = FileStoreService.findChild(owner, book.folderId, '자료')!
    const original = FileStoreService.writeText(owner, materials.id, '약속.md', '원래 자료', { silent: true })
    book = OwnedLorebookStore.saveChatBook(id, [{ ...book.entries[0], file: '자료/약속.md', fileId: original.id }])!
    const card = ChatProposalStore.add({ threadId: id, profileId: profile.id, kind: 'direct', replyId: 'file-reply' }, { kind: 'lore', title: '약속', keys: [], content: '새 약속', constant: false, replaces: 'file-entry', before: { title: '약속', keys: [], content: '옛 약속', constant: false, file: '자료/약속.md' }, file: { name: '약속.md', text: '새 자료' } })
    const applied = applyLoreProposal(card.id).book
    assert.notEqual(applied.entries[0].fileId, original.id)
    const restored = undoLoreProposal(card.id).book!
    assert.equal(restored.entries[0].fileId, original.id)
    assert.equal(readEntryFileText({ owner, folderId: restored.folderId }, restored.entries[0], 1024)?.text, '원래 자료')
    const legacy = ChatProposalStore.add({ threadId: id, profileId: profile.id, kind: 'direct', replyId: 'legacy-file-reply' }, { kind: 'lore', title: '약속', keys: [], content: '다른 약속', constant: false, replaces: 'file-entry', before: { title: '약속', keys: [], content: '옛 약속', constant: false, file: '자료/약속.md' }, file: { name: '다른.md', text: '다른 자료' } })
    applyLoreProposal(legacy.id)
    // Pre-stage-5 cards have the partial before record, without an entry snapshot.
    ChatProposalStore.updateLoreUndo(legacy.id, { undoBefore: undefined, undoAfter: undefined })
    const check = undoLoreProposal(legacy.id)
    assert.equal(check.changed, true)
    const legacyRestored = undoLoreProposal(legacy.id, true, check.currentHash).book!
    assert.equal(legacyRestored.entries[0].file, '자료/약속.md')
    assert.equal(readEntryFileText({ owner, folderId: legacyRestored.folderId }, legacyRestored.entries[0], 1024)?.text, '원래 자료')
  })

  await t.test('E1: continuation copies past/manual lore, preservation copies all, account links stay shared', () => {
    const id = freshThread()
    const point = say(id, 'past')
    say(id, 'future')
    const account = OwnedLorebookStore.create(owner, { name: '계정 책', entries: [{ content: '공유' }] })
    OwnedLorebookStore.setThreadLinks(id, [account.id])
    let book = OwnedLorebookStore.saveChatBook(id, [
      { id: 'manual', content: '손글씨' },
      { id: 'past', content: '과거', source: { threadId: id, replyId: 'past', proposalId: 1 } },
      { id: 'future', content: '미래', source: { threadId: id, replyId: 'future', proposalId: 2 } },
      { id: 'missing', content: '삭제된 출처', source: { threadId: id, replyId: 'deleted', proposalId: 3 } },
    ])!
    const materials = FileStoreService.findChild(owner, book.folderId, '자료')!
    const original = FileStoreService.writeText(owner, materials.id, '과거.md', '과거 자료', { silent: true })
    book = OwnedLorebookStore.saveChatBook(id, book.entries.map((entry) => entry.id === 'past' ? { ...entry, file: '자료/과거.md', fileId: original.id } : entry))!
    db.prepare('UPDATE codex_chat_messages SET context_meta = ? WHERE id = ?').run(JSON.stringify({ version: 2, loreEntries: [{ bookId: book.id, entryId: 'past', key: `${book.id}:past:hash`, selected: true }] }), point)
    const branch = branchChatThread(thread(id), point)!
    const copied = OwnedLorebookStore.chatBookOf(branch)!
    assert.deepEqual(copied.entries.map((entry) => entry.id), ['manual', 'past'])
    assert.notEqual(copied.entries[1].fileId, original.id)
    assert.ok(loreEntryFile({ owner, folderId: copied.folderId }, copied.entries[1]))
    assert.equal(readEntryFileText({ owner, folderId: copied.folderId }, copied.entries[1], 1024)?.text, '과거 자료')
    assert.deepEqual(OwnedLorebookStore.threadLinks(branch), [account.id])
    assert.equal(OwnedLorebookStore.find(account.id, owner)!.entries[0].content, '공유')
    assert.equal(threadLorebooks(thread(branch), [profile]).entryUsage[`${copied.id}:past`].turnsAgo, 0)
    const branchPoint = CodexChatStore.listMessages(branch)[0].id
    const nested = branchChatThread(thread(branch), branchPoint)!
    assert.deepEqual(OwnedLorebookStore.chatBookOf(nested)!.entries.map((entry) => entry.id), ['manual', 'past'])
    const preserved = branchChatThread(thread(id), point, 'preserve')!
    assert.deepEqual(OwnedLorebookStore.chatBookOf(preserved)!.entries.map((entry) => entry.id), ['manual', 'past', 'future', 'missing'])
    assert.deepEqual(OwnedLorebookStore.threadLinks(preserved), [account.id])
  })

  await t.test('E2: macro validation matches card imports, deduplicates and keeps supported spellings', () => {
    assert.deepEqual(unknownChatMacros('{{char}} {{ USER }} {{original}} {{scene}} {{scene}} {{char.name}}'), ['{{scene}}', '{{char.name}}'])
    assert.deepEqual(unknownChatMacros('일반 본문 {{char}}'), [])
    assert.deepEqual(unknownChatMacros('{{' + 'x'.repeat(41) + '}}'), [])
  })

  await t.test('E3: every greeting is saved as a variant and the previewed index remains active', () => {
    const id = freshThread()
    addChatGreeting(id, profile, userPersonaOf(null), 1)
    const message = CodexChatStore.listMessages(id)[0]
    assert.equal(message.alternatives.length, 3)
    assert.equal(message.active_alternative, 1)
    assert.equal(message.content, '카이가 웃어')
    assert.ok(!message.alternatives[0].content.includes('{{user}}'))
    CodexChatStore.selectAlternative(id, message.id, 2)
    assert.equal(CodexChatStore.listMessages(id)[0].content, '세 번째 인사')
    const single = { ...profile, greeting: '한 인사', alternateGreetings: [] }
    const singleId = freshThread()
    addChatGreeting(singleId, single, userPersonaOf(null), 0)
    assert.equal(CodexChatStore.listMessages(singleId)[0].alternatives.length, 1)
    const emptyId = freshThread()
    addChatGreeting(emptyId, { ...single, greeting: '' }, userPersonaOf(null))
    assert.equal(CodexChatStore.listMessages(emptyId).length, 0)
  })

  await t.test('E4: inclusive numeric boundaries, enums, empty values and invalid mappings', () => {
    const block = normalizeBlock({ key: 'status', fields: [
      { name: 'affinity', tone: [{ min: 0, max: 30, text: '조심스럽게 말해' }, { min: 31, max: 100, text: '다정하게 말해' }, { min: 10, max: 1, text: '잘못된 구간' }] },
      { name: 'mood', values: ['기쁨', '슬픔'], tone: { 기쁨: '밝게 말해', 슬픔: '차분하게 말해', 없음: '무시' } },
    ] })!
    for (const value of [0, 30, '30']) assert.equal(chatBlockToneText(block.fields, { affinity: value }), '조심스럽게 말해')
    for (const value of [-1, 101, undefined, null, '', '  ', true, '글자']) assert.equal(chatBlockToneText(block.fields, { affinity: value }), '')
    assert.equal(chatBlockToneText(block.fields, { affinity: 31, mood: '기쁨' }), '다정하게 말해 · 밝게 말해')
    assert.equal(chatBlockToneText(block.fields, { mood: '슬픔' }), '차분하게 말해')
    assert.equal(chatBlockToneText(block.fields, { mood: '없음' }), '')
    const output = blockStateText([block], { status: { affinity: 0, mood: '슬픔' } })
    assert.ok(output.includes('{"affinity":0,"mood":"슬픔"}'))
    assert.ok(output.includes('말투: 조심스럽게 말해 · 차분하게 말해'))
    assert.ok(!blockStateText([block], { status: {} }).includes('말투:'))
    assert.deepEqual(normalizeBlock(JSON.parse(JSON.stringify(block)))!.fields, block.fields)
  })

  await t.test('E4: tone stays in the reference block and changes the state diagnostic hash', () => {
    const id = freshThread()
    const block = normalizeBlock({ key: 'status', example: '{"hp":10}', fields: [{ name: 'hp', tone: [{ min: 0, max: 30, text: '차분하게 말해' }] }] })!
    const stateProfile = { ...profile, style: { ...profile.style, blocks: [block] } }
    const request = (selected = stateProfile) => {
      let meta: import('../src/services/codex-chat/llmChatContext').ChatContextMeta | undefined
      const messages = buildChatMessages({ profile: selected, thread: thread(id), messages: [], config: resolveContextConfig(thread(id), selected), tools: [], onMeta: (value) => { meta = value } })
      return { messages, meta: meta! }
    }
    const withTone = request()
    const withoutTone = request({ ...stateProfile, style: { ...stateProfile.style, blocks: [{ ...block, fields: block.fields.map((field) => ({ ...field, tone: undefined })) }] } })
    assert.notEqual(withTone.meta.sources!.find((source) => source.kind === 'state')!.hash, withoutTone.meta.sources!.find((source) => source.kind === 'state')!.hash)
    assert.ok(JSON.stringify(withTone.messages).includes('말투: 차분하게 말해'))
    assert.ok(JSON.stringify(withTone.messages).includes('[참고 설정]'))
  })
})
