import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/** Automations: schedules run as the account that saved them, chat wakes, chat routines and the runtime-status node. */
test('automation routines: run-as schedules, timing, chat wakes, routines and nodes', { timeout: 120000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-automation-test-'))
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
    ChatRoutineRunner.stop()
    settings.closeUserSettingsDb()
    auth.getAuthDb().close()
    images.closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.ok(path.basename(root).startsWith('conai-automation-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const timing = await import('../src/services/scheduleTiming')
  const { GraphWorkflowModel } = await import('../src/models/GraphWorkflow')
  const { GraphExecutionModel } = await import('../src/models/GraphExecution')
  const { GraphWorkflowScheduleModel } = await import('../src/models/GraphWorkflowSchedule')
  const { ModuleDefinitionModel } = await import('../src/models/ModuleDefinition')
  const { GraphWorkflowScheduleService } = await import('../src/services/graphWorkflowScheduleService')
  const { RUNNING_EXECUTION_RESTART_MESSAGE } = await import('../src/services/graphWorkflowExecutionQueue')
  const { createGraphWorkflowScheduleRoutes } = await import('../src/routes/graph-workflows/schedule-routes')
  const { parseModuleDefinition } = await import('../src/services/graph-workflow-executor/shared')
  const { CHAT_NODE_HANDLERS } = await import('../src/services/graph-workflow-executor/system-chat-node-handlers')
  const { getSupportedSystemOperationKeys } = await import('../src/services/graph-workflow-executor/execute-system')
  const { executeReadRuntimeStatusNode } = await import('../src/services/graph-workflow-executor/system-runtime-operations')
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { CodexChatService } = await import('../src/services/codex-chat/codexChatService')
  const { GroupChatService } = await import('../src/services/codex-chat/groupChatService')
  const { wakeChatRoom, ensureAutomationRoom, ChatWakeBusyError } = await import('../src/services/codex-chat/chatRoomWake')
  const { ChatRoutineStore, ChatRoutineRunner, normalizeChatRoutineInput } = await import('../src/services/codex-chat/chatRoutines')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { ComfyUIServerModel } = await import('../src/models/ComfyUIServer')
  const { GenerationQueueModel } = await import('../src/models/GenerationQueue')
  const { AuthAccount } = await import('../src/models/AuthAccount')
  const { AuthAccessControlService } = await import('../src/services/authAccessControlService')
  const authHelpers = await import('../src/routes/auth-route-helpers')

  // Account 1 is an active administrator, 2 an active guest without generation.execute, 9 is switched off.
  updateChatSettings({ enabled: true })
  t.mock.method(AuthAccount, 'findById', (id: number) => (
    id === 1 ? { id: 1, status: 'active', account_type: 'admin' }
      : id === 2 ? { id: 2, status: 'active', account_type: 'guest' }
        : id === 9 ? { id: 9, status: 'disabled', account_type: 'guest' } : undefined
  ))
  t.mock.method(AuthAccessControlService, 'resolveForAccountId', (id: number) => ({
    groupKeys: [],
    permissionKeys: id === 1 ? ['chat.use', 'chat.agent.use', 'generation.execute'] : ['chat.use', 'chat.agent.use'],
  }))
  t.mock.method(ExternalApiProvider, 'findByName', () => ({ provider_name: 'test', display_name: 'Test', is_enabled: true, provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid/v1', additional_config: JSON.stringify({ max_concurrent_requests: 3 }) }))
  t.mock.method(ExternalApiProvider, 'getDecryptedKey', () => null)
  const requests: string[] = []
  const response = (content: string) => Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] })
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    const body = String(init?.body ?? '')
    requests.push(body)
    const request = JSON.parse(body)
    return response(`${request.model} did it.`)
  })
  const admin = { accountId: 1, accountType: 'admin' as const }
  const withAuthConfigured = async (body: () => Promise<void>) => {
    const admins = t.mock.method(AuthAccount, 'countActiveAdmins', () => 1)
    authHelpers.invalidateConfiguredAuthCache()
    try { await body() } finally {
      admins.mock.restore()
      authHelpers.invalidateConfiguredAuthCache()
    }
  }

  await t.test('daily times are read in the schedule time zone; intervals never fire a backlog', () => {
    const now = new Date('2026-10-09T00:30:00Z') // 09:30 in Seoul
    assert.equal(timing.nextDailyRunAt('09:00', now, 'Asia/Seoul'), '2026-10-10T00:00:00.000Z')
    assert.equal(timing.nextDailyRunAt('10:00', now, 'Asia/Seoul'), '2026-10-09T01:00:00.000Z')
    assert.equal(timing.nextDailyRunAt('09:00', now, 'UTC'), '2026-10-09T09:00:00.000Z')
    assert.equal(timing.nextDailyRunAt('10:00', now, 'Not/AZone'), '2026-10-09T01:00:00.000Z')
    assert.equal(timing.nextDailyRunAt('25:00', now, 'Asia/Seoul'), null)
    // A server that was down for two hours resumes on the interval's own rhythm, once.
    const next = timing.followingRunAt({ scheduleType: 'interval', intervalMinutes: 10 }, '2026-10-08T22:31:00Z', now)
    assert.equal(next, '2026-10-09T00:31:00.000Z')
    assert.equal(timing.followingRunAt({ scheduleType: 'once', runAt: now.toISOString() }, now.toISOString(), now), null)
  })

  // ---- Workflow schedules run as the account that saved them -------------------------------------------------------
  const moduleFor = (operationKey: string) => {
    const record = ModuleDefinitionModel.findAll().find((row) => {
      const fixed = typeof row.internal_fixed_values === 'string' ? JSON.parse(row.internal_fixed_values) : row.internal_fixed_values
      return fixed?.operation_key === operationKey
    })
    assert.ok(record, operationKey)
    return record
  }
  const graph = { nodes: [{ id: 'only', module_id: moduleFor('system.constant_text').id, position: { x: 0, y: 0 }, input_values: { text: 'x' } }], edges: [] }

  await t.test('a saved schedule records its account and its runs carry it', async () => {
    const workflowId = GraphWorkflowModel.create({ name: 'scheduled', graph } as any)
    const router = createGraphWorkflowScheduleRoutes() as any
    const route = router.stack.find((layer: any) => layer.route?.path === '/schedules' && layer.route.methods.post).route
    const handler = route.stack[route.stack.length - 1].handle
    const created = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      let status = 200
      const res = { status(code: number) { status = code; return this }, json(data: unknown) { resolve({ status, body: data }); return this } }
      Promise.resolve(handler({ params: {}, query: {}, session: { accountId: 1 }, body: { graph_workflow_id: workflowId, name: 'every hour', schedule_type: 'interval', interval_minutes: 60, status: 'active' } }, res, reject)).catch(reject)
    })
    assert.equal(created.status, 201)
    const schedule = GraphWorkflowScheduleModel.findById(created.body.data.id)!
    assert.equal(schedule.run_as_account_id, 1)
    assert.equal(schedule.timezone, 'Asia/Seoul')

    const due = new Date(Date.now() - 1000).toISOString()
    const make = (name: string, runAs: number | null, extra: Record<string, unknown> = {}) => GraphWorkflowScheduleModel.create({
      graph_workflow_id: workflowId, name, schedule_type: 'interval', interval_minutes: 60, status: 'active', confirmed_graph_version: 1, next_run_at: due, run_as_account_id: runAs, ...extra,
    } as any)
    GraphWorkflowScheduleModel.update(schedule.id, { next_run_at: due })
    const legacy = make('legacy', null)
    const disabled = make('disabled account', 9)
    const guest = make('guest account', 2)
    await (GraphWorkflowScheduleService as any).pollDueSchedules()

    const ranAs = (id: number) => GraphExecutionModel.findById(GraphWorkflowScheduleModel.findById(id)!.last_execution_id!)?.requested_by_account_id
    assert.equal(ranAs(schedule.id), 1)
    assert.equal(ranAs(legacy), null)
    for (const [id, code] of [[disabled, 'run_as_unavailable'], [guest, 'run_as_forbidden']] as const) {
      const stopped = GraphWorkflowScheduleModel.findById(id)!
      assert.equal(stopped.status, 'paused')
      assert.equal(stopped.stop_reason_code, code)
      assert.equal(stopped.last_execution_id ?? null, null)
    }
  })

  await t.test('a run cut off by a restart does not stop the schedule; a real failure does', async () => {
    const workflowId = GraphWorkflowModel.create({ name: 'restart', graph } as any)
    const failedRun = (message: string) => {
      const id = GraphExecutionModel.create({ graph_workflow_id: workflowId, graph_version: 1 } as any)
      settings.getUserSettingsDb().prepare("UPDATE graph_executions SET status = 'failed', error_message = ? WHERE id = ?").run(message, id)
      return id
    }
    const due = new Date(Date.now() - 1000).toISOString()
    const make = (executionId: number) => GraphWorkflowScheduleModel.create({
      graph_workflow_id: workflowId, name: 'x', schedule_type: 'interval', interval_minutes: 60, status: 'active', confirmed_graph_version: 1, next_run_at: due, last_execution_id: executionId, run_as_account_id: 1,
    } as any)
    const restarted = make(failedRun(RUNNING_EXECUTION_RESTART_MESSAGE))
    const broken = make(failedRun('node exploded'))
    await (GraphWorkflowScheduleService as any).pollDueSchedules()
    assert.equal(GraphWorkflowScheduleModel.findById(restarted)!.status, 'active')
    assert.notEqual(GraphWorkflowScheduleModel.findById(restarted)!.last_execution_id, null)
    assert.equal(GraphWorkflowScheduleModel.findById(broken)!.status, 'error_stopped')
  })

  // ---- Chat wakes ----------------------------------------------------------------------------------------------------
  const mina = ChatProfileStore.create({ name: 'Mina', engine: 'llm', providerName: 'test', model: 'mina', mcpEnabled: false, summaryEnabled: false })
  const rui = ChatProfileStore.create({ name: 'Rui', engine: 'llm', providerName: 'test', model: 'rui', mcpEnabled: false, summaryEnabled: false })

  await t.test('a wake reaches the character as the app’s request and is marked for a thin line', async () => {
    const threadId = CodexChatStore.createThread(1, 'mine', 'llm', mina.id)
    const result = await wakeChatRoom({ requester: admin, threadId, instruction: 'Check the queue.', routing: { source: 'routine', id: 5, name: 'Morning' } })
    assert.equal(result.replies.length, 1)
    assert.equal(result.replies[0].content, 'mina did it.')
    const sent = CodexChatStore.listMessages(threadId).find((message) => message.role === 'user')!
    assert.deepEqual(sent.routing?.routine, { source: 'routine', id: 5, name: 'Morning' })
    assert.match(sent.content, /Routine "Morning" — sent by the app/)
    assert.ok(requests.at(-1)!.includes('Check the queue.'))

    const theirs = CodexChatStore.createThread(2, 'theirs', 'llm', mina.id)
    await assert.rejects(wakeChatRoom({ requester: admin, threadId: theirs, instruction: 'x', routing: { source: 'routine', id: 5, name: 'Morning' } }), /채팅방이 아니거나/)
  })

  await t.test('a wake never cuts into a room that is still answering', async (s) => {
    const threadId = CodexChatStore.createThread(1, 'busy', 'llm', mina.id)
    s.mock.method(CodexChatService, 'isRunning', () => true)
    await assert.rejects(wakeChatRoom({ requester: admin, threadId, instruction: 'x', routing: { source: 'routine', id: 1, name: 'r' } }), ChatWakeBusyError)
    assert.equal(CodexChatStore.listMessages(threadId).filter((message) => message.role === 'user').length, 0)
  })

  await t.test('a group wake goes to the representative within its own chain limit', async () => {
    const room = GroupChatService.create(admin, { profileIds: [mina.id, rui.id], representativeId: rui.id, userProfileId: null })
    const result = await wakeChatRoom({ requester: admin, threadId: room.id, instruction: 'Talk among yourselves.', routing: { source: 'workflow', id: 3, name: 'Chatter' }, chainLimit: 0 })
    assert.deepEqual(result.replies.map((reply) => [reply.speaker_profile_id, reply.content]), [[rui.id, 'rui did it.']])
    const sent = CodexChatStore.listMessages(room.id).find((message) => message.role === 'user')!
    assert.equal(sent.routing?.routine?.source, 'workflow')
    // The reply's quote shows the instruction, not the frame the app adds for the model.
    assert.equal(result.replies[0].routing?.replyTo?.excerpt, 'Talk among yourselves.')
  })

  await t.test('an automation keeps one room per key and makes it again when it is gone', async () => {
    const first = await ensureAutomationRoom(admin, mina.id, 'test:1', 'Mina routine')
    assert.equal(first.title, 'Mina routine')
    assert.equal((await ensureAutomationRoom(admin, mina.id, 'test:1', 'Mina routine')).id, first.id)
    await CodexChatService.deleteThread(admin, first.id)
    const again = await ensureAutomationRoom(admin, mina.id, 'test:1', 'Mina routine')
    assert.notEqual(again.id, first.id)
  })

  // ---- Chat routines -------------------------------------------------------------------------------------------------
  await t.test('routine input is checked against the saving account', () => {
    const theirs = CodexChatStore.createThread(2, 'theirs', 'llm', mina.id)
    assert.throws(() => normalizeChatRoutineInput({ name: 'x', target: 'room', threadId: theirs, message: 'm', scheduleType: 'interval', intervalMinutes: 5 }, 1), /내 채팅방/)
    assert.throws(() => normalizeChatRoutineInput({ name: 'x', target: 'dedicated', profileId: mina.id, message: '', scheduleType: 'interval', intervalMinutes: 5 }, 1), /지시/)
    assert.throws(() => normalizeChatRoutineInput({ name: 'x', target: 'dedicated', profileId: mina.id, message: 'm', scheduleType: 'interval', intervalMinutes: 0 }, 1), /간격/)
    assert.throws(() => normalizeChatRoutineInput({ name: 'x', target: 'dedicated', profileId: mina.id, message: 'm', scheduleType: 'daily', dailyTime: '9:00' }, 1), /HH:mm/)
    const values = normalizeChatRoutineInput({ name: ' Morning ', target: 'dedicated', profileId: mina.id, message: 'Say hi.', scheduleType: 'daily', dailyTime: '09:00' }, 1)
    assert.equal(values.name, 'Morning')
    assert.equal(values.timezone, 'Asia/Seoul')
    assert.equal(values.account_id, 1)
  })

  await t.test('a due routine wakes its own room, moves its next time first, and records the outcome', async () => {
    const values = normalizeChatRoutineInput({ name: 'Morning', target: 'dedicated', profileId: mina.id, message: 'Say hi.', scheduleType: 'interval', intervalMinutes: 30 }, 1)
    const routine = ChatRoutineStore.create({ ...values, status: 'active', next_run_at: new Date(Date.now() - 1000).toISOString() })
    await ChatRoutineRunner.poll()
    for (let attempt = 0; attempt < 200 && ChatRoutineRunner.isRunning(routine.id); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10))
    const after = ChatRoutineStore.find(routine.id)!
    assert.equal(after.lastResult, 'ok')
    assert.equal(after.runCount, 1)
    assert.ok(after.nextRunAt && new Date(after.nextRunAt).getTime() > Date.now())
    assert.ok(after.threadId)
    const room = CodexChatStore.findThread(after.threadId!, 1)!
    assert.equal(room.title, 'Morning')
    assert.equal(CodexChatStore.listMessages(room.id).at(-1)?.content, 'mina did it.')
    // Run again by hand: the same room.
    await ChatRoutineRunner.fire(routine.id, { manual: true })
    assert.equal(ChatRoutineStore.find(routine.id)!.threadId, room.id)
    assert.equal(ChatRoutineStore.find(routine.id)!.runCount, 2)
  })

  await t.test('a routine pauses without its account, and stops after three failures in a row', async () => {
    const disabled = ChatRoutineStore.create({ ...normalizeChatRoutineInput({ name: 'Gone', target: 'dedicated', profileId: mina.id, message: 'm', scheduleType: 'interval', intervalMinutes: 5 }, 1), account_id: 9, status: 'active' })
    await ChatRoutineRunner.fire(disabled.id)
    assert.equal(ChatRoutineStore.find(disabled.id)!.status, 'paused')
    assert.match(ChatRoutineStore.find(disabled.id)!.stopReason ?? '', /실행 계정/)

    const off = ChatProfileStore.create({ name: 'Off', engine: 'llm', providerName: 'test', model: 'off', isEnabled: false })
    const offRoom = CodexChatStore.createThread(1, 'off', 'llm', off.id)
    const failing = ChatRoutineStore.create({ ...normalizeChatRoutineInput({ name: 'Broken', target: 'room', threadId: offRoom, message: 'm', scheduleType: 'interval', intervalMinutes: 5 }, 1), status: 'active' })
    for (let attempt = 0; attempt < 3; attempt += 1) await ChatRoutineRunner.fire(failing.id)
    const stopped = ChatRoutineStore.find(failing.id)!
    assert.equal(stopped.lastResult, 'failed')
    assert.equal(stopped.status, 'error_stopped')
    assert.equal(stopped.nextRunAt, null)
  })

  await t.test('a one-time routine ends after its run, but not after a manual one', async () => {
    const once = ChatRoutineStore.create({ ...normalizeChatRoutineInput({ name: 'Once', target: 'dedicated', profileId: mina.id, message: 'm', scheduleType: 'once', runAt: new Date(Date.now() + 3600_000).toISOString() }, 1), status: 'active' })
    await ChatRoutineRunner.fire(once.id, { manual: true })
    assert.equal(ChatRoutineStore.find(once.id)!.status, 'active')
    await ChatRoutineRunner.fire(once.id)
    assert.equal(ChatRoutineStore.find(once.id)!.status, 'completed')
  })

  await t.test('the stop-everything switch holds due routines and schedules until it is off again', async () => {
    const { AutomationSwitch } = await import('../src/services/automationSwitch')
    const due = new Date(Date.now() - 1000).toISOString()
    const routine = ChatRoutineStore.create({ ...normalizeChatRoutineInput({ name: 'Held', target: 'dedicated', profileId: mina.id, message: 'm', scheduleType: 'interval', intervalMinutes: 5 }, 1), status: 'active', next_run_at: due })
    const workflowId = GraphWorkflowModel.create({ name: 'held', graph } as any)
    const schedule = GraphWorkflowScheduleModel.create({ graph_workflow_id: workflowId, name: 'held', schedule_type: 'interval', interval_minutes: 5, status: 'active', confirmed_graph_version: 1, next_run_at: due, run_as_account_id: 1 } as any)
    assert.equal(AutomationSwitch.setPaused(true), true)
    await ChatRoutineRunner.poll()
    await (GraphWorkflowScheduleService as any).pollDueSchedules()
    assert.equal(ChatRoutineStore.find(routine.id)!.runCount, 0)
    assert.equal(ChatRoutineStore.find(routine.id)!.nextRunAt, due)
    assert.equal(GraphWorkflowScheduleModel.findById(schedule)!.last_execution_id ?? null, null)
    assert.equal(AutomationSwitch.setPaused(false), false)
    await (GraphWorkflowScheduleService as any).pollDueSchedules()
    assert.notEqual(GraphWorkflowScheduleModel.findById(schedule)!.last_execution_id ?? null, null)
    ChatRoutineStore.delete(routine.id)
  })

  // ---- Workflow nodes ------------------------------------------------------------------------------------------------
  async function runNode(operationKey: string, inputs: Record<string, unknown>, requester: number | null, handler = CHAT_NODE_HANDLERS[operationKey]) {
    const nodeGraph = { nodes: [{ id: 'n', module_id: moduleFor(operationKey).id, position: { x: 0, y: 0 }, input_values: {} }], edges: [] }
    const workflowId = GraphWorkflowModel.create({ name: `run ${operationKey}`, graph: nodeGraph } as any)
    const executionId = GraphExecutionModel.create({ graph_workflow_id: workflowId, graph_version: 1, requested_by_account_id: requester } as any)
    const context = {
      executionId, workflow: { id: workflowId, name: 'Night shift', graph: nodeGraph }, modulesById: new Map(), artifactsByNode: new Map(),
      debugMode: false, signal: new AbortController().signal, abort: () => {}, getAbortReason: () => null, requestedByAccountId: requester,
    } as any
    await handler(context, nodeGraph.nodes[0] as any, parseModuleDefinition(moduleFor(operationKey)), inputs)
    const artifacts = context.artifactsByNode.get('n') as Record<string, { value: any }>
    return { workflowId, out: Object.fromEntries(Object.entries(artifacts).map(([key, artifact]) => [key, artifact.value])) as Record<string, any> }
  }

  await t.test('the wake node answers with the character’s reply and keeps its own room', async () => {
    assert.ok(getSupportedSystemOperationKeys().includes('system.wake_chat_room'))
    assert.ok(getSupportedSystemOperationKeys().includes('system.read_runtime_status'))
    const { out } = await runNode('system.wake_chat_room', { target: 'dedicated', profile_id: mina.id, message: 'Report.' }, 1)
    assert.equal(out.text, 'mina did it.')
    assert.equal(out.replies.status, 'ok')
    const room = CodexChatStore.findThread(out.room_id, 1)!
    assert.equal(room.title, 'Night shift · Mina')
    const sent = CodexChatStore.listMessages(room.id).find((message) => message.role === 'user')!
    assert.equal(sent.routing?.routine?.source, 'workflow')

    const picked = CodexChatStore.createThread(1, 'picked', 'llm', rui.id)
    const { out: roomOut } = await runNode('system.wake_chat_room', { target: 'room', room_id: picked, message: 'Report.' }, 1)
    assert.equal(roomOut.room_id, picked)
    assert.equal(roomOut.text, 'rui did it.')

    await withAuthConfigured(async () => {
      await assert.rejects(runNode('system.wake_chat_room', { target: 'dedicated', profile_id: mina.id, message: 'Report.' }, null), /실행 계정이 없어서/)
    })
  })

  await t.test('the status node reports idle servers, filtered by tag, and none while ComfyUI work waits', async (s) => {
    const server = (id: number, tags: string[]) => ({ id, name: `S${id}`, endpoint: `http://s${id}.invalid`, backend_type: 'modal', capacity: 1, routing_tags: tags, is_active: true, is_default: false, created_date: '', updated_date: '' })
    s.mock.method(ComfyUIServerModel, 'findActiveServers', () => [server(1, ['gpu']), server(2, [])])
    const handler = executeReadRuntimeStatusNode as any
    const all = await runNode('system.read_runtime_status', {}, 1, handler)
    assert.equal(all.out.has_idle, true)
    assert.deepEqual(all.out.idle_server_ids, [1, 2])
    const tagged = await runNode('system.read_runtime_status', { server_tag: 'GPU' }, 1, handler)
    assert.deepEqual(tagged.out.idle_server_ids, [1])
    s.mock.method(GenerationQueueModel, 'getStatusCounts', () => ({ queued: 2, dispatching: 0, running: 0, completed: 0, failed: 0, cancelled: 0 }))
    const busy = await runNode('system.read_runtime_status', {}, 1, handler)
    assert.equal(busy.out.has_idle, false)
    assert.equal(busy.out.queue_waiting, 2)
  })
})
