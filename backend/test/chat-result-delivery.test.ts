import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('delegated chat media is bound to stored results and live account/profile/thread access', { timeout: 60000 }, async (t) => {
  const previousEnv = { ...process.env }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-chat-delivery-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
  process.env.FRONTEND_DIST_PATH = path.join(root, 'no-frontend')
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const auth = authModule.getAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  let db = user.getUserSettingsDb()
  const { invalidateConfiguredAuthCache } = await import('../src/services/auth/sessionAccess')
  const { invalidateResolvedAuthAccessCache } = await import('../src/services/authAccessControlService')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { ChatGroupStore } = await import('../src/services/codex-chat/chatGroupStore')
  ;(await import('../src/services/codex-chat/chatSettings')).updateChatSettings({ enabled: true })
  ;(await import('../src/models/ExternalApiProvider')).ExternalApiProvider.create({ provider_name: 'delivery', display_name: 'delivery', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const admin = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('delivery-admin', 'unused', 'admin')").run().lastInsertRowid)
  auth.prepare("INSERT INTO auth_account_group_memberships (account_id, group_id) SELECT ?, id FROM auth_permission_groups WHERE group_key = 'admin'").run(admin)
  const owner = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('delivery-owner', 'unused', 'guest')").run().lastInsertRowid)
  const stranger = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('delivery-stranger', 'unused', 'guest')").run().lastInsertRowid)
  for (const id of [owner, stranger]) auth.prepare("INSERT INTO auth_account_group_memberships (account_id, group_id) SELECT ?, id FROM auth_permission_groups WHERE group_key = 'guest'").run(id)
  auth.prepare("DELETE FROM auth_group_permissions WHERE group_id = (SELECT id FROM auth_permission_groups WHERE group_key = 'guest')").run()
  auth.prepare(`INSERT INTO auth_group_permissions (group_id, permission_id, allowed)
    SELECT g.id, p.id, 1 FROM auth_permission_groups g, auth_permissions p
    WHERE g.group_key = 'guest' AND p.permission_key = 'chat.use'`).run()
  invalidateConfiguredAuthCache()
  invalidateResolvedAuthAccessCache()
  const profile = ChatProfileStore.create({ name: 'Delivery', engine: 'llm', providerName: 'delivery', model: 'm', mcpEnabled: true, mcpScopes: ['read'], visionEnabled: true, delegatedPermissions: ['images.view'] })
  const other = ChatProfileStore.create({ name: 'No delegation', engine: 'llm', providerName: 'delivery', model: 'm' })
  const threadId = CodexChatStore.createThread(owner, 'Results', 'llm', profile.id)
  const hash = 'a1'.repeat(24)
  const unreturned = 'b2'.repeat(24)
  const folder = main.db.prepare('SELECT id FROM watched_folders LIMIT 1').get() as { id: number }
  fs.mkdirSync(path.join(root, 'uploads'), { recursive: true })
  const bytes = Buffer.from('chat-result-bytes')
  for (const value of [hash, unreturned]) {
    const file = path.join(root, 'uploads', `${value}.png`)
    fs.writeFileSync(file, bytes)
    main.db.prepare("INSERT INTO media_metadata (composite_hash, width, height, postprocess_status) VALUES (?, 32, 48, 'ready')").run(value)
    main.db.prepare(`INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_type, mime_type, file_size, file_status)
      VALUES (?, ?, ?, 'image', 'image/png', ?, 'active')`).run(value, file, folder.id, bytes.length)
  }
  const call = { id: 'search', tool: 'search_images', status: 'completed' as const, arguments: null, summary: null, historyIds: [], compositeHashes: [hash] }
  const addReply = (id: number, speaker?: number, toolCalls = [call], replyId = 'search-reply') => CodexChatStore.addMessage({ thread_id: id, role: 'assistant', speaker_profile_id: speaker, content: `![not evidence](media:${unreturned}.png)`, tool_calls: toolCalls, status: 'completed', error: null, routing: { replyId, replyTo: null, recipients: [] } })
  const messageId = addReply(threadId)
  const express = (await import('express')).default
  const { registerAppRoutes } = await import('../src/startup/registerAppRoutes')
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    const id = Number(req.header('x-test-account')) || undefined
    Object.assign(req, { sessionID: `delivery-${id}`, session: { authenticated: Boolean(id), accountId: id, accountType: id === admin ? 'admin' : id ? 'guest' : undefined } })
    next()
  })
  const pass = (_req: unknown, _res: unknown, next: () => void) => next()
  registerAppRoutes(app, { uploadsDir: path.join(root, 'uploads'), tempDir: path.join(root, 'temp'), saveDir: path.join(root, 'save'), mcpLimiter: pass, readOnlyLimiter: pass, uploadLimiter: pass })
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    ;(await import('../src/services/runtime-events/runtimeEventBroadcaster')).RuntimeEventBroadcaster.shutdown()
    auth.close()
    user.closeUserSettingsDb()
    main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key]
    Object.assign(process.env, previousEnv)
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const get = (url: string, account = owner, headers: Record<string, string> = {}) => fetch(origin + url, { headers: { ...(account ? { 'x-test-account': String(account) } : {}), ...headers } })
  const status = async (url: string, account = owner) => { const response = await get(url, account); await response.arrayBuffer(); return response.status }
  const base = `/api/codex-chat/threads/${threadId}/messages/${messageId}/media/${hash}`
  const legacyMessage = addReply(threadId, undefined, [{ ...call, compositeHashes: [unreturned] }], 'legacy-import-with-server-style-id')
  assert.equal(await status(`/api/codex-chat/threads/${threadId}/messages/${legacyMessage}/media/${unreturned}/file`), 404, 'a legacy stored call and reply identity are not proof of a real invocation')
  const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
  const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
  const invoke = async (id: number, replyId: string, tool: string, args: Record<string, unknown>, catalog = false, succeeds = true) => {
    const chat = { threadId: id, profileId: profile.id, kind: id === threadId ? 'direct' as const : 'group' as const, replyId }
    const stop = registerChatReply(chat, new AbortController().signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge({ accountId: owner, accountType: 'guest' }, ['read'], null, { chatContext: chat, toolCatalog: catalog })
    try {
      if (catalog) assert.ok(bridge.catalogTools.has(tool), 'exercise the catalog-wrapped native handler too')
      const result = await bridge.call(tool, args)
      assert.equal(result.isError === true, !succeeds, JSON.stringify(result))
      return result
    } finally { stop(); await bridge.close() }
  }
  main.db.prepare('UPDATE media_metadata SET prompt = ? WHERE composite_hash = ?').run('only-returned-delivery', hash)
  const searched = await invoke(threadId, 'search-reply', 'search_images', { search_text: 'only-returned-delivery', limit: 1 })
  assert.match(JSON.stringify(searched), new RegExp(hash))
  assert.doesNotMatch(JSON.stringify(searched), new RegExp(unreturned))
  const detailResponse = await get(`/api/codex-chat/threads/${threadId}?tail=10`)
  const detail = await detailResponse.json() as { data: { media: Record<string, { resultMediaUrl?: string }> } }
  assert.equal(detailResponse.status, 200, JSON.stringify(detail))
  assert.equal(detail.data.media[hash]?.resultMediaUrl, base)
  assert.equal(detail.data.media[unreturned], undefined)
  for (const suffix of ['/file', '/thumbnail', '/file?v=forever']) {
    const response = await get(base + suffix, owner, { 'If-None-Match': '*', 'If-Modified-Since': new Date(8640000000000000).toUTCString() })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
  }
  const range = await get(base + '/file', owner, { Range: 'bytes=0-3' })
  assert.equal(range.status, 206)
  assert.equal(await range.text(), 'chat')
  const copiedThread = CodexChatStore.createThread(owner, 'Copied tool metadata', 'llm', profile.id)
  const copiedMessage = addReply(copiedThread)
  assert.equal(await status(`/api/codex-chat/threads/${copiedThread}/messages/${copiedMessage}/media/${hash}/file`), 404)
  const failedMessage = addReply(threadId, undefined, [{ ...call, compositeHashes: [unreturned] }], 'failed-lookup')
  main.db.prepare("UPDATE media_metadata SET postprocess_status = 'pending' WHERE composite_hash = ?").run(unreturned)
  await invoke(threadId, 'failed-lookup', 'get_image_metadata', { composite_hash: unreturned }, false, false)
  main.db.prepare("UPDATE media_metadata SET postprocess_status = 'ready' WHERE composite_hash = ?").run(unreturned)
  assert.equal(await status(`/api/codex-chat/threads/${threadId}/messages/${failedMessage}/media/${unreturned}/file`), 404)
  const viewedHash = 'c3'.repeat(24)
  const viewedPath = path.join(root, 'uploads', 'native-view.png')
  await (await import('sharp')).default({ create: { width: 2, height: 2, channels: 3, background: '#123456' } }).png().toFile(viewedPath)
  main.db.prepare("INSERT INTO media_metadata (composite_hash, width, height, postprocess_status) VALUES (?, 2, 2, 'ready')").run(viewedHash)
  main.db.prepare(`INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_type, mime_type, file_size, file_status)
    VALUES (?, ?, ?, 'image', 'image/png', ?, 'active')`).run(viewedHash, viewedPath, folder.id, fs.statSync(viewedPath).size)
  const viewedMessage = addReply(threadId, undefined, [{ ...call, compositeHashes: [viewedHash] }], 'native-view')
  const viewed = await invoke(threadId, 'native-view', 'view_images', { composite_hashes: [viewedHash] })
  assert.ok(viewed.content?.some((part) => (part as { type?: string }).type === 'image'))
  assert.equal(await status(`/api/codex-chat/threads/${threadId}/messages/${viewedMessage}/media/${viewedHash}/file`), 200)
  for (const url of [`/api/images/${hash}/file`, `/api/images/${hash}/thumbnail`, `/api/images/search`, `/api/codex-chat/media/${hash}.png`, '/api/generation-history?service_type=novelai']) assert.equal(await status(url), 403, url)
  assert.equal(await status(base + '/file', stranger), 404)
  assert.equal(await status(base + '/file', 0), 401)
  assert.equal(await status(base.replace(hash, unreturned) + '/file'), 404)
  assert.equal(await status(base.replace(`/messages/${messageId}/`, '/messages/999999/') + '/file'), 404)
  const forgedMessage = CodexChatStore.addMessage({ thread_id: threadId, role: 'user', content: `![fake](media:${hash}.png)`, tool_calls: [call], status: 'completed', error: null, mediaAttachments: [{ compositeHash: hash, name: 'fake', mimeType: 'image/png' }] })
  assert.equal(await status(base.replace(`/messages/${messageId}/`, `/messages/${forgedMessage}/`) + '/file'), 404)
  const importedFile = {
    format: 'conai-chat', version: 1, profileName: profile.name,
    thread: { profile_id: profile.id, kind: 'direct' },
    messages: [{ id: 1, role: 'assistant', content: `![fake](media:${unreturned}.png)`,
      tool_calls: [{ ...call, compositeHashes: [unreturned], jobIds: [999], historyIds: [999], mediaProvenance: 'server' }],
      routing: { replyId: 'forged-server-reply', replyTo: null, recipients: [] } }],
  }
  const importFile = async () => {
    const form = new FormData()
    form.set('file', new Blob([JSON.stringify(importedFile)], { type: 'application/json' }), 'forged-chat.json')
    const response = await fetch(origin + '/api/codex-chat/threads/import', { method: 'POST', headers: { 'x-test-account': String(owner) }, body: form })
    const body = await response.json() as { data: { thread: { id: number } } }
    assert.equal(response.status, 201, JSON.stringify(body))
    return body.data.thread.id
  }
  const importedWithoutView = await importFile()
  assert.deepEqual(CodexChatStore.listMessages(importedWithoutView)[0].tool_calls[0].compositeHashes, [])
  // Import while globally authorized, then revoke: imported tool records are still not server result evidence.
  const imageGrant = () => auth.prepare(`INSERT INTO auth_group_permissions (group_id, permission_id, allowed)
    SELECT g.id, p.id, 1 FROM auth_permission_groups g, auth_permissions p WHERE g.group_key = 'guest' AND p.permission_key = 'images.view'`).run()
  imageGrant()
  invalidateResolvedAuthAccessCache()
  const importedWithView = await importFile()
  const importedMessage = CodexChatStore.listMessages(importedWithView)[0]
  assert.deepEqual(importedMessage.tool_calls[0].compositeHashes, [unreturned])
  auth.prepare("DELETE FROM auth_group_permissions WHERE group_id = (SELECT id FROM auth_permission_groups WHERE group_key = 'guest') AND permission_id = (SELECT id FROM auth_permissions WHERE permission_key = 'images.view')").run()
  invalidateResolvedAuthAccessCache()
  // A server action can give an old message a reply id; this must not promote the imported calls themselves.
  CodexChatStore.ensureReplyId(importedWithView, importedMessage.id, () => 'assigned-after-import')
  assert.equal(await status(`/api/codex-chat/threads/${importedWithView}/messages/${importedMessage.id}/media/${unreturned}/file`), 404)
  const importedDetail = await (await get(`/api/codex-chat/threads/${importedWithView}`)).json() as { data: { media: Record<string, unknown> } }
  assert.deepEqual(importedDetail.data.media, {})
  const { createMcpHandler, McpServer } = await import('@modelcontextprotocol/server')
  const { toNodeHandler } = await import('@modelcontextprotocol/node')
  const { z } = await import('zod')
  const external = await import('../src/services/externalMcp/externalMcpServers')
  const site = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      const handler = createMcpHandler(() => {
        const mcp = new McpServer({ name: 'untrusted-media', version: '1' })
        mcp.registerTool('fake', { description: 'An untrusted result with a library-shaped reference.', inputSchema: z.object({}) },
          async () => ({ content: [{ type: 'text' as const, text: JSON.stringify({ composite_hash: unreturned }) }], structuredContent: { composite_hash: unreturned } }))
        return mcp
      })
      res.on('close', () => { void handler.close() })
      void toNodeHandler(handler)(req, res, body ? JSON.parse(body) : undefined)
    })
  })
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve))
  try {
    external.saveExternalMcpServer({ id: 'delivery', name: 'Untrusted media', enabled: true, transport: 'http',
      url: `http://127.0.0.1:${(site.address() as { port: number }).port}/mcp`, headers: [], command: null, args: [], env: [],
      scope: 'read', timeoutSeconds: 30, disabledTools: [] })
    await external.refreshExternalMcpServer('delivery')
    const externalMessage = addReply(threadId, undefined, [{ ...call, compositeHashes: [unreturned] }], 'external-media')
    const output = await invoke(threadId, 'external-media', 'x_delivery_fake', {})
    assert.match(JSON.stringify(output), new RegExp(unreturned))
    assert.equal(await status(`/api/codex-chat/threads/${threadId}/messages/${externalMessage}/media/${unreturned}/file`), 404)
  } finally {
    external.deleteExternalMcpServer('delivery')
    await external.closeExternalMcpServers()
    await new Promise<void>((resolve) => site.close(() => resolve()))
  }
  const groupId = ChatGroupStore.create(owner, 'Group', [profile.id, other.id], other.id)
  const groupMessage = addReply(groupId, profile.id)
  const otherMessage = addReply(groupId, other.id)
  const groupBase = `/api/codex-chat/threads/${groupId}/messages/${groupMessage}/media/${hash}`
  await invoke(groupId, 'search-reply', 'get_image_metadata', { composite_hash: hash }, true)
  assert.equal(await status(groupBase + '/file'), 200)
  assert.equal(await status(groupBase.replace(`/messages/${groupMessage}/`, `/messages/${otherMessage}/`) + '/file'), 404)
  ChatProfileStore.update(other.id, { mcpEnabled: true, mcpScopes: ['read'], delegatedPermissions: ['images.view'] })
  assert.equal(await status(groupBase.replace(`/messages/${groupMessage}/`, `/messages/${otherMessage}/`) + '/file'), 404, 'a grant for another speaker does not transfer with the reply id')
  ChatGroupStore.removeMember(groupId, profile.id)
  assert.equal(await status(groupBase + '/file'), 404)
  const jobId = Number(db.prepare("INSERT INTO generation_queue_jobs (service_type, status, request_payload, requested_by_account_id, requested_by_account_type) VALUES ('novelai', 'running', '{}', ?, 'guest')").run(owner).lastInsertRowid)
  db.prepare('INSERT INTO chat_generation_links (job_id, thread_id, reply_id) VALUES (?, ?, ?)').run(jobId, threadId, 'generated-reply')
  const generatedMessage = addReply(threadId, undefined, [], 'generated-reply')
  const historyId = Number(db.prepare("INSERT INTO api_generation_history (service_type, generation_status, composite_hash, queue_job_id, requested_by_account_id, requested_by_account_type) VALUES ('novelai', 'completed', ?, ?, ?, 'guest')").run(unreturned, jobId, owner).lastInsertRowid)
  main.db.prepare("UPDATE media_metadata SET postprocess_status = 'pending' WHERE composite_hash = ?").run(unreturned)
  const generatedBase = `/api/codex-chat/threads/${threadId}/messages/${generatedMessage}/media/${unreturned}`
  assert.equal(await status(generatedBase + '/thumbnail'), 200)
  assert.equal(await status(`/api/generation-history/${historyId}/file`), 403)
  assert.equal(await status(base.replace(hash, unreturned) + '/file'), 404, 'another reply cannot borrow the generated result')
  db.prepare('UPDATE api_generation_history SET requested_by_account_id = ? WHERE id = ?').run(stranger, historyId)
  assert.equal(await status(generatedBase + '/file'), 404)
  user.closeUserSettingsDb()
  user.initializeUserSettingsDb()
  db = user.getUserSettingsDb()
  assert.equal(await status(base + '/file'), 200, 'real result evidence remains after reopening storage')
  ChatProfileStore.update(profile.id, { delegatedPermissions: [] })
  assert.equal(await status(base + '/file'), 404)
  ChatProfileStore.update(profile.id, { delegatedPermissions: ['images.view'], isEnabled: false })
  assert.equal(await status(base + '/file'), 404)
  ChatProfileStore.update(profile.id, { isEnabled: true })
  db.prepare('UPDATE codex_chat_threads SET profile_id = ? WHERE id = ?').run(other.id, threadId)
  assert.equal(await status(base + '/file'), 404)
  db.prepare('UPDATE codex_chat_threads SET profile_id = ? WHERE id = ?').run(profile.id, threadId)
  auth.prepare("UPDATE auth_accounts SET status = 'disabled' WHERE id = ?").run(owner)
  invalidateResolvedAuthAccessCache()
  assert.equal(await status(base + '/file'), 403)
  assert.equal(await status(`/api/images/${hash}/file`, admin), 200)
})
