import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

test('posts bots: @ calls run as the caller, chain, limits and cancel', { timeout: 90000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const temp = path.resolve(__dirname, '../../temp')
  fs.mkdirSync(temp, { recursive: true })
  const root = fs.mkdtempSync(path.join(temp, 'conai-posts-bots-test-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  process.env.RUNTIME_UPLOADS_DIR = path.join(root, 'uploads')
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { AuthAccount } = await import('../src/models/AuthAccount')
  const { AuthAccessControlService } = await import('../src/services/authAccessControlService')
  const { AutomationSwitch } = await import('../src/services/automationSwitch')
  const { PostStore, PostCommentStore } = await import('../src/services/posts/postStore')
  const { PostBotRuns } = await import('../src/services/posts/postBotRuns')
  const { PostBotRunner } = await import('../src/services/posts/postBotRunner')
  const { updatePostsSettings } = await import('../src/services/posts/postsSettings')
  type Actor = import('../src/services/posts/postActor').PostActor

  updateChatSettings({ enabled: true })
  const KEYS = ['chat.use', 'posts.view', 'posts.comment', 'posts.write', 'posts.summon', 'images.view']
  t.mock.method(AuthAccount, 'findById', (id: number) => ({ id, username: `user${id}`, account_type: id === 1 ? 'admin' : 'guest', status: 'active' }))
  t.mock.method(AuthAccessControlService, 'resolveForAccountId', (id: number) => ({ permissionKeys: id === 9 ? ['posts.view', 'posts.comment'] : KEYS, groupKeys: [] }))
  t.mock.method(AuthAccessControlService, 'hasPermission', () => true)
  const provider = { provider_name: 'chat', display_name: 'Chat', is_enabled: true, provider_type: 'llm_openai_compatible', base_url: 'http://chat.invalid/v1', additional_config: '{}' }
  t.mock.method(ExternalApiProvider, 'findByName', (name: string) => (name === 'chat' ? provider : null))
  t.mock.method(ExternalApiProvider, 'getDecryptedKey', () => 'key')

  /** Each bot answers by the name in its system prompt; 루나 calls 카이 while `lunaCalls` says so. */
  let lunaCalls = true
  const requests: string[] = []
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    if (!init?.method || init.method === 'GET') return new Response('', { status: 404 })
    const body = JSON.parse(String(init.body))
    const system = JSON.stringify(body.messages.filter((message: { role: string }) => message.role === 'system'))
    const user = JSON.stringify(body.messages.at(-1))
    requests.push(user)
    const content = system.includes('카이') && !system.includes('루나') ? '종소리 붙였어.' : lunaCalls ? '비 오는 버전 그려볼게. @카이 효과음 부탁해' : '비 오는 버전이야.'
    return Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10 } })
  })

  const luna = ChatProfileStore.create({ name: '루나', engine: 'llm', providerName: 'chat', model: 'chat-model', summaryEnabled: false, mcpEnabled: false, systemPrompt: '너는 루나야.' })
  const kai = ChatProfileStore.create({ name: '카이', engine: 'llm', providerName: 'chat', model: 'chat-model', summaryEnabled: false, mcpEnabled: false, systemPrompt: '너는 카이야.' })
  const alice: Actor = { accountId: 2, isAdmin: false, keys: new Set(KEYS), profileId: null }
  const viewer: Actor = { accountId: 9, isAdmin: false, keys: new Set(['posts.view', 'posts.comment']), profileId: null }
  const db = () => dbModule.getUserSettingsDb()
  const runs = (postId: number) => db().prepare('SELECT * FROM post_bot_runs WHERE post_id = ? ORDER BY id').all(postId) as Array<{ id: number; profile_id: number; status: string; chain_depth: number; error: string | null; run_as_account_id: number | null; result_comment_id: number | null }>
  const settle = async (postId: number) => {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      if (!runs(postId).some((run) => run.status === 'queued' || run.status === 'running')) return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.fail('bot runs did not finish')
  }
  PostBotRunner.start()

  t.after(async () => {
    PostBotRunner.stop()
    await new Promise((resolve) => setTimeout(resolve, 100))
    dbModule.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), temp)
    assert.ok(path.basename(root).startsWith('conai-posts-bots-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  await t.test('a call becomes the bot\'s reply, run as the caller; its own @ continues the chain', async () => {
    const post = PostStore.create(alice, { title: '벨마르 항구', body: '안개 낀 항구를 그렸어.' })
    const call = PostCommentStore.create(alice, post.id, { body: '@루나 비 오는 버전도 그려줘', mentions: [luna.id] })
    await settle(post.id)
    const [first, second] = runs(post.id)
    assert.deepEqual([first.profile_id, first.status, first.chain_depth, first.run_as_account_id], [luna.id, 'done', 1, 2])
    assert.deepEqual([second.profile_id, second.status, second.chain_depth, second.run_as_account_id], [kai.id, 'done', 2, 2], 'the chain keeps the caller\'s account')
    const comments = PostCommentStore.list(alice, post.id)
    const lunaReply = comments.find((comment) => comment.id === first.result_comment_id)!
    assert.equal(lunaReply.author.name, '루나')
    assert.equal(lunaReply.parentId, call.id)
    assert.match(lunaReply.body, /@카이/)
    const kaiReply = comments.find((comment) => comment.id === second.result_comment_id)!
    assert.equal(kaiReply.parentId, call.id, 'stays under the person\'s comment')
    assert.equal(kaiReply.quoteCommentId, lunaReply.id)
    assert.match(requests.find((text) => text.includes('비 오는 버전도'))!, /Posts board call/, 'the bot is told where the call came from')
  })

  await t.test('chain depth 0: bots never call bots', async () => {
    updatePostsSettings({ safety: { chainDepth: 0 } })
    const post = PostStore.create(alice, { title: '두 번째 글', body: '' })
    PostCommentStore.create(alice, post.id, { body: '@루나 하나 더', mentions: [luna.id] })
    await settle(post.id)
    const [first, second] = runs(post.id)
    assert.equal(first.status, 'done')
    assert.equal(second.status, 'skipped')
    assert.match(second.error ?? '', /단계 한도/)
    updatePostsSettings({ safety: { chainDepth: 2 } })
  })

  await t.test('limits: bots per comment, permission, the switch, the pause, duplicates', async () => {
    lunaCalls = false
    updatePostsSettings({ safety: { botsPerComment: 1 } })
    const post = PostStore.create(alice, { title: '세 번째 글', body: '' })
    PostCommentStore.create(alice, post.id, { body: '@루나 @카이 둘 다', mentions: [luna.id, kai.id, luna.id] })
    await settle(post.id)
    assert.deepEqual(runs(post.id).map((run) => [run.profile_id, run.status]), [[luna.id, 'done'], [kai.id, 'skipped']], 'one row per bot, the second over the limit')
    updatePostsSettings({ safety: { botsPerComment: 3 } })

    PostCommentStore.create(viewer, post.id, { body: '@루나 나도 불러볼래' })
    assert.match(runs(post.id).at(-1)!.error ?? '', /권한/, 'typed @name without posts.summon')
    assert.deepEqual(PostBotRuns.mentionable(viewer), [], 'an account without chat cannot call bots either')

    updatePostsSettings({ safety: { summonEnabled: false } })
    PostCommentStore.create(alice, post.id, { body: '@카이 꺼졌지?' })
    assert.match(runs(post.id).at(-1)!.error ?? '', /꺼져/)
    updatePostsSettings({ safety: { summonEnabled: true } })

    AutomationSwitch.setPaused(true)
    PostCommentStore.create(alice, post.id, { body: '@카이 멈췄지?' })
    assert.match(runs(post.id).at(-1)!.error ?? '', /멈춰/)
    AutomationSwitch.setPaused(false)
  })

  await t.test('per-post hourly limit and cancelling a queued call', async () => {
    updatePostsSettings({ safety: { repliesPerPostPerHour: 1 } })
    const post = PostStore.create(alice, { title: '네 번째 글', body: '' })
    PostCommentStore.create(alice, post.id, { body: '@루나 첫 번째' })
    PostCommentStore.create(alice, post.id, { body: '@루나 두 번째' })
    await settle(post.id)
    assert.deepEqual(runs(post.id).map((run) => run.status), ['done', 'skipped'])
    updatePostsSettings({ safety: { repliesPerPostPerHour: 20 } })

    // Cancel before the runner picks it up (it starts on the next tick).
    PostCommentStore.create(alice, post.id, { body: '@카이 취소할게' })
    const queued = runs(post.id).at(-1)!
    const cancelled = PostBotRuns.cancel(alice, queued.id)
    assert.equal(cancelled.status, 'cancelled')
    assert.throws(() => PostBotRuns.cancel(alice, queued.id), /취소할 수 없어/, 'already finished')
    assert.equal(runs(post.id).at(-1)!.status, 'cancelled', 'the runner never starts it')
  })

  await t.test('one board room per (account, bot), reused across posts', () => {
    const rooms = db().prepare(`SELECT account_key, room_key, thread_id FROM chat_automation_rooms WHERE room_key LIKE 'posts:board:%'`).all() as Array<{ account_key: string; thread_id: number }>
    assert.equal(rooms.length, 2, '루나 and 카이 for account 2')
    for (const room of rooms) assert.match(CodexChatStore.findThreadById(room.thread_id)!.title, /^게시판 · /)
  })
})
