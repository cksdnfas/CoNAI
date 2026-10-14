import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { ChatExecutionContext, WorkspaceOperation } from '@conai/shared'

test('project files share files while preserving revisions, execution boundaries and retry semantics', { timeout: 120000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-workspaces-test-'))
  process.env.RUNTIME_BASE_PATH = directory
  for (const name of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) process.env[`RUNTIME_${name}_DIR`] = path.join(directory, name.toLowerCase())
  const settings = await import('../src/database/userSettingsDb')
  settings.initializeUserSettingsDb()
  const auth = await import('../src/database/authDb')
  auth.initializeAuthDb()
  t.after(async () => {
    settings.closeUserSettingsDb()
    auth.getAuthDb().close()
    ;(await import('../src/database/init')).closeDatabase()
    await new Promise<void>(resolve => { void import('../src/utils/logger').then(({ logger }) => logger.close(resolve)) })
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(directory).startsWith('conai-workspaces-test-'))
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const { WorkspaceService: service, workspaceTarget } = await import('../src/services/workspaceService')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
  const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
  const { BoardCallRooms } = await import('../src/services/posts/boardCallRooms')
  const { rawTokenEstimate } = await import('../src/services/llmUsage')
  const { validateMcpToolArguments } = await import('../src/mcp/requestSecurity')
  const { chatPageActionTier, chatPageActionAllowed } = await import('@conai/shared')
  updateChatSettings({ enabled: true })
  ExternalApiProvider.create({ provider_name: 'workspace-test', display_name: 'Workspace test', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const profile = ChatProfileStore.create({ name: 'Workspace test', engine: 'llm', providerName: 'workspace-test' })
  const threadId = CodexChatStore.createThread(null, 'Workspace test', 'llm', profile.id)
  const requester = { accountId: null, accountType: 'admin' as const }
  const context: ChatExecutionContext = { threadId, profileId: profile.id, kind: 'direct', replyId: 'workspace-reply' }
  const release = registerChatReply(context, new AbortController().signal, () => ({ replyTo: null, recipients: ['user'] }))
  t.after(release)
  const project = await service.create('bootstrap', '리소스', 'Use Korean names.')
  const read = async (target: string) => (await service.read('bootstrap', project.id, [{ target }])).files[0]
  const apply = (key: string, operations: WorkspaceOperation[]) => service.apply('bootstrap', project.id, key, operations)
  await t.test('shared projects retain path checks and private chat bindings', async () => {
    assert.equal(service.get('account:77', project.id).id, project.id)
    assert.equal(service.list('account:77')[0].id, project.id)
    assert.throws(() => service.bind('account:77', threadId, project.id, true), /내 1:1 채팅/)
    assert.equal(service.binding('account:77', threadId), null)
    for (const target of ['../secret', 'a/../b', '/tmp/a', 'C:/a', 'a\\b', 'a:stream', 'node_modules/a', '.git/config', 'CON.txt', '.workspace-abc', 'a.']) assert.throws(() => workspaceTarget(target), /경로/)
    assert.equal((await service.read('account:77', project.id, [{ target: 'AI_GUIDELINES.md' }])).files[0].text, 'Use Korean names.')
    assert.throws(() => validateMcpToolArguments({ path: 'file.md' }), /not allowed/)
    assert.doesNotThrow(() => validateMcpToolArguments({ target: 'file.md' }))
  })
  await t.test('revision checks and identical retries do not apply edits twice', async () => {
    const create: WorkspaceOperation[] = [{ kind: 'write', target: 'note.md', text: 'first', expectedRevision: null }]
    const initial = await apply('create-note', create)
    assert.equal(initial.status, 'completed')
    const revision = (await read('note.md')).revision
    const edits: WorkspaceOperation[] = [{ kind: 'edit', target: 'note.md', edits: [{ old_text: 'first', new_text: 'second' }], expectedRevision: revision }]
    const saved = await apply('edit-note', edits)
    assert.equal(saved.status, 'completed')
    assert.deepEqual(await apply('edit-note', edits), saved)
    assert.equal((await read('note.md')).text, 'second')
    assert.equal((await apply('stale-note', [{ ...create[0], kind: 'write', target: 'note.md', text: 'stale', expectedRevision: revision }])).status, 'failed')
    await assert.rejects(apply('create-note', [{ kind: 'write', target: 'other.md', text: 'different', expectedRevision: null }]), /같은 요청 ID/)
  })
  await t.test('a failed batch reports committed items and retry cannot repeat them', async () => {
    const operations: WorkspaceOperation[] = [{ kind: 'mkdir', target: 'folder' }, { kind: 'write', target: 'note.md', text: 'overwrite', expectedRevision: null }, { kind: 'mkdir', target: 'never' }]
    const result = await apply('partial-batch', operations)
    assert.equal(result.status, 'failed')
    assert.deepEqual(result.results, [{ target: 'folder' }])
    assert.deepEqual(await apply('partial-batch', operations), result)
    assert.equal((await service.entries('bootstrap', project.id)).entries.some(entry => entry.target === 'never'), false)
  })
  await t.test('only one writer is admitted and read revisions protect concurrent edits', async () => {
    const results = await Promise.allSettled([
      apply('parallel-first', [{ kind: 'write', target: 'one.md', text: 'one', expectedRevision: null }]),
      apply('parallel-second', [{ kind: 'write', target: 'two.md', text: 'two', expectedRevision: null }]),
    ])
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(results.filter(result => result.status === 'rejected').length, 1)
  })
  await t.test('move preserves identity and refuses an existing destination', async () => {
    const entry = (await service.entries('bootstrap', project.id)).entries.find(item => item.target === 'note.md')!
    const revision = (await read('note.md')).revision
    assert.equal((await apply('move-note', [{ kind: 'move', target: 'note.md', destination: 'folder/note.md', expectedRevision: revision }])).status, 'completed')
    const moved = (await service.entries('bootstrap', project.id, 'folder')).entries[0]
    assert.equal(moved.id, entry.id)
    assert.equal((await read('folder/note.md')).text, 'second')
    const conflict = await apply('move-conflict', [{ kind: 'move', target: 'folder/note.md', destination: 'AI_GUIDELINES.md', expectedRevision: (await read('folder/note.md')).revision }])
    assert.equal(conflict.status, 'failed')
    assert.equal((await read('AI_GUIDELINES.md')).text, 'Use Korean names.')
    assert.equal((await apply('case-alias', [{ kind: 'write', target: 'ai_guidelines.md', text: 'alias', expectedRevision: null }])).status, 'failed')
  })
  await t.test('hard links and junctions cannot expose files outside the project', async () => {
    const projectRoot = path.join(directory, 'workspaces', project.id)
    const outside = path.join(directory, 'outside')
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'secret.md'), 'private')
    fs.linkSync(path.join(outside, 'secret.md'), path.join(projectRoot, 'hard.md'))
    fs.symlinkSync(outside, path.join(projectRoot, 'outside'), process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(read('hard.md'), /링크/)
    await assert.rejects(read('outside/secret.md'), /링크/)
    const result = await apply('junction-write', [{ kind: 'write', target: 'outside/new.md', text: 'bad', expectedRevision: null }])
    assert.equal(result.status, 'failed')
    assert.equal(fs.existsSync(path.join(outside, 'new.md')), false)
    fs.unlinkSync(path.join(projectRoot, 'hard.md'))
    await fs.promises.rm(path.join(projectRoot, 'outside'))
  })
  await t.test('UTF-8 continuation retains the revision and does not lose characters', async () => {
    const text = '한글😀'.repeat(9000)
    await apply('create-long', [{ kind: 'write', target: 'long.md', text, expectedRevision: null }])
    let offset = 0; let joined = ''; let revision: string | undefined
    do {
      const chunk = (await service.read('bootstrap', project.id, [{ target: 'long.md', offset, limit: 16000, revision }])).files[0]
      joined += chunk.text; revision = chunk.revision; offset = chunk.nextOffset ?? -1
    } while (offset !== -1)
    assert.equal(joined, text)
    assert.equal((await read('long.md')).nextOffset, null)
  })
  await t.test('folder moves protect child revisions and preserve indexed identities', async () => {
    assert.equal((await apply('folder-move-setup', [{ kind: 'mkdir', target: 'stage' }, { kind: 'mkdir', target: 'stage/hero' }, { kind: 'write', target: 'stage/hero/info.json', text: '{}', expectedRevision: null }])).status, 'completed')
    const entry = (await service.entries('bootstrap', project.id, 'stage/hero')).entries[0]
    const stale = await service.stat('bootstrap', project.id, 'stage/hero')
    await apply('folder-child-edit', [{ kind: 'write', target: entry.target, text: '{"changed":true}', expectedRevision: (await read(entry.target)).revision }])
    assert.equal((await apply('folder-stale-move', [{ kind: 'move', target: 'stage/hero', destination: 'moved', expectedRevision: stale.revision }])).status, 'failed')
    const current = await service.stat('bootstrap', project.id, 'stage/hero')
    const operations: WorkspaceOperation[] = [{ kind: 'move', target: 'stage/hero', destination: 'moved', expectedRevision: current.revision }]
    const moved = await apply('folder-valid-move', operations)
    assert.equal(moved.status, 'completed')
    assert.deepEqual(await apply('folder-valid-move', operations), moved)
    assert.equal((await service.entries('bootstrap', project.id, 'moved')).entries[0].id, entry.id)
    assert.equal((await read('moved/info.json')).text, '{"changed":true}')
    await assert.rejects(service.stat('bootstrap', project.id, 'stage/hero'))
  })
  await t.test('text search keeps ordered partial results and revisions prevent stale excerpt edits', async () => {
    const searchProject = await service.create('bootstrap', 'Search revisions')
    const operations: WorkspaceOperation[] = [
      { kind: 'mkdir', target: 'needle-folder' },
      ...['a.md', 'b.md', 'c.md', 'd.md', 'e.md'].map(target => ({ kind: 'write' as const, target, text: `앞부분 needle ${target}\n` + (target === 'e.md' ? '한'.repeat(50000) : ''), expectedRevision: null })),
    ]
    assert.equal((await service.apply('bootstrap', searchProject.id, 'search-create', operations)).status, 'completed')
    const result = await service.search('bootstrap', searchProject.id, 'needle')
    assert.deepEqual(result.hits.map(hit => hit.target), ['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'needle-folder'])
    assert.equal(result.partialFiles, 1)
    assert.equal(result.nextOffset, null)
    assert.equal(result.hits.at(-1)!.revision, undefined, 'name-only matches must not invent a content revision')
    const hit = result.hits[0]
    assert.match(hit.excerpt!, /앞부분 needle a.md/)
    assert.match(hit.revision!, /^[a-f0-9]{64}$/)
    const edit: WorkspaceOperation = { kind: 'edit', target: hit.target, edits: [{ old_text: 'needle', new_text: 'changed' }], expectedRevision: hit.revision! }
    assert.equal((await service.apply('bootstrap', searchProject.id, 'search-edit', [edit])).status, 'completed')
    assert.equal((await service.apply('bootstrap', searchProject.id, 'stale-search-edit', [edit])).status, 'failed')
    assert.match((await service.read('bootstrap', searchProject.id, [{ target: hit.target }])).files[0].text, /앞부분 changed a.md/)
    const cancelled = new AbortController()
    cancelled.abort()
    await assert.rejects(service.search('bootstrap', searchProject.id, 'needle', 0, cancelled.signal), /abort/i)
  })
  await t.test('project tools require explicit binding, remain available beside a page, and revoke old grants', async () => {
    const before = await openChatMcpBridge(requester, [], null, { chatContext: context })
    const beforeSize = JSON.stringify(before.tools)
    assert.equal(before.tools.some(tool => tool.function.name.startsWith('workspace_')), false)
    await before.close()
    service.bind('bootstrap', threadId, project.id, false)
    const readonly = await openChatMcpBridge(requester, [], null, { chatContext: context })
    assert.equal(readonly.tools.filter(tool => tool.function.name.startsWith('workspace_')).length, 3)
    await readonly.close()
    service.bind('bootstrap', threadId, project.id, true)
    const projectOnly = await openChatMcpBridge(requester, [], null, { chatContext: context })
    const projectSize = JSON.stringify(projectOnly.tools)
    await projectOnly.close()
    const bridge = await openChatMcpBridge(requester, [], null, { chatContext: { ...context, page: { path: '/files', kind: 'files', title: 'Files', fields: [], actions: [] } as never } })
    try {
      assert.equal(bridge.tools.filter(tool => tool.function.name.startsWith('workspace_')).length, 4)
      const result = await bridge.call('workspace_read', { targets: [{ target: 'long.md' }, { target: 'folder/note.md' }] })
      assert.ok(!result.isError, JSON.stringify(result))
      const payload = JSON.parse((result.content![0] as { text: string }).text)
      assert.equal(payload.files.length, 2)
      assert.equal(payload.files[0].nextOffset, null)
      const afterSize = JSON.stringify(bridge.tools)
      t.diagnostic(`Tool definitions before=${Buffer.byteLength(beforeSize)} bytes/${rawTokenEstimate(beforeSize)} estimated tokens; project only=${Buffer.byteLength(projectSize)} bytes/${rawTokenEstimate(projectSize)} estimated tokens; project + page=${Buffer.byteLength(afterSize)} bytes/${rawTokenEstimate(afterSize)} estimated tokens. Two files (including 90KB UTF-8) read in one call.`)
      service.bind('bootstrap', threadId, null, false)
      assert.equal((await bridge.call('workspace_read', { targets: [{ target: 'long.md' }] })).isError, true)
    } finally { await bridge.close() }
    service.bind('bootstrap', threadId, project.id, true)
    const unbindBoard = BoardCallRooms.bind(threadId, 987, profile.id)
    try {
      const board = await openChatMcpBridge(requester, [], null, { chatContext: context })
      assert.equal(board.tools.some(tool => tool.function.name.startsWith('workspace_')), false)
      await board.close()
    } finally { unbindBoard() }
  })
  await t.test('page saves remain review actions and navigation remains view-only', () => {
    for (const action of ['workspace.create', 'workspace.save', 'workspace.mkdir']) assert.equal(chatPageActionTier(action), 'commit')
    assert.equal(chatPageActionTier('workspace.open'), 'view')
    assert.equal(chatPageActionAllowed('/files', 'workspace.save'), true)
    assert.equal(chatPageActionAllowed('/posts', 'workspace.save'), false)
  })
  await t.test('a changed guideline revokes the old tool snapshot before the next mutation', async () => {
    const bridge = await openChatMcpBridge(requester, [], null, { chatContext: context })
    try {
      const old = await read('AI_GUIDELINES.md')
      // Only the screen may write the guidelines: they become every connected chat's "selected by the user" instructions.
      const refused = await bridge.call('workspace_apply', { requestId: 'chat-guideline', operations: [{ kind: 'write', target: old.target, text: 'Injected', expectedRevision: old.revision }] })
      assert.match(JSON.stringify(refused.content), /화면에서만/)
      assert.equal((await apply('assistant-guideline', [{ kind: 'edit', target: old.target, expectedRevision: old.revision, edits: [{ old_text: old.text.slice(0, 5) || 'x', new_text: 'y' }] }])).status, 'failed')
      const update = await service.apply('bootstrap', project.id, 'update-guideline', [{ kind: 'write', target: old.target, text: 'New instructions', expectedRevision: old.revision }], undefined, undefined, { guidelines: true })
      assert.equal(update.status, 'completed')
      assert.equal(service.get('bootstrap', project.id).revision, project.revision + 1)
      assert.equal((await bridge.call('workspace_apply', { requestId: 'old-guideline', operations: [{ kind: 'mkdir', target: 'refused' }] })).isError, true)
      assert.equal((await service.entries('bootstrap', project.id)).entries.some(entry => entry.target === 'refused'), false)
    } finally { await bridge.close() }
  })
  await t.test('an abandoned operation is reported as interrupted without replaying its mutations', async () => {
    const operations: WorkspaceOperation[] = [{ kind: 'write', target: 'interrupted.md', text: 'once', expectedRevision: null }]
    await apply('interrupted-test', operations)
    settings.getUserSettingsDb().prepare("UPDATE workspace_operations SET status='running',process_id=2147483647 WHERE project_id=? AND request_id=?").run(project.id, 'interrupted-test')
    const result = await apply('interrupted-test', operations)
    assert.equal(result.status, 'interrupted')
    assert.equal((await read('interrupted.md')).text, 'once')
  })
  await t.test('a reused local PID does not permanently retain an interrupted writer lock', async () => {
    const operations: WorkspaceOperation[] = [{ kind: 'write', target: 'pid-reuse.md', text: 'once', expectedRevision: null }]
    await apply('pid-reuse-test', operations)
    settings.getUserSettingsDb().prepare("UPDATE workspace_operations SET status='running',process_id=? WHERE project_id=? AND request_id=?").run(process.pid, project.id, 'pid-reuse-test')
    const result = await apply('pid-reuse-test', operations)
    assert.equal(result.status, 'interrupted')
    assert.equal((await read('pid-reuse.md')).text, 'once')
    assert.equal((await apply('after-pid-reuse', [{ kind: 'mkdir', target: 'after-restart' }])).status, 'completed')
  })
  await t.test('a writer from another host cannot be presumed dead and stolen', async () => {
    const operations: WorkspaceOperation[] = [{ kind: 'write', target: 'other-host.md', text: 'original', expectedRevision: null }]
    await apply('other-host-test', operations)
    const database = settings.getUserSettingsDb()
    database.prepare("UPDATE workspace_operations SET status='running',hostname='unverified-other-host' WHERE project_id=? AND request_id=?").run(project.id, 'other-host-test')
    try {
      await assert.rejects(apply('must-not-steal', [{ kind: 'mkdir', target: 'stolen' }]), /다른 변경 작업/)
      assert.equal((await service.entries('bootstrap', project.id)).entries.some(entry => entry.target === 'stolen'), false)
    } finally {
      database.prepare("UPDATE workspace_operations SET status='completed' WHERE project_id=? AND request_id=?").run(project.id, 'other-host-test')
    }
  })
  await t.test('linked original text continuation retains its source and revision', async () => {
    const { FileStoreService } = await import('../src/services/fileStoreService')
    const { readLinked } = await import('../src/services/codex-chat/chatLinkedFiles')
    const text = '한글'.repeat(5000)
    const file = FileStoreService.writeText('bootstrap', null, 'linked-long.md', text)
    const places = [{ owner: 'bootstrap', entry: file, label: 'guide', write: false, via: 'thread' as const }]
    const first = await readLinked(places, '[guide]')
    const continuation = /offset=(\d+), source=(original|extracted), revision="([^"]+)"/.exec(first)!
    assert.ok(continuation)
    assert.equal(continuation[2], 'original')
    const remaining = await readLinked(places, '[guide]', Number(continuation[1]), { source: continuation[2] as 'original', revision: continuation[3] })
    assert.ok(remaining.includes('한글'))
    FileStoreService.updateText('bootstrap', file.id, 'changed')
    await assert.rejects(readLinked(places, '[guide]', 0, { source: 'original', revision: continuation[3] }), /변경/)
  })
  await t.test('legacy migration preserves blobs, revisions, project bindings and retries without overwrites', async () => {
    const { FileStoreService: files } = await import('../src/services/fileStoreService')
    const { FileStoreRevisions } = await import('../src/services/fileStoreRevisions')
    const { storedFilePath } = await import('../src/services/fileStorePaths')
    const file = files.writeText('account:31', null, 'legacy.md', 'before')
    files.updateText('account:31', file.id, 'after')
    const version = FileStoreRevisions.list('account:31', file.id)[0]
    const legacyProject = await service.create('account:31', 'Legacy project', 'Legacy guide')
    service.bind('bootstrap', threadId, legacyProject.id, false)
    const moves = [
      [storedFilePath('account:31', file.id), path.join(directory, 'files', 'account-31', `${file.id}.bin`)],
      [path.join(directory, 'files', '.revisions', `${version.id}.bin`), path.join(directory, 'files', '.revisions', 'account-31', `${version.id}.bin`)],
      [path.join(directory, 'workspaces', legacyProject.id), path.join(directory, 'workspaces', 'account-31', legacyProject.id)],
    ]
    for (const [source, target] of moves) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.renameSync(source, target) }
    assert.equal(files.migrateLayout().moved, 3)
    assert.equal(files.migrateLayout().moved, 0)
    assert.equal((await files.readText('account:32', file.id)).text, 'after')
    assert.equal(FileStoreRevisions.readText('account:32', file.id, version.id), 'before')
    assert.equal(service.binding('bootstrap', threadId)?.project.id, legacyProject.id)
    assert.equal((await service.read('account:32', legacyProject.id, [{ target: 'AI_GUIDELINES.md' }])).files[0].text, 'Legacy guide')
    fs.writeFileSync(moves[0][1], 'conflict')
    assert.throws(() => files.migrateLayout(), /collision/)
    assert.equal(fs.readFileSync(moves[0][0], 'utf8'), 'after')
    assert.equal(fs.readFileSync(moves[0][1], 'utf8'), 'conflict')
  })
  await t.test('screen deletes check revisions, keep the guidelines file and are not open to assistants', async () => {
    const { workspaceApplySchema, workspaceDeleteSchema } = await import('../src/services/workspaceSchemas')
    const rev = 'a'.repeat(64)
    assert.throws(() => workspaceApplySchema.parse({ requestId: 'delete-mcp-1', operations: [{ kind: 'delete', target: 'x.md', expectedRevision: rev }] }))
    assert.doesNotThrow(() => workspaceDeleteSchema.parse({ requestId: 'delete-ui-1', targets: [{ target: 'x.md', expectedRevision: rev }] }))
    assert.equal((await apply('delete-setup', [{ kind: 'mkdir', target: 'trash' }, { kind: 'write', target: 'trash/a.md', text: 'a', expectedRevision: null }, { kind: 'write', target: 'trash/b.md', text: 'b', expectedRevision: null }])).status, 'completed')
    const stale = await apply('delete-stale', [{ kind: 'delete', target: 'trash', expectedRevision: rev }])
    assert.equal(stale.status, 'failed')
    assert.ok(fs.existsSync(path.join(directory, 'workspaces', project.id, 'trash', 'a.md')))
    const folder = await service.stat('bootstrap', project.id, 'trash')
    const done = await apply('delete-folder', [{ kind: 'delete', target: 'trash', expectedRevision: folder.revision }])
    assert.deepEqual(done.results, [{ target: 'trash', deleted: true }])
    assert.equal(fs.existsSync(path.join(directory, 'workspaces', project.id, 'trash')), false)
    assert.equal((await service.entries('bootstrap', project.id, '')).entries.some(entry => entry.target.startsWith('trash')), false)
    const guide = await service.stat('bootstrap', project.id, 'AI_GUIDELINES.md')
    assert.match((await apply('delete-guide', [{ kind: 'delete', target: 'AI_GUIDELINES.md', expectedRevision: guide.revision }])).error ?? '', /지침/)
  })
  await t.test('project settings rename and rewrite the guidelines through a logged write', async () => {
    const before = service.get('bootstrap', project.id)
    await assert.rejects(service.update('bootstrap', project.id, { name: 'x', revision: before.revision + 5 }), /다시 열어/)
    const after = await service.update('bootstrap', project.id, { name: '리소스 2', guidelines: 'New guide', revision: before.revision })
    assert.equal(after.name, '리소스 2')
    assert.equal(after.guidelines, 'New guide')
    assert.equal(after.revision, before.revision + 1)
    assert.equal((await read('AI_GUIDELINES.md')).text, 'New guide')
    assert.equal(JSON.parse(service.changes('bootstrap', project.id)[0].result).results[0].target, 'AI_GUIDELINES.md')
    await service.update('bootstrap', project.id, { name: '리소스', revision: after.revision })
  })
  await t.test('a lock left by a container that is gone is reclaimed; one from a live same-host writer is not', async () => {
    const { getUserSettingsDb } = await import('../src/database/userSettingsDb')
    const insert = getUserSettingsDb().prepare("INSERT INTO workspace_operations(project_id,request_id,input_hash,status,process_id,hostname,result,created_at) VALUES(?,?,?,'running',?,?,?,?)")
    const running = JSON.stringify({ requestId: 'x', status: 'running', results: [] })
    insert.run(project.id, 'old-container', 'h', 1, 'container-gone', running, '2020-01-01 00:00:00')
    assert.equal((await apply('after-old-container', [{ kind: 'mkdir', target: 'lock-a' }])).status, 'completed')
    assert.equal(service.changes('bootstrap', project.id).find(row => row.requestId === 'old-container')?.status, 'interrupted')
    // A different host that started a minute ago may still be writing: wait for it.
    insert.run(project.id, 'other-container', 'h', 1, 'container-busy', running, new Date(Date.now() - 60_000).toISOString().slice(0, 19).replace('T', ' '))
    await assert.rejects(apply('during-other', [{ kind: 'mkdir', target: 'lock-b' }]), /진행 중/)
    getUserSettingsDb().prepare("UPDATE workspace_operations SET status='interrupted' WHERE request_id='other-container'").run()
  })
  await t.test('index and disk drift heal instead of locking a folder', async () => {
    assert.equal((await apply('drift-setup', [{ kind: 'mkdir', target: 'drift' }, { kind: 'write', target: 'drift/a.md', text: 'a', expectedRevision: null }, { kind: 'write', target: 'drift/b.md', text: 'b', expectedRevision: null }])).status, 'completed')
    fs.rmSync(path.join(directory, 'workspaces', project.id, 'drift', 'a.md'))
    // A child the disk lost no longer makes the folder unreadable, and the listing drops it from the index.
    const folder = await service.stat('bootstrap', project.id, 'drift')
    assert.deepEqual((await service.entries('bootstrap', project.id, 'drift')).entries.map(entry => entry.target), ['drift/b.md'])
    assert.notEqual((await service.stat('bootstrap', project.id, 'drift')).revision, folder.revision)
    assert.equal((await apply('drift-delete', [{ kind: 'delete', target: 'drift', expectedRevision: (await service.stat('bootstrap', project.id, 'drift')).revision }])).status, 'completed')
  })
  await t.test('search skips an unreadable file, case-only renames work and fs errors hide server paths', async () => {
    assert.equal((await apply('search-setup', [{ kind: 'write', target: 'needle-ok.md', text: 'find the needle here', expectedRevision: null }, { kind: 'write', target: 'broken.txt', text: 'x', expectedRevision: null }])).status, 'completed')
    fs.writeFileSync(path.join(directory, 'workspaces', project.id, 'broken.txt'), Buffer.from([0xc3, 0x28, 0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65]))
    const found = await service.search('bootstrap', project.id, 'needle')
    assert.ok(found.hits.some(hit => hit.target === 'needle-ok.md'))
    assert.equal(found.skippedFiles, 1)
    const note = await service.stat('bootstrap', project.id, 'needle-ok.md')
    assert.equal((await apply('case-rename', [{ kind: 'move', target: 'needle-ok.md', destination: 'Needle-OK.md', expectedRevision: note.revision }])).status, 'completed')
    assert.ok(fs.readdirSync(path.join(directory, 'workspaces', project.id)).includes('Needle-OK.md'))
    assert.equal((await read('Needle-OK.md')).text, 'find the needle here')
    const clash = await apply('mkdir-clash', [{ kind: 'mkdir', target: 'clash' }, { kind: 'mkdir', target: 'clash' }])
    assert.equal(clash.status, 'failed')
    assert.ok(!clash.error?.includes(directory), clash.error)
  })
  await t.test('a long read is shortened for a chat at a resumable offset, never as a whole-looking file', async () => {
    const { fitWorkspaceRead } = await import('../src/services/codex-chat/llmChatContext')
    const text = `﻿${'가나다라마바사'.repeat(3000)}`
    const written = await apply('long-read', [{ kind: 'write', target: 'chat-cut.md', text, expectedRevision: null }, { kind: 'write', target: 'chat-next.md', text: 'next', expectedRevision: null }])
    assert.equal(written.status, 'completed', written.error)
    const full = await service.read('bootstrap', project.id, [{ target: 'chat-cut.md', limit: 1048576 }, { target: 'chat-next.md' }])
    const fitted = JSON.parse(fitWorkspaceRead(JSON.stringify(full), 6000)!) as typeof full
    assert.ok(JSON.stringify(fitted).length <= 6000)
    const [cut] = fitted.files
    assert.ok(cut.text.length < full.files[0].text.length && cut.nextOffset !== null)
    // Reading on from the cut gives exactly the rest of the file.
    const rest = (await service.read('bootstrap', project.id, [{ target: 'chat-cut.md', offset: cut.nextOffset!, revision: cut.revision, limit: 1048576 }])).files[0]
    assert.equal(cut.text + rest.text, full.files[0].text)
    assert.deepEqual((fitted.remaining as Array<{ target: string }>).map(item => item.target), ['chat-next.md'])
  })
  await t.test('legacy duplicate names migrate once while IDs and descendants stay intact', async () => {
    const { default: Database } = await import('better-sqlite3')
    const { ensureFileStoreSchema } = await import('../src/database/fileStoreSchema')
    const database = new Database(':memory:')
    try {
      database.pragma('foreign_keys = OFF')
      ensureFileStoreSchema(database)
      database.exec('DROP INDEX idx_stored_files_shared_name')
      const insert = database.prepare("INSERT INTO stored_file_entries(id,owner_key,parent_id,name,name_key,kind) VALUES(?,?,?,?,?,'folder')")
      insert.run('a'.repeat(32), 'account:1', null, '자료', '자료')
      insert.run('b'.repeat(32), 'account:2', null, '자료', '자료')
      insert.run('c'.repeat(32), 'account:2', 'b'.repeat(32), '하위', '하위')
      ensureFileStoreSchema(database)
      const rows = database.prepare('SELECT id,parent_id,name FROM stored_file_entries ORDER BY id').all() as Array<{id:string;parent_id:string|null;name:string}>
      assert.equal(rows[0].name, '자료')
      assert.match(rows[1].name, /자료 .*이전/)
      assert.equal(rows[2].parent_id, rows[1].id)
      ensureFileStoreSchema(database)
      assert.deepEqual(database.prepare('SELECT id,parent_id,name FROM stored_file_entries ORDER BY id').all(), rows)
      assert.throws(() => insert.run('d'.repeat(32), 'account:3', null, '자료', '자료'), /UNIQUE/)
    } finally { database.close() }
  })

})
