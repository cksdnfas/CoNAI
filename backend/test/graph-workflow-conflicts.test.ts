import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'

test('workflow and schedule revisions protect reviewed saves and preserve legacy writers', { timeout: 120000 }, async (t) => {
  const { ensureGraphWorkflowRevisionSchema } = await import('../src/database/graphWorkflowRevisionSchema')
  const legacy = new Database(':memory:')
  legacy.exec(`
    CREATE TABLE graph_workflows (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE graph_workflow_schedules (
      id INTEGER PRIMARY KEY, graph_workflow_id INTEGER, name TEXT, schedule_type TEXT, status TEXT,
      timezone TEXT, run_at TEXT, interval_minutes INTEGER, daily_time TEXT, max_run_count INTEGER,
      run_enqueue_count INTEGER, failure_policy TEXT, input_values TEXT, confirmed_graph_version INTEGER,
      confirmed_input_signature TEXT, stop_reason_code TEXT, stop_reason_message TEXT, run_as_account_id INTEGER,
      next_run_at TEXT, last_enqueued_at TEXT, revision INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO graph_workflows VALUES (1, 'old');
    INSERT INTO graph_workflow_schedules (id, status) VALUES (1, 'active');
    CREATE TRIGGER graph_workflow_schedules_advance_revision AFTER UPDATE ON graph_workflow_schedules
    WHEN NEW.revision = OLD.revision BEGIN UPDATE graph_workflow_schedules SET revision = OLD.revision + 1 WHERE id = NEW.id; END;
  `)
  ensureGraphWorkflowRevisionSchema(legacy)
  ensureGraphWorkflowRevisionSchema(legacy)
  legacy.exec("UPDATE graph_workflow_schedules SET next_run_at = 'later' WHERE id = 1")
  assert.equal((legacy.prepare('SELECT revision FROM graph_workflow_schedules').get() as { revision: number }).revision, 1)
  legacy.exec("UPDATE graph_workflows SET name = 'new' WHERE id = 1; UPDATE graph_workflow_schedules SET status = 'paused' WHERE id = 1")
  assert.deepEqual(legacy.prepare('SELECT name, revision FROM graph_workflows').get(), { name: 'new', revision: 2 })
  assert.deepEqual(legacy.prepare('SELECT status, revision FROM graph_workflow_schedules').get(), { status: 'paused', revision: 2 })
  legacy.close()

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-workflow-conflicts-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  t.after(async () => {
    user.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  const { GraphWorkflowModel } = await import('../src/models/GraphWorkflow')
  const { GraphWorkflowFolderModel } = await import('../src/models/GraphWorkflowFolder')
  const { GraphWorkflowScheduleModel } = await import('../src/models/GraphWorkflowSchedule')
  const { buildGraphWorkflowReservationContent } = await import('../src/services/graphWorkflowViewService')
  const { createGraphWorkflowCrudRoutes } = await import('../src/routes/graph-workflows/workflow-routes')
  const { createGraphWorkflowFolderRoutes } = await import('../src/routes/graph-workflows/folder-routes')
  const { createGraphWorkflowScheduleRoutes } = await import('../src/routes/graph-workflows/schedule-routes')
  const workflowRoutes = createGraphWorkflowCrudRoutes() as any
  const scheduleRoutes = createGraphWorkflowScheduleRoutes() as any
  const invoke = (router: any, method: string, routePath: string, params: Record<string, string>, body: unknown = {}, revision?: string) => new Promise<{ status: number; body: any }>((resolve, reject) => {
    const route = router.stack.find((layer: any) => layer.route?.path === routePath && layer.route.methods[method]).route
    const handler = route.stack[route.stack.length - 1].handle
    let status = 200
    const res = { status(code: number) { status = code; return this }, json(data: unknown) { resolve({ status, body: data }); return this } }
    Promise.resolve(handler({ params, body, query: {}, session: {}, get: () => revision }, res, reject)).catch(reject)
  })
  const graph = { nodes: [], edges: [] }
  const folder = GraphWorkflowFolderModel.create({ name: 'folder' })
  const workflowId = GraphWorkflowModel.create({ name: 'original', graph, folder_id: folder })
  const workflowParams = { id: String(workflowId) }
  const loaded = GraphWorkflowModel.findById(workflowId)!
  assert.equal(loaded.revision, 1)

  await t.test('folder moves reject cycles and create-and-assign never leaves a stray folder on conflict', async () => {
    const routes = createGraphWorkflowFolderRoutes()
    const parent = GraphWorkflowFolderModel.create({ name: 'Parent', description: 'Old description' })
    const child = GraphWorkflowFolderModel.create({ name: 'Child', parent_id: parent })
    const leaf = GraphWorkflowFolderModel.create({ name: 'Leaf', parent_id: child })
    assert.equal((await invoke(routes, 'put', '/folders/:id', { id: String(parent) }, { name: 'Lost', parent_id: leaf })).status, 400)
    assert.equal(GraphWorkflowFolderModel.findById(parent)!.parent_id, null)
    assert.equal(GraphWorkflowFolderModel.findById(parent)!.name, 'Parent')
    assert.equal((await invoke(routes, 'put', '/folders/:id', { id: String(parent) }, { description: null })).status, 200)
    assert.equal(GraphWorkflowFolderModel.findById(parent)!.description, null)
    const id = GraphWorkflowModel.create({ name: 'Move me', graph })
    const create = () => invoke(routes, 'post', '/folders', {}, { name: 'New folder', parent_id: child, assign_to: { workflow_id: id, expected_revision: 1 } })
    const result = await create()
    assert.equal(result.status, 201)
    assert.equal(result.body.data.workflow_revision, 2)
    assert.equal((await create()).status, 409)
    assert.deepEqual(GraphWorkflowFolderModel.findAll().filter(f => f.name === 'New folder').map(f => f.id), [result.body.data.id])
    assert.equal(GraphWorkflowModel.findById(id)!.folder_id, result.body.data.id)
    assert.equal(GraphWorkflowModel.findById(id)!.version, 1)
    assert.equal(GraphWorkflowFolderModel.delete(parent, 'delete_tree'), true)
    assert.equal(GraphWorkflowModel.findById(id), null)
  })

  await t.test('workflow writes commit or roll back the version, schedules, queue and notifications together', async () => {
    const db = user.getUserSettingsDb()
    const { subscribeToRuntimeEvents } = await import('../src/services/runtime-events/runtimeEventBus')
    const { GraphWorkflowExecutionQueue } = await import('../src/services/graphWorkflowExecutionQueue')
    const { GraphWorkflowScheduleService } = await import('../src/services/graphWorkflowScheduleService')
    const id = GraphWorkflowModel.create({ name: 'Atomic save', graph })
    const schedule = GraphWorkflowScheduleModel.create({ graph_workflow_id: id, name: 'Scheduled', schedule_type: 'daily', status: 'active' })
    const execution = db.prepare("INSERT INTO graph_executions (graph_workflow_id, graph_version, trigger_type, schedule_id, status) VALUES (?, 1, 'schedule', ?, 'queued')").run(id, schedule).lastInsertRowid
    const events: Array<[string, boolean]> = []
    const off = subscribeToRuntimeEvents(event => { if (event.name.startsWith('graph.')) events.push([event.name, db.inTransaction]) })
    const update = () => invoke(workflowRoutes, 'put', '/:id', { id: String(id) }, { graph: { nodes: [], edges: [], metadata: { debug_mode: true } }, expected_revision: 1 })
    const remove = () => invoke(workflowRoutes, 'delete', '/:id', { id: String(id) })
    try {
      db.exec("CREATE TEMP TRIGGER hold_schedule_queue BEFORE UPDATE OF status ON graph_executions BEGIN SELECT RAISE(ABORT,'held queue'); END")
      assert.equal((await update()).status, 500)
      const scheduleParams = { scheduleId: String(schedule) }
      await assert.rejects(invoke(scheduleRoutes, 'post', '/schedules/:scheduleId/pause', scheduleParams), /held queue/)
      db.exec("DROP TRIGGER hold_schedule_queue; CREATE TEMP TRIGGER hold_workflow_delete BEFORE DELETE ON graph_workflows BEGIN SELECT RAISE(ABORT,'held graph'); END")
      assert.equal((await remove()).status, 500)
      db.exec("CREATE TEMP TRIGGER hold_schedule_delete BEFORE DELETE ON graph_workflow_schedules BEGIN SELECT RAISE(ABORT,'held schedule'); END")
      await assert.rejects(invoke(scheduleRoutes, 'delete', '/schedules/:scheduleId', scheduleParams), /held schedule/)
      assert.deepEqual(events, [])
      assert.equal(GraphWorkflowModel.findById(id)!.revision, 1)
      assert.equal(GraphWorkflowModel.findVersionSummaries(id).length, 1)
      assert.equal(GraphWorkflowScheduleModel.findById(schedule)!.status, 'active')
      assert.equal(db.prepare('SELECT status FROM graph_executions WHERE id=?').pluck().get(execution), 'queued')
      db.exec('DROP TRIGGER hold_workflow_delete; DROP TRIGGER hold_schedule_delete')
      const saved = await update()
      assert.equal(saved.status, 200)
      assert.deepEqual(saved.body.data.schedule_maintenance, { pausedScheduleCount: 1, cancelled: 1, runningCancellationRequested: 0 })
      assert.deepEqual(events, [['graph.schedule.changed', false], ['graph.execution.status', false]])
      assert.equal(GraphWorkflowScheduleModel.findById(schedule)!.status, 'paused')
      assert.equal(db.prepare('SELECT status FROM graph_executions WHERE id=?').pluck().get(execution), 'cancelled')
      GraphWorkflowExecutionQueue.start()
      const run = GraphWorkflowExecutionQueue.enqueue(id)
      // The queue claimed this manual execution; deletion now lands before its async plan lookup completes.
      assert.equal(GraphWorkflowScheduleService.deleteWorkflow(id)?.runningCancellationRequested, 1)
      assert.equal(GraphWorkflowExecutionQueue.isCancellationRequested(run.executionId), true)
      assert.equal(GraphWorkflowScheduleModel.findById(schedule), null)
      const { writeExecutionLog } = await import('../src/services/graph-workflow-executor/shared')
      writeExecutionLog({ executionId: run.executionId, nodeId: 'settling', eventType: 'node_aborted', message: 'Settled after deletion', always: true })
      assert.equal(db.prepare('SELECT COUNT(*) FROM graph_execution_logs WHERE execution_id = ?').pluck().get(run.executionId), 0)
    } finally {
      off()
      await GraphWorkflowExecutionQueue.stop()
      db.exec('DROP TRIGGER IF EXISTS hold_schedule_queue; DROP TRIGGER IF EXISTS hold_workflow_delete; DROP TRIGGER IF EXISTS hold_schedule_delete')
    }
  })

  await t.test('workflow import and its initial version commit together, preserving an inactive export', async () => {
    const db = user.getUserSettingsDb()
    const payload = { schema: 'conai.graph-workflow.export', schema_version: 1, module_definitions: [],
      workflow: { name: 'imported draft', is_active: 0, graph: { nodes: [{ id: 'node', module_id: 900001 }], edges: [] } } }
    db.exec("CREATE TEMP TRIGGER reject_initial BEFORE INSERT ON graph_workflow_versions BEGIN SELECT RAISE(ABORT, 'held version'); END")
    try {
      assert.equal((await invoke(workflowRoutes, 'post', '/import', {}, { payload })).status, 400)
      assert.equal(db.prepare("SELECT count(*) FROM graph_workflows WHERE name = 'imported draft'").pluck().get(), 0)
      assert.equal(db.prepare("SELECT count(*) FROM module_definitions WHERE name = 'Missing module 900001'").pluck().get(), 0)
      assert.throws(() => GraphWorkflowModel.create({ name: 'held create', graph }), /held version/)
      assert.equal(db.prepare("SELECT count(*) FROM graph_workflows WHERE name = 'held create'").pluck().get(), 0)
    } finally { db.exec('DROP TRIGGER reject_initial') }
    const imported = await invoke(workflowRoutes, 'post', '/import', {}, { payload })
    assert.equal(imported.status, 201)
    const exported = await invoke(workflowRoutes, 'get', '/:id/export', { id: String(imported.body.data.id) })
    assert.equal(exported.body.data.workflow.is_active, false)
    assert.deepEqual(exported.body.data.module_definitions.map((row: { original_id: number }) => row.original_id), imported.body.data.placeholder_module_ids)
  })

  const same = await invoke(workflowRoutes, 'put', '/:id', workflowParams, {
    name: loaded.name, description: null, folder_id: folder, graph: { edges: [], nodes: [] }, is_active: true, expected_revision: loaded.revision,
  })
  assert.equal(same.status, 200)
  assert.equal(same.body.data.revision, loaded.revision, 'another editor can still save after an equivalent document with reordered object keys')
  assert.equal(same.body.data.schedule_maintenance, null)
  const moved = await invoke(workflowRoutes, 'put', '/:id', workflowParams, { folder_id: null, expected_revision: loaded.revision })
  assert.equal(moved.status, 200)
  assert.equal(GraphWorkflowModel.findById(workflowId)!.version, loaded.version, 'metadata does not change the execution graph version')
  const staleGraph = await invoke(workflowRoutes, 'put', '/:id', workflowParams, { name: 'stale', graph, folder_id: folder, expected_revision: loaded.revision })
  assert.equal(staleGraph.status, 409)
  assert.equal(GraphWorkflowModel.findById(workflowId)!.folder_id, null)
  assert.equal(GraphWorkflowModel.findById(workflowId)!.name, 'original')

  GraphWorkflowModel.update(workflowId, { folder_id: folder })
  const beforeFolderDelete = GraphWorkflowModel.findById(workflowId)!
  GraphWorkflowFolderModel.delete(folder, 'move_children')
  assert.equal(GraphWorkflowModel.findById(workflowId)!.revision, beforeFolderDelete.revision + 1)
  assert.equal((await invoke(workflowRoutes, 'put', '/:id', workflowParams, { name: 'stale folder', expected_revision: beforeFolderDelete.revision })).status, 409)

  const scheduleId = GraphWorkflowScheduleModel.create({
    graph_workflow_id: workflowId, name: 'hourly', schedule_type: 'interval', interval_minutes: 60,
    status: 'active', confirmed_graph_version: 1, next_run_at: '2099-01-01T00:00:00.000Z',
  })
  const scheduleParams = { scheduleId: String(scheduleId) }
  const beforeBookkeeping = GraphWorkflowScheduleModel.findById(scheduleId)!
  const firstSnapshot = buildGraphWorkflowReservationContent()
  assert.equal(firstSnapshot.schedules.find((schedule) => schedule.id === scheduleId)?.workflow_version, 1)
  GraphWorkflowScheduleModel.update(scheduleId, {
    next_run_at: '2099-01-02T00:00:00.000Z', last_enqueued_at: '2099-01-01T00:00:00.000Z',
  })
  assert.equal(GraphWorkflowScheduleModel.findById(scheduleId)!.revision, beforeBookkeeping.revision, 'routine run bookkeeping is not an edit conflict')
  assert.equal(buildGraphWorkflowReservationContent().schedules.find((schedule) => schedule.id === scheduleId)?.next_run_at, '2099-01-02T00:00:00.000Z')
  assert.equal((await invoke(scheduleRoutes, 'put', '/schedules/:scheduleId', scheduleParams, {
    name: 'hourly', schedule_type: 'interval', interval_minutes: 60, input_values: {}, timezone: 'Asia/Seoul',
    expected_revision: beforeBookkeeping.revision, expected_graph_version: 1,
  })).status, 200)
  assert.equal(GraphWorkflowScheduleModel.findById(scheduleId)!.revision, beforeBookkeeping.revision, 'equivalent defaults are not configuration changes')
  const editAfterRun = await invoke(scheduleRoutes, 'put', '/schedules/:scheduleId', scheduleParams, {
    name: 'edited while running', schedule_type: 'interval', interval_minutes: 60,
    expected_revision: beforeBookkeeping.revision, expected_graph_version: 1,
  })
  assert.equal(editAfterRun.status, 200)
  let opened = GraphWorkflowScheduleModel.findById(scheduleId)!
  assert.equal(opened.next_run_at, '2099-01-02T00:00:00.000Z', 'saving unchanged timing keeps the scheduler’s next run')
  assert.ok(opened.revision > beforeBookkeeping.revision)
  assert.equal(buildGraphWorkflowReservationContent().schedules.find((schedule) => schedule.id === scheduleId)?.revision, opened.revision)
  const otherWriter = new Database(user.getUserSettingsDb().name)
  otherWriter.prepare('UPDATE graph_workflow_schedules SET name = ? WHERE id = ?').run('another process', scheduleId)
  otherWriter.close()
  assert.equal(buildGraphWorkflowReservationContent().schedules.find((schedule) => schedule.id === scheduleId)?.name, 'another process')
  opened = GraphWorkflowScheduleModel.findById(scheduleId)!
  user.getUserSettingsDb().prepare('UPDATE graph_workflows SET name = ? WHERE id = ?').run('direct workflow change', workflowId)
  assert.equal(buildGraphWorkflowReservationContent().workflows.find((workflow) => workflow.id === workflowId)?.name, 'direct workflow change')
  const currentWorkflow = GraphWorkflowModel.findById(workflowId)!
  const changed = await invoke(workflowRoutes, 'put', '/:id', workflowParams, {
    graph: { nodes: [{ id: 'new', module_id: 1, position: { x: 0, y: 0 } }], edges: [] },
    version: currentWorkflow.version,
    expected_revision: currentWorkflow.revision,
  })
  assert.equal(changed.status, 200)
  assert.equal(changed.body.data.schedule_maintenance.pausedScheduleCount, 1)
  const paused = GraphWorkflowScheduleModel.findById(scheduleId)!
  assert.equal(paused.status, 'paused')
  assert.equal(paused.stop_reason_code, 'workflow_changed')
  const reviewedRow = buildGraphWorkflowReservationContent().schedules.find((schedule) => schedule.id === scheduleId)
  assert.equal(reviewedRow?.revision, paused.revision)
  assert.equal(reviewedRow?.workflow_version, currentWorkflow.version + 1)
  const staleSchedule = await invoke(scheduleRoutes, 'put', '/schedules/:scheduleId', scheduleParams, {
    name: 'stale', status: 'active', expected_revision: opened.revision, expected_graph_version: 1,
  })
  assert.equal(staleSchedule.status, 409)
  assert.equal(GraphWorkflowScheduleModel.findById(scheduleId)!.stop_reason_code, 'workflow_changed')
  assert.equal(GraphWorkflowScheduleModel.findById(scheduleId)!.confirmed_graph_version, 1)
  assert.equal((await invoke(scheduleRoutes, 'put', '/schedules/:scheduleId', scheduleParams, {
    name: 'stale workflow', expected_revision: paused.revision, expected_graph_version: 1,
  })).status, 409, 'the reviewed graph version is checked independently')
  assert.equal((await invoke(scheduleRoutes, 'put', '/schedules/:scheduleId', scheduleParams, {
    name: 'old active page action', expected_status: 'active',
  })).status, 409, 'an old active page action does not resume a paused schedule')
  assert.equal((await invoke(scheduleRoutes, 'post', '/schedules/:scheduleId/pause', scheduleParams, {
    expected_revision: opened.revision,
  })).status, 409)

  const workflowVersion = GraphWorkflowModel.findById(workflowId)!.version
  assert.ok(workflowVersion > currentWorkflow.version, 'a graph change cannot reuse an explicitly supplied old version')
  GraphWorkflowModel.update(workflowId, { version: 1 })
  assert.equal(GraphWorkflowModel.findById(workflowId)!.version, workflowVersion, 'a later metadata write cannot rewind the graph version')
  const editPaused = await invoke(scheduleRoutes, 'put', '/schedules/:scheduleId', scheduleParams, {
    name: 'reviewed', expected_revision: paused.revision, expected_graph_version: workflowVersion,
  })
  assert.equal(editPaused.status, 200)
  const stillPaused = GraphWorkflowScheduleModel.findById(scheduleId)!
  assert.equal(stillPaused.status, 'paused')
  assert.equal(stillPaused.stop_reason_code, 'workflow_changed')
  assert.equal(stillPaused.confirmed_graph_version, 1, 'editing a paused schedule does not confirm the new graph')
  assert.equal((await invoke(scheduleRoutes, 'post', '/schedules/:scheduleId/resume', scheduleParams, {
    expected_revision: stillPaused.revision, expected_graph_version: 1,
  })).status, 409)
  assert.equal(GraphWorkflowScheduleModel.findById(scheduleId)!.status, 'paused')
  assert.equal((await invoke(scheduleRoutes, 'put', '/schedules/:scheduleId', scheduleParams, {
    status: 'active', expected_revision: stillPaused.revision, expected_graph_version: workflowVersion,
  })).status, 200, 'an explicit activation with reviewed revisions is allowed')
  const active = GraphWorkflowScheduleModel.findById(scheduleId)!
  assert.equal(active.status, 'active')
  assert.equal((await invoke(scheduleRoutes, 'post', '/schedules/:scheduleId/pause', scheduleParams, {
    expected_revision: stillPaused.revision,
  })).status, 409)
  assert.equal((await invoke(scheduleRoutes, 'post', '/schedules/:scheduleId/pause', scheduleParams, {
    expected_revision: active.revision,
  })).status, 200)
  const manuallyPaused = GraphWorkflowScheduleModel.findById(scheduleId)!
  assert.equal((await invoke(scheduleRoutes, 'post', '/schedules/:scheduleId/resume', scheduleParams, {
    expected_revision: manuallyPaused.revision, expected_graph_version: workflowVersion,
  })).status, 200)
  const resumed = GraphWorkflowScheduleModel.findById(scheduleId)!
  assert.equal(resumed.status, 'active')
  assert.equal(resumed.confirmed_graph_version, workflowVersion)
  GraphWorkflowScheduleModel.update(scheduleId, { status: 'completed', stop_reason_code: 'max_run_count_reached' })
  assert.equal((await invoke(scheduleRoutes, 'put', '/schedules/:scheduleId', scheduleParams, {
    name: 'stale again', status: 'active', expected_revision: resumed.revision, expected_graph_version: workflowVersion,
  })).status, 409)
  assert.equal(GraphWorkflowScheduleModel.findById(scheduleId)!.status, 'completed')

  const newSchedule = { graph_workflow_id: workflowId, name: 'new', schedule_type: 'interval', interval_minutes: 60 }
  assert.equal((await invoke(scheduleRoutes, 'post', '/schedules', {}, { ...newSchedule, expected_graph_version: 1 })).status, 409)
  assert.equal((await invoke(scheduleRoutes, 'post', '/schedules', {}, { ...newSchedule, expected_graph_version: workflowVersion })).status, 201)
  assert.equal((await invoke(workflowRoutes, 'put', '/:id', workflowParams, { name: 'legacy writer' })).status, 200)
  assert.equal(GraphWorkflowModel.findById(workflowId)!.name, 'legacy writer')

  const { WorkflowModel } = await import('../src/models/Workflow')
  const { nativeEditRevision } = await import('../src/services/nativeEditRevision')
  const comfyRoutes = (await import('../src/routes/workflows/crud.routes')).default as any
  const comfyId = WorkflowModel.create({ name: 'comfy', workflow_json: '{}' })
  const comfyRevision = nativeEditRevision(WorkflowModel.findById(comfyId))
  const otherConnection = new Database(user.getUserSettingsDb().name)
  otherConnection.pragma('busy_timeout = 0')
  const originalUpdate = WorkflowModel.update.bind(WorkflowModel)
  const mockedUpdate = t.mock.method(WorkflowModel, 'update', (id: number, data: Parameters<typeof WorkflowModel.update>[1]) => {
    assert.throws(() => otherConnection.prepare('UPDATE workflows SET name = ? WHERE id = ?').run('concurrent', id), /locked/)
    return originalUpdate(id, data)
  })
  try {
    assert.equal((await invoke(comfyRoutes, 'put', '/:id', { id: String(comfyId) }, { name: 'reviewed comfy' }, comfyRevision)).status, 200)
  } finally {
    mockedUpdate.mock.restore()
    otherConnection.close()
  }
  assert.equal((await invoke(comfyRoutes, 'put', '/:id', { id: String(comfyId) }, { name: 'stale comfy' }, comfyRevision)).status, 409)
  assert.equal(WorkflowModel.findById(comfyId)!.name, 'reviewed comfy')
})
