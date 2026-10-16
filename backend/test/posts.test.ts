import './support/testTemp'
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
  const { KnowledgeStore, findKnowledgeRow } = await import('../src/services/posts/knowledgeStore')
  const { KnowledgeAssessmentStore, getKnowledgeQuality, insertKnowledgeAssessment, knowledgeTaskFitMultiplier, knowledgeSearchTaskKey } = await import('../src/services/posts/knowledgeAssessment')
  type Actor = import('../src/services/posts/postActor').PostActor

  const ALL = ['posts.view', 'posts.comment', 'posts.write', 'posts.summon', 'images.view', 'files.view']
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
    assert.equal(next.safety.chainDepth, 20)
    assert.equal(next.safety.botsPerComment, 1)
    assert.equal(next.safety.repliesPerPostPerHour, 20, 'untouched fields keep their value')
    assert.equal(normalizePostsSettings({ layout: 'weird' }).layout, 'feed')
    assert.equal(next.topicEvaluation.autoEnabled, false, 'existing installations do not start model calls')
    const settingsPath = path.join(root, 'config', 'posts.json')
    fs.writeFileSync(settingsPath, JSON.stringify({ ...next, topicEvaluation: { ...next.topicEvaluation, dailyCallLimit: 0 } }))
    assert.equal(loadPostsSettings().topicEvaluation.dailyCallLimit, 0, 'workers observe changes written by another process')
    updatePostsSettings({ topicEvaluation: { dailyCallLimit: 20 } })
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
    const [first] = PostStore.revisions(alice, postId)
    assert.deepEqual([first.revision, first.editedByType, first.editedByAccountId], [1, 'account', alice.accountId])
    assert.ok(first.editedBy, 'the editor has a name to show')
    // Restoring is an ordinary edit back to that version: the version it replaces is kept in turn.
    const restored = PostStore.update(alice, postId, { title: first.title, body: first.body, expectedRevision: 2 })
    assert.deepEqual([restored.revision, restored.body], [3, first.body])
    assert.deepEqual(PostStore.revisions(alice, postId).map((revision) => [revision.revision, revision.body]), [[2, '안개가 걷혔다.'], [1, first.body]])
    PostStore.update(alice, postId, { body: '안개가 걷혔다.', expectedRevision: 3 })
    assert.equal(PostStore.update(admin, postId, { status: 'hidden' }).status, 'hidden')
    assert.equal(status(() => PostStore.get(bob, postId)), 404, 'hidden posts are gone for others')
    assert.equal(status(() => PostStore.update(alice, postId, { status: 'published' })), 403, 'only admins unhide')
    PostStore.update(admin, postId, { status: 'published' })
  })

  await t.test('revision summaries and selected bodies preserve ownership, retention and restore conflicts', (t) => {
    let post = PostStore.create(alice, { title: '긴 글 이력', body: '이전 본문 '.repeat(2000) })
    try {
      for (let index = 0; index < 21; index += 1) {
        post = PostStore.update(alice, post.id, { body: `판 ${index}\n${'이전 본문 '.repeat(2000)}`, expectedRevision: post.revision })
      }
      const full = PostStore.revisions(alice, post.id)
      const summaries = PostStore.revisionSummaries(alice, post.id)
      assert.equal(summaries.length, 20, 'ordinary posts retain the newest twenty versions')
      assert.deepEqual(summaries, full.map(({ body: _body, ...summary }) => summary))
      assert.ok(summaries.every((item) => !('body' in item)), 'summary responses cannot be mistaken for a full body')
      const selected = PostStore.revisions(alice, post.id, summaries[5].revision)
      assert.deepEqual(selected, [full[5]], 'a selected read returns only that version')
      assert.deepEqual(PostStore.revisions(alice, post.id, 1), [], 'pruned versions stay unavailable')
      assert.equal(status(() => PostStore.revisions(alice, post.id, 0)), 400)
      assert.equal(status(() => PostStore.revisionSummaries(bob, post.id)), 403)
      assert.equal(status(() => PostStore.revisions(bob, post.id, summaries[5].revision)), 403)
      const currentRevision = post.revision
      post = PostStore.update(alice, post.id, { title: '동시에 고친 글', expectedRevision: currentRevision })
      assert.equal(status(() => PostStore.update(alice, post.id, { title: selected[0].title, body: selected[0].body, expectedRevision: currentRevision })), 409)
      const restored = PostStore.update(alice, post.id, { title: selected[0].title, body: selected[0].body, expectedRevision: post.revision })
      assert.equal(restored.body, selected[0].body)
      t.diagnostic(`20 revisions: full JSON ${Buffer.byteLength(JSON.stringify(full))} bytes; summary JSON ${Buffer.byteLength(JSON.stringify(summaries))} bytes; selected JSON ${Buffer.byteLength(JSON.stringify(selected[0]))} bytes`)
    } finally {
      PostStore.remove(alice, post.id)
    }
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

  await t.test('file embeds: shared files with file permission, then protected from deletion', () => {
    const folder = FileStoreService.createFolder(fileOwnerKey(2), null, '첨부 자료')
    const own = FileStoreService.writeText(fileOwnerKey(2), folder.id, '설정.md', '# 설정')
    const others = FileStoreService.writeText(fileOwnerKey(3), null, '비밀.md', '비밀')
    assert.equal(status(() => PostStore.create(alice, { title: '공용 파일', body: `![](file:${others.id})` })), 200)
    assert.equal(status(() => PostStore.create({ ...alice, keys: new Set(['posts.view', 'posts.write']) }, { title: '권한 없음', body: `![](file:${others.id})` })), 403)
    const withFile = PostStore.create(alice, { title: '첨부', body: `자료 ![](file:${own.id})` })
    assert.equal(PostStore.embeddedFileOwner(bob, withFile.id, own.id), fileOwnerKey(2), 'readers reach it through the post')
    assert.equal(PostStore.embeddedFileOwner(bob, withFile.id, others.id), null)
    assert.throws(() => FileStoreService.delete(fileOwnerKey(2), [own.id]), /게시물/)
    assert.throws(() => FileStoreService.deleteTree(fileOwnerKey(2), folder.id), /게시물/)
    assert.equal(FileStoreService.get(fileOwnerKey(2), own.id).id, own.id, 'refusing a tree deletion leaves every entry live')
    PostStore.remove(alice, withFile.id)
    FileStoreService.delete(fileOwnerKey(2), [own.id])
    FileStoreService.deleteTree(fileOwnerKey(2), folder.id)
    assert.throws(() => FileStoreService.get(fileOwnerKey(2), folder.id), /찾을 수 없어/)
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

  await t.test('comment pages keep cursors, hidden ownership, deep links and quotes across large threads', (t) => {
    const post = PostStore.create(alice, { title: '댓글 페이지', body: '본문' })
    try {
      const insert = db.prepare(`INSERT INTO post_comments (post_id, parent_id, quote_comment_id, author_type, author_name, owner_account_id, body, status)
        VALUES (?, ?, ?, 'account', 'Alice', ?, ?, ?)`)
      const roots: number[] = [], replies: number[] = []
      db.transaction(() => {
        for (let index = 0; index < 85; index += 1) roots.push(Number(insert.run(post.id, null, null, alice.accountId, `댓글 ${index} ${'본문 '.repeat(300)}`, 'visible').lastInsertRowid))
        for (let index = 0; index < 995; index += 1) replies.push(Number(insert.run(post.id, roots[84], index === 994 ? replies[0] : null, alice.accountId, `답글 ${index} ${'본문 '.repeat(300)}`, 'visible').lastInsertRowid))
      })()
      PostCommentStore.setHidden(admin, replies[1], true)
      PostCommentStore.setHidden(admin, roots[0], true)
      const first = PostCommentStore.page(bob, post.id)
      assert.equal(first.comments.filter((comment) => comment.parentId === null).length, 40)
      assert.equal(first.comments.filter((comment) => comment.parentId === roots[84]).length, 40)
      assert.equal(first.context.find((comment) => comment.id === replies[0])?.body.startsWith('답글 0'), true, 'older quotes accompany the visible reply')
      assert.ok(first.nextCursor)
      let before = first.replies.find((item) => item.parentId === roots[84])!.nextCursor
      const walked = first.comments.filter((comment) => comment.parentId === roots[84]).map((comment) => comment.id)
      while (before) {
        const page = PostCommentStore.page(bob, post.id, { parentId: roots[84], before })
        walked.unshift(...page.comments.map((comment) => comment.id))
        before = page.nextCursor
      }
      assert.deepEqual(walked, replies.filter((id) => id !== replies[1]), 'equal timestamps page without duplicates or missing replies')
      assert.deepEqual(PostCommentStore.page(bob, post.id, { focusIds: [replies[1], roots[0]] }).comments, [], 'hidden targets are absent for other accounts')
      assert.ok(PostCommentStore.page(alice, post.id, { focusIds: [replies[1]] }).comments.some((item) => item.id === replies[1]), 'writers can still open hidden replies')
      const focus = PostCommentStore.page(bob, post.id, { focusIds: [roots[2], replies[0]] })
      assert.ok(focus.comments.some((item) => item.id === roots[2]))
      assert.ok(focus.comments.some((item) => item.id === roots[84]), 'an old reply brings its visible parent')
      assert.ok(focus.comments.some((item) => item.id === replies[0]))
      const oldCursor = first.nextCursor!
      PostCommentStore.remove(alice, oldCursor.id)
      PostCommentStore.create(alice, post.id, { body: '새 댓글' })
      const second = PostCommentStore.page(bob, post.id, { before: oldCursor })
      assert.ok(second.comments.every((item) => item.id < oldCursor.id), 'deleting an anchor and inserting a newer root do not move the older page')
      assert.equal(status(() => PostCommentStore.page(reader, post.id, { parentId: roots[0] })), 404)
      assert.equal(status(() => PostCommentStore.page(bob, post.id, { before: { id: 1, createdAt: 'bad' } })), 400)
      const recent = PostCommentStore.list(bob, post.id, { limit: 30, visibleOnly: true })
      assert.equal(recent.length, 30)
      assert.ok(recent.every((item) => item.status === 'visible'))
      const { chatPageActionTier, chatPageActionAllowed } = require('@conai/shared') as typeof import('@conai/shared')
      for (const action of ['posts.comments_more', 'posts.comments_at']) {
        assert.equal(chatPageActionTier(action), 'view')
        assert.equal(chatPageActionAllowed('/posts', action), true)
        assert.equal(chatPageActionAllowed('/files', action), false)
      }
      t.diagnostic(`1,080 stored comments: first page materializes ${first.comments.length} displayed comments and ${first.context.length} quote; selected MCP read materializes ${recent.length}`)
    } finally { PostStore.remove(alice, post.id) }
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

  await t.test('search: words all in one visible comment find its post, and say which comment', async () => {
    const comment = PostCommentStore.create(bob, postId, { body: '방파제 끝에서 **노을** 봤어' })
    const found = (await PostStore.list(reader, { q: '방파제 노을' })).items
    assert.deepEqual(found.map((item) => item.id), [postId])
    assert.equal(found[0].matchedComment?.id, comment.id)
    assert.match(found[0].matchedComment?.excerpt ?? '', /방파제 끝에서 노을 봤어/, 'plain text, not Markdown')
    assert.deepEqual((await PostStore.list(reader, { q: '등대지기 방파제' })).items, [], 'words split between the post and a comment do not match')
    assert.equal((await PostStore.list(reader, { q: '등대지기' })).items[0]?.matchedComment, undefined, 'a post that matches itself points at no comment')
    PostCommentStore.setHidden(admin, comment.id, true)
    assert.deepEqual((await PostStore.list(reader, { q: '방파제 노을' })).items, [], 'hidden comments are not searched')
    PostCommentStore.setHidden(admin, comment.id, false)
    assert.deepEqual((await PostStore.list(reader, { q: '방파제 노을' })).items.map((item) => item.id), [postId], 'shown again')
  })

  await t.test('deleting a post removes its comments, refs and search text', async () => {
    PostStore.remove(alice, postId)
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM post_comments WHERE post_id = ?').get(postId) as { count: number }).count, 0)
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM post_media_refs WHERE post_id = ?').get(postId) as { count: number }).count, 0)
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM search_db.search_documents WHERE source = 'post' AND source_id = ?").get(String(postId)) as { count: number }).count, 0)
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM search_db.search_documents WHERE source = 'post_comment'").get() as { count: number }).count, 0, 'its comments too')
    assert.equal(PostCategoryStore.list().find((category) => category.id === illust)?.postCount, 0)
  })

  const voter: Actor = { ...alice, keys: new Set([...ALL, 'posts.evaluate']) }
  let knowledgeId = 0
  let knowledgeFileId = ''
  await t.test('knowledge: stable ID, immutable content versions, aliases, sources and common AI mutation boundary', async () => {
    assert.equal(loadPostsSettings().knowledge.autoEvaluationEnabled, false)
    assert.equal(loadPostsSettings().knowledge.rankingEnabled, false)
    const source = PostStore.create(alice, { title: '출처', body: '확인된 해결 방법' })
    const commentParent = PostStore.create(alice,{title:'댓글 출처의 부모',body:'부모 본문'})
    const sourceComment=PostCommentStore.create(alice,commentParent.id,{body:'댓글의 해결 방법'})
    const newerParent=KnowledgeStore.patch(alice,commentParent.id,{expectedRevision:commentParent.revision})
    assert.notEqual(newerParent.revision,sourceComment.revision)
    const commentDocument=PostStore.create(alice,{title:'댓글에서 정리한 지식'})
    const fromComment=KnowledgeStore.patch(alice,commentDocument.id,{expectedRevision:commentDocument.revision,sources:[{kind:'comment',commentId:sourceComment.id,quote:'해결 방법'}]})
    assert.equal(fromComment.knowledgeSources?.[0].revision,sourceComment.revision,'comment citations use their own revision, not the parent post revision')
    PostCommentStore.update(alice,sourceComment.id,{body:'댓글이 나중에 바뀜',expectedRevision:sourceComment.revision})
    const commentEdited=PostStore.update(alice,fromComment.id,{body:'문서 보완',expectedRevision:fromComment.revision})
    const commentRestored=KnowledgeStore.restoreVersion(alice,fromComment.id,1,{expectedRevision:commentEdited.revision})
    assert.equal(commentRestored.knowledgeSources?.[0].contentHash,fromComment.knowledgeSources?.[0].contentHash,'an exact server-validated public comment citation remains pinned after comment edits')
    const privateSource = PostStore.create(alice, { title: '비공개 출처', body: '개인 기록', status: 'draft' })
    knowledgeFileId=FileStoreService.writeText(fileOwnerKey(2),null,'knowledge-evidence.md','공개 승인 자료').id
    const post = PostStore.create(alice, { title: '지식 첫 제목', body: `해결 절차 [출처](post:${source.id})\n\n\
\`\`\`md\n[예시](post:${privateSource.id})\n\`\`\`\n\`[인라인](post:${privateSource.id})\`\n[[미해결 문서]]\n![](file:${knowledgeFileId})` })
    knowledgeId = post.id
    assert.equal(status(() => KnowledgeStore.patch(alice, post.id, { enabled: true })), 400)
    assert.equal(status(() => KnowledgeStore.patch(alice, post.id, { expectedRevision: post.revision, sources: [{ kind: 'post', postId: privateSource.id, quote: '개인 기록' }] })), 403)
    const designated = KnowledgeStore.patch(alice, post.id, { expectedRevision: post.revision, enabled: true, sources: [{ kind: 'post', postId: source.id, quote: '해결 방법' }] })
    assert.equal(designated.id, post.id)
    assert.equal(designated.knowledge?.contentVersion, 1)
    assert.deepEqual(KnowledgeStore.links(alice, post.id).links.map(link => link.postId), [source.id, null], 'code sample links are ignored')
    assert.equal(status(() => PostStore.update({ ...admin, origin: 'mcp' }, post.id, { title: 'MCP가 직접 고침', expectedRevision: designated.revision })), 403)
    assert.equal(status(() => KnowledgeStore.patch({ ...admin, origin: 'mcp' }, post.id, { expectedRevision: designated.revision, enabled: false })), 403)
    assert.equal(status(() => PostStore.remove({ ...admin, origin: 'mcp' }, post.id, { expectedRevision: designated.revision })), 403)
    assert.equal(status(() => PostStore.update(alice, post.id, { title: '판 누락' })), 400)
    KnowledgeStore.review(admin, post.id, { contentVersion: 1, action: 'verify', reason: '원문 검수' })
    const metadata = PostStore.update(alice, post.id, { pinned: false, expectedRevision: designated.revision })
    assert.equal(metadata.knowledge?.contentVersion, 1)
    assert.equal(metadata.knowledge?.reviewStatus, 'verified')
    const renamed = PostStore.update(alice, post.id, { title: '지식 둘째 제목', expectedRevision: metadata.revision })
    assert.equal(renamed.knowledge?.contentVersion, 2)
    assert.equal(renamed.knowledge?.reviewStatus, 'needs_review')
    assert.deepEqual(KnowledgeStore.links(alice, post.id).aliases, ['지식 첫 제목'])
    assert.equal(KnowledgeStore.versions(alice, post.id).length, 2)
    assert.throws(() => db.prepare('UPDATE post_knowledge_versions SET title=? WHERE post_id=?').run('변조', post.id), /immutable/)
    const privateKnowledge = KnowledgeStore.patch(alice, privateSource.id, { expectedRevision: privateSource.revision })
    KnowledgeAssessmentStore.vote(voter,privateSource.id,{contentVersion:1,idempotencyKey:'private-draft-vote',quality:'down',reason:'개인 기록에 대한 비공개 설명',evidenceQuote:'개인 기록'})
    KnowledgeStore.review(voter,privateSource.id,{contentVersion:1,action:'report_error',reason:'개인 기록에 대한 비공개 오류',evidenceQuote:'개인 기록'})
    let publishedSource = PostStore.update(alice, privateSource.id, { body: '공개 기록', expectedRevision: privateKnowledge.revision })
    publishedSource = PostStore.update(alice, privateSource.id, { status: 'published', expectedRevision: publishedSource.revision })
    assert.equal(getKnowledgeQuality(reader,privateSource.id).reasons.length,0,'later publication does not expose private draft vote text')
    const reviewOnly: Actor = {...reader,keys:new Set(['posts.view','posts.knowledge.review'])}
    const priorIssue=(await KnowledgeStore.reviewQueue(reviewOnly)).items.find(item=>item.post.id===privateSource.id)!.issues[0]
    assert.equal(priorIssue.evidenceQuote,'','review permission does not disclose an old private body')
    assert.equal(priorIssue.evidenceAvailable,false)
    const target = PostStore.create(alice, { title: '과거 출처 접근 검수' })
    assert.equal(status(() => KnowledgeStore.patch(alice, target.id, { expectedRevision: target.revision, sources: [{ kind: 'post', postId: privateSource.id, contentVersion: 1, quote: '개인 기록' }] })), 403, 'published current document does not expose a historical private body')
    assert.equal(KnowledgeStore.patch(alice, target.id, { expectedRevision: target.revision, sources: [{ kind: 'post', postId: privateSource.id, contentVersion: publishedSource.knowledge!.contentVersion, quote: '공개 기록' }] }).knowledge?.contentVersion, 1)
    const withReplacement=KnowledgeStore.patch(alice,post.id,{expectedRevision:renamed.revision,replacementPostId:target.id})
    assert.equal(withReplacement.knowledge?.replacementPostId,target.id)
    const replacement=PostStore.get(admin,target.id)
    PostStore.update(admin,target.id,{status:'hidden',expectedRevision:replacement.revision})
    assert.equal(PostStore.get(reader,post.id).knowledge?.replacementPostId,null,'a subsequently hidden replacement is not disclosed')
    PostStore.update(alice,source.id,{commentMode:'closed'})
  })

  await t.test('knowledge votes: idempotent immutable ledger, latest head, nonstacking history and same-hash restore', () => {
    const post = PostStore.get(voter, knowledgeId)
    assert.equal(status(() => KnowledgeAssessmentStore.vote(reader, post.id, { contentVersion: 2, idempotencyKey: 'no-permission', quality: 'down' })), 403)
    const first = KnowledgeAssessmentStore.vote(voter, post.id, { contentVersion: 2, idempotencyKey: 'vote-1', quality: 'down', reason: '절차 오류' })
    assert.equal(first.down, 1)
    assert.ok(Math.abs(first.qualityMultiplier - 0.86) < 1e-9)
    const replay = KnowledgeAssessmentStore.vote(voter, post.id, { contentVersion: 2, idempotencyKey: 'vote-1', quality: 'down', reason: '절차 오류' })
    assert.equal(replay.ownVote?.eventId, first.ownVote?.eventId)
    assert.equal(status(() => KnowledgeAssessmentStore.vote(voter, post.id, { contentVersion: 2, idempotencyKey: 'vote-1', quality: 'up' })), 409)
    assert.throws(() => db.prepare('UPDATE post_assessment_events SET quality=? WHERE id=?').run('up', first.ownVote?.eventId), /immutable/)
    const changed = KnowledgeAssessmentStore.vote(voter, post.id, { contentVersion: 2, idempotencyKey: 'vote-2', quality: 'up' })
    assert.deepEqual([changed.up, changed.down], [1, 0])
    const withdrawn = KnowledgeAssessmentStore.withdraw(voter, post.id, { contentVersion: 2, idempotencyKey: 'vote-3' })
    assert.deepEqual([withdrawn.up, withdrawn.down], [0, 0])
    KnowledgeAssessmentStore.vote(voter, post.id, { contentVersion: 2, idempotencyKey: 'vote-4', quality: 'down' })
    let edited = PostStore.update(voter, post.id, { body: `${post.body}\n수정 1`, expectedRevision: post.revision })
    assert.deepEqual([edited.knowledgeQuality?.current.human.down, edited.knowledgeQuality?.history.down], [0, 0.25])
    edited = PostStore.update(voter, post.id, { body: `${post.body}\n수정 2`, expectedRevision: edited.revision })
    assert.equal(edited.knowledgeQuality?.history.down, 0.25, 'historical score is not added once per version')
    KnowledgeAssessmentStore.vote(voter, post.id, { contentVersion: edited.knowledge!.contentVersion, idempotencyKey: 'vote-new-content', quality: 'up' })
    assert.equal(getKnowledgeQuality(voter, post.id).history.down, 0, 'same person replaces their old contribution')
    const restored = KnowledgeStore.restoreVersion(voter, post.id, 2, { expectedRevision: edited.revision })
    assert.equal(restored.knowledge?.contentHash, post.knowledge?.contentHash)
    assert.equal(restored.knowledgeQuality?.current.human.down, 1, 'the original content hash reuses its evaluations')
  })

  await t.test('knowledge errors survive edits and require explicit review resolution', () => {
    const post = PostStore.get(voter, knowledgeId)
    const reported = KnowledgeStore.review(voter, post.id, { contentVersion: post.knowledge!.contentVersion, action: 'report_error', reason: '오류 위치', evidenceQuote: '해결 절차' })
    const issue = reported.issues.find(item => !item.resolvedAt)!
    const edited = PostStore.update(voter, post.id, { body: `${post.body}\n보완`, expectedRevision: post.revision })
    assert.equal(edited.knowledge?.reviewStatus, 'needs_review')
    assert.equal(status(() => KnowledgeStore.review(admin, post.id, { contentVersion: edited.knowledge!.contentVersion, action: 'verify' })), 409)
    assert.equal(status(() => KnowledgeStore.review(voter, post.id, { contentVersion: edited.knowledge!.contentVersion, action: 'resolve_issue', issueId: issue.id, reason: '해결' })), 403)
    KnowledgeStore.review(admin, post.id, { contentVersion: edited.knowledge!.contentVersion, action: 'resolve_issue', issueId: issue.id, reason: '절차를 원문과 대조해 수정 확인' })
    KnowledgeStore.review(admin, post.id, { contentVersion: edited.knowledge!.contentVersion, action: 'verify', reason: '검수 완료' })
    assert.equal(PostStore.get(voter, post.id).knowledge?.reviewStatus, 'verified')
    assert.throws(() => db.prepare('UPDATE post_review_events SET reason=? WHERE id=?').run('조용히 삭제', issue.id), /immutable/)
  })

  await t.test('automatic contributions: conflicting bundle, daily family cap, global cap and provisional retry', () => {
    const post = PostStore.create(alice, { title: '자동 평가 상한', body: '평가 근거' })
    const designated = KnowledgeStore.patch(alice, post.id, { expectedRevision: post.revision })
    const base = { postId: post.id, contentVersion: 1, contentHash: designated.knowledge!.contentHash, accountKey: 'account:2', purpose: 'usage', evaluatorFamily: 'provider/model', rootExecutionId: 'root-0', phase: 'final' as const, useId: 'trusted-use', evidenceSufficient: true, executionStartedAt: '2026-10-12T00:00:00Z' }
    insertKnowledgeAssessment({ ...base, evaluator: 'use_ai', quality: 'up', idempotencyKey: 'auto-up' })
    insertKnowledgeAssessment({ ...base, evaluator: 'judge', quality: 'down', idempotencyKey: 'judge-down' })
    let stats = getKnowledgeQuality(alice, post.id)
    assert.ok(Math.abs(stats.up - 1/6) < 1e-9)
    assert.ok(Math.abs(stats.down - 1/3) < 1e-9)
    assert.equal(stats.independentCount, 1)
    insertKnowledgeAssessment({ ...base, rootExecutionId: 'fit-root',taskKey: 'fit-root',evaluator: 'use_ai',quality: 'abstain',taskFit: 'unsuitable',phase: 'provisional',idempotencyKey: 'private-provisional-fit' })
    assert.equal(getKnowledgeQuality(alice, post.id).down, stats.down, 'provisional fit does not affect global quality')
    assert.ok(knowledgeTaskFitMultiplier(alice,post.id,'fit-root','fit-root') < 1, 'provisional fit affects only its current execution')
    assert.equal(knowledgeTaskFitMultiplier(alice,post.id,'fit-root'),1,'provisional fit never transfers to another execution')
    assert.equal(knowledgeTaskFitMultiplier(bob,post.id,'fit-root'), 1, 'another account does not inherit private task fit')
    assert.equal(knowledgeTaskFitMultiplier(alice,post.id,'unrelated-root'), 1)
    insertKnowledgeAssessment({ ...base, evaluator: 'judge', quality: 'up', phase: 'provisional', idempotencyKey: 'judge-late-provisional' })
    assert.equal(getKnowledgeQuality(alice, post.id).down, stats.down, 'late provisional never replaces a final assessment')
    for (let index = 1; index < 8; index++) insertKnowledgeAssessment({ ...base, rootExecutionId: `root-${index}`, evaluator: 'judge', quality: 'down', idempotencyKey: `daily-${index}` })
    stats = getKnowledgeQuality(alice, post.id)
    assert.equal(stats.aiEffectiveWeight, 1.5, 'same family contributes only three root executions daily')
    for (let index = 0; index < 12; index++) insertKnowledgeAssessment({ ...base, rootExecutionId: `family-root-${index}`, evaluatorFamily: `provider/model-${index}`, evaluator: 'judge', quality: 'down', idempotencyKey: `global-${index}` })
    stats = getKnowledgeQuality(alice, post.id)
    assert.ok(Math.abs(stats.aiEffectiveWeight - 2) < 1e-9, 'all automation capped without human votes')
    assert.equal(stats.current.judge.rawCount, 20)
    assert.equal(findKnowledgeRow(post.id)?.review_status,'needs_review','grounded automatic negatives enter the persistent review queue')
    insertKnowledgeAssessment({ ...base,rootExecutionId:'private-root',taskKey:'private-root',evaluator:'judge',quality:'down',taskFit:'unsuitable',publicReason:false,idempotencyKey:'private-automatic-opinion' })
    const afterPrivate=getKnowledgeQuality(bob,post.id)
    assert.equal(afterPrivate.current.judge.rawCount,stats.current.judge.rawCount,'private automatic records do not reveal execution counts in public aggregates')
    assert.equal(afterPrivate.qualityMultiplier,stats.qualityMultiplier,'private automatic quality does not affect other users searches')
    assert.ok(knowledgeTaskFitMultiplier(alice,post.id,'private-root')<1)
    const queryKey=knowledgeSearchTaskKey('Linux ERR-2026')
    assert.equal(queryKey,knowledgeSearchTaskKey('  linux   ERR-2026  '))
    insertKnowledgeAssessment({...base,rootExecutionId:'query-root',taskKey:queryKey,evaluator:'use_ai',quality:'abstain',taskFit:'unsuitable',publicReason:false,idempotencyKey:'query-fit'})
    assert.ok(knowledgeTaskFitMultiplier(alice,post.id,knowledgeSearchTaskKey('linux err-2026'))<1,'final fit transfers to the same actual query')
    assert.equal(knowledgeTaskFitMultiplier(alice,post.id,knowledgeSearchTaskKey('windows err-2026')),1,'other query conditions do not inherit the penalty')
    assert.equal(knowledgeTaskFitMultiplier(bob,post.id,queryKey),1,'query fit remains private to its execution account')
  })

  await t.test('knowledge search: verified negative score applies within relevance bands, and snapshots preserve pagination', async () => {
    updatePostsSettings({ knowledge: { rankingEnabled: true } })
    const make = (title: string) => {
      const post = PostStore.create(alice, { title, body: '순위검수 오류코드 ERR-2026 해결' })
      return KnowledgeStore.patch(alice, post.id, { expectedRevision: post.revision })
    }
    const bad = make('순위검수 나쁜 문서'), good = make('순위검수 좋은 문서'), exact = make('순위검수')
    KnowledgeStore.review(admin, bad.id, { contentVersion: 1, action: 'verify' })
    KnowledgeAssessmentStore.vote(voter, bad.id, { contentVersion: 1, quality: 'down', idempotencyKey: 'rank-down' })
    const first = await PostStore.list(reader, { q: '순위검수', kind: 'knowledge', sort: 'relevance', limit: 1 })
    assert.equal(first.items[0]?.id, exact.id, 'exact title remains discoverable')
    assert.ok(first.snapshot)
    const second = await PostStore.list(reader, { q: '순위검수', kind: 'knowledge', sort: 'relevance', limit: 1, offset: 1, snapshot: first.snapshot })
    assert.equal(second.items[0]?.id, good.id)
    KnowledgeAssessmentStore.vote(voter, good.id, { contentVersion: 1, quality: 'down', idempotencyKey: 'rank-reorder' })
    const third = await PostStore.list(reader, { q: '순위검수', kind: 'knowledge', sort: 'relevance', limit: 1, offset: 2, snapshot: first.snapshot })
    assert.equal(third.items[0]?.id, bad.id, 'votes after page one cannot duplicate or omit results across that snapshot')
    assert.equal(third.scoreVersion, first.scoreVersion)
    assert.deepEqual((await PostStore.list(reader, { q: '지식 첫 제목', kind: 'knowledge' })).items.map(item => item.id), [knowledgeId], 'old title alias is searchable')
    updatePostsSettings({ knowledge: { rankingEnabled: false } })
  })

  await t.test('knowledge trash preserves body, revisions, attachments and assessments, including when feature disabled', async () => {
    let post = PostStore.get(voter, knowledgeId)
    const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE post_id=?`).get(post.id) as { n: number }).n
    const before = [count('post_knowledge_versions'),count('post_assessment_events'),count('post_review_events')]
    const mediaBefore=count('post_media_refs')
    assert.equal(status(() => PostStore.remove(voter, post.id)), 400)
    updatePostsSettings({ knowledge: { enabled: false } })
    assert.equal(status(() => PostStore.update({ ...admin, origin: 'mcp' }, post.id, { body: '스위치 우회', expectedRevision: post.revision })), 403)
    PostStore.remove(voter, post.id, { expectedRevision: post.revision })
    assert.equal(status(() => PostStore.get(reader, post.id)), 404)
    assert.equal((await PostStore.list(reader, { q: '지식 둘째 제목' })).total, 0)
    assert.ok(findKnowledgeRow(post.id)?.deleted_at)
    assert.equal(count('post_knowledge_versions'), before[0])
    assert.equal(count('post_assessment_events'), before[1])
    assert.equal(count('post_review_events'), before[2]+1)
    assert.equal(count('post_media_refs'),mediaBefore)
    assert.throws(()=>FileStoreService.delete(fileOwnerKey(2),[knowledgeFileId]),/게시물/,'trashed knowledge still protects its attachment file')
    const trash = await PostStore.list(voter, { deleted: 'only', status: 'all' })
    assert.ok(trash.items.some(item => item.id===post.id))
    const revision = trash.items.find(item => item.id===post.id)!.revision
    assert.equal(status(() => KnowledgeStore.restore({ ...admin, origin: 'mcp' }, post.id, { expectedRevision: revision })), 403)
    post = KnowledgeStore.restore(voter, post.id, { expectedRevision: revision })
    assert.equal(post.knowledge?.deletedAt, null)
    assert.equal(PostStore.embeddedFileOwner(reader,post.id,knowledgeFileId),fileOwnerKey(2))
    assert.equal(count('post_assessment_events'), before[1])
    updatePostsSettings({ knowledge: { enabled: true } })
    assert.equal(KnowledgeStore.export(voter, post.id).markdown, post.body)
    const attachmentVersion=post.knowledge!.contentVersion
    const withoutFile=PostStore.update(voter,post.id,{body:post.body.replace(`![](file:${knowledgeFileId})`,''),expectedRevision:post.revision})
    assert.equal(PostStore.embeddedFileOwner(reader,post.id,knowledgeFileId),null,'an old private-version file is not granted by the current body')
    assert.equal(PostStore.embeddedKnowledgeVersionFileOwner(voter,post.id,attachmentVersion,knowledgeFileId),fileOwnerKey(2))
    assert.equal(status(()=>PostStore.embeddedKnowledgeVersionFileOwner(reader,post.id,attachmentVersion,knowledgeFileId)),403,'history files require editor authority and an explicit version')
    assert.throws(()=>FileStoreService.delete(fileOwnerKey(2),[knowledgeFileId]),/게시물/,'removing the current embed cannot delete a file preserved in immutable knowledge history')
    post=KnowledgeStore.restoreVersion(voter,post.id,attachmentVersion,{expectedRevision:withoutFile.revision})
    assert.equal(PostStore.embeddedFileOwner(reader,post.id,knowledgeFileId),fileOwnerKey(2),'restoring the body restores its original file provenance')
  })
  await t.test('human task fit is bound to a real search, private to the account and leaves the quality opinion intact', async()=>{
    updatePostsSettings({knowledge:{rankingEnabled:true}})
    const make=(title:string)=>{
      const post=PostStore.create(voter,{title,body:'조건검수 Linux ERR-2026 절차'})
      return KnowledgeStore.patch(voter,post.id,{expectedRevision:post.revision})
    }
    const first=make('실행 조건 A'),second=make('실행 조건 B')
    KnowledgeAssessmentStore.vote(voter,second.id,{contentVersion:1,quality:'up',idempotencyKey:'fit-quality-up'})
    const searched=await PostStore.list(voter,{q:'조건검수',sort:'relevance'})
    assert.equal(searched.items[0].id,second.id)
    const token=searched.items.find(item=>item.id===second.id)!.knowledgeSearchReceipt!.token
    const fit=KnowledgeAssessmentStore.taskFit(voter,second.id,{contentVersion:1,searchReceiptToken:token,taskFit:'unsuitable',reasonCode:'scope_mismatch',reason:'이 검색 조건에서는 범위가 맞지 않음',idempotencyKey:'fit-down'})
    assert.equal(KnowledgeAssessmentStore.taskFit(voter,second.id,{contentVersion:1,searchReceiptToken:token,taskFit:'unsuitable',reasonCode:'scope_mismatch',reason:'이 검색 조건에서는 범위가 맞지 않음',idempotencyKey:'fit-down'}).eventId,fit.eventId)
    const quality=getKnowledgeQuality(voter,second.id)
    assert.deepEqual([quality.up,quality.down,quality.ownVote?.quality],[1,0,'up'])
    assert.equal(KnowledgeAssessmentStore.ownTaskFit(voter,second.id,token)?.taskFit,'unsuitable')
    const ranked=await PostStore.list(voter,{q:'조건검수',sort:'relevance'})
    assert.deepEqual(ranked.items.map(item=>item.id),[first.id,second.id])
    assert.equal((await PostStore.list(voter,{q:'ERR-2026',sort:'relevance'})).items[0].id,second.id,'another actual query does not inherit the penalty')
    assert.equal((await PostStore.list(bob,{q:'조건검수',sort:'relevance'})).items[0].id,second.id,'other accounts only see the global quality opinion')
    assert.equal(status(()=>KnowledgeAssessmentStore.ownTaskFit(bob,second.id,token)),404)
    assert.equal(status(()=>KnowledgeAssessmentStore.vote(voter,second.id,{contentVersion:1,quality:'down',reasonCode:'scope_mismatch',idempotencyKey:'unbound-fit'})),400)
    KnowledgeAssessmentStore.taskFit(voter,second.id,{contentVersion:1,searchReceiptToken:token,taskFit:'unknown',idempotencyKey:'fit-withdraw'})
    assert.equal((await PostStore.list(voter,{q:'조건검수',sort:'relevance'})).items[0].id,second.id)
    PostStore.update(voter,second.id,{body:'조건검수 변경된 절차',expectedRevision:second.revision})
    assert.equal(status(()=>KnowledgeAssessmentStore.taskFit(voter,second.id,{contentVersion:2,searchReceiptToken:token,taskFit:'unsuitable',idempotencyKey:'old-hash-fit'})),409)
    updatePostsSettings({knowledge:{rankingEnabled:false}})
  })

  await t.test('AI moderation appends immutable audit, rejects stale or human targets and survives model retries',()=>{
    const created=PostStore.create(voter,{title:'평가 정정 검수',body:'확인할 절차 근거'})
    const post=KnowledgeStore.patch(voter,created.id,{expectedRevision:created.revision})
    const base={postId:post.id,contentVersion:1,contentHash:post.knowledge!.contentHash,evaluator:'use_ai' as const,accountKey:'account:2',evaluatorFamily:'provider/model',rootExecutionId:'moderation-root',purpose:'usage',quality:'down' as const,phase:'final' as const,useId:'trusted-moderation-use',evidenceQuote:'절차 근거',taskKey:knowledgeSearchTaskKey('평가 정정')}
    const original=insertKnowledgeAssessment({...base,idempotencyKey:'original-moderation-target'})
    const input={action:'correct',expectedHeadEventId:original,quality:'up',reason:'원문과 결과를 대조하여 기존 부정 평가가 틀렸음을 확인',idempotencyKey:'review-correction'}
    assert.equal(status(()=>KnowledgeAssessmentStore.moderate(voter,post.id,original,input)),403)
    assert.equal(status(()=>KnowledgeAssessmentStore.moderate({...admin,origin:'mcp'},post.id,original,input)),403)
    const corrected=KnowledgeAssessmentStore.moderate(admin,post.id,original,input)
    assert.equal(corrected.quality.current.useAi.up,0.25)
    assert.equal((db.prepare('SELECT quality FROM post_assessment_events WHERE id=?').get(original) as {quality:string}).quality,'down')
    assert.equal(corrected.assessment.supersedesEventId,original)
    assert.equal(corrected.assessment.eventKind,'correction')
    assert.equal(KnowledgeAssessmentStore.moderate(admin,post.id,original,input).assessment.eventId,corrected.assessment.eventId)
    assert.equal(status(()=>KnowledgeAssessmentStore.moderate(admin,post.id,original,{...input,idempotencyKey:'stale-moderation'})),409)
    assert.equal(status(()=>KnowledgeAssessmentStore.moderate(admin,post.id,original,{...input,quality:'down'})),409)
    insertKnowledgeAssessment({...base,idempotencyKey:'late-automatic-retry'})
    insertKnowledgeAssessment({...base,taskKey:knowledgeSearchTaskKey('다른 평가 조건'),idempotencyKey:'another-condition-retry'})
    assert.equal(getKnowledgeQuality(voter,post.id).current.useAi.up,0.25,'automated retries or condition changes cannot undo an explicit correction')
    const invalid=KnowledgeAssessmentStore.moderate(admin,post.id,corrected.assessment.eventId,{action:'invalidate',expectedHeadEventId:corrected.assessment.eventId,reason:'추가 검토로 이 평가를 무효 처리',idempotencyKey:'review-invalidate'})
    assert.equal(invalid.quality.current.useAi.effectiveWeight,0)
    const recovered=KnowledgeAssessmentStore.moderate(admin,post.id,invalid.assessment.eventId,{action:'correct',quality:'up',expectedHeadEventId:invalid.assessment.eventId,reason:'무효 처리 사유를 재검토하여 의견 복원',idempotencyKey:'review-recover'})
    assert.equal(recovered.quality.current.useAi.up,0.25)
    const human=KnowledgeAssessmentStore.vote(voter,post.id,{contentVersion:1,quality:'down',idempotencyKey:'moderation-human-opinion'}).ownVote!.eventId
    assert.equal(status(()=>KnowledgeAssessmentStore.moderate(admin,post.id,human,{action:'invalidate',expectedHeadEventId:human,reason:'관리자가 대리 변경 시도',idempotencyKey:'forbidden-human-change'})),403)
    assert.equal(getKnowledgeQuality(voter,post.id).ownVote?.quality,'down')
    assert.throws(()=>db.prepare('UPDATE post_assessment_moderations SET reason=? WHERE post_id=?').run('덮어쓰기',post.id),/immutable/)
    assert.equal(KnowledgeAssessmentStore.history(admin,post.id).items.find(item=>item.eventId===original)?.isLatest,false)
  })

  await t.test('permanent deletion previews dependencies, rejects changed approval and purges document records while retaining files',async()=>{
    const {KnowledgeEvaluationStore}=await import('../src/services/posts/knowledge/knowledgeEvaluation')
    const {KnowledgeProposalStore}=await import('../src/services/posts/knowledge/knowledgeProposals')
    const {recordKnowledgeUse,finishKnowledgeExecution,normalizedKnowledgeEvaluatorFamily}=await import('../src/services/posts/knowledge/knowledgeRuntime')
    const file=FileStoreService.writeText(fileOwnerKey(2),null,'purge-evidence.md','보존할 실제 첨부 내용')
    let post=PostStore.create(voter,{title:'영구 삭제 검수',body:`절차 ![](file:${file.id})`})
    post=KnowledgeStore.patch(voter,post.id,{expectedRevision:post.revision})
    PostCommentStore.create(bob,post.id,{body:'보존했던 댓글'})
    const execution={executionId:'purge-execution',rootExecutionId:'purge-root',accountId:2,accountKey:'account:2',profileId:luna.id,providerName:'conn',model:'m',evaluatorFamily:normalizedKnowledgeEvaluatorFamily('conn','m'),trust:'observed_execution' as const}
    const use=recordKnowledgeUse(lunaAsAlice,{postId:post.id,body:post.body,intervals:[{start:0,end:post.body.length}],execution})!
    finishKnowledgeExecution(execution,{status:'completed'})
    const event=insertKnowledgeAssessment({postId:post.id,contentVersion:1,contentHash:post.knowledge!.contentHash,evaluator:'use_ai',accountKey:'account:2',evaluatorFamily:execution.evaluatorFamily,rootExecutionId:execution.rootExecutionId,purpose:'usage',quality:'down',phase:'final',idempotencyKey:'purge-ai-event',useId:use.useId})
    KnowledgeAssessmentStore.moderate(admin,post.id,event,{action:'invalidate',expectedHeadEventId:event,reason:'삭제 검수용 평가 무효화',idempotencyKey:'purge-audit'})
    KnowledgeProposalStore.create(lunaAsAlice,{kind:'update',postId:post.id,baseRevision:post.revision,baseContentVersion:1,title:post.title,body:post.body,sources:[],idempotencyKey:'purge-own-proposal'})
    updatePostsSettings({knowledge:{autoEvaluationEnabled:true}})
    const queued=KnowledgeEvaluationStore.request(admin,post.id,{contentVersion:1,idempotencyKey:'purge-evaluation'})
    updatePostsSettings({knowledge:{autoEvaluationEnabled:false}})
    assert.equal(status(()=>KnowledgeStore.permanentDeletePreview(voter,post.id,{expectedRevision:post.revision})),409,'only trash documents can be permanently deleted')
    KnowledgeStore.trash(voter,post.id,{expectedRevision:post.revision})
    const revision=(db.prepare('SELECT revision FROM posts WHERE id=?').get(post.id) as {revision:number}).revision
    assert.equal(KnowledgeStore.permanentDeletePreview(voter,post.id,{expectedRevision:revision}).blocked,true,'active evaluation blocks deletion')
    // Cancellation needs the source to be visible; the owner restores, cancels, then returns it to trash.
    post=KnowledgeStore.restore(voter,post.id,{expectedRevision:revision})
    KnowledgeEvaluationStore.cancel(admin,post.id,queued.id)
    KnowledgeStore.trash(voter,post.id,{expectedRevision:post.revision})
    const finalRevision=(db.prepare('SELECT revision FROM posts WHERE id=?').get(post.id) as {revision:number}).revision
    const preview=KnowledgeStore.permanentDeletePreview(voter,post.id,{expectedRevision:finalRevision})
    assert.equal(preview.blocked,false)
    assert.deepEqual([preview.counts.comments,preview.counts.uses,preview.counts.moderations,preview.counts.proposals],[1,1,1,1])
    const foreign=PostStore.create(bob,{title:'비공개 연결 문서 제목',body:`[참고](post:${post.id})`,status:'draft'})
    assert.equal(status(()=>KnowledgeStore.permanentDelete(voter,post.id,{expectedRevision:finalRevision,previewToken:preview.previewToken,confirm:true})),409,'a new dependency invalidates the earlier deletion approval')
    const blocked=KnowledgeStore.permanentDeletePreview(voter,post.id,{expectedRevision:finalRevision})
    assert.equal(blocked.blocked,true)
    assert.ok(blocked.dependencies.some(item=>item.kind==='link'&&item.postId===null&&item.title===null),'private incoming links are redacted')
    assert.equal(status(()=>KnowledgeStore.permanentDelete(voter,post.id,{expectedRevision:finalRevision,previewToken:blocked.previewToken,confirm:true})),409)
    PostStore.remove(bob,foreign.id)
    const shared=PostStore.create(voter,{title:'첨부를 계속 쓰는 문서',body:`![](file:${file.id})`})
    const ready=KnowledgeStore.permanentDeletePreview(voter,post.id,{expectedRevision:finalRevision})
    assert.equal(ready.blocked,false,'shared attachment is retained rather than deleted')
    assert.ok(ready.dependencies.some(item=>item.kind==='shared_attachment'&&!item.blocking&&item.postId===shared.id))
    assert.equal(status(()=>KnowledgeStore.permanentDelete({...admin,origin:'mcp'},post.id,{expectedRevision:finalRevision,previewToken:ready.previewToken,confirm:true})),403)
    assert.equal(status(()=>KnowledgeStore.permanentDelete(voter,post.id,{expectedRevision:finalRevision,previewToken:ready.previewToken,confirm:false})),400)
    const deleted=KnowledgeStore.permanentDelete(voter,post.id,{expectedRevision:finalRevision,previewToken:ready.previewToken,confirm:true})
    assert.equal(deleted.filesRetained,true)
    assert.equal(KnowledgeStore.permanentDelete(voter,post.id,{expectedRevision:finalRevision,previewToken:ready.previewToken,confirm:true}).deletedAt,deleted.deletedAt,'confirmation retry is idempotent')
    for(const table of ['posts','post_comments','post_knowledge_versions','post_assessment_events','post_review_events','post_knowledge_uses','post_evaluation_requests','post_assessment_moderations','post_knowledge_media_refs']) {
      const column=table==='posts'?'id':'post_id'
      assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column}=?`).get(post.id) as {n:number}).n,0,table)
    }
    assert.equal((await FileStoreService.readText(fileOwnerKey(2),file.id)).text,'보존할 실제 첨부 내용')
    assert.equal(PostStore.embeddedFileOwner(voter,shared.id,file.id),fileOwnerKey(2))
  })

  await t.test('topic relevance: versioned criteria, independent scores and strict request guards', async (s) => {
    const { loadContentEvaluationSettings, updateContentEvaluationSettings } = await import('../src/services/contentEvaluation/definitionStore')
    const { ModelSlotStore } = await import('../src/services/codex-chat/modelSlots')
    const { topicScore, topicQuestion } = await import('../src/services/contentEvaluation/topicScore')
    const { askJudge, resolveJudgeConnection } = await import('../src/services/judge/judgeEngine')
    ExternalApiProvider.create({ provider_name: 'topic-judge', display_name: 'Topic judge', provider_type: 'decision_typesafe', base_url: 'http://topic.invalid', is_enabled: true, additional_config: {} })
    const modelSlotId = ModelSlotStore.ensure('topic-judge','judge-test')
    const topics = ['교육','AI','LLM'].map((name,index) => ({ id: 'topic-' + index, name, description: 'Assess substantive discussion of ' + name, enabled: true }))
    const initial = loadContentEvaluationSettings()
    const saved = updateContentEvaluationSettings({ expectedRevision: initial.revision, modelSlotId, topics })
    assert.equal(saved.definitionVersion,initial.definitionVersion + 1)
    assert.throws(() => updateContentEvaluationSettings({ expectedRevision: initial.revision, modelSlotId, topics }), (error: any) => error.statusCode === 409)
    assert.throws(() => ModelSlotStore.delete(modelSlotId!), /콘텐츠 평가/)
    const mixed = { none:0,mention:0,partial:0.2,major:0.8,core:0,unknown:0 }
    const scored = topicScore(topics[0],{probability:0,confidence:0.8,choice:'major',distribution:mixed})
    assert.equal(scored.score,70)
    assert.equal(topicScore(topics[1],{probability:0,confidence:1,choice:'core',distribution:{...mixed,partial:0,major:0,core:1}}).score,100)
    assert.equal(topicScore(topics[0],{probability:0,confidence:1,choice:'none',distribution:{...mixed,partial:0,major:0,none:1}}).score,0)
    assert.equal(topicScore(topics[0],{probability:0,confidence:1,choice:'unknown',distribution:{...mixed,partial:0,major:0,unknown:1}}).answerStatus,'unknown')
    assert.equal(topicScore(topics[0],undefined).answerStatus,'missing')
    let calls = 0
    s.mock.method(globalThis,'fetch',async () => { calls++; return Response.json({model:'judge-test',answers:{'topic-0':{type:'choice',choice:'core',probabilities:{core:1}}}}) })
    const connection = resolveJudgeConnection('topic-judge','judge-test')
    const strict = await askJudge(connection,{},[topicQuestion(topics[0])],undefined,undefined,{strictDistributions:true})
    assert.equal(strict.answers.size,0,'missing probability fields must not turn into confident scores')
    const loose = await askJudge(connection,{},[topicQuestion(topics[0])])
    assert.equal(loose.answers.get('topic-0')?.distribution?.core,1,'existing judge calls keep their normalization contract')
    const before = calls
    await assert.rejects(askJudge(resolveJudgeConnection('conn','m'),{},[topicQuestion(topics[0])],undefined,undefined,{
      strictDistributions:true,beforeRequest:() => { throw new Error('request authorization stopped') },
    }),/request authorization stopped/)
    assert.equal(calls,before,'LLM authorization runs after acquiring the request slot and before fetch')
  })

  await t.test('topic relevance runtime: publication, stale responses, current access and deletion-safe budgets', {timeout:20000}, async (s) => {
    const { AuthAccount } = await import('../src/models/AuthAccount')
    const { AuthAccessControlService } = await import('../src/services/authAccessControlService')
    const { RuntimeJobRunner } = await import('../src/services/runtimeJobs/runtimeJobRunner')
    const runtime = await import('../src/services/posts/postTopicEvaluation')
    const { loadContentEvaluationSettings, updateContentEvaluationSettings } = await import('../src/services/contentEvaluation/definitionStore')
    let revoked = false, calls = 0, holdNext = false
    let malformed: 'none' | 'partial' | 'all' = 'none'
    let release: (() => void) | null = null
    s.mock.method(AuthAccount,'findById',(id: number) => ({ id, username:'test', account_type:id === 1 ? 'admin' : 'user', status:revoked ? 'disabled' : 'active' }))
    s.mock.method(AuthAccessControlService,'resolveForAccountId',() => ({permissionKeys:ALL}))
    s.mock.method(globalThis,'fetch',async (_url: unknown, init?: RequestInit) => {
      calls++
      const request = JSON.parse(String(init?.body))
      if (holdNext) { holdNext = false; await new Promise<void>(resolve => { release = resolve }) }
      const answers = Object.fromEntries(Object.keys(request.questions).map((id,index) => {
        const probabilities = { none:0,mention:0,partial:index === 1 ? 0 : 0.2,major:index === 1 ? 0 : 0.8,core:index === 1 ? 1 : 0,unknown:0 }
        if (request.state.body.includes('새 내용')) { probabilities.none=1;probabilities.partial=0;probabilities.major=0;probabilities.core=0 }
        return [id,{type:'choice',choice:index === 1 ? 'core' : 'major',probabilities:malformed === 'all' || malformed === 'partial' && index === 2 ? {core:1} : probabilities}]
      }))
      return Response.json({model:'judge-test',answers,usage:{input_tokens:30,output_tokens:10}})
    })
    const wait = async (condition: () => boolean) => {
      const deadline = Date.now() + 4000
      while (!condition() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve,10))
      assert.ok(condition(),'evaluation state should settle')
    }
    const view = (id: number) => PostStore.get(admin,id).topicEvaluation!
    const usageCount = () => (db.prepare("SELECT COUNT(*) AS n FROM post_topic_evaluation_usage WHERE account_key='account:1' AND created_at>=date('now')").get() as {n:number}).n
    updatePostsSettings({ topicEvaluation: {autoEnabled:true,reevaluateOnEdit:true,dailyCallLimit:100,dailyTokenLimit:100000,maxRetries:0} })
    runtime.registerPostTopicEvaluationHandler()
    runtime.initializePostTopicEvaluationRuntime()
    s.after(() => { runtime.shutdownPostTopicEvaluationRuntime(); RuntimeJobRunner.shutdown(); updatePostsSettings({topicEvaluation:{autoEnabled:false}}) })
    const draft = PostStore.create(admin,{title:'학습과 AI',body:'LLM 수업 자료',status:'draft'})
    assert.equal(view(draft.id).status,'unassessed')
    assert.equal(calls,0)
    PostStore.update(admin,draft.id,{status:'published'})
    runtime.kickPostTopicEvaluationQueue()
    await wait(() => view(draft.id).status === 'completed')
    assert.deepEqual(view(draft.id).items.map(item => item.score),[70,100,70])
    assert.equal(view(draft.id).isCurrent,true)
    const requestId = view(draft.id).requestId
    PostStore.update(admin,draft.id,{tags:['metadata-only']})
    assert.equal(view(draft.id).requestId,requestId)
    const manual = {expectedContentHash:view(draft.id).contentHash,idempotencyKey:'topic-command',force:false}
    assert.equal(PostStore.requestTopicEvaluation(admin,draft.id,manual).topicEvaluation?.requestId,requestId)
    assert.equal(PostStore.requestTopicEvaluation(admin,draft.id,manual).topicEvaluation?.requestId,requestId)
    assert.equal(status(() => PostStore.requestTopicEvaluation(bob,draft.id,manual)),403)
    assert.equal(status(() => PostStore.requestTopicEvaluation({...admin,profileId:luna.id},draft.id,manual)),403)
    assert.equal(status(() => PostStore.requestTopicEvaluation(admin,draft.id,{...manual,idempotencyKey:'force',force:true})),429)
    const count = calls
    const cfg = loadContentEvaluationSettings()
    updateContentEvaluationSettings({expectedRevision:cfg.revision,modelSlotId:cfg.modelSlotId,topics:cfg.topics.map((topic,index) => index === 0 ? {...topic,description:'Updated learning criterion'} : topic)})
    assert.equal(view(draft.id).isCurrent,false)
    assert.equal(PostStore.get(reader,draft.id).topicEvaluation?.items.length,0,'previous results are not exposed as current reader metadata')
    assert.equal(calls,count,'criteria edits never enqueue the existing corpus')

    malformed = 'partial'
    const partial = PostStore.create(admin,{title:'응답 일부 누락',body:'교육 자료'})
    await wait(() => view(partial.id).status === 'partial')
    assert.equal(view(partial.id).items[2].answerStatus,'missing')
    assert.equal(view(partial.id).items[2].score,null)
    malformed = 'all'
    const invalid = PostStore.create(admin,{title:'응답 전체 오류',body:'교육 자료'})
    await wait(() => view(invalid.id).status === 'failed')
    assert.equal(view(invalid.id).reasonCode,'invalid_response')
    assert.equal(view(invalid.id).items.length,0)
    malformed = 'none'

    holdNext = true
    const changing = PostStore.create(admin,{title:'수정 중 평가',body:'이전 내용'})
    await wait(() => release !== null)
    const staleId = view(changing.id).requestId!
    PostStore.update(admin,changing.id,{body:'새 내용'})
    release!()
    await wait(() => view(changing.id).status === 'completed')
    assert.equal(view(changing.id).isCurrent,true)
    assert.ok(view(changing.id).items.every(item => item.score === 0),'late old scores never overwrite the new content')
    assert.equal((db.prepare('SELECT status FROM post_topic_evaluation_requests WHERE id=?').get(staleId) as {status:string}).status,'superseded')

    release = null
    holdNext = true
    const disconnected = PostStore.create(admin,{title:'평가 중 연결 중지',body:'교육 자료'})
    await wait(() => release !== null)
    ExternalApiProvider.update('topic-judge',{is_enabled:false})
    release!()
    await wait(() => view(disconnected.id).status === 'skipped')
    assert.equal(view(disconnected.id).reasonCode,'judge_unavailable')
    assert.equal(view(disconnected.id).items.length,0,'a disabled connection cannot commit its late result')
    ExternalApiProvider.update('topic-judge',{is_enabled:true})

    revoked = true
    const privateAccess = PostStore.create(admin,{title:'권한 회수',body:'교육 자료'})
    const beforeRevoked = calls
    await wait(() => view(privateAccess.id).status === 'skipped')
    assert.equal(calls,beforeRevoked,'current account access is checked before calling the provider')
    revoked = false

    const quota = usageCount() + 1
    updatePostsSettings({topicEvaluation:{dailyCallLimit:quota}})
    const billable = PostStore.create(admin,{title:'마지막 평가',body:'교육 자료'})
    await wait(() => view(billable.id).status === 'completed')
    assert.equal(usageCount(),quota)
    PostStore.remove(admin,billable.id)
    assert.equal(usageCount(),quota,'deleting a post must not refund the daily call allowance')
    const blocked = PostStore.create(admin,{title:'한도 초과',body:'교육 자료'})
    const beforeBudget = calls
    await wait(() => view(blocked.id).status === 'skipped')
    assert.equal(view(blocked.id).reasonCode,'daily_budget')
    assert.equal(calls,beforeBudget)
  })
})
