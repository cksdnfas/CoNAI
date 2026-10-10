import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { ChatExecutionContext } from '@conai/shared'

test('lorebook merge: chat book end of life (delete, keep, merge), duplicates, drafts, save_lore', { timeout: 120000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-lorebook-merge-test-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  let server: http.Server | null = null
  t.after(async () => {
    if (server) await new Promise<void>((resolve) => { server!.close(() => resolve()); server!.closeAllConnections() })
    authModule.getAuthDb().close()
    dbModule.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-lorebook-merge-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const db = dbModule.getUserSettingsDb()
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
  const { storedFilePath } = await import('../src/services/fileStorePaths')
  const { OwnedLorebookStore, LOREBOOK_ROOT_FOLDER, CHAT_LOREBOOK_FOLDER } = await import('../src/services/codex-chat/chatLorebookFiles')
  const { previewMerge, applyMerge, draftMerge, MergeDecisionsMissingError, MERGE_DRAFT_INSTRUCTION } = await import('../src/services/codex-chat/chatLorebookMerge')
  const { ChatProposalStore } = await import('../src/services/codex-chat/chatProposals')
  const { attachProposals } = await import('../src/services/codex-chat/codexChatMedia')
  const { SAVE_LORE_DONE, SAVE_LORE_SAVED } = await import('../src/mcp/tools/chatLoreTools')
  const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
  const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
  const { buildChatMessages, resolveContextConfig } = await import('../src/services/codex-chat/llmChatContext')
  const express = (await import('express')).default

  updateChatSettings({ enabled: true })
  ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const profile = ChatProfileStore.create({ name: '카이', engine: 'llm', providerName: 'conn' })
  // No accounts configured: the bootstrap owner (session without an account) owns these chats and books.
  const me = fileOwnerKey(null)
  const child = (parentId: string | null, name: string) => FileStoreService.findChild(me, parentId, name)
  const readBlob = (id: string) => fs.readFileSync(storedFilePath(me, id), 'utf8')
  const materials = (book: { folderId: string | null }) => FileStoreService.ensureFolder(me, book.folderId, '자료')
  const book = (id: number) => OwnedLorebookStore.find(id, me)!
  const chatWithBook = (title: string, entries: unknown[]) => {
    const threadId = CodexChatStore.createThread(null, title, 'llm', profile.id)
    OwnedLorebookStore.saveChatBook(threadId, entries)
    return { threadId, chatBook: OwnedLorebookStore.chatBookOf(threadId)! }
  }
  const threadExists = (id: number) => Boolean(CodexChatStore.findThreadById(id))

  // The routes as the app mounts them, for a session without an account (bootstrap: every permission).
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { (req as unknown as { session: object }).session = {}; next() })
  app.use('/api/codex-chat', (await import('../src/routes/codex-chat.routes')).default)
  app.use('/api/chat-proposals', (await import('../src/routes/chat-proposals.routes')).default)
  server = http.createServer(app)
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const call = async (method: string, url: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, json: await response.json() as { success: boolean; error?: string; data?: any } }
  }

  // The account book "카이" and a chat book that overlaps it: by title (case and spacing aside), by keyword set.
  const kai = OwnedLorebookStore.create(me, { name: '카이', entries: [
    { id: 't-ink', title: 'Ink  Cat', keys: ['먹물'], content: '카이가 기르는 검은 고양이.' },
    { id: 't-left', title: '손', keys: ['왼손', '손잡이'], content: '카이는 왼손잡이다.' },
    { id: 't-house', title: '집', keys: ['집'], content: '항구 근처 2층 집.' },
  ] })
  FileStoreService.writeText(me, materials(kai).id, '전단지.md', '카이 책의 다른 전단지.')
  const sea = chatWithBook('2026-10-03 바다 약속', [
    { id: 's-promise', title: '바다 약속', keys: ['바다'], content: '내일 저녁 바다에서 반지를 주기로 했다.', constant: true },
    { id: 's-ink', title: 'ink cat', keys: ['전단지'], content: '먹물이 사흘째 안 보인다.' },
    { id: 's-left', title: '왼손잡이', keys: ['손잡이', '왼손'], content: '카이는 왼손으로 글을 쓴다.' },
    { id: 's-house', title: '집 구조', keys: ['집', '2층'], content: '1층은 수리점.' },
  ])
  FileStoreService.writeText(me, materials(sea.chatBook).id, '전단지.md', '검은 고양이 먹물을 찾습니다.')
  FileStoreService.writeText(me, materials(sea.chatBook).id, '반지.md', '은반지, 안쪽에 날짜.')
  OwnedLorebookStore.saveChatBook(sea.threadId, sea.chatBook.entries.map((entry) => entry.id === 's-ink' ? { ...entry, file: '자료/전단지.md' } : entry))

  await t.test('preview: duplicates by title and by keyword set, the merged text to start from, file clashes', () => {
    const preview = previewMerge(sea.chatBook.id, kai.id, me)
    assert.deepEqual(preview.items.map((item) => [item.entry.id, item.status, item.duplicateOf?.id ?? null]), [
      ['s-promise', 'new', null],
      ['s-ink', 'duplicate', 't-ink'],
      ['s-left', 'duplicate', 't-left'],
      ['s-house', 'new', null],
    ])
    assert.equal(preview.items[1].suggested, '카이가 기르는 검은 고양이.\n\n먹물이 사흘째 안 보인다.')
    assert.equal(preview.defaultInstruction, MERGE_DRAFT_INSTRUCTION)
    assert.deepEqual(preview.files, [{ file: '자료/반지.md', clash: false }, { file: '자료/전단지.md', clash: true }])
    assert.throws(() => previewMerge(kai.id, kai.id, me), /같은 로어북/)
    assert.throws(() => previewMerge(kai.id, sea.chatBook.id, me), /계정 로어북에만/, 'a chat book is never a target')
    assert.throws(() => previewMerge(sea.chatBook.id, kai.id, fileOwnerKey(9)), (error: Error & { status?: number }) => error.status === 404, "another owner's books")
    // Missing decisions stop the merge before anything changes.
    assert.throws(() => applyMerge(sea.chatBook.id, kai.id, me, [{ entryId: 's-ink', choice: 'target' }]), (error: unknown) => error instanceof MergeDecisionsMissingError && error.missing.join() === 's-left' && error.status === 409)
    assert.throws(() => applyMerge(sea.chatBook.id, kai.id, me, [{ entryId: 's-ink', choice: 'merged' }, { entryId: 's-left', choice: 'target' }]), /합친 결과 본문이 비어/)
    assert.equal(book(kai.id).entries.length, 3)
  })

  await t.test('preview: the merged text to start from does not repeat equal or contained texts', () => {
    const target = OwnedLorebookStore.create(me, { name: '겹침 대상', entries: [
      { id: 'same', title: '같음', keys: ['같음'], content: '카이는  왼손잡이다.' },
      { id: 'long', title: '긴 쪽', keys: ['긴'], content: '카이는 왼손잡이다. 글도 왼손으로 쓴다.' },
      { id: 'short', title: '짧은 쪽', keys: ['짧은'], content: '먹물은 검은 고양이.' },
      { id: 'apart', title: '다름', keys: ['다름'], content: '항구 근처 집.' },
    ] })
    const source = OwnedLorebookStore.create(me, { name: '겹침 원본', entries: [
      { id: 'same', title: '같음', keys: ['같음'], content: ' 카이는\n왼손잡이다. ' },
      { id: 'long', title: '긴 쪽', keys: ['긴'], content: '글도 왼손으로 쓴다.' },
      { id: 'short', title: '짧은 쪽', keys: ['짧은'], content: '먹물은 검은 고양이. 사흘째 안 보인다.' },
      { id: 'apart', title: '다름', keys: ['다름'], content: '1층은 수리점.' },
    ] })
    const suggested = Object.fromEntries(previewMerge(source.id, target.id, me).items.map((item) => [item.entry.id, item.suggested]))
    assert.deepEqual(suggested, {
      same: '카이는  왼손잡이다.',
      long: '카이는 왼손잡이다. 글도 왼손으로 쓴다.',
      short: '먹물은 검은 고양이. 사흘째 안 보인다.',
      apart: '항구 근처 집.\n\n1층은 수리점.',
    })
  })

  await t.test('apply: source, target, both and merged decisions; new entries appended; the source untouched', () => {
    const target = OwnedLorebookStore.create(me, { name: '대상', entries: [
      { id: 'a', title: 'A', keys: ['a1'], content: 'a-old' },
      { id: 'b', title: 'B', keys: ['b1'], content: 'b-old' },
      { id: 'c', title: 'C', keys: ['c1'], content: 'c-old' },
      { id: 'd', title: 'D', keys: ['d1'], content: 'd-old' },
    ] })
    const source = OwnedLorebookStore.create(me, { name: '원본', entries: [
      { id: 'a', title: 'A', keys: ['a2'], content: 'a-new' },
      { id: 'b', title: 'B', keys: ['b2'], content: 'b-new' },
      { id: 'c', title: 'C', keys: ['c2'], content: 'c-new' },
      { id: 'd', title: 'D', keys: ['d2'], content: 'd-new' },
      { id: 'e', title: 'E', keys: ['e1'], content: 'e-new' },
    ] })
    const result = applyMerge(source.id, target.id, me, [
      { entryId: 'a', choice: 'source' },
      { entryId: 'b', choice: 'target' },
      { entryId: 'c', choice: 'both' },
      { entryId: 'd', choice: 'merged', content: 'd-merged' },
    ])
    assert.deepEqual([result.added, result.updated, result.skipped], [2, 2, 1])
    const merged = book(target.id).entries
    assert.deepEqual(merged.map((entry) => [entry.id, entry.title, entry.content, entry.keys.join(',')]), [
      ['a', 'A', 'a-new', 'a1,a2'],
      ['b', 'B', 'b-old', 'b1'],
      ['c', 'C', 'c-old', 'c1'],
      ['d', 'D', 'd-merged', 'd1,d2'],
      ['c-2', 'C (2)', 'c-new', 'c2'],
      ['e', 'E', 'e-new', 'e1'],
    ])
    assert.ok(merged[4].order > merged[3].order && merged[5].order > merged[4].order, 'appended after the target entries')
    assert.deepEqual(book(source.id).entries.map((entry) => entry.content), ['a-new', 'b-new', 'c-new', 'd-new', 'e-new'], 'the source is left as it was')
  })

  await t.test('merge route: preview first, then files copied with a suffix and links re-pointed, source deleted', async () => {
    const before = book(kai.id).entries
    const preview = await call('POST', `/api/codex-chat/lorebooks/${kai.id}/merge`, { sourceId: sea.chatBook.id })
    assert.equal(preview.status, 200)
    assert.equal(preview.json.data.status, 'preview')
    assert.deepEqual(book(kai.id).entries, before, 'a preview writes nothing')
    const missing = await call('POST', `/api/codex-chat/lorebooks/${kai.id}/merge`, { sourceId: sea.chatBook.id, decisions: [] })
    assert.equal(missing.status, 409)
    assert.deepEqual(missing.json.data.missing, ['s-ink', 's-left'])

    const done = await call('POST', `/api/codex-chat/lorebooks/${kai.id}/merge`, { sourceId: sea.chatBook.id, deleteSource: true, decisions: [
      { entryId: 's-ink', choice: 'source' },
      { entryId: 's-left', choice: 'both' },
    ] })
    assert.equal(done.status, 200, JSON.stringify(done.json))
    assert.equal(done.json.data.status, 'merged')
    assert.equal(done.json.data.files, 2)
    assert.equal(done.json.data.sourceDeleted, true)
    const entries = book(kai.id).entries
    const folder = materials(kai)
    const copied = child(folder.id, '전단지 (2).md')!
    assert.equal(readBlob(copied.id), '검은 고양이 먹물을 찾습니다.')
    assert.equal(readBlob(child(folder.id, '전단지.md')!.id), '카이 책의 다른 전단지.', "the target's own file is kept")
    assert.equal(readBlob(child(folder.id, '반지.md')!.id), '은반지, 안쪽에 날짜.', 'an unlinked file comes along too')
    const ink = entries.find((entry) => entry.id === 't-ink')!
    assert.deepEqual([ink.content, ink.keys, ink.file, ink.fileId], ['먹물이 사흘째 안 보인다.', ['먹물', '전단지'], '자료/전단지 (2).md', copied.id], 'the source file, since the target entry had none')
    assert.deepEqual(entries.filter((entry) => entry.content === '카이는 왼손으로 글을 쓴다.').map((entry) => entry.title), ['왼손잡이'], 'both: titles differ, kept as is')
    assert.equal(OwnedLorebookStore.chatBookOf(sea.threadId), null, 'the chat book was deleted')
    assert.ok(threadExists(sea.threadId), 'the chat stays')
  })

  await t.test('keep: the folder moves to 로어북/ (suffixed on a clash) and the book becomes an account book', async () => {
    OwnedLorebookStore.create(me, { name: '등대 산책', entries: [] })
    const { threadId, chatBook } = chatWithBook('등대 산책', [{ id: 'walk', title: '등대', content: '저녁마다 등대까지 걷는다.' }])
    const kept = await call('POST', `/api/codex-chat/threads/${threadId}/lorebook/keep`)
    assert.equal(kept.status, 200, JSON.stringify(kept.json))
    assert.equal(kept.json.data.id, chatBook.id)
    assert.equal(kept.json.data.kind, 'account')
    assert.equal(kept.json.data.threadId, null)
    assert.equal(kept.json.data.name, '등대 산책 (2)')
    const lorebookRoot = child(null, LOREBOOK_ROOT_FOLDER)!
    assert.equal(child(lorebookRoot.id, '등대 산책 (2)')?.id, chatBook.folderId)
    assert.equal(child(child(lorebookRoot.id, CHAT_LOREBOOK_FOLDER)!.id, '등대 산책'), null)
    assert.equal(OwnedLorebookStore.chatBookOf(threadId), null)
    assert.deepEqual(OwnedLorebookStore.threadLinks(threadId), [chatBook.id], 'the chat keeps the kept book, now linked')
    assert.equal((await call('POST', `/api/codex-chat/threads/${threadId}/lorebook/keep`)).status, 404, 'no chat book left to keep')
    // A chat that already links the most it can: refused, nothing moved.
    const full = chatWithBook('가득 찬 채팅', [{ id: 'f', content: '메모.' }])
    const many = Array.from({ length: 20 }, (_, n) => OwnedLorebookStore.create(me, { name: `연결 ${n}`, entries: [] }).id)
    OwnedLorebookStore.setThreadLinks(full.threadId, many)
    assert.equal((await call('POST', `/api/codex-chat/threads/${full.threadId}/lorebook/keep`)).status, 400)
    assert.equal(OwnedLorebookStore.chatBookOf(full.threadId)?.id, full.chatBook.id)
    // Deleting the chat now leaves the kept book alone.
    assert.equal((await call('DELETE', `/api/codex-chat/threads/${threadId}`)).status, 200)
    assert.deepEqual(book(chatBook.id).entries.map((entry) => entry.content), ['저녁마다 등대까지 걷는다.'])
  })

  await t.test('deleting a chat: by default its book goes too, even with a file a message attaches', async () => {
    const { threadId, chatBook } = chatWithBook('반지', [{ id: 'ring', title: '반지', content: '은반지.' }])
    const file = FileStoreService.writeText(me, materials(chatBook).id, '반지.md', '안쪽에 날짜.')
    CodexChatStore.addMessage({ thread_id: threadId, role: 'user', content: '이거 봐', tool_calls: [], status: 'completed', error: null }, [file.id])
    const deleted = await call('DELETE', `/api/codex-chat/threads/${threadId}`)
    assert.equal(deleted.status, 200, JSON.stringify(deleted.json))
    assert.equal(deleted.json.data.lorebook.action, 'delete')
    assert.equal(threadExists(threadId), false)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chat_lorebooks WHERE id = ?').get(chatBook.id).count, 0)
    assert.equal(FileStoreService.findChild(me, null, LOREBOOK_ROOT_FOLDER) && db.prepare('SELECT COUNT(*) AS count FROM stored_file_entries WHERE id = ?').get(chatBook.folderId).count, 0, 'the folder is gone')
    // The store hook covers every path, not only the route.
    const other = chatWithBook('다른 채팅', [{ id: 'x', content: '메모.' }])
    CodexChatStore.deleteThread(other.threadId)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chat_lorebooks WHERE thread_id = ?').get(other.threadId).count, 0)
  })

  await t.test('deleting a chat with merge: 409 with the preview until every duplicate has a decision', async () => {
    const target = OwnedLorebookStore.create(me, { name: '항구', entries: [{ id: 'harbor', title: '항구', keys: ['항구'], content: '안개 낀 항구.' }] })
    const { threadId, chatBook } = chatWithBook('항구 산책', [
      { id: 'h', title: '항구', keys: ['배'], content: '항구에 배가 많다.' },
      { id: 'n', title: '노을', keys: ['노을'], content: '노을이 진다.' },
    ])
    const refused = await call('DELETE', `/api/codex-chat/threads/${threadId}`, { lorebook: { action: 'merge', targetId: target.id } })
    assert.equal(refused.status, 409)
    assert.equal(refused.json.data.status, 'decisions')
    assert.deepEqual(refused.json.data.preview.items.map((item: { status: string }) => item.status), ['duplicate', 'new'])
    assert.ok(threadExists(threadId), 'nothing changed')
    assert.equal(book(target.id).entries.length, 1)
    assert.equal((await call('DELETE', `/api/codex-chat/threads/${threadId}`, { lorebook: { action: 'merge' } })).status, 400, 'merge needs a target')
    const merged = await call('DELETE', `/api/codex-chat/threads/${threadId}`, { lorebook: { action: 'merge', targetId: target.id, decisions: [{ entryId: 'h', choice: 'merged', content: '안개 낀 항구. 배가 많다.' }] } })
    assert.equal(merged.status, 200, JSON.stringify(merged.json))
    assert.deepEqual(merged.json.data.lorebook, { action: 'merge', bookId: target.id, merge: { added: 1, updated: 1, skipped: 0, files: 0 } })
    assert.equal(threadExists(threadId), false)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chat_lorebooks WHERE id = ?').get(chatBook.id).count, 0)
    assert.deepEqual(book(target.id).entries.map((entry) => [entry.title, entry.content, entry.keys.join(',')]), [['항구', '안개 낀 항구. 배가 많다.', '항구,배'], ['노을', '노을이 진다.', '노을']])
  })

  await t.test('merge draft: the profile model writes merged texts, per-entry errors, nothing saved', async () => {
    const target = OwnedLorebookStore.create(me, { name: '초안 대상', entries: [
      { id: 'cat', title: '먹물', keys: ['먹물'], content: '검은 고양이.' },
      { id: 'dog', title: '바둑이', keys: ['바둑이'], content: '흰 개.' },
    ] })
    const { chatBook } = chatWithBook('초안', [
      { id: 'cat2', title: '먹물', keys: ['고양이'], content: '사흘째 안 보인다.' },
      { id: 'dog2', title: '바둑이', keys: ['개'], content: '짖는다.' },
    ])
    const bodies: string[] = []
    t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
      const body = String(init.body)
      bodies.push(body)
      if (body.includes('바둑이')) return new Response('boom', { status: 500 })
      return Response.json({ choices: [{ message: { content: '검은 고양이. 사흘째 안 보인다.' }, finish_reason: 'stop' }] })
    })
    const before = book(target.id)
    const { drafts } = await draftMerge(chatBook.id, target.id, me, { profileId: profile.id, instruction: '짧게 써.' })
    t.mock.restoreAll()
    assert.deepEqual(drafts[0], { entryId: 'cat2', content: '검은 고양이. 사흘째 안 보인다.' })
    assert.equal(drafts[1].entryId, 'dog2')
    assert.ok('error' in drafts[1] && drafts[1].error.length > 0)
    const first = JSON.parse(bodies[0]) as { messages: Array<{ role: string; content: string }> }
    assert.equal(first.messages[0].content, '짧게 써.', 'the rewritten instruction replaces the default')
    assert.match(first.messages[1].content, /^## A \(채팅 책\)\n제목: 먹물\n키워드: 고양이\n\n사흘째 안 보인다\.\n\n## B \(대상 책\)\n제목: 먹물\n키워드: 먹물\n\n검은 고양이\.$/)
    assert.deepEqual(book(target.id).entries, before.entries, 'drafts are not saved')
    assert.equal(book(target.id).updatedDate, before.updatedDate)
    await assert.rejects(draftMerge(chatBook.id, target.id, me, { profileId: 999 }), /프로필을 찾을 수 없어/)
  })

  // ---- save_lore -------------------------------------------------------------------------------------------------

  const loreThread = CodexChatStore.createThread(null, '방파제', 'llm', profile.id)
  const controller = new AbortController()
  const replyContext = (replyId: string): ChatExecutionContext => ({ threadId: loreThread, profileId: profile.id, kind: 'direct', replyId })
  const withBridge = async <T>(replyId: string, run: (bridge: Awaited<ReturnType<typeof openChatMcpBridge>>) => Promise<T>) => {
    const close = registerChatReply(replyContext(replyId), controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, [], null, { chatContext: replyContext(replyId) })
    try { return await run(bridge) } finally { close(); await bridge.close() }
  }
  const textOf = (result: { content?: unknown[] }) => String((result.content?.[0] as { text?: string }).text)
  const SEAWALL = { title: '방파제 약속', keys: ['방파제', '노을'], content: '노을 질 때 방파제 끝에서 만나기로 했다.', constant: true, file: { name: '약속.md', text: '이유는 그때 말하기로 했다.' } }

  // The card flow first (a person saves each card); auto-save, the default, has its own test below.
  updateChatSettings({ loreAutoSave: false })
  let proposalId = 0
  await t.test('save_lore: validated, one per reply, stored as a lore proposal on the reply', async () => {
    await withBridge('r1', async (bridge) => {
      assert.ok(bridge.tools.some((tool) => tool.function.name === 'save_lore'))
      const done = await bridge.call('save_lore', SEAWALL)
      assert.equal(done.isError, undefined, textOf(done))
      assert.equal(textOf(done), SAVE_LORE_DONE)
      const proposal = (done.structuredContent as { proposal: { id: number; kind: string; title: string; replaces?: string } }).proposal
      assert.equal(proposal.kind, 'lore')
      assert.equal(proposal.replaces, undefined)
      proposalId = proposal.id
      const second = await bridge.call('save_lore', { title: '다른 것', content: '두 번째.' })
      assert.equal(second.isError, true)
      assert.match(textOf(second), /already has a lore proposal/)
    })
    await withBridge('r-bad', async (bridge) => {
      assert.equal((await bridge.call('save_lore', { title: 'x', content: 'y'.repeat(4001) })).isError, true)
      assert.match(textOf(await bridge.call('save_lore', { title: 'x', content: 'y', file: { name: '사진.png', text: 'z' } })), /text file/)
      assert.match(textOf(await bridge.call('save_lore', { title: 'x', content: 'y', file: { name: '자료/x.md', text: 'z' } })), /plain file name/)
      assert.match(textOf(await bridge.call('save_lore', { title: 'x', content: 'y', file: { name: 'x.md', text: '가'.repeat(11_000) } })), /over 32 KB/)
      assert.match(textOf(await bridge.call('save_lore', { title: '방파제 약속', content: 'y' })), /still waiting/, 'the same title is not proposed again')
    })
    const stored = ChatProposalStore.find(proposalId)
    assert.ok(stored?.kind === 'lore')
    assert.deepEqual([stored.title, stored.keys, stored.constant, stored.file?.name], ['방파제 약속', ['방파제', '노을'], true, '약속.md'])
    // The card rides on the save_lore call of its reply.
    const [message] = attachProposals([{ id: 1, thread_id: loreThread, role: 'assistant', content: '', routing: { replyId: 'r1', replyTo: null, recipients: [] }, tool_calls: [{ id: 'c1', tool: 'save_lore', status: 'completed', arguments: null, summary: null, historyIds: [], compositeHashes: [] }] } as never])
    assert.equal(message.tool_calls[0].proposal?.id, proposalId)
  })

  await t.test('apply: the entry and its file go into the chat book; a same-title proposal replaces it in place', async () => {
    assert.equal(OwnedLorebookStore.chatBookOf(loreThread), null)
    const applied = await call('POST', `/api/chat-proposals/${proposalId}/apply`)
    assert.equal(applied.status, 200, JSON.stringify(applied.json))
    const chatBook = OwnedLorebookStore.chatBookOf(loreThread)!
    assert.equal(applied.json.data.proposal.savedId, chatBook.id)
    const [entry] = chatBook.entries
    assert.deepEqual([entry.title, entry.keys, entry.content, entry.constant, entry.file], ['방파제 약속', ['방파제', '노을'], '노을 질 때 방파제 끝에서 만나기로 했다.', true, '자료/약속.md'])
    assert.equal(readBlob(entry.fileId!), '이유는 그때 말하기로 했다.')
    assert.equal((await call('POST', `/api/chat-proposals/${proposalId}/apply`)).status, 409, 'saved once')

    const update = await withBridge('r2', async (bridge) => bridge.call('save_lore', { title: '방파제  약속', keys: ['방파제'], content: '노을 질 때가 아니라 해 뜰 때로 바꿨다.' }))
    const proposal = (update.structuredContent as { proposal: { id: number; replaces?: string; before?: { content: string } } }).proposal
    assert.equal(proposal.replaces, entry.id)
    assert.equal(proposal.before?.content, '노을 질 때 방파제 끝에서 만나기로 했다.')
    assert.equal((await call('POST', `/api/chat-proposals/${proposal.id}/apply`)).status, 200)
    const after = OwnedLorebookStore.chatBookOf(loreThread)!.entries
    assert.equal(after.length, 1)
    assert.deepEqual([after[0].id, after[0].content, after[0].keys, after[0].file], [entry.id, '노을 질 때가 아니라 해 뜰 때로 바꿨다.', ['방파제'], '자료/약속.md'])
  })

  await t.test('dismissed lore titles are not proposed again and are named in the reference block', async () => {
    const ring = await withBridge('r3', async (bridge) => bridge.call('save_lore', { title: '반지', keys: ['반지'], content: '은반지를 준비했다.' }))
    const ringId = (ring.structuredContent as { proposal: { id: number } }).proposal.id
    const dismissed = await call('POST', `/api/chat-proposals/${ringId}/dismiss`)
    assert.equal(dismissed.status, 200)
    assert.equal(dismissed.json.data.dismissed, true)
    assert.equal((await call('POST', `/api/chat-proposals/${proposalId}/dismiss`)).status, 409, 'a saved one stays saved')
    const again = await withBridge('r4', async (bridge) => bridge.call('save_lore', { title: '반지', content: '다시.' }))
    assert.match(textOf(again), /dismissed/)

    CodexChatStore.addMessage({ thread_id: loreThread, role: 'user', content: '내일 봐.', tool_calls: [], status: 'completed', error: null })
    const thread = CodexChatStore.findThreadById(loreThread)!
    const request = (tools: Array<{ type: 'function'; function: { name: string } }>) => buildChatMessages({ profile: ChatProfileStore.find(profile.id)!, thread, messages: CodexChatStore.listMessages(loreThread), config: resolveContextConfig(thread, ChatProfileStore.find(profile.id)!), tools: tools as never })
    const sent = request([{ type: 'function', function: { name: 'save_lore' } }])
    const line = '(거절된 로어 제안: 반지 — 다시 제안하지 마)'
    const users = sent.filter((message) => message.role === 'user').map((message) => String(message.content))
    assert.ok(users.some((content) => content.includes(`${line}\n[/참고 설정]`)), JSON.stringify(sent))
    assert.ok(!sent.filter((message) => message.role === 'system').some((message) => String(message.content).includes('거절된 로어 제안')), 'never in the system prompt')
    assert.ok(!JSON.stringify(request([])).includes('거절된 로어 제안'), 'only when save_lore is offered')
  })

  await t.test('a profile can turn lore proposals off', async () => {
    assert.equal(ChatProfileStore.find(profile.id)!.allowLoreProposals, true, 'on by default')
    ChatProfileStore.update(profile.id, { allowLoreProposals: false })
    assert.equal(ChatProfileStore.find(profile.id)!.allowLoreProposals, false)
    await withBridge('r5', async (bridge) => {
      assert.ok(!bridge.tools.some((tool) => tool.function.name === 'save_lore'))
    })
    ChatProfileStore.update(profile.id, { allowLoreProposals: true })
  })

  await t.test('save_lore: one every few replies unless the user asks; names, dates and times leave the keywords', async () => {
    const threadId = CodexChatStore.createThread(null, '등대', 'llm', profile.id)
    const context = (replyId: string): ChatExecutionContext => ({ threadId, profileId: profile.id, kind: 'direct', replyId })
    const propose = async (replyId: string, input: Record<string, unknown>) => {
      const close = registerChatReply(context(replyId), controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
      const bridge = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, [], null, { chatContext: context(replyId) })
      try { return await bridge.call('save_lore', input) } finally { close(); await bridge.close() }
    }
    const say = (role: 'user' | 'assistant', content: string, replyId?: string) => CodexChatStore.addMessage({
      thread_id: threadId, role, content, tool_calls: [], status: 'completed', error: null,
      ...(replyId ? { routing: { replyId, replyTo: null, recipients: ['user'] } } : {}),
    })

    say('user', '토요일 7시에 등대에서 보자.')
    const first = await propose('p1', { title: '등대 약속', keys: ['카이', '사용자', '토요일', '7시', '오후 3시 반', '19:30', '내일', '약속', '등대', '기어', '램프', '수리', '방파제', '노을', '갈매기', '파도', '모래'], content: '토요일 7시에 등대에서 만나기로 했다.' })
    assert.equal(first.isError, undefined, textOf(first))
    const keys = (first.structuredContent as { proposal: { keys: string[] } }).proposal.keys
    assert.deepEqual(keys, ['등대', '기어', '램프', '수리', '방파제', '노을', '갈매기', '파도'], 'no names, dates or times, at most eight')
    say('assistant', '좋아, 토요일에 봐.', 'p1')

    say('user', '그 등대 오래됐어?')
    const tooSoon = await propose('p2', { title: '등대 나이', content: '등대는 백 년 됐다.' })
    assert.equal(tooSoon.isError, true)
    assert.match(textOf(tooSoon), /within the last 3 replies/)
    say('assistant', '백 년 됐대.', 'p2')

    say('user', '이건 꼭 기억해줘: 나는 바다를 무서워해.')
    const asked = await propose('p3', { title: '바다 공포', keys: ['바다'], content: '사용자는 바다를 무서워한다.' })
    assert.equal(asked.isError, undefined, 'the user asked for it')
    say('assistant', '알았어, 기억할게.', 'p3')

    for (const replyId of ['q1', 'q2', 'q3']) {
      say('user', '그렇구나.')
      say('assistant', '응.', replyId)
    }
    say('user', '내 동생 이름은 하늘이야.')
    const later = await propose('p4', { title: '동생', keys: ['하늘'], content: '사용자의 동생은 하늘이다.' })
    assert.equal(later.isError, undefined, 'three replies later it is allowed again')
  })

  await t.test("save_lore keywords leave out the user's chat name, every speaker and words most recent messages hold", async () => {
    const { ChatGroupStore } = await import('../src/services/codex-chat/chatGroupStore')
    const { ChatUserProfileStore } = await import('../src/services/codex-chat/chatUserProfiles')
    const { proposeLore, usefulLoreKeys } = await import('../src/services/codex-chat/chatLoreProposals')
    const luna = ChatProfileStore.create({ name: '루나', engine: 'llm', providerName: 'conn' })
    const roomId = ChatGroupStore.create(null, '항구', [profile.id, luna.id], profile.id)
    ChatUserProfileStore.setThreadUserProfile(roomId, ChatUserProfileStore.create(null, { name: '한별' }).id)
    const say = (role: 'user' | 'assistant', content: string) => CodexChatStore.addMessage({
      thread_id: roomId, role, content, tool_calls: [], status: 'completed', error: null, ...(role === 'assistant' ? { speaker_profile_id: luna.id } : {}),
    })
    for (let index = 0; index < 6; index++) {
      say('user', index % 2 ? '오늘도 HARBOR  항구는 조용하네.' : '그냥 걷는 중.')
      say('assistant', index % 2 ? '항구 바람이 차. harbor 냄새도.' : '응.')
    }
    say('user', '이건 기억해줘: 할머니 금성 라디오를 고쳐야 해.')
    const proposal = proposeLore({ threadId: roomId, profileId: profile.id, kind: 'group', replyId: 'g1' }, {
      title: '금성 라디오', keys: ['한별', '루나', '카이', ' 항구 ', 'Harbor', '금성', '라디오', '할머니', '수리'], content: '한별은 할머니의 금성 라디오를 고쳐야 한다.',
    })
    assert.deepEqual(proposal.keys, ['금성', '라디오', '할머니', '수리'])
    // Too few messages to tell what is common: nothing is dropped for it.
    assert.deepEqual(usefulLoreKeys(['항구'], [], Array(9).fill('항구')), ['항구'])
    assert.deepEqual(usefulLoreKeys(['항구'], [], Array(10).fill('항구')), [])
    assert.deepEqual(usefulLoreKeys(['항구'], [], [...Array(4).fill('항구'), ...Array(6).fill('바다')]), ['항구'], 'at 40% it stays')
  })

  await t.test('auto-save: saved right away, undo removes a new entry and its file or restores a replaced one, a chat can turn it off', async () => {
    updateChatSettings({ loreAutoSave: true })
    assert.equal(updateChatSettings({}).loreAutoSave, true)
    const threadId = CodexChatStore.createThread(null, '등대지기', 'llm', profile.id)
    const context = (replyId: string): ChatExecutionContext => ({ threadId, profileId: profile.id, kind: 'direct', replyId })
    const say = (role: 'user' | 'assistant', content: string, replyId?: string) => CodexChatStore.addMessage({
      thread_id: threadId, role, content, tool_calls: [], status: 'completed', error: null,
      ...(replyId ? { routing: { replyId, replyTo: null, recipients: ['user'] } } : {}),
    })
    // "기억해" lifts the spacing between proposals, so each step can propose.
    const propose = async (replyId: string, input: Record<string, unknown>) => {
      say('user', '이건 기억해줘.')
      const close = registerChatReply(context(replyId), controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
      const bridge = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, [], null, { chatContext: context(replyId) })
      try {
        assert.match(bridge.tools.find((tool) => tool.function.name === 'save_lore')!.function.description ?? '', /saved right away/)
        return await bridge.call('save_lore', input)
      } finally {
        close(); await bridge.close(); say('assistant', '응.', replyId)
      }
    }
    const proposalOf = (result: { structuredContent?: unknown }) => (result.structuredContent as { proposal: { id: number; savedId?: number; replaces?: string } }).proposal

    const lamp = await propose('a1', { title: '램프', keys: ['램프'], content: '등대 램프는 매주 닦는다.', file: { name: '램프.md', text: '닦는 순서.' } })
    assert.equal(textOf(lamp), SAVE_LORE_SAVED)
    const saved = proposalOf(lamp)
    const chatBook = OwnedLorebookStore.chatBookOf(threadId)!
    assert.equal(saved.savedId, chatBook.id)
    const [entry] = chatBook.entries
    assert.deepEqual([entry.title, entry.file], ['램프', '자료/램프.md'])
    const fileId = entry.fileId!
    assert.equal(readBlob(fileId), '닦는 순서.')

    const undone = await call('POST', `/api/chat-proposals/${saved.id}/undo`)
    assert.equal(undone.status, 200, JSON.stringify(undone.json))
    assert.deepEqual([undone.json.data.proposal.undone, undone.json.data.proposal.dismissed, undone.json.data.proposal.savedId], [true, true, undefined])
    assert.deepEqual(OwnedLorebookStore.chatBookOf(threadId)!.entries, [], 'the new entry left the book')
    assert.equal(child(materials(chatBook).id, '램프.md'), null, 'its file went with it')
    assert.equal((await call('POST', `/api/chat-proposals/${saved.id}/undo`)).status, 409, 'undone once')
    assert.match(textOf(await propose('a2', { title: '램프', content: '다시.' })), /dismissed or undid/)

    // A replacement saved right away; undo brings the old entry back.
    const fog = proposalOf(await propose('a3', { title: '안개', keys: ['안개'], content: '안개 낀 날은 종을 친다.' }))
    const replaced = await propose('a4', { title: '안개', keys: ['안개'], content: '안개 낀 날은 뿔나팔을 분다.' })
    assert.match(textOf(replaced), /같은 제목의 항목을 고쳤어/)
    const replacement = proposalOf(replaced)
    assert.equal(replacement.replaces, OwnedLorebookStore.chatBookOf(threadId)!.entries[0].id)
    assert.equal(OwnedLorebookStore.chatBookOf(threadId)!.entries[0].content, '안개 낀 날은 뿔나팔을 분다.')
    assert.equal((await call('POST', `/api/chat-proposals/${replacement.id}/undo`)).status, 200)
    assert.equal(OwnedLorebookStore.chatBookOf(threadId)!.entries[0].content, '안개 낀 날은 종을 친다.')
    assert.equal(ChatProposalStore.find(fog.id)?.dismissed, undefined, 'the first save stays saved')

    // The chat's own switch wins over the settings: off leaves a card.
    const off = await call('PATCH', `/api/codex-chat/threads/${threadId}/context`, { loreAutoSave: false })
    assert.equal(off.status, 200, JSON.stringify(off.json))
    assert.equal(off.json.data.lore_auto_save, 0)
    say('user', '이건 기억해줘.')
    const close = registerChatReply(context('a5'), controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, [], null, { chatContext: context('a5') })
    try {
      const card = await bridge.call('save_lore', { title: '종', content: '종은 녹이 슬었다.' })
      assert.equal(textOf(card), SAVE_LORE_DONE)
      assert.equal(proposalOf(card).savedId, undefined)
    } finally { close(); await bridge.close() }
    assert.equal((await call('PATCH', `/api/codex-chat/threads/${threadId}/context`, { loreAutoSave: 'yes' })).status, 400)
  })
})
