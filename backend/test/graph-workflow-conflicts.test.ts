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

  const moved = await invoke(workflowRoutes, 'put', '/:id', workflowParams, { folder_id: null })
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
  const mockedUpdate = t.mock.method(WorkflowModel, 'update', (id, data) => {
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
