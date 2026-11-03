import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('chat-only uploads stay account-private through send, shared APIs, tools and cleanup', { timeout: 60000 }, async (t) => {
  const previousEnv = { ...process.env }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-chat-attachments-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const auth = authModule.getAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  const { invalidateConfiguredAuthCache } = await import('../src/services/auth/sessionAccess')
  const { invalidateResolvedAuthAccessCache } = await import('../src/services/authAccessControlService')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
  const { chatAttachmentOwner } = await import('../src/services/fileStoreService')
  const { validateChatAttachments, inlineTextsForChat, loadAttachedImages, chatContentWithAttachments } = await import('../src/services/codex-chat/chatAttachments')
  const { searchStoredFiles, stopFileSearchMaintenance } = await import('../src/services/fileStoreSearch')
  ;(await import('../src/services/codex-chat/chatSettings')).updateChatSettings({ enabled: true })
  const createAccount = (name: string, type: string) => Number(auth.prepare('INSERT INTO auth_accounts (username, password_hash, account_type) VALUES (?, ?, ?)').run(name, 'unused', type).lastInsertRowid)
  const owner = createAccount('attachment-owner', 'guest')
  const stranger = createAccount('attachment-stranger', 'guest')
  const admin = createAccount('attachment-admin', 'admin')
  for (const id of [owner, stranger, admin]) auth.prepare('INSERT INTO auth_account_group_memberships (account_id, group_id) SELECT ?, id FROM auth_permission_groups WHERE group_key = ?').run(id, id === admin ? 'admin' : 'guest')
  auth.prepare("DELETE FROM auth_group_permissions WHERE group_id = (SELECT id FROM auth_permission_groups WHERE group_key = 'guest')").run()
  auth.prepare(`INSERT INTO auth_group_permissions (group_id, permission_id, allowed)
    SELECT g.id, p.id, 1 FROM auth_permission_groups g, auth_permissions p
    WHERE g.group_key = 'guest' AND p.permission_key = 'chat.use'`).run()
  invalidateConfiguredAuthCache()
  invalidateResolvedAuthAccessCache()
  ;(await import('../src/models/ExternalApiProvider')).ExternalApiProvider.create({ provider_name: 'attachment-test', display_name: 'attachment-test', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'unused' } })
  const profile = ChatProfileStore.create({ name: 'Private attachments', engine: 'llm', providerName: 'attachment-test', model: 'unused', mcpEnabled: true, mcpScopes: ['read'] })
  const threadId = CodexChatStore.createThread(owner, 'Private', 'llm', profile.id)
  const requester = { accountId: owner, accountType: 'guest' as const }
  const express = (await import('express')).default
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    const id = Number(req.header('x-test-account'))
    Object.assign(req, { sessionID: `attachments-${id}`, session: { authenticated: true, accountId: id, accountType: id === admin ? 'admin' : 'guest' } })
    next()
  })
  app.use('/api/codex-chat', (await import('../src/routes/codex-chat.routes')).default)
  app.use('/api/files', (await import('../src/routes/files.routes')).default)
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    stopFileSearchMaintenance()
    ;(await import('../src/services/runtime-events/runtimeEventBroadcaster')).RuntimeEventBroadcaster.shutdown()
    auth.close()
    user.closeUserSettingsDb()
    main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key]
    Object.assign(process.env, previousEnv)
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const get = (url: string, account = owner) => fetch(origin + url, { headers: { 'x-test-account': String(account) } })
  const body = new FormData()
  body.append('files', new Blob(['account-private attachment body']), 'private.txt')
  const uploaded = await fetch(`${origin}/api/codex-chat/attachments/upload?threadId=${threadId}`, { method: 'POST', headers: { 'x-test-account': String(owner) }, body })
  assert.equal(uploaded.status, 201, await uploaded.clone().text())
  const [file] = (await uploaded.json() as { data: Array<{ id: string }> }).data
  const attachments = validateChatAttachments(requester, [file.id])
  const { ensureAutomationRoom } = await import('../src/services/codex-chat/chatRoomWake')
  const { CodexChatService } = await import('../src/services/codex-chat/codexChatService')
  const { BoardCallRooms } = await import('../src/services/posts/boardCallRooms')
  const { hasPrivateAttachmentContext, markPrivateAttachmentContext } = await import('../src/services/codex-chat/chatAttachmentPrivacy')
  const boardKey = `posts:board:${profile.id}`
  const board = await ensureAutomationRoom(requester, profile.id, boardKey, `게시판 · ${profile.name}`)
  const boardBody = new FormData()
  boardBody.append('files', new Blob(['must-not-enter-board-room']), 'board.txt')
  const boardUpload = await fetch(`${origin}/api/codex-chat/attachments/upload?threadId=${board.id}`, { method: 'POST', headers: { 'x-test-account': String(owner) }, body: boardBody })
  assert.equal(boardUpload.status, 403, await boardUpload.clone().text())
  assert.match(await boardUpload.text(), /게시판/)
  const beforeBoardSend = CodexChatStore.messageCount(board.id)
  await assert.rejects(CodexChatService.sendMessage(requester, board.id, 'attach while no board run is active', () => {}, [file.id]), /게시판/)
  assert.throws(() => CodexChatStore.addMessage({ thread_id: board.id, role: 'user', content: 'attach', tool_calls: [], status: 'completed', error: null }, [file.id]), /게시판/)
  assert.equal(CodexChatStore.messageCount(board.id), beforeBoardSend)
  assert.equal(hasPrivateAttachmentContext(board.id), false)
  markPrivateAttachmentContext(board.id) // A board room tainted before destination validation existed.
  ChatProfileStore.update(profile.id, { name: 'Renamed bot' })
  const endOldBoard = BoardCallRooms.bind(board.id, 777, profile.id)
  try {
    await assert.rejects(CodexChatService.sendMessage(requester, board.id, 'board call', () => {}), error => {
      assert.match((error as Error).message, /게시판 · Private attachments/)
      assert.match((error as Error).message, /방.*삭제.*게시판 호출/)
      return true
    })
  } finally { endOldBoard(); ChatProfileStore.update(profile.id, { name: profile.name }) }
  await CodexChatService.deleteThread(requester, board.id)
  const freshBoard = await ensureAutomationRoom(requester, profile.id, boardKey, `게시판 · ${profile.name}`)
  assert.notEqual(freshBoard.id, board.id)
  assert.equal(hasPrivateAttachmentContext(freshBoard.id), false)
  const { LinkedFileStore } = await import('../src/services/codex-chat/chatLinkedFiles')
  const { ChatMinutesStore, appendMinutes, MINUTES_FOLDER } = await import('../src/services/codex-chat/chatMinutes')
  const minutesFolder = FileStoreService.createFolder(fileOwnerKey(admin), null, 'meeting-records')
  LinkedFileStore.setThreadLinks(threadId, [{ id: minutesFolder.id, write: true }])
  ChatMinutesStore.set(threadId, minutesFolder.id)
  const messageId = CodexChatStore.addMessage({ thread_id: threadId, role: 'user', content: 'read this', tool_calls: [], status: 'completed', error: null }, [file.id])
  assert.equal(CodexChatStore.listMessages(threadId).find(message => message.id === messageId)?.attachments?.[0].id, file.id)
  assert.equal((await inlineTextsForChat(profile, owner, [{ attachments }]))?.get(file.id), 'account-private attachment body')
  assert.throws(() => ChatMinutesStore.set(threadId, minutesFolder.id), /개인 첨부.*회의록/)
  const pausedDetail = await (await get(`/api/codex-chat/threads/${threadId}?tail=10`)).json() as { data: { thread: { minutes_paused: boolean } } }
  assert.equal(pausedDetail.data.thread.minutes_paused, true)
  const stretch = { content: 'account-private attachment body', firstAt: '2026-11-03 01:00:00', lastAt: '2026-11-03 02:00:00' }
  appendMinutes(threadId, stretch)
  assert.equal(FileStoreService.findChild(fileOwnerKey(admin), minutesFolder.id, MINUTES_FOLDER), null)
  ChatMinutesStore.set(threadId, null)
  assert.equal(CodexChatService.getThreadRecord(requester, threadId).minutes_paused, true, 'turning off the folder does not remove the paused status')
  const cleanMinutesThread = CodexChatStore.createThread(owner, 'Public meeting', 'llm', profile.id)
  LinkedFileStore.setThreadLinks(cleanMinutesThread, [{ id: minutesFolder.id, write: true }])
  ChatMinutesStore.set(cleanMinutesThread, minutesFolder.id)
  assert.equal(CodexChatService.getThreadRecord(requester, cleanMinutesThread).minutes_paused, false)
  appendMinutes(cleanMinutesThread, { ...stretch, content: 'public meeting record' })
  assert.ok(FileStoreService.findChild(fileOwnerKey(admin), minutesFolder.id, MINUTES_FOLDER))
  const { OwnedLorebookStore } = await import('../src/services/codex-chat/chatLorebookFiles')
  const { proposeLore, loreAutoSaveOn } = await import('../src/services/codex-chat/chatLoreProposals')
  const recordBook = OwnedLorebookStore.createForThread(threadId, 'Review required')
  CodexChatStore.updateThreadContext(threadId, { loreAutoSave: true })
  const loreProposal = proposeLore({ threadId, profileId: profile.id, kind: 'direct', replyId: 'private-lore' }, {
    title: 'Private record', keys: ['private'], content: 'account-private attachment body', file: { name: 'private-note.txt', text: 'account-private attachment body' },
  })
  assert.equal(loreAutoSaveOn(threadId), false)
  assert.equal(loreProposal.savedId, undefined)
  assert.equal(loreProposal.content, 'account-private attachment body')
  assert.equal(OwnedLorebookStore.find(recordBook.id, fileOwnerKey(owner))?.entries.length, 0)
  const download = await get(`/api/codex-chat/attachments/${file.id}/download`)
  assert.equal(download.status, 200)
  assert.equal(await download.text(), 'account-private attachment body')
  for (const account of [stranger, admin]) {
    const denied = await get(`/api/codex-chat/attachments/${file.id}/download`, account)
    assert.equal(denied.status, 404)
    await denied.arrayBuffer()
  }
  assert.throws(() => validateChatAttachments({ accountId: stranger, accountType: 'guest' }, [file.id]))
  const foreignThread = CodexChatStore.createThread(stranger, 'Foreign', 'llm', profile.id)
  assert.throws(() => CodexChatStore.addMessage({ thread_id: foreignThread, role: 'user', content: 'stolen', tool_calls: [], status: 'completed', error: null }, [file.id]))
  for (const suffix of ['', '/download', '/text', '/neighbors']) {
    const denied = await get(`/api/files/${file.id}${suffix}`, admin)
    assert.equal(denied.status, 404)
    await denied.arrayBuffer()
  }
  const listing = await (await get('/api/files', admin)).json() as { data: { entries: Array<{ id: string }> } }
  assert.ok(!listing.data.entries.some(entry => entry.id === file.id))
  assert.equal((await searchStoredFiles(fileOwnerKey(admin), 'account-private')).hits.length, 0)
  assert.throws(() => FileStoreService.readEditableText(fileOwnerKey(admin), file.id))
  const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
  const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
  const chat = { threadId, profileId: profile.id, kind: 'direct' as const, replyId: 'private-read' }
  const stop = registerChatReply(chat, new AbortController().signal, () => ({ replyTo: null, recipients: ['user'] }))
  const bridge = await openChatMcpBridge(requester, [], null, { chatContext: chat, toolCatalog: false })
  try {
    const result = await bridge.call('read_chat_attachment', { file_id: file.id })
    assert.notEqual(result.isError, true, JSON.stringify(result))
    assert.match(JSON.stringify(result), /account-private attachment body/)
  } finally { stop(); await bridge.close() }
  const { isContextToolAllowed } = await import('../src/mcp/toolAccess')
  assert.equal(isContextToolAllowed({ source: 'http', scopes: ['read'], keyGroup: 'admin' }, 'read_chat_attachment'), false)
  const unbind = BoardCallRooms.bind(threadId, 1, profile.id)
  try {
    assert.equal(isContextToolAllowed({ source: 'llm-chat', requester, scopes: ['read'], chatContext: chat }, 'read_chat_attachment'), false)
    await assert.rejects(inlineTextsForChat(profile, owner, [{ attachments }], chat), /개인 첨부/)
    await assert.rejects(loadAttachedImages(profile, requester, [{ attachments }], chat), /개인 첨부/)
    await assert.rejects(CodexChatService.sendMessage(requester, threadId, 'board answer', () => {}), /개인 첨부/)
  } finally { unbind() }
  const publicChat = { ...chat, page: { instanceId: 'public', connectionId: 'public', path: '/public/test', title: 'Public', kind: 'page' as const, resourceId: null, fields: [] } }
  await assert.rejects(inlineTextsForChat(profile, owner, [{ attachments }], publicChat), /개인 첨부/)
  await assert.rejects(loadAttachedImages(profile, requester, [{ attachments }], publicChat), /개인 첨부/)
  const { backupChatToFiles } = await import('../src/services/codex-chat/chatBackup')
  const privateReplyId = CodexChatStore.addMessage({ thread_id: threadId, role: 'assistant', content: 'account-private attachment body', tool_calls: [{
    id: 'private-tool', tool: 'read_chat_attachment', status: 'completed', arguments: { file_id: file.id },
    summary: 'account-private attachment body', output: 'account-private attachment body', historyIds: [], compositeHashes: [],
  }], status: 'completed', error: null })
  const { saveChatRequestCapture } = await import('../src/services/codex-chat/chatRequestCaptures')
  saveChatRequestCapture(privateReplyId, '{"messages":[{"content":"account-private attachment body"}]}')
  assert.throws(() => backupChatToFiles(requester, threadId, '2026-11-03'), /개인 첨부/)
  const bulkDelete = await fetch(`${origin}/api/codex-chat/threads/bulk`, { method: 'POST', headers: { 'x-test-account': String(owner), 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadIds: [threadId], action: 'delete', backup: true }) })
  const bulkResult = await bulkDelete.json() as { data: { results: Array<{ status: string; reason: string }> } }
  assert.equal(bulkResult.data.results[0].status, 'failed')
  assert.match(bulkResult.data.results[0].reason, /Private.*그냥 지우기/)
  assert.ok(CodexChatStore.findThread(threadId, owner))
  const { exportChatDiagnostics } = await import('../src/services/codex-chat/chatDiagnostics')
  await assert.rejects(exportChatDiagnostics(requester, threadId, privateReplyId), error => {
    assert.match((error as Error).message, /개인 첨부.*공용.*진단/)
    assert.doesNotMatch((error as Error).message, /지우기|삭제/)
    return true
  })
  assert.equal((await searchStoredFiles(fileOwnerKey(admin), 'account-private')).hits.length, 0)
  const { exportChatMarkdown } = await import('../src/services/codex-chat/chatExport')
  const markdown = exportChatMarkdown(CodexChatStore.findThreadById(threadId)!, CodexChatStore.listMessages(threadId), [], profile.name, origin)
  assert.ok(markdown.includes(`/api/codex-chat/attachments/${file.id}/download`))
  for (const unreadable of [
    { ...attachments[0], name: 'sound.mp3', mimeType: 'audio/mpeg' },
    { ...attachments[0], name: 'binary.zip', mimeType: 'application/zip' },
    { ...attachments[0], name: 'past-budget.txt' },
    { ...attachments[0], name: 'past-image-budget.png', mimeType: 'image/png' },
  ]) {
    assert.match(chatContentWithAttachments('', [unreadable], [], new Map(), new Map()), /Do not claim to have read|Do not claim to have seen/)
  }
  const { callChatAgent, ChatAgentRunner } = await import('../src/services/codex-chat/chatAgentCalls')
  const { onChatReplyFinished } = await import('../src/services/codex-chat/chatReplyRegistry')
  const agent = ChatProfileStore.create({ name: 'Attachment agent', engine: 'llm', providerName: 'attachment-test', model: 'unused', agentEnabled: true, summaryEnabled: false, mcpEnabled: true, mcpScopes: ['read'] })
  const delegated = { ...chat, replyId: 'delegate-private' }
  const stopDelegation = registerChatReply(delegated, new AbortController().signal, () => ({ replyTo: null, recipients: ['user'] }))
  const pendingOther = path.join(root, 'unhanded.txt')
  fs.writeFileSync(pendingOther, 'unhanded-private-body')
  const [unhanded] = FileStoreService.upload(chatAttachmentOwner(owner), null, [{ path: pendingOther, originalname: 'unhanded.txt', mimetype: 'text/plain', size: 21 } as Express.Multer.File])
  assert.throws(() => callChatAgent(requester, delegated, { agentProfileId: agent.id, instruction: 'read', fileIds: [unhanded.id] }), /호출한 채팅.*개인 첨부.*에이전트/)
  assert.throws(() => callChatAgent({ accountId: stranger, accountType: 'guest' }, delegated, { agentProfileId: agent.id, instruction: 'read', fileIds: [file.id] }))
  const originalFetch = globalThis.fetch
  let agentRequests = 0
  const network = t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (!String(url).startsWith('http://unused.invalid')) return originalFetch(url, init)
    const request = JSON.parse(String(init?.body))
    agentRequests++
    if (agentRequests === 1) return Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: 'read-delegated', type: 'function', function: { name: 'read_chat_attachment', arguments: JSON.stringify({ file_id: file.id }) } }] }, finish_reason: 'tool_calls' }] })
    assert.match(JSON.stringify(request.messages.filter((message: { role: string }) => message.role === 'tool')), /account-private attachment body/)
    return Response.json({ choices: [{ message: { content: 'read delegated attachment' }, finish_reason: 'stop' }] })
  })
  let endFinished = () => {}
  const finished = new Promise<number>(resolve => { endFinished = onChatReplyFinished(context => { if (context.profileId === agent.id) resolve(context.threadId) }) })
  let agentThreadId: number
  try {
    callChatAgent(requester, delegated, { agentProfileId: agent.id, instruction: 'Read the handed file with read_chat_attachment.', fileIds: [file.id] })
    agentThreadId = await finished
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(agentRequests, 2)
    assert.equal(CodexChatStore.listMessages(agentThreadId).find(message => message.role === 'user')?.attachments?.[0].id, file.id)
    const agentContext = { threadId: agentThreadId, profileId: agent.id, kind: 'direct' as const, replyId: 'verify-delegated-scope' }
    const end = registerChatReply(agentContext, new AbortController().signal, () => ({ replyTo: null, recipients: ['user'] }))
    const agentBridge = await openChatMcpBridge(requester, [], null, { chatContext: agentContext, toolCatalog: false })
    try {
      assert.equal((await agentBridge.call('read_chat_attachment', { file_id: unhanded.id })).isError, true)
    } finally { end(); await agentBridge.close() }
    assert.throws(() => backupChatToFiles(requester, agentThreadId, '2026-11-03'), /개인 첨부/)
    CodexChatStore.deleteThread(agentThreadId)
  } finally {
    endFinished()
    stopDelegation()
    ChatAgentRunner.stop()
    network.mock.restore()
  }
  const { ChatGroupStore } = await import('../src/services/codex-chat/chatGroupStore')
  const groupId = ChatGroupStore.create(owner, 'My bots', [profile.id], profile.id)
  CodexChatStore.addMessage({ thread_id: groupId, role: 'user', content: 'group attachment', tool_calls: [], status: 'completed', error: null }, [file.id])
  const { GroupChatService } = await import('../src/services/codex-chat/groupChatService')
  const unbindGroup = BoardCallRooms.bind(groupId, 2, profile.id)
  try { await assert.rejects(GroupChatService.sendMessage(requester, groupId, 'board answer', () => {}), /개인 첨부/) }
  finally { unbindGroup() }
  assert.equal(CodexChatStore.findThread(groupId, stranger), undefined)
  const { exportChatJson } = await import('../src/services/codex-chat/chatBackup')
  const { importChatThread } = await import('../src/services/codex-chat/chatImport')
  const raw = Buffer.from(JSON.stringify(exportChatJson(requester, threadId)))
  const importFor = (accountId: number) => importChatThread({ accountId, accountType: 'guest' }, raw, {
    direct: profileId => ({ id: CodexChatStore.createThread(accountId, 'Imported', 'llm', profileId) }),
    group: () => { throw new Error('Not a group export') },
  })
  const imported = importFor(owner)
  assert.equal(CodexChatStore.listMessages(imported.threadId)[0].attachments?.[0].id, file.id)
  const foreignImport = importFor(stranger)
  assert.equal(CodexChatStore.listMessages(foreignImport.threadId)[0].attachments?.length, 0)
  const shared = FileStoreService.writeText(fileOwnerKey(admin), null, 'legacy.txt', 'legacy body')
  assert.throws(() => validateChatAttachments(requester, [shared.id]))
  assert.equal(validateChatAttachments({ accountId: admin, accountType: 'admin' }, [shared.id])[0].id, shared.id)
  const legacyThread = CodexChatStore.createThread(admin, 'Legacy shared attachment', 'llm', profile.id)
  CodexChatStore.addMessage({ thread_id: legacyThread, role: 'user', content: 'legacy', tool_calls: [], status: 'completed', error: null }, [shared.id])
  const legacyRequester = { accountId: admin, accountType: 'admin' as const }
  const legacyExport = exportChatJson(legacyRequester, legacyThread)
  assert.equal(legacyExport.messages[0].attachments?.[0].id, shared.id)
  assert.equal((await inlineTextsForChat({ ...profile, mcpEnabled: false }, admin, legacyExport.messages))?.get(shared.id), 'legacy body')
  const legacyImport = importChatThread(legacyRequester, Buffer.from(JSON.stringify(legacyExport)), {
    direct: profileId => ({ id: CodexChatStore.createThread(admin, 'Legacy import', 'llm', profileId) }),
    group: () => { throw new Error('Not a group export') },
  })
  assert.equal(CodexChatStore.listMessages(legacyImport.threadId)[0].attachments?.[0].id, shared.id)
  const { ensureFileStoreSchema } = await import('../src/database/fileStoreSchema')
  const duplicatePath = path.join(root, 'duplicate.txt')
  fs.writeFileSync(duplicatePath, 'duplicate')
  const [duplicate] = FileStoreService.upload(chatAttachmentOwner(owner), null, [{ path: duplicatePath, originalname: 'private.txt', mimetype: 'text/plain', size: 9 } as Express.Multer.File])
  user.getUserSettingsDb().exec('DROP INDEX idx_stored_files_shared_name')
  ensureFileStoreSchema(user.getUserSettingsDb())
  ensureFileStoreSchema(user.getUserSettingsDb())
  assert.equal(FileStoreService.get(chatAttachmentOwner(owner), file.id).name, 'private.txt')
  assert.equal(FileStoreService.get(chatAttachmentOwner(owner), duplicate.id).name, 'private.txt')
  fs.writeFileSync(duplicatePath, 'after restart')
  const [afterRestart] = FileStoreService.upload(chatAttachmentOwner(owner), null, [{ path: duplicatePath, originalname: 'private.txt', mimetype: 'text/plain', size: 13 } as Express.Multer.File])
  assert.equal(afterRestart.name, 'private.txt')
  CodexChatStore.clearThread(threadId, '')
  assert.throws(() => backupChatToFiles(requester, threadId, '2026-11-03'), /개인 첨부/, 'clearing messages cannot declassify old session captures or summaries')
  assert.equal(FileStoreService.get(chatAttachmentOwner(owner), file.id).id, file.id, 'other own-chat references preserve the file')
  CodexChatStore.deleteThread(groupId)
  CodexChatStore.deleteThread(imported.threadId)
  FileStoreService.purgeDeleted()
  const gone = await get(`/api/codex-chat/attachments/${file.id}/download`)
  assert.equal(gone.status, 404)
  await gone.arrayBuffer()
  assert.equal(FileStoreService.get(fileOwnerKey(admin), shared.id).id, shared.id)
  const pendingPath = path.join(root, 'pending.txt')
  fs.writeFileSync(pendingPath, 'pending')
  const [pending] = FileStoreService.upload(chatAttachmentOwner(owner), null, [{ path: pendingPath, originalname: 'pending.txt', mimetype: 'text/plain', size: 7 } as Express.Multer.File])
  user.getUserSettingsDb().prepare("UPDATE stored_file_entries SET created_at = datetime('now', '-2 days') WHERE id = ?").run(pending.id)
  FileStoreService.purgeDeleted()
  assert.throws(() => FileStoreService.get(chatAttachmentOwner(owner), pending.id))
})
