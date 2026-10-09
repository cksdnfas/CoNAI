import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('posts: categories, posts, tags, media refs, comments, visibility and search', { timeout: 60000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-posts-test-'))
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
    assert.ok(path.basename(root).startsWith('conai-posts-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const db = dbModule.getUserSettingsDb()
  const { PostCategoryStore, PostCommentStore, PostStore, PostTagStore } = await import('../src/services/posts/postStore')
  const { extractMediaRefs, excerptOf } = await import('../src/services/posts/postMedia')
  const { normalizePostsSettings, updatePostsSettings, loadPostsSettings } = await import('../src/services/posts/postsSettings')
  const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  type Actor = import('../src/services/posts/postActor').PostActor

  const ALL = ['posts.view', 'posts.comment', 'posts.write', 'posts.summon', 'images.view']
  const admin: Actor = { accountId: 1, isAdmin: true, keys: new Set(ALL), profileId: null }
  const alice: Actor = { accountId: 2, isAdmin: false, keys: new Set(ALL), profileId: null }
  const bob: Actor = { accountId: 3, isAdmin: false, keys: new Set(ALL), profileId: null }
  const reader: Actor = { accountId: 4, isAdmin: false, keys: new Set(['posts.view']), profileId: null }
  const status = (fn: () => unknown) => {
    try { fn(); } catch (error) { return (error as { status?: number }).status ?? 500 }
    return 200
  }

  ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const luna = ChatProfileStore.create({ name: '루나', engine: 'llm', providerName: 'conn' })
  const kai = ChatProfileStore.create({ name: '카이', engine: 'llm', providerName: 'conn' })
  const lunaAsAlice: Actor = { ...alice, profileId: luna.id }
  const kaiAsAlice: Actor = { ...alice, profileId: kai.id }

  let art = 0
  let illust = 0
  await t.test('categories: admin only, unique names, depth limit, no cycles, delete only when empty', () => {
    assert.equal(status(() => PostCategoryStore.create(alice, { name: '창작' })), 403)
    art = PostCategoryStore.create(admin, { name: '창작' }).id
    illust = PostCategoryStore.create(admin, { name: '일러스트', parentId: art }).id
    assert.equal(status(() => PostCategoryStore.create(admin, { name: '일러스트 ', parentId: art })), 409)
    let parent = illust
    for (let depth = 3; depth <= 5; depth++) parent = PostCategoryStore.create(admin, { name: `깊이${depth}`, parentId: parent }).id
    assert.equal(status(() => PostCategoryStore.create(admin, { name: '너무 깊음', parentId: parent })), 400)
    assert.equal(status(() => PostCategoryStore.update(admin, art, { parentId: illust })), 400, 'no cycle')
    assert.equal(status(() => PostCategoryStore.remove(admin, illust)), 409, 'has children')
  })

  await t.test('settings: partial updates merge, numbers clamp', () => {
    assert.equal(loadPostsSettings().safety.chainDepth, 2)
    const next = updatePostsSettings({ layout: 'sns', safety: { chainDepth: 99, botsPerComment: 0 } })
    assert.equal(next.layout, 'sns')
    assert.equal(next.safety.chainDepth, 5)
    assert.equal(next.safety.botsPerComment, 1)
    assert.equal(next.safety.repliesPerPostPerHour, 20, 'untouched fields keep their value')
    assert.equal(normalizePostsSettings({ layout: 'weird' }).layout, 'feed')
    updatePostsSettings({ layout: 'feed', safety: { chainDepth: 2, botsPerComment: 3 } })
  })

  await t.test('media refs: kinds, 32/48 hex, order, duplicates, excerpt drops embeds', () => {
    const still = 'a'.repeat(48)
    const video = 'b'.repeat(32)
    const body = `글 ![](media:${still}.png)\n![x](media:${video})\n![](audio:cand_01)\n![](group:12)\n![](media:${still})\n![](media:nothex)`
    assert.deepEqual(extractMediaRefs(body), [
      { kind: 'media', ref: still }, { kind: 'media', ref: video }, { kind: 'audio', ref: 'cand_01' }, { kind: 'group', ref: '12' },
    ])
    assert.equal(excerptOf(`# 제목\n\n**굵게** 본문 ![](media:${still}) [링크](http://x)`), '제목 굵게 본문 링크')
    assert.equal(excerptOf('| 조합 | 안정성 |\n| --- | :-: |\n| 노을 | 높음 |\n\n---\n끝'), '조합 안정성 노을 높음 끝', 'table rules and separators drop out')
  })

  let postId = 0
  let draftId = 0
  await t.test('posts: create with tags and media, drafts only for their owner, hidden only by admins', async () => {
    const still = 'c'.repeat(48)
    const post = PostStore.create(alice, { title: '벨마르 항구의 밤', body: `안개 낀 항구.\n![](media:${still})`, categoryId: illust, tags: ['#밤하늘', '벨마르', '밤하늘'] })
    postId = post.id
    assert.equal(post.status, 'published')
    assert.deepEqual(post.tags, ['밤하늘', '벨마르'])
    assert.deepEqual(post.media, [{ kind: 'media', ref: still }])
    assert.equal(post.author.type, 'account')
    assert.equal(post.canEdit, true)
    draftId = PostStore.create(alice, { title: '초안', body: '아직', status: 'draft' }).id
    assert.equal(status(() => PostStore.get(bob, draftId)), 404)
    assert.equal(PostStore.get(admin, draftId).title, '초안')
    assert.equal(status(() => PostStore.create(alice, { title: '숨김', status: 'hidden' })), 403)
    assert.equal(status(() => PostStore.create(reader, { title: '권한 없음' })), 403)
    const listed = await PostStore.list(bob, {})
    assert.deepEqual(listed.items.map((item) => item.id), [postId])
    assert.equal(listed.items[0].canEdit, false)
    assert.deepEqual((await PostStore.list(alice, { status: 'draft' })).items.map((item) => item.id), [draftId])
    assert.deepEqual((await PostStore.list(bob, { status: 'draft' })).items, [])
    assert.deepEqual((await PostStore.list(bob, { categoryId: art })).items.map((item) => item.id), [postId], 'parent category lists its children')
    assert.deepEqual((await PostStore.list(bob, { tag: '밤하늘' })).items.map((item) => item.id), [postId])
    assert.deepEqual(PostTagStore.list().map((tag) => tag.name).sort(), ['밤하늘', '벨마르'])
  })

  await t.test('edits: owner only, revision check, history kept', () => {
    assert.equal(status(() => PostStore.update(bob, postId, { title: '남의 글' })), 403)
    const edited = PostStore.update(alice, postId, { body: '안개가 걷혔다.', expectedRevision: 1 })
    assert.equal(edited.revision, 2)
    assert.equal(status(() => PostStore.update(alice, postId, { title: '늦은 수정', expectedRevision: 1 })), 409)
    assert.deepEqual(PostStore.revisions(alice, postId).map((revision) => revision.revision), [1])
    assert.equal(PostStore.update(admin, postId, { status: 'hidden' }).status, 'hidden')
    assert.equal(status(() => PostStore.get(bob, postId)), 404, 'hidden posts are gone for others')
    assert.equal(status(() => PostStore.update(alice, postId, { status: 'published' })), 403, 'only admins unhide')
    PostStore.update(admin, postId, { status: 'published' })
  })

  await t.test('bots: post as their profile, edit only their own posts', () => {
    const botPost = PostStore.create(lunaAsAlice, { title: '루나의 그림 일기', body: '오늘은 비.' }, 'chat')
    assert.equal(botPost.author.type, 'profile')
    assert.equal(botPost.author.name, '루나')
    assert.equal(botPost.author.profileId, luna.id)
    assert.equal(status(() => PostStore.update(kaiAsAlice, botPost.id, { title: '카이가 고침' })), 403, 'another bot cannot')
    assert.equal(status(() => PostStore.update(lunaAsAlice, postId, { title: '사람 글' })), 403, 'a bot cannot edit a person\'s post')
    assert.equal(PostStore.update(alice, botPost.id, { title: '사람이 고침' }).title, '사람이 고침', 'the owning account can')
    updatePostsSettings({ botPostStatus: 'draft' })
    assert.equal(PostStore.create(kaiAsAlice, { title: '검토 대기', status: 'published' }).status, 'draft', 'review setting wins')
    updatePostsSettings({ botPostStatus: 'published' })
  })

  await t.test('file embeds: only the writer\'s own files, then protected from deletion', () => {
    const own = FileStoreService.writeText(fileOwnerKey(2), null, '설정.md', '# 설정')
    const others = FileStoreService.writeText(fileOwnerKey(3), null, '비밀.md', '비밀')
    assert.equal(status(() => PostStore.create(alice, { title: '남의 파일', body: `![](file:${others.id})` })), 404)
    const withFile = PostStore.create(alice, { title: '첨부', body: `자료 ![](file:${own.id})` })
    assert.equal(PostStore.embeddedFileOwner(bob, withFile.id, own.id), fileOwnerKey(2), 'readers reach it through the post')
    assert.equal(PostStore.embeddedFileOwner(bob, withFile.id, others.id), null)
    assert.throws(() => FileStoreService.delete(fileOwnerKey(2), [own.id]), /게시물/)
    PostStore.remove(alice, withFile.id)
    FileStoreService.delete(fileOwnerKey(2), [own.id])
  })

  await t.test('comments: two levels, quotes, hidden and deleted, closed posts', () => {
    const top = PostCommentStore.create(bob, postId, { body: '좋다', mentions: [luna.id, 'x', luna.id] })
    assert.deepEqual(top.mentions, [luna.id])
    const reply = PostCommentStore.create(lunaAsAlice, postId, { body: '고마워', parentId: top.id })
    assert.equal(reply.parentId, top.id)
    assert.equal(reply.author.name, '루나')
    const deeper = PostCommentStore.create(bob, postId, { body: '또 답글', parentId: reply.id })
    assert.equal(deeper.parentId, top.id, 'stays two levels deep')
    assert.equal(deeper.quoteCommentId, reply.id)
    assert.equal(status(() => PostCommentStore.create(reader, postId, { body: '읽기만' })), 403)
    assert.equal(status(() => PostCommentStore.update(alice, top.id, { body: '남의 댓글' })), 403)
    PostCommentStore.setHidden(admin, deeper.id, true)
    assert.equal(PostCommentStore.list(reader, postId).some((comment) => comment.id === deeper.id), false)
    assert.equal(PostCommentStore.list(bob, postId).find((comment) => comment.id === deeper.id)?.status, 'hidden', 'the writer still sees it')
    PostCommentStore.remove(bob, top.id)
    const afterDelete = PostCommentStore.list(admin, postId)
    assert.equal(afterDelete.find((comment) => comment.id === top.id)?.status, 'deleted', 'kept for its replies')
    assert.equal(afterDelete.find((comment) => comment.id === top.id)?.body, '')
    assert.equal(PostStore.get(reader, postId).commentCount, 1, 'only visible comments count')
    PostStore.update(alice, postId, { commentMode: 'closed' })
    assert.equal(status(() => PostCommentStore.create(bob, postId, { body: '닫힘' })), 403)
    PostStore.update(alice, postId, { commentMode: 'open' })
  })

  await t.test('search: title, tags and text; drafts stay private', async () => {
    assert.deepEqual((await PostStore.list(bob, { q: '등대지기' })).items, [])
    PostStore.update(alice, postId, { body: '등대지기 카이가 산다.' })
    assert.deepEqual((await PostStore.list(bob, { q: '등대지기' })).items.map((item) => item.id), [postId])
    assert.deepEqual((await PostStore.list(bob, { q: '#벨마르' })).items.map((item) => item.id), [postId], 'tags are searchable')
    assert.deepEqual((await PostStore.list(bob, { q: '아직', status: 'all' })).items, [], 'someone else\'s draft')
    assert.deepEqual((await PostStore.list(alice, { q: '아직', status: 'all' })).items.map((item) => item.id), [draftId])
    // A lost search.db is filled in again on the next search.
    db.prepare("DELETE FROM search_db.search_documents WHERE source = 'post'").run()
    assert.deepEqual((await PostStore.list(bob, { q: '등대지기' })).items.map((item) => item.id), [postId])
  })

  await t.test('deleting a post removes its comments, refs and search text', async () => {
    PostStore.remove(alice, postId)
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM post_comments WHERE post_id = ?').get(postId) as { count: number }).count, 0)
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM post_media_refs WHERE post_id = ?').get(postId) as { count: number }).count, 0)
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM search_db.search_documents WHERE source = 'post' AND source_id = ?").get(String(postId)) as { count: number }).count, 0)
    assert.equal(PostCategoryStore.list().find((category) => category.id === illust)?.postCount, 0)
  })
})
