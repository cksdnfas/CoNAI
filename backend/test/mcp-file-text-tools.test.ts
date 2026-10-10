import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/** Chat bots and bound keys write and edit text documents in their own file store through MCP. */
test('mcp file text tools: write, replace, append and edit text documents', { timeout: 120000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-mcp-file-text-'))
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
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  t.after(async () => {
    auth.close()
    user.closeUserSettingsDb()
    main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-mcp-file-text-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const { invalidateConfiguredAuthCache } = await import('../src/routes/auth-route-helpers')
  const { AuthPermissionGroup } = await import('../src/models/AuthPermissionGroup')
  const addAccount = (name: string, permissionKeys: string[]) => {
    const id = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES (?, 'unused', 'guest')").run(name).lastInsertRowid)
    AuthPermissionGroup.addAccountMembership(AuthPermissionGroup.createCustomGroup({ name: `${name}-group`, permissionKeys }).id, id)
    return id
  }
  const writerId = addAccount('writer', ['files.view', 'files.edit'])
  const readerId = addAccount('reader', ['files.view'])
  invalidateConfiguredAuthCache()

  const { createMcpServer } = await import('../src/mcp/server')
  const { ALL_MCP_HTTP_SCOPES } = await import('../src/mcp/context')
  const { Client, InMemoryTransport } = await import('@modelcontextprotocol/client')
  const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
  const connect = async (accountId: number) => {
    const mcp = createMcpServer({ scopes: [...ALL_MCP_HTTP_SCOPES], source: 'http', requester: { accountId, accountType: 'guest' } })
    const client = new Client({ name: 'file-text-test', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)])
    t.after(async () => { await client.close(); await mcp.close() })
    return client
  }
  type Client = Awaited<ReturnType<typeof connect>>
  const call = async (client: Client, name: string, args: Record<string, unknown>) => {
    const reply = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: Array<{ text: string }> }
    return { isError: reply.isError === true, text: reply.content[0]?.text ?? '', data: reply.isError ? null : JSON.parse(reply.content[0].text) }
  }
  const me = fileOwnerKey(writerId)
  const read = async (id: string) => (await FileStoreService.readText(me, id, 0, 32000)).text
  const writeTools = ['edit_file_text', 'update_file_text', 'write_text_file']

  const writer = await connect(writerId)
  const reader = await connect(readerId)

  await t.test('write tools follow files.edit', async () => {
    const names = async (client: Client) => (await client.listTools()).tools.map((tool) => tool.name)
    for (const name of writeTools) assert.ok((await names(writer)).includes(name), name)
    for (const name of writeTools) assert.equal((await names(reader)).includes(name), false, name)
    assert.ok((await names(reader)).includes('search_files'))
  })

  const folder = (await call(writer, 'create_file_folder', { name: '설정집' })).data as { id: string }
  const created = await call(writer, 'write_text_file', { parent_id: folder.id, name: '세계관.md', text: '# 세계관\n\n수도는 아르덴.\n' })
  const doc = created.data as { id: string; mimeType: string; parentId: string }

  await t.test('write_text_file creates Markdown and HTML documents the other tools find', async () => {
    assert.equal(created.isError, false, created.text)
    assert.equal(doc.mimeType, 'text/markdown')
    assert.equal(doc.parentId, folder.id)
    const page = await call(writer, 'write_text_file', { name: '소개.html', text: '<h1>소개</h1><p>아르덴 이야기</p>' })
    assert.equal(page.isError, false, page.text)
    // HTML is kept as inert text (text/plain), never served as a page.
    assert.equal(page.data.mimeType, 'text/plain')
    const found = await call(writer, 'search_files', { query: '아르덴' })
    assert.deepEqual(new Set((found.data as { hits: Array<{ entry: { id: string } }> }).hits.map((hit) => hit.entry.id)), new Set([doc.id, page.data.id]))
  })

  await t.test('write_text_file refuses taken names unless overwrite, non-text types and oversized text', async () => {
    const taken = await call(writer, 'write_text_file', { parent_id: folder.id, name: '세계관.MD', text: 'x' })
    assert.ok(taken.isError && /같은 이름/.test(taken.text), taken.text)
    const overwritten = await call(writer, 'write_text_file', { parent_id: folder.id, name: '세계관.md', text: '# 세계관\n\n수도는 아르덴.\n', overwrite: true })
    assert.equal(overwritten.data.id, doc.id, 'overwrite keeps the file id')
    const image = await call(writer, 'write_text_file', { name: '그림.png', text: 'x' })
    assert.ok(image.isError && /텍스트 파일만/.test(image.text), image.text)
    const huge = await call(writer, 'write_text_file', { name: '큰.txt', text: '가'.repeat(800_000) })
    assert.ok(huge.isError && /2MB/.test(huge.text), huge.text)
  })

  await t.test('update_file_text replaces or appends in place', async () => {
    const appended = await call(writer, 'update_file_text', { file_id: doc.id, text: '\n## 인물\n', mode: 'append' })
    assert.equal(appended.data.id, doc.id)
    assert.equal(await read(doc.id), '# 세계관\n\n수도는 아르덴.\n\n## 인물\n')
    await assert.rejects(call(reader, 'update_file_text', { file_id: doc.id, text: 'x' }), { code: -32602 })
    assert.equal(await read(doc.id), '# 세계관\n\n수도는 아르덴.\n\n## 인물\n')
  })

  await t.test('edit_file_text replaces exact text and saves nothing when an edit fails', async () => {
    const edited = await call(writer, 'edit_file_text', { file_id: doc.id, edits: [
      { old_text: '수도는 아르덴.', new_text: '수도는 벨노르.' },
      { old_text: '## 인물\n', new_text: '## 인물\n\n- 리나: 기사\n' },
    ] })
    assert.equal(edited.isError, false, edited.text)
    assert.equal(edited.data.replaced, 2)
    assert.equal(edited.data.file.id, doc.id)
    const after = '# 세계관\n\n수도는 벨노르.\n\n## 인물\n\n- 리나: 기사\n'
    assert.equal(await read(doc.id), after)

    const missing = await call(writer, 'edit_file_text', { file_id: doc.id, edits: [
      { old_text: '벨노르', new_text: '카스' },
      { old_text: '없는 문장', new_text: 'x' },
    ] })
    assert.ok(missing.isError && /edits\[1\]/.test(missing.text), missing.text)
    const ambiguous = await call(writer, 'edit_file_text', { file_id: doc.id, edits: [{ old_text: '\n\n', new_text: '\n' }] })
    assert.ok(ambiguous.isError && /3군데/.test(ambiguous.text), ambiguous.text)
    assert.equal(await read(doc.id), after, 'a failed edit saves nothing')

    const all = await call(writer, 'edit_file_text', { file_id: doc.id, edits: [{ old_text: '\n\n', new_text: '\n', replace_all: true }] })
    assert.equal(all.data.replaced, 3)
    assert.equal(await read(doc.id), '# 세계관\n수도는 벨노르.\n## 인물\n- 리나: 기사\n')
  })

  await t.test('edit_file_text matches \\n edits against a CRLF file and keeps its line ends', async () => {
    const crlf = FileStoreService.writeText(me, null, '윈도우.txt', '첫 줄\r\n둘째 줄\r\n', { create: true })
    const edited = await call(writer, 'edit_file_text', { file_id: crlf.id, edits: [{ old_text: '첫 줄\n둘째 줄', new_text: '첫 줄\n새 줄\n둘째 줄' }] })
    assert.equal(edited.isError, false, edited.text)
    assert.equal(await read(crlf.id), '첫 줄\r\n새 줄\r\n둘째 줄\r\n')
  })

  await t.test('edits refuse folders and files of other accounts', async () => {
    assert.ok((await call(writer, 'edit_file_text', { file_id: folder.id, edits: [{ old_text: 'a', new_text: 'b' }] })).isError)
    const other = FileStoreService.writeText(fileOwnerKey(readerId), null, '남의 것.md', '비밀', { create: true })
    const stolen = await call(writer, 'update_file_text', { file_id: other.id, text: 'x', mode: 'append' })
    assert.ok(stolen.isError && /찾을 수 없어/.test(stolen.text), stolen.text)
    assert.equal((await FileStoreService.readText(fileOwnerKey(readerId), other.id)).text, '비밀')
  })
})
