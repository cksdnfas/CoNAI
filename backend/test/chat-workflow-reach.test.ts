import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

/**
 * What a chat can reach on the workflow screens: live choices for node id fields, the caller's own room list, library
 * image refs on image inputs, and the run / autorun operations as commit cards.
 */
test('chat workflow reach: field choices, room list, image refs, run and autorun operations', { timeout: 120000 }, async (t) => {
  const temp = path.resolve(__dirname, '../../temp')
  fs.mkdirSync(temp, { recursive: true })
  const root = fs.mkdtempSync(path.join(temp, 'conai-chat-workflow-reach-test-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  process.env.RUNTIME_UPLOADS_DIR = path.join(root, 'uploads')
  process.env.RUNTIME_TEMP_DIR = path.join(root, 'temp')
  const settings = await import('../src/database/userSettingsDb')
  settings.initializeUserSettingsDb()
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  const auth = await import('../src/database/authDb')
  auth.initializeAuthDb()
  const images = await import('../src/database/init')
  await images.initializeDatabase()
  t.after(async () => {
    settings.closeUserSettingsDb()
    auth.getAuthDb().close()
    images.closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), temp)
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const shared = await import('@conai/shared')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { ChatGroupStore } = await import('../src/services/codex-chat/chatGroupStore')
  const { chatWorkflowModules, withChatWorkflowChoices, requireChatWorkflowChoiceValues } = await import('../src/services/codex-chat/chatWorkflowContext')
  const { registerChatRoomListTools } = await import('../src/mcp/tools/chatRoomListTools')
  const { getMcpToolScope } = await import('../src/mcp/context')
  const { TOOL_FEATURE_PERMISSIONS } = await import('../src/mcp/toolAccess')
  const { AuthAccount } = await import('../src/models/AuthAccount')
  const authHelpers = await import('../src/services/auth/sessionAccess')

  const mina = ChatProfileStore.create({ name: 'Mina', engine: 'codex' })
  const kai = ChatProfileStore.create({ name: 'Kai', engine: 'codex' })
  const off = ChatProfileStore.create({ name: 'Off', engine: 'codex', isEnabled: false })
  const direct = CodexChatStore.createThread(1, '', 'llm', mina.id)
  const group = ChatGroupStore.create(1, 'Tea party', [mina.id, kai.id], mina.id)
  const archived = CodexChatStore.createThread(1, 'Old talk', 'llm', kai.id)
  CodexChatStore.updateListState(archived, { archived: true })
  const theirs = CodexChatStore.createThread(2, 'Not yours', 'llm', mina.id)

  // ---- list_chat_rooms: the caller's own rooms only -----------------------------------------------------------------
  const handlers = new Map<string, (input: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>>()
  const fakeServer = { registerTool: (name: string, _definition: unknown, handler: never) => { handlers.set(name, handler) } }
  const listRooms = async (accountId: number | null, input: Record<string, unknown> = {}) => {
    handlers.clear()
    registerChatRoomListTools(fakeServer as never, { scopes: ['read'], requester: { accountId, accountType: 'user' } })
    return JSON.parse((await handlers.get('list_chat_rooms')!(input)).content[0].text) as {
      total: number; rooms: Array<Record<string, unknown>>; has_more: boolean; next_cursor: string | null; nextOffset: number | null
    }
  }
  const mine = await listRooms(1)
  assert.deepEqual(mine.rooms.map((room) => room.id).sort(), [direct, group].sort(), 'archived and other accounts\' rooms are left out')
  assert.deepEqual(mine.rooms.find((room) => room.id === group), { id: group, title: 'Tea party', kind: 'group', members: ['Mina', 'Kai'], updated: mine.rooms.find((room) => room.id === group)!.updated })
  assert.equal(mine.rooms.find((room) => room.id === direct)!.title, 'Mina', 'an untitled chat is named after its character')
  assert.deepEqual((await listRooms(1, { include_archived: true })).rooms.map((room) => room.id).sort(), [direct, group, archived].sort())
  assert.deepEqual((await listRooms(1, { kind: 'group' })).rooms.map((room) => room.id), [group])
  assert.deepEqual((await listRooms(1, { query: 'kai' })).rooms.map((room) => room.id), [group], 'a member name finds the room')
  assert.deepEqual((await listRooms(2)).rooms.map((room) => room.id), [theirs])
  const noHydration = t.mock.method(ChatProfileStore, 'list', () => { throw new Error('Room names must not hydrate profiles') })
  try {
    const first = await listRooms(1, { limit: 1 })
    assert.equal(first.total, 2)
    assert.equal(first.has_more, true)
    assert.ok(first.next_cursor)
    const second = await listRooms(1, { limit: 1, cursor: first.next_cursor })
    assert.equal(second.total, 2, 'the total is the filtered directory, not the remaining suffix')
    assert.equal(second.has_more, false)
    assert.equal(second.next_cursor, null)
    assert.deepEqual([...first.rooms, ...second.rooms].map((room) => room.id), mine.rooms.map((room) => room.id), 'equal activity timestamps use id as the stable tie breaker')
    assert.deepEqual((await listRooms(1, { limit: 1, offset: 1 })).rooms, second.rooms, 'legacy offsets also page in SQL')
    const empty = await listRooms(1, { query: '%' })
    assert.deepEqual(empty.rooms, [], 'search is literal, not a SQL LIKE pattern')
    assert.equal(empty.has_more, false)
    CodexChatStore.updateListState(direct, { pinned: true })
    assert.deepEqual((await listRooms(1, { pinned: true })).rooms.map((room) => room.id), [direct])
    assert.deepEqual((await listRooms(1, { pinned: false })).rooms.map((room) => room.id), [group])
    assert.deepEqual((await listRooms(1, { query: 'kai', kind: 'direct' })).rooms, [], 'a group member does not match another direct room')
    assert.deepEqual((await listRooms(2, { query: 'Tea' })).rooms, [], 'membership/name search never crosses account boundaries')
    await assert.rejects(listRooms(1, { cursor: 'invalid' }), /cursor/)
    await assert.rejects(listRooms(1, { cursor: first.next_cursor, offset: 1 }), /either/)
  } finally { noHydration.mock.restore() }
  const admins = t.mock.method(AuthAccount, 'countActiveAdmins', () => 1)
  authHelpers.invalidateConfiguredAuthCache()
  try { assert.equal((await listRooms(null)).total, 0, 'nobody owns rooms once accounts exist') } finally { admins.mock.restore(); authHelpers.invalidateConfiguredAuthCache() }
  assert.equal(getMcpToolScope('list_chat_rooms'), 'read')
  assert.deepEqual(TOOL_FEATURE_PERMISSIONS.list_chat_rooms, [])

  // ---- live choices for node id fields -------------------------------------------------------------------------------
  const modules = chatWorkflowModules()
  const post = modules.find((module) => module.operation === 'system.post_to_chat_room')!
  const wake = modules.find((module) => module.operation === 'system.wake_chat_room')
  const roomField = post.fields.find((field) => field.key === 'room_id')!
  assert.equal(roomField.optionsSource, 'chat_rooms')
  assert.equal(roomField.editable, true)
  const asField = post.fields.find((field) => field.type === 'select' && field.options?.length)
  if (asField) assert.equal(asField.optionLabels?.length, asField.options!.length, 'a static select carries its labels')
  const [withChoices] = await withChatWorkflowChoices([post], 1) as Array<typeof post & { choices: Record<string, Array<{ value: string; label: string }>> }>
  assert.deepEqual(withChoices.choices.room_id.map((choice) => Number(choice.value)).sort(), [direct, group, archived].sort(), 'the node editor\'s own list for this account')
  assert.ok(!withChoices.choices.room_id.some((choice) => Number(choice.value) === theirs))
  await requireChatWorkflowChoiceValues(modules, [{ moduleId: post.id, key: 'room_id', value: group }], 1)
  await assert.rejects(requireChatWorkflowChoiceValues(modules, [{ moduleId: post.id, key: 'room_id', value: theirs }], 1), /not one of the current choices.*Tea party/)
  const profileField = modules.flatMap((module) => module.fields.filter((field) => field.optionsSource === 'chat_profiles').map((field) => ({ module, field })))[0]
  await assert.rejects(requireChatWorkflowChoiceValues(modules, [{ moduleId: profileField.module.id, key: profileField.field.key, value: off.id }], 1), /not one of the current choices/, 'a switched-off profile is not pickable')
  await requireChatWorkflowChoiceValues(modules, [{ moduleId: profileField.module.id, key: profileField.field.key, value: kai.id }], 1)
  if (wake) assert.ok(wake.fields.some((field) => field.optionsSource === 'chat_rooms'))
  // The description itself carries no live data, so the browser and the server derive the same module.
  assert.equal(JSON.stringify(post).includes(String(group)), false)

  // ---- image inputs take library refs --------------------------------------------------------------------------------
  const imageModule = modules.find((module) => module.operation === 'system.constant_image')!
  assert.equal(imageModule.fields.find((field) => field.key === 'image')!.editable, true)
  assert.deepEqual(shared.libraryImageRef({ label: 'x' }, ` ${'B'.repeat(32)} `), { composite_hash: 'b'.repeat(32) })
  assert.throws(() => shared.libraryImageRef({ label: 'x' }, '../secret.png'), /composite_hash/)

  // ---- run and autorun operations are commit cards on the generation page -------------------------------------------
  for (const id of ['workflow.run', 'workflow.schedule_save', 'workflow.schedule_pause', 'workflow.schedule_resume', 'workflow.schedule_run_now', 'workflow.schedule_delete', 'workflow.runs_cleanup']) {
    assert.equal(shared.chatPageActionTier(id), 'commit', id)
    assert.equal(shared.chatPageActionAllowed('/generation', id), true, id)
    assert.equal(shared.chatPageActionAllowed('/posts', id), false, id)
  }
  assert.equal(shared.CHAT_PAGE_ACTION_PERMISSIONS['workflow.run'], 'generation.execute')
  assert.equal(shared.CHAT_PAGE_ACTION_PERMISSIONS['workflow.schedule_save'], 'workflows.edit')
  const schema = { type: 'object' as const, properties: {}, required: [] }
  assert.equal(shared.normalizeChatPageActions('/generation', [{ id: 'workflow.run', label: '실행', description: '', effect: 'save', schema }])[0].effect, 'save')
  assert.throws(() => shared.normalizeChatPageActions('/generation', [{ id: 'workflow.run', label: '실행', description: '', effect: 'draft', schema }]), /저장 범위/, 'a run is never a draft')
})
