import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { ChatPageSnapshot } from '@conai/shared'

/**
 * Board and file store tools a chat (or a bound MCP key) uses beyond writing: deleting and restoring its own posts,
 * editing and deleting its own comments, administrators' categories and comment hiding, and earlier file versions.
 * Also keeps the posts and files screens' per-request page view small (it goes with every LLM request).
 */
test('mcp posts and file version tools', { timeout: 120000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-mcp-posts-files-'))
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
    assert.ok(path.basename(root).startsWith('conai-mcp-posts-files-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const { invalidateConfiguredAuthCache } = await import('../src/services/auth/sessionAccess')
  const { AuthPermissionGroup } = await import('../src/models/AuthPermissionGroup')
  const addAccount = (name: string, permissionKeys: string[], type: 'guest' | 'admin' = 'guest') => {
    const id = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES (?, 'unused', ?)").run(name, type).lastInsertRowid)
    if (permissionKeys.length) AuthPermissionGroup.addAccountMembership(AuthPermissionGroup.createCustomGroup({ name: `${name}-group`, permissionKeys }).id, id)
    return id
  }
  const KEYS = ['posts.view', 'posts.write', 'posts.comment', 'files.view', 'files.edit']
  const writerId = addAccount('writer', KEYS)
  const otherId = addAccount('other', KEYS)
  const adminId = addAccount('admin', [...KEYS, 'posts.evaluate'], 'admin')
  invalidateConfiguredAuthCache()

  const { createMcpServer } = await import('../src/mcp/server')
  const { ALL_MCP_HTTP_SCOPES } = await import('../src/mcp/context')
  const { isContextToolAllowed } = await import('../src/mcp/toolAccess')
  const { catalogToolNames } = await import('../src/mcp/toolCatalog')
  const { Client, InMemoryTransport } = await import('@modelcontextprotocol/client')
  const { BoardCallRooms } = await import('../src/services/posts/boardCallRooms')
  const { CHAT_SCOPES } = await import('../src/services/codex-chat/chatSettings')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
  type Requester = { accountId: number; accountType: 'guest' | 'admin' }
  const connect = async (requester: Requester) => {
    const mcp = createMcpServer({ scopes: [...ALL_MCP_HTTP_SCOPES], source: 'http', requester, keyId: `test-key:${requester.accountId}` })
    const client = new Client({ name: 'posts-files-test', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)])
    t.after(async () => { await client.close(); await mcp.close() })
    return client
  }
  type McpClient = Awaited<ReturnType<typeof connect>>
  const call = async (client: McpClient, name: string, args: Record<string, unknown>) => {
    const reply = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: Array<{ text: string }> }
    return { isError: reply.isError === true, text: reply.content[0]?.text ?? '', data: reply.isError ? null : JSON.parse(reply.content[0].text) }
  }
  const names = async (client: McpClient) => (await client.listTools()).tools.map((tool) => tool.name)
  const ok = (result: Awaited<ReturnType<typeof call>>) => { assert.equal(result.isError, false, result.text); return result.data }

  const writer = await connect({ accountId: writerId, accountType: 'guest' })
  const other = await connect({ accountId: otherId, accountType: 'guest' })
  const admin = await connect({ accountId: adminId, accountType: 'admin' })
  const ADMIN_TOOLS = ['post_comment_hide', 'posts_category_create', 'posts_category_update', 'posts_category_delete']

  await t.test('posts: revisions and restore, own comments, tags, delete', async () => {
    const post = ok(await call(writer, 'posts_create', { title: '첫 판', body: '처음 본문', tags: ['일기'] }))
    ok(await call(writer, 'posts_update', { post_id: post.id, expected_revision: 1, title: '둘째 판', body: '두 번째 본문 '.repeat(40) }))
    const listed = ok(await call(writer, 'posts_revisions', { post_id: post.id }))
    assert.equal(listed.current_revision, 2)
    assert.deepEqual(listed.revisions.map((item: { revision: number }) => item.revision), [1])
    const chunk = ok(await call(writer, 'posts_revisions', { post_id: post.id, revision: 1, limit: 100 }))
    assert.equal(chunk.title, '첫 판')
    assert.equal(chunk.body, '처음 본문')
    assert.equal(chunk.next_offset, null)
    assert.equal((await call(other, 'posts_revisions', { post_id: post.id })).isError, true, 'only an editor reads earlier versions')
    assert.equal((await call(other, 'posts_revisions', { post_id: post.id, revision: 1 })).isError, true, 'selected bodies retain the same editor check')
    assert.equal((await call(writer, 'posts_revisions', { post_id: post.id, revision: 99 })).isError, true, 'a missing version never falls back to the newest one')

    assert.equal((await call(writer, 'posts_restore_revision', { post_id: post.id, revision: 1, expected_revision: 1 })).isError, true, 'stale revision refused')
    const restored = ok(await call(writer, 'posts_restore_revision', { post_id: post.id, revision: 1, expected_revision: 2 }))
    assert.equal(restored.title, '첫 판')
    assert.equal(restored.body, '처음 본문')
    assert.ok(ok(await call(writer, 'posts_revisions', { post_id: post.id })).revisions.some((item: { title: string }) => item.title === '둘째 판'), 'the restore can be undone')

    const comment = ok(await call(other, 'post_comment', { post_id: post.id, body: '좋아' }))
    assert.equal((await call(writer, 'post_comment_edit', { comment_id: comment.id, body: '남의 댓글' })).isError, true)
    assert.equal(ok(await call(other, 'post_comment_edit', { comment_id: comment.id, body: '정말 좋아' })).revision, 2)
    assert.equal((await call(writer, 'post_comment_delete', { comment_id: comment.id })).isError, true)
    ok(await call(other, 'post_comment_delete', { comment_id: comment.id }))
    assert.equal(ok(await call(writer, 'posts_read', { post_id: post.id })).comments.length, 0)

    assert.deepEqual(ok(await call(writer, 'posts_tags', {})), [{ name: '일기', posts: 1 }])
    assert.equal((await call(other, 'posts_delete', { post_id: post.id })).isError, true, 'not the writer')
    ok(await call(writer, 'posts_delete', { post_id: post.id }))
    assert.equal((await call(writer, 'posts_read', { post_id: post.id })).isError, true)
  })

  await t.test('categories and hiding: administrators acting as themselves only', async () => {
    for (const name of ADMIN_TOOLS) assert.equal((await names(writer)).includes(name), false, name)
    for (const name of ADMIN_TOOLS) assert.ok((await names(admin)).includes(name), name)
    const category = ok(await call(admin, 'posts_category_create', { name: '공지' }))
    assert.equal(ok(await call(admin, 'posts_category_update', { category_id: category.id, name: '알림', description: '중요' })).name, '알림')
    const post = ok(await call(writer, 'posts_create', { title: '글', body: '본문', category_id: category.id }))
    assert.equal((await call(admin, 'posts_category_delete', { category_id: category.id })).isError, true, 'not empty')
    const comment = ok(await call(other, 'post_comment', { post_id: post.id, body: '숨길 댓글' }))
    assert.equal(ok(await call(admin, 'post_comment_hide', { comment_id: comment.id, hidden: true })).status, 'hidden')
    assert.equal(ok(await call(writer, 'posts_read', { post_id: post.id })).comments.length, 0)
    ok(await call(writer, 'posts_delete', { post_id: post.id }))
    ok(await call(admin, 'posts_category_delete', { category_id: category.id }))
  })

  // A chat bot under an administrator account: the store refuses bots these, so they are not even offered.
  ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const profile = ChatProfileStore.create({ name: 'Board bot', engine: 'llm', providerName: 'conn', mcpEnabled: true, mcpScopes: [...CHAT_SCOPES] })
  const threadId = CodexChatStore.createThread(adminId, 'posts chat', 'llm', profile.id)
  const chatContext = (page?: ChatPageSnapshot) => ({
    scopes: [...CHAT_SCOPES] as never, source: 'codex-chat' as const, requester: { accountId: adminId, accountType: 'admin' as const },
    chatContext: { threadId, profileId: profile.id, kind: 'direct' as const, replyId: 'reply-1', ...(page ? { page } : {}) },
  })

  await t.test('a chat bot gets its own-content tools but not the administrator ones', async () => {
    const mcp = createMcpServer(chatContext())
    const client = new Client({ name: 'posts-chat-test', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)])
    try {
      const offered = new Set([...(await names(client)), ...catalogToolNames(mcp)])
      for (const name of ['posts_delete', 'posts_revisions', 'posts_restore_revision', 'post_comment_edit', 'post_comment_delete', 'posts_tags', 'list_file_versions', 'read_file_version', 'restore_file_version']) assert.ok(offered.has(name), name)
      for (const name of ADMIN_TOOLS) assert.equal(offered.has(name), false, name)
    } finally {
      await client.close()
      await mcp.close()
    }
  })

  await t.test('board-call turns never get destructive post tools or file versions', () => {
    const context = chatContext()
    for (const name of ['posts_delete', 'posts_restore_revision', 'post_comment_delete', 'list_file_versions', 'restore_file_version']) assert.ok(isContextToolAllowed(context, name), name)
    const release = BoardCallRooms.bind(threadId, 99, profile.id)
    try {
      for (const name of ['posts_delete', 'posts_restore_revision', 'post_comment_delete', 'list_file_versions', 'read_file_version', 'restore_file_version']) assert.equal(isContextToolAllowed(context, name), false, name)
      assert.ok(isContextToolAllowed(context, 'post_comment_edit'), 'a call may still fix its own answer')
    } finally {
      release()
    }
  })

  await t.test('file versions: list, read in chunks, restore; a connected page withholds them', async () => {
    const doc = ok(await call(writer, 'write_text_file', { name: '메모.md', text: '첫째' }))
    ok(await call(writer, 'update_file_text', { file_id: doc.id, text: '둘째' }))
    ok(await call(writer, 'update_file_text', { file_id: doc.id, text: '셋째' }))
    const listed = ok(await call(writer, 'list_file_versions', { file_id: doc.id }))
    assert.equal(listed.versions.length, 2)
    const oldest = listed.versions[1]
    const part = ok(await call(writer, 'read_file_version', { file_id: doc.id, version_id: oldest.id, limit: 4 }))
    assert.equal(part.text, '첫째')
    assert.equal(part.nextOffset, null)
    assert.equal((await call(other, 'list_file_versions', { file_id: doc.id })).isError, false, 'shared file versions')
    ok(await call(writer, 'restore_file_version', { file_id: doc.id, version_id: oldest.id }))
    assert.equal((await FileStoreService.readText(fileOwnerKey(writerId), doc.id, 0, 100)).text, '첫째')
    assert.equal(ok(await call(writer, 'list_file_versions', { file_id: doc.id })).versions.length, 3, 'the replaced text is kept')
    assert.equal((await call(writer, 'read_file_version', { file_id: doc.id, version_id: 'f'.repeat(32) })).isError, true)

    const page = { instanceId: 'page-files-test', connectionId: 'connection-files', path: '/files', title: '파일 보관함', kind: 'files' as const, resourceId: 'self:root', fields: [] }
    for (const name of ['list_file_versions', 'read_file_version', 'restore_file_version']) assert.equal(isContextToolAllowed(chatContext(page), name), true, name)
  })

  await t.test('posts and files screens stay small in every request', async () => {
    const { normalizeChatPageSnapshot } = await import('@conai/shared')
    const { chatPageReference, PAGE_VIEW_BUDGET } = await import('../src/services/codex-chat/chatPageContext')
    const requester = { accountId: adminId, accountType: 'admin' as const }
    const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required })
    const id = object({ id: { type: 'number', minimum: 1, integer: true } }, ['id'])
    const action = (actionId: string, label: string, description = '', schema: unknown = object({}), effect: 'draft' | 'save' = 'draft') => ({ id: actionId, label, description, schema, effect })
    // An open post as the posts page registers it (frontend posts-page.tsx), with a long body, 40 comments,
    // 20 earlier versions and 30 tags; text sizes at their caps.
    const comments = Array.from({ length: 40 }, (_, index) => ({ id: index + 1, replyTo: null, author: `작성자${index}`, bot: false, text: '댓글 '.repeat(130).slice(0, 400), ...(index % 3 ? {} : { canEdit: true }) }))
    const tags = Array.from({ length: 30 }, (_, index) => `태그${index}`)
    const posts = normalizeChatPageSnapshot({
      instanceId: 'page-posts-measure', connectionId: 'connection-posts', path: '/posts', title: '게시판', kind: 'posts', resourceId: 'post:7', revision: 'revision-posts-measure',
      fields: [
        { id: 'comment', label: '글 아래 댓글 입력칸 (@이름으로 봇 부르기)', type: 'text', value: '', allowEmpty: true },
        { id: 'replyTo', label: '답글을 달 댓글 (data.comments의 id, none은 닫기)', type: 'select', value: 'none', options: ['none', ...comments.map((comment) => String(comment.id))] },
        { id: 'reply', label: '답글 입력칸 (replyTo를 먼저 골라)', type: 'text', value: '', allowEmpty: true },
        { id: 'editComment', label: '고칠 내 댓글 id (0은 닫기)', type: 'number', value: 0, min: 0, integer: true },
      ],
      data: {
        categories: Array.from({ length: 10 }, (_, index) => ({ id: index + 1, name: `카테고리${index}`, parentId: null, posts: 3 })),
        open: { id: 7, title: '긴 글', author: 'writer', bot: false, categoryId: 1, tags: tags.slice(0, 5), status: 'published', comments: 40, canEdit: true, revision: 21, pinned: false, body: '본문 '.repeat(700).slice(0, 2000), bodyOffset: 0, bodyLength: 50_000 },
        comments,
        earlierVersions: Array.from({ length: 10 }, (_, index) => ({ revision: index + 1, title: '긴 글', at: '2026-10-11T00:00:00Z' })),
      },
      actions: [
        action('posts.category', '카테고리 보기', '카테고리(data.categories) 글 목록을 열어. all은 전체.', object({ id: { type: 'string', enum: ['all', ...Array.from({ length: 10 }, (_, index) => String(index + 1))] } }, ['id'])),
        action('posts.tag', '태그 보기', '그 태그가 붙은 글 목록을 열어.', object({ tag: { type: 'string', enum: tags } }, ['tag'])),
        action('posts.back', '목록으로', '글 목록으로 돌아가.'),
        action('posts.new', '새 글 쓰기', '새 글 편집기를 열어. 내용은 편집기 필드로 채워.'),
        action('posts.edit', '이 글 고치기', '열린 글의 편집기를 열어.'),
        action('posts.body_at', '본문 이어 읽기', 'data.open.body를 offset부터 보여줘', object({ offset: { type: 'number', minimum: 0, maximum: 49_999, integer: true } }, ['offset'])),
        action('posts.delete', '이 글 지우기', '', object({}), 'save'),
        action('posts.restore_revision', '이전 판으로 되돌리기', 'data.earlierVersions의 판', object({ revision: { type: 'number', minimum: 1, integer: true } }, ['revision']), 'save'),
        action('posts.comment_delete', '내 댓글 지우기', '', id, 'save'),
        action('posts.comment_hide', '댓글 숨기기·보이기', '', object({ id: { type: 'number', minimum: 1, integer: true }, hidden: { type: 'boolean' } }, ['id', 'hidden']), 'save'),
        action('posts.bot_cancel', '봇 호출 취소', 'data.botCalls의 id', id, 'save'),
      ],
    })
    // A long document open in the file store's editor (frontend file-text-editor.tsx).
    const document = normalizeChatPageSnapshot({
      instanceId: 'page-document-measure', connectionId: 'connection-files', path: '/files', title: '설정집.md', kind: 'files', resourceId: 'document:abc', revision: 'revision-files-measure',
      fields: [],
      data: { document: { name: '설정집.md', markdown: true, length: 400_000, saved: true, offset: 0, text: '문서 '.repeat(700).slice(0, 2000) } },
      actions: [
        action('files.doc_at', '문서 이어 읽기', 'data.document.text를 offset부터 보여줘', object({ offset: { type: 'number', minimum: 0, maximum: 399_999, integer: true } }, ['offset'])),
        action('files.doc_edit', '문서 고치기', 'whole은 전체를 바꿔. edits는 find(한 번만 나오는 글)를 replace로 차례로 바꾸고, 하나라도 안 맞으면 그대로야', object({ whole: { type: 'string', maxLength: 200_000 }, edits: { type: 'array', maxItems: 50, minItems: 0, items: object({ find: { type: 'string', maxLength: 8000 }, replace: { type: 'string', maxLength: 100_000 }, all: { type: 'boolean' } }, ['find', 'replace']) } })),
        action('files.doc_append', '문서 끝에 이어 쓰기', '', object({ text: { type: 'string', maxLength: 100_000 } }, ['text'])),
      ],
    })
    const sizes = { posts: chatPageReference(posts, requester).length, document: chatPageReference(document, requester).length }
    const { chatPageView } = await import('../src/mcp/tools/chatPageView')
    const views = { posts: JSON.stringify(chatPageView(requester, posts)).length, document: JSON.stringify(chatPageView(requester, document)).length }
    t.diagnostic(`per-request page reference: posts open post ${sizes.posts} chars (view ${views.posts}), files open document ${sizes.document} chars (view ${views.document})`)
    for (const [name, size] of Object.entries(sizes)) assert.ok(size < PAGE_VIEW_BUDGET, `${name}: ${size}`)
    // Neither long text rides along whole.
    assert.ok(!chatPageReference(posts, requester).includes('본문 '.repeat(1001)))
  })

  await t.test('knowledge MCP and connected page cannot bypass human proposal approval', async () => {
    const { PostStore } = await import('../src/services/posts/postStore')
    const { KnowledgeStore } = await import('../src/services/posts/knowledgeStore')
    const { KnowledgeProposalStore } = await import('../src/services/posts/knowledge/knowledgeProposals')
    const { actorFromRequester } = await import('../src/services/posts/postActor')
    const { getKnowledgeQuality } = await import('../src/services/posts/knowledgeAssessment')
    const { requireKnowledgePageAction, knowledgePageForExecution } = await import('../src/services/posts/knowledge/knowledgePage')
    const { normalizeChatPageSnapshot } = await import('@conai/shared')
    const human = { accountId: adminId, isAdmin: true, keys: new Set(KEYS), profileId: null, origin: 'human' as const }
    let post = PostStore.create(human, { title: '검토할 지식', body: '공개 원문을 읽고 근거를 확인한다.' })
    post = KnowledgeStore.patch(human, post.id, { expectedRevision: post.revision, enabled: true })
    const read = ok(await call(admin, 'posts_read', { post_id: post.id, comment_limit: 0 }))
    assert.equal(read.comments.length, 0)
    assert.equal(read.reference.trust, 'external_unverified')
    for (const [name, args] of [
      ['posts_update', { post_id: post.id, expected_revision: post.revision, body: '우회 변경' }],
      ['posts_delete', { post_id: post.id }],
    ] as const) {
      const denied = await call(admin, name, args)
      assert.equal(denied.isError, true, name)
      assert.match(denied.text, /posts_propose_knowledge/)
    }
    assert.ok(!await names(writer).then(tools => tools.includes('posts_assess')), 'assessment requires the explicit new permission')
    assert.equal(isContextToolAllowed({ requester: { accountId: adminId, accountType: 'admin' }, keyId: 'test-read-only', source: 'http', scopes: ['read'] }, 'posts_assess'), false)
    const assessment = ok(await call(admin, 'posts_assess', { use_id: read.reference.useId, reference_token: read.reference.referenceToken,
      stage: 'final', quality: 'down', task_fit: 'unknown', reason_code: 'error', evidence: [{ scope: 'body', start: 0, end: 5, quote: post.body.slice(0, 5) }], idempotency_key: 'external-final' }))
    assert.equal(assessment.phase, 'final')
    assert.equal(getKnowledgeQuality(human, post.id).aiEffectiveWeight, 0, 'an external client cannot claim observed execution')
    const proposal = ok(await call(admin, 'posts_propose_knowledge', { kind: 'update', post_id: post.id, base_revision: post.revision,
      base_content_version: post.knowledge!.contentVersion, title: post.title, body: '사람이 검토할 변경안', sources: [], idempotency_key: 'mcp-proposal' }))
    assert.equal(proposal.status, 'pending')
    assert.equal(PostStore.get(human, post.id).body, post.body)
    const mcpActor = actorFromRequester({ accountId: adminId, accountType: 'admin' }, null)
    assert.throws(() => KnowledgeProposalStore.apply(mcpActor, proposal.proposal_id, { expectedRevision: post.revision, contentVersion: post.knowledge!.contentVersion }), /승인|사람/)
    assert.throws(() => requireKnowledgePageAction({ path: '/posts', resourceId: `edit:${post.id}` }, 'posts.save'), { code: 'KNOWLEDGE_PROPOSAL_REQUIRED' })
    ExternalApiProvider.create({ provider_name: 'knowledge-conn', display_name: 'Knowledge', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
    const profile = ChatProfileStore.create({ name: '검토 도우미', engine: 'llm', providerName: 'knowledge-conn' })
    const threadId = CodexChatStore.createThread(adminId, '지식 근거', 'llm', profile.id)
    const page = normalizeChatPageSnapshot({ path: '/posts', kind: 'posts', title: '지식', instanceId: 'knowledge-instance', connectionId: 'knowledge-connection', resourceId: `post:${post.id}`, revision: 'knowledge-page-1', fields: [],
      data: { open: { id: post.id, body: '위조된 클라이언트 본문', bodyOffset: 0 }, comments: [] } })
    const trusted = knowledgePageForExecution({ requester: { accountId: adminId, accountType: 'admin' }, source: 'llm-chat', scopes: ['read'],
      chatContext: { threadId, profileId: profile.id, kind: 'direct', replyId: 'knowledge-reply', rootExecutionId: 'knowledge-task', knowledgeProvider: 'knowledge-conn', knowledgeModel: 'm' } }, page)
    const open = trusted.data!.open as Record<string, unknown>
    assert.equal(open.body, post.body.slice(0, '위조된 클라이언트 본문'.length))
    assert.ok(open.reference, 'the server records only the source interval it actually returns')
    const limited = knowledgePageForExecution({ requester: { accountId: adminId, accountType: 'admin' }, source: 'llm-chat', scopes: ['read'],
      chatContext: { threadId, profileId: profile.id, kind: 'direct', replyId: 'knowledge-limited-reply', rootExecutionId: 'knowledge-task', knowledgeProvider: 'knowledge-conn', knowledgeModel: 'm', knowledgeOutputLimit: 500 } }, page)
    assert.equal((limited.data!.open as Record<string, unknown>).reference, undefined, 'a connected page that exceeds the delivery budget cannot issue read evidence')
  })

  await t.test('knowledge read receipts cover only complete JSON within a 500-character runtime budget, including escaping and comment pagination',async()=>{
    const {updateChatSettings}=await import('../src/services/codex-chat/chatSettings')
    const {registerChatReply}=await import('../src/services/codex-chat/chatReplyRegistry')
    updateChatSettings({enabled:true})
    AuthPermissionGroup.addAccountMembership(AuthPermissionGroup.createCustomGroup({name:'bounded-read-chat',permissionKeys:['chat.use','chat.agent.use']}).id,adminId)
    const {PostStore,PostCommentStore}=await import('../src/services/posts/postStore')
    const {KnowledgeStore}=await import('../src/services/posts/knowledgeStore')
    const human={accountId:adminId,isAdmin:true,keys:new Set(KEYS),profileId:null,origin:'human' as const}
    let post=PostStore.create(human,{title:'긴 지식 제목'.repeat(20).slice(0,200),body:'A "\\\n🙃 escaped source. '.repeat(3000)+'UNREAD_TAIL'})
    post=KnowledgeStore.patch(human,post.id,{expectedRevision:post.revision,enabled:true,sources:[]})
    const comment=PostCommentStore.create(human,post.id,{body:'C "\\\n🙃 comment discussion. '.repeat(100)})
    const context={...chatContext(),source:'llm-chat' as const,toolCatalog:false,chatContext:{...chatContext().chatContext,replyId:'bounded-read-reply',knowledgeOutputLimit:500}}
    const closeReply=registerChatReply(context.chatContext,new AbortController().signal,()=>({replyId:context.chatContext.replyId,replyTo:null,recipients:['user']}))
    const mcp=createMcpServer(context),client=new Client({name:'bounded-read-test',version:'1'})
    const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair()
    await Promise.all([mcp.connect(serverTransport),client.connect(clientTransport)])
    try {
      const response=await call(client,'posts_read',{post_id:post.id,comment_limit:0}),first=ok(response)
      assert.ok(response.text.length<=500,response.text.length.toString())
      assert.equal(first.metadata_omitted,true)
      assert.ok(first.post.body.length>0)
      assert.equal(first.post.body,post.body.slice(first.body_offset,first.next_offset))
      assert.equal(first.body_length,post.body.length)
      assert.equal(first.reference.trust,'observed_execution')
      assert.deepEqual(first.reference.intervals,[{start:first.body_offset,end:first.next_offset}])
      assert.deepEqual(first.comments,[])
      const unread=post.body.indexOf('UNREAD_TAIL')
      const denied=await call(client,'posts_assess',{use_id:first.reference.useId,reference_token:first.reference.referenceToken,stage:'final',quality:'down',task_fit:'unknown',reason_code:'error',
        evidence:[{scope:'body',start:unread,end:unread+11,quote:'UNREAD_TAIL'}],idempotency_key:'undelivered-tail'})
      assert.equal(denied.isError,true,'an oversized original body is not read proof for the cut tail')
      const nextResponse=await call(client,'posts_read',{post_id:post.id,comment_limit:0,offset:first.next_offset,limit:100}),next=ok(nextResponse)
      assert.ok(nextResponse.text.length<=500)
      assert.equal(next.body_offset,first.next_offset)
      assert.equal(next.post.body,post.body.slice(next.body_offset,next.next_offset))
      assert.equal((user.getUserSettingsDb().prepare('SELECT COUNT(*) AS n FROM post_knowledge_uses WHERE execution_id=? AND scope=\'comment\'').get(`chat:${threadId}:reply:bounded-read-reply`) as {n:number}).n,0,'omitted comments create no receipt')
      const commentResponse=await call(client,'posts_read',{post_id:post.id,comment_id:comment.id,limit:100}),comments=ok(commentResponse)
      assert.ok(commentResponse.text.length<=500)
      assert.equal(comments.post.body,'','a targeted comment does not claim the unread body')
      assert.equal(comments.reference,undefined)
      assert.equal(comments.comments.length,1)
      const part=comments.comments[0]
      assert.equal(part.body,comment.body.slice(part.body_offset,part.next_offset))
      assert.deepEqual(part.reference.intervals,[{start:part.body_offset,end:part.next_offset}])
      assert.equal(part.reference.scope,'comment')
      const continuationResponse=await call(client,'posts_read',{post_id:post.id,comment_id:comment.id,comment_offset:part.next_offset,limit:100}),continued=ok(continuationResponse)
      assert.ok(continuationResponse.text.length<=500)
      assert.equal(continued.comments[0].body_offset,part.next_offset)
      assert.equal(continued.comments[0].body,comment.body.slice(part.next_offset,continued.comments[0].next_offset))
    } finally {closeReply();await client.close();await mcp.close()}
  })
  await t.test('shared files still require view, edit and delete permissions for guests and MCP', async () => {
    const { requireFileStoreOwner, requireFileStoreAction } = await import('../src/services/fileStoreAccess')
    const viewerId = addAccount('file-viewer', ['files.view'])
    const deniedId = addAccount('no-files', ['posts.view'])
    const viewer = { accountId: viewerId, accountType: 'guest' as const }
    const denied = { accountId: deniedId, accountType: 'guest' as const }
    const file = FileStoreService.writeText(fileOwnerKey(writerId), null, 'shared-permissions.md', 'shared')
    assert.equal(FileStoreService.get(requireFileStoreOwner(viewer), file.id).id, file.id)
    assert.throws(() => requireFileStoreOwner(denied), /권한/)
    assert.throws(() => requireFileStoreOwner(undefined), /계정/)
    assert.throws(() => requireFileStoreOwner({ accountId: null, accountType: null }), /로그인/)
    assert.throws(() => requireFileStoreAction(viewer, 'organize'), /권한/)
    assert.throws(() => requireFileStoreAction(viewer, 'delete'), /권한/)
    const noFiles = await connect(denied)
    await assert.rejects(call(noFiles, 'read_file_text', { file_id: file.id }), /not found/)
  })

})
