import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

test('claude sessions: forked turns, input once, resets and cleanup', { timeout: 60000 }, async (t) => {
  const temp = path.resolve(__dirname, '../../temp')
  fs.mkdirSync(temp, { recursive: true })
  const root = fs.mkdtempSync(path.join(temp, 'conai-claude-session-test-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  const { claudeChatArgs, claudeSessionInput, claudeSessionFileExists } = await import('../src/services/codex-chat/claudeChatCompletion')
  const { buildClaudeSessionTurn, claudeSessionDir, deleteClaudeSessions, readClaudeSession } = await import('../src/services/codex-chat/claudeChatSessions')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  t.after(async () => {
    dbModule.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), temp)
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  await t.test('a session run keeps the conversation: a new one by id, a later turn forks the last', () => {
    const fresh = claudeChatArgs('haiku', 'system.txt', 'mcp.json', 4, null, { resumeId: null, newId: 'new-id' })
    assert.ok(!fresh.includes('--no-session-persistence'))
    assert.deepEqual(fresh.slice(-2), ['--session-id', 'new-id'])
    const next = claudeChatArgs('haiku', 'system.txt', 'mcp.json', 4, null, { resumeId: 'old-id', newId: 'unused' })
    assert.deepEqual(next.slice(-3), ['--resume', 'old-id', '--fork-session'])
    assert.ok(claudeChatArgs('haiku', 'system.txt', 'mcp.json', 4).includes('--no-session-persistence'))
  })

  await t.test('a session turn sends only the new message, images as image blocks', () => {
    const line = JSON.parse(claudeSessionInput([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'old' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: [{ type: 'text', text: 'new' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } }] },
    ]))
    assert.deepEqual(line.message.content, [{ type: 'text', text: 'new' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } }])
  })

  await t.test('the past goes once, given input is not repeated, and a compaction, prompt change or rewrite starts over', async () => {
    const requester = { accountId: 1, accountType: 'admin' as const }
    const profile = ChatProfileStore.create({ name: '루나', engine: 'claude', model: 'haiku', systemPrompt: '너는 루나야.', authorNote: '분위기는 차분하게.' })
    const threadId = CodexChatStore.createThread(1, '세션', 'llm', profile.id)
    const add = (role: 'user' | 'assistant', content: string) => CodexChatStore.addMessage({ thread_id: threadId, role, content, tool_calls: [], status: 'completed', error: null })
    add('user', '안녕')
    add('assistant', '안녕, 왔구나.')
    add('user', '오늘 뭐 했어?')
    const build = () => buildClaudeSessionTurn({ requester, threadId, profile: ChatProfileStore.find(profile.id)!, history: CodexChatStore.listMessages(threadId), withTools: false })
    const textOf = (messages: Awaited<ReturnType<typeof build>>['messages']) => String(messages[1].content)
    const fakeSession = (id: string) => {
      const dir = path.join(claudeSessionDir(threadId), 'home', 'projects', 'work')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, `${id}.jsonl`), '{}\n')
    }

    const first = await build()
    assert.equal(first.session.resumeId, null)
    assert.match(String(first.messages[0].content), /너는 루나야/)
    assert.match(textOf(first.messages), /\[이전 기록\]/)
    assert.match(textOf(first.messages), /안녕, 왔구나/)
    assert.match(textOf(first.messages), /분위기는 차분하게/)
    assert.match(textOf(first.messages), /오늘 뭐 했어\?/)
    const one = '11111111-1111-4111-8111-111111111111'
    fakeSession(one)
    first.session.onDone(one, false)
    assert.equal(readClaudeSession(CodexChatStore.findThreadById(threadId)!.codex_thread_id)?.id, one)

    add('assistant', '그림 그렸어.')
    add('user', '보여줘')
    const second = await build()
    assert.equal(second.session.resumeId, one)
    assert.doesNotMatch(textOf(second.messages), /\[이전 기록\]/)
    assert.doesNotMatch(textOf(second.messages), /분위기는 차분하게/, 'the note was given already')
    assert.match(textOf(second.messages), /보여줘/)

    // Claude Code folded the memory during the turn: the note goes in again.
    const two = '22222222-2222-4222-8222-222222222222'
    fakeSession(two)
    second.session.onDone(two, true)
    const third = await build()
    assert.equal(third.session.resumeId, two)
    assert.match(textOf(third.messages), /분위기는 차분하게/)
    third.session.onDone(two, false)

    // A changed system prompt cannot reach a recorded session: a new one starts, told the past.
    ChatProfileStore.update(profile.id, { systemPrompt: '너는 이제 카이야.' })
    const changed = await build()
    assert.equal(changed.session.resumeId, null)
    assert.match(textOf(changed.messages), /\[이전 기록\]/)
    changed.session.onDone(two, false)
    assert.equal((await build()).session.resumeId, two)

    // Rewriting the history drops the session like a Codex thread; lost files do too.
    const last = CodexChatStore.listMessages(threadId).at(-1)!
    CodexChatStore.prepareRegeneration(threadId, last.id)
    assert.equal(CodexChatStore.findThreadById(threadId)!.codex_thread_id, null)
    assert.equal((await build()).session.resumeId, null)
    changed.session.onDone(two, false)
    fs.rmSync(path.join(claudeSessionDir(threadId), 'home', 'projects'), { recursive: true, force: true })
    assert.equal(claudeSessionFileExists(path.join(claudeSessionDir(threadId), 'home'), two), false)
    assert.equal((await build()).session.resumeId, null)

    deleteClaudeSessions(threadId)
    assert.equal(fs.existsSync(claudeSessionDir(threadId)), false)
  })

  await t.test('a room member keeps its own session: what it missed goes in, member changes and rewrites start over', async () => {
    const { ChatGroupStore } = await import('../src/services/codex-chat/chatGroupStore')
    const { buildClaudeGroupSessionTurn, claudeMemberSessionDir } = await import('../src/services/codex-chat/claudeChatSessions')
    const requester = { accountId: 1, accountType: 'admin' as const }
    const luna = ChatProfileStore.create({ name: '루나', engine: 'claude', model: 'haiku', systemPrompt: '너는 루나야.', authorNote: '분위기는 차분하게.' })
    const kai = ChatProfileStore.create({ name: '카이', engine: 'claude', model: 'haiku', systemPrompt: '너는 카이야.' })
    const mina = ChatProfileStore.create({ name: '미나', engine: 'claude', model: 'haiku', systemPrompt: '너는 미나야.' })
    const roomId = ChatGroupStore.create(1, '방', [luna.id, kai.id], luna.id)
    const add = (role: 'user' | 'assistant', content: string, speaker: number | null = null) =>
      CodexChatStore.addMessage({ thread_id: roomId, role, content, tool_calls: [], status: 'completed', error: null, speaker_profile_id: speaker })
    const build = (profileId: number) => {
      const members = ChatGroupStore.members(roomId).map((member) => ChatProfileStore.find(member.profile_id)!)
      return buildClaudeGroupSessionTurn({ requester, thread: CodexChatStore.findThreadById(roomId)!, members, profile: members.find((member) => member.id === profileId)!, messages: CodexChatStore.listMessages(roomId), windowLimit: 20, withTools: false })
    }
    const textOf = (turn: Awaited<ReturnType<typeof build>>) => String(turn.messages[1].content)
    const finish = (turn: Awaited<ReturnType<typeof build>>, profileId: number, id: string, compacted = false) => {
      const dir = path.join(claudeMemberSessionDir(roomId, profileId), 'home', 'projects', 'work')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, `${id}.jsonl`), '{}\n')
      turn.session.onDone(id, compacted)
    }
    add('user', '다들 안녕')

    const first = await build(luna.id)
    assert.equal(first.session.resumeId, null)
    assert.equal(first.session.dir, claudeMemberSessionDir(roomId, luna.id))
    assert.match(String(first.messages[0].content), /너는 루나야[\s\S]*## Group chat room/)
    assert.doesNotMatch(textOf(first), /## Group chat room/, 'the room header is in the fixed part')
    assert.match(textOf(first), /\[지금까지의 대화\][\s\S]*다들 안녕/)
    assert.match(textOf(first), /분위기는 차분하게/)
    const one = '11111111-1111-4111-8111-111111111111'
    finish(first, luna.id, one)
    const seen = ChatGroupStore.member(roomId, luna.id)!
    assert.equal(readClaudeSession(seen.codex_thread_id)?.id, one)
    assert.equal(seen.last_seen_message_id, CodexChatStore.listMessages(roomId).at(-1)!.id)

    // Each member has its own session: 카이 starts its own, in its own folder.
    const kaiTurn = await build(kai.id)
    assert.equal(kaiTurn.session.resumeId, null)
    assert.notEqual(kaiTurn.session.dir, first.session.dir)

    add('assistant', '안녕, 다들.', luna.id)
    add('assistant', '루나 왔네.', kai.id)
    add('user', '루나는 오늘 뭐 했어?')
    const second = await build(luna.id)
    assert.equal(second.session.resumeId, one)
    assert.match(textOf(second), /\[네가 마지막으로 말한 뒤의 대화\]/)
    assert.doesNotMatch(textOf(second), /안녕, 다들/, 'its own reply is in its session already')
    assert.match(textOf(second), /루나 왔네[\s\S]*오늘 뭐 했어/)
    assert.doesNotMatch(textOf(second), /분위기는 차분하게/, 'the note was given already')
    const two = '22222222-2222-4222-8222-222222222222'
    finish(second, luna.id, two)
    assert.equal((await build(luna.id)).session.resumeId, two)

    // Another variant of 루나's reply: 루나 (its speaker) forgets the room; 카이, which has not seen it yet, keeps going.
    finish(kaiTurn, kai.id, '33333333-3333-4333-8333-333333333333')
    const lunaReply = CodexChatStore.listMessages(roomId).find((message) => message.content === '안녕, 다들.')!
    assert.ok(ChatGroupStore.member(roomId, kai.id)!.last_seen_message_id! < lunaReply.id)
    assert.deepEqual(ChatGroupStore.resetMemoryOfMessage(roomId, lunaReply.id, luna.id).map((member) => member.profileId), [luna.id])
    assert.equal((await build(luna.id)).session.resumeId, null)
    assert.equal((await build(kai.id)).session.resumeId, '33333333-3333-4333-8333-333333333333')
    // 카이 then sees it; a variant of it would reset 카이 too.
    ChatGroupStore.setLastSeen(roomId, kai.id, CodexChatStore.listMessages(roomId).at(-1)!.id)
    assert.deepEqual(ChatGroupStore.resetMemoryOfMessage(roomId, lunaReply.id, luna.id).map((member) => member.profileId), [kai.id])
    const three = '44444444-4444-4444-8444-444444444444'
    finish(await build(luna.id), luna.id, three)
    assert.equal((await build(luna.id)).session.resumeId, three)

    // A new member changes the room header: the session starts over, given the room's recent past.
    ChatGroupStore.addMembers(roomId, [mina.id])
    const joined = await build(luna.id)
    assert.equal(joined.session.resumeId, null)
    assert.match(String(joined.messages[0].content), /미나/)
    assert.match(textOf(joined), /\[지금까지의 대화\]/)
    finish(joined, luna.id, three)
    assert.equal((await build(luna.id)).session.resumeId, three)

    // Clearing or rewriting the room forgets every member's session.
    ChatGroupStore.resetCodexMemory(roomId)
    assert.equal(ChatGroupStore.member(roomId, luna.id)!.codex_thread_id, null)
    assert.equal((await build(luna.id)).session.resumeId, null)
    deleteClaudeSessions(roomId)
    assert.equal(fs.existsSync(claudeMemberSessionDir(roomId, luna.id)), false)
  })
})
