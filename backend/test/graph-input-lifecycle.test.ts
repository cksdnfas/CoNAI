import './support/testTemp'
import './support/scratchRuntime'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { test } from 'node:test'
import express from 'express'
import { initializeAuthDb, getAuthDb } from '../src/database/authDb'
import { initializeDatabase, closeDatabase } from '../src/database/init'
import { initializeUserSettingsDb, closeUserSettingsDb, getUserSettingsDb } from '../src/database/userSettingsDb'
import { runtimePaths } from '../src/config/runtimePaths'
import { WorkflowModel } from '../src/models/Workflow'
import { AuthPermissionGroup } from '../src/models/AuthPermissionGroup'
import { invalidateConfiguredAuthCache } from '../src/services/auth/sessionAccess'
import { GenerationQueueModel } from '../src/models/GenerationQueue'
import { GenerationQueueService } from '../src/services/generationQueueService'
import { GraphWorkflowExecutionQueue } from '../src/services/graphWorkflowExecutionQueue'
import { settingsService } from '../src/services/settingsService'
import { createGenerationQueueActionRoutes } from '../src/routes/generation-queue/queue-action-routes'
import { enqueueGenerationJobs } from '../src/services/generation-queue/queueEnqueue'
import { resolveWorkflowRoleQueueLimitState } from '../src/services/generation-queue/queueRoleLimitPolicy'
import { ComfyUIService } from '../src/services/comfyuiService'
import { getIncomingArtifacts } from '../src/services/graph-workflow-executor/artifacts'
import { executeComfyModule } from '../src/services/graph-workflow-executor/execute-comfy'
import { getWorkflowInputAssetStoreDir, isWorkflowInputAssetRef, pruneDeletedWorkflowInputAssets, resolveWorkflowInputAssetFilePath, storeGraphQueueInputFile } from '../src/services/workflowInputAssetStore'
import { getQueueInputStoreDir, resolveQueueInputFilePath, storeQueueInputBuffer, sweepOrphanQueueInputFiles } from '../src/services/generation-queue/queueInputStore'

test('graph input copies are retained only by committed jobs and queue orphans are swept', { timeout: 60000 }, async (t) => {
  initializeAuthDb()
  await initializeDatabase()
  initializeUserSettingsDb()
  t.after(async () => {
    await GenerationQueueService.stopAndDrain()
    getAuthDb().close()
    closeUserSettingsDb()
    closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
  })
  const bytes = Buffer.from('graph artifact bytes')
  const source = path.join(runtimePaths.basePath, 'graph-source.png')
  await fs.promises.writeFile(source, bytes)
  const workflowId = WorkflowModel.create({
    name: 'graph input', workflow_json: '{}',
    marked_fields: [{ id: 'image', label: 'Image', type: 'image', jsonPath: '1.inputs.image', required: false }],
  })
  const controller = new AbortController()
  const context = {
    executionId: 1, workflow: { name: 'graph', graph: {
      nodes: [{ id: 'source', module_id: 1 }, { id: 'target', module_id: 2 }],
      edges: [{ source_node_id: 'source', source_port_key: 'image', target_node_id: 'target', target_port_key: 'image' }],
    } },
    modulesById: new Map([[2, { engine_type: 'comfyui', exposed_inputs: [{ key: 'image', data_type: 'image' }] }]]),
    artifactsByNode: new Map([['source', { image: { type: 'image', value: { storagePath: source }, storagePath: source } }]]),
    signal: controller.signal, getAbortReason: () => null,
  } as any
  const graphRef = ((await getIncomingArtifacts(context, 'target')).image as any).value
  const node = { id: 'target', input_values: { image: true } } as any
  const direct = { name: 'direct', template_defaults: { workflow_json: {}, marked_fields: [{ id: 'image', type: 'image' }], api_endpoint: 'http://127.0.0.1:1' } } as any
  const queued = { name: 'queued', source_workflow_id: workflowId, template_defaults: {}, output_ports: [] } as any
  const assetFiles = async () => {
    try { return (await fs.promises.readdir(getWorkflowInputAssetStoreDir(), { recursive: true })).filter((name) => /\.(bin|deleted|part|graph|claimed)$/.test(String(name))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  }

  await t.test('direct modules stream the trusted artifact without making a queue copy', async (sub) => {
    sub.mock.method(ComfyUIService.prototype, 'uploadInputImage', async (_name, input) => {
      const chunks: Buffer[] = []
      for await (const chunk of input as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk))
      assert.deepEqual(Buffer.concat(chunks), bytes)
      throw new Error('direct upload reached')
    })
    await assert.rejects(executeComfyModule(context, node, direct, { image: graphRef }), /direct upload reached/)
    assert.deepEqual(await assetFiles(), [])
    assert.equal(fs.existsSync(getQueueInputStoreDir()), false)
  })

  await t.test('a copy is discarded when enqueue fails', async (sub) => {
    sub.mock.method(GenerationQueueModel, 'createMany', () => { throw new Error('enqueue failed') })
    await assert.rejects(executeComfyModule(context, node, queued, { image: graphRef }), /enqueue failed/)
    assert.deepEqual(await assetFiles(), [])
  })

  await t.test('a failed partial copy is discarded', async (sub) => {
    sub.mock.method(fs.promises, 'copyFile', async (_source, destination) => {
      await fs.promises.writeFile(destination, 'partial')
      throw new Error('copy failed')
    })
    await assert.rejects(executeComfyModule(context, node, queued, { image: graphRef }), /copy failed/)
    assert.deepEqual(await assetFiles(), [])
  })

  await t.test('a copy is discarded if the node aborts before enqueue', async (sub) => {
    const abort = new AbortController()
    const originalCopy = fs.promises.copyFile.bind(fs.promises)
    sub.mock.method(fs.promises, 'copyFile', async (...args: Parameters<typeof fs.promises.copyFile>) => {
      await originalCopy(...args)
      if (String(args[1]).endsWith('.bin.part')) abort.abort()
    })
    await assert.rejects(executeComfyModule({ ...context, signal: abort.signal }, node, queued, { image: graphRef }), /aborted/)
    assert.deepEqual(await assetFiles(), [])
  })

  await t.test('a committed job keeps its copy for retries', async (sub) => {
    sub.mock.method(GenerationQueueService, 'waitForTerminalJob', async () => ({ status: 'failed', failure_message: 'queue stopped' } as any))
    await assert.rejects(executeComfyModule(context, node, queued, { image: graphRef }), /queue stopped/)
    const row = getUserSettingsDb().prepare('SELECT id, request_payload FROM generation_queue_jobs ORDER BY id DESC LIMIT 1').get() as { id: number; request_payload: string }
    const ref = JSON.parse(row.request_payload).prompt_data.image
    assert.ok(isWorkflowInputAssetRef(ref))
    assert.deepEqual(await fs.promises.readFile(resolveWorkflowInputAssetFilePath(ref)!), bytes)
    assert.ok(getUserSettingsDb().prepare('SELECT 1 FROM workflow_input_asset_job_refs WHERE job_id = ? AND asset_id = ?').get(row.id, ref.id))
  })

  await t.test('graph input files use exclusive copy when hard links are unavailable', async (sub) => {
    sub.mock.method(fs.promises, 'link', async () => { throw Object.assign(new Error('unsupported'), { code: 'ENOTSUP' }) })
    sub.mock.method(GenerationQueueService, 'waitForTerminalJob', async () => ({ status: 'failed', failure_message: 'queue stopped' } as any))
    await assert.rejects(executeComfyModule(context, node, queued, { image: graphRef }), /queue stopped/)
    const row = getUserSettingsDb().prepare('SELECT request_payload FROM generation_queue_jobs ORDER BY id DESC LIMIT 1').get() as { request_payload: string }
    const ref = JSON.parse(row.request_payload).prompt_data.image
    assert.deepEqual(await fs.promises.readFile(resolveWorkflowInputAssetFilePath(ref)!), bytes)
  })

  await t.test('graph-owned copies are released with the last retryable job despite live graphs', async (sub) => {
    sub.mock.method(GenerationQueueService, 'waitForTerminalJob', async () => ({ status: 'failed', failure_message: 'queue stopped' } as any))
    const db = getUserSettingsDb()
    const graphId = Number(db.prepare("INSERT INTO graph_workflows (name, graph_json) VALUES ('unrelated', '{}')").run().lastInsertRowid)
    db.prepare("INSERT INTO graph_executions (graph_workflow_id, graph_version, status) VALUES (?, 1, 'running')").run(graphId)
    await assert.rejects(executeComfyModule(context, node, queued, { image: graphRef }), /queue stopped/)
    const original = db.prepare('SELECT id, request_payload FROM generation_queue_jobs ORDER BY id DESC LIMIT 1').get() as { id: number; request_payload: string }
    const ref = JSON.parse(original.request_payload).prompt_data.image
    const retryId = GenerationQueueModel.create({ service_type: 'comfyui', request_payload: { image: ref } })
    db.prepare("UPDATE generation_queue_jobs SET status = 'failed' WHERE id = ?").run(original.id)
    GenerationQueueModel.pruneTerminalRequestPayloads({ retainRecentTerminalJobs: 0 })
    assert.ok(resolveWorkflowInputAssetFilePath(ref), 'a retry still claims the graph copy')
    db.prepare("UPDATE generation_queue_jobs SET status = 'failed' WHERE id = ?").run(retryId)
    GenerationQueueModel.pruneTerminalRequestPayloads({ retainRecentTerminalJobs: 0 })
    assert.equal(resolveWorkflowInputAssetFilePath(ref), null)
  })

  await t.test('the collector protects the owning graph but not unrelated graph runs', async () => {
    const db = getUserSettingsDb()
    const graphId = Number(db.prepare("INSERT INTO graph_workflows (name, graph_json) VALUES ('owner', '{}')").run().lastInsertRowid)
    const owner = Number(db.prepare("INSERT INTO graph_executions (graph_workflow_id, graph_version, status) VALUES (?, 1, 'running')").run(graphId).lastInsertRowid)
    const ref = await storeGraphQueueInputFile(source, { fileName: 'input.png', executionId: owner })
    await pruneDeletedWorkflowInputAssets()
    assert.ok(resolveWorkflowInputAssetFilePath(ref))
    db.prepare("UPDATE graph_executions SET status = 'completed' WHERE id = ?").run(owner)
    await pruneDeletedWorkflowInputAssets()
    assert.equal(resolveWorkflowInputAssetFilePath(ref), null)
  })

  await t.test('a removed job leaves no graph copy even while its graph still runs', async () => {
    const db = getUserSettingsDb()
    const graphId = Number(db.prepare("INSERT INTO graph_workflows (name, graph_json) VALUES ('removed-job', '{}')").run().lastInsertRowid)
    const owner = Number(db.prepare("INSERT INTO graph_executions (graph_workflow_id, graph_version, status) VALUES (?, 1, 'running')").run(graphId).lastInsertRowid)
    const ref = await storeGraphQueueInputFile(source, { fileName: 'input.png', executionId: owner })
    const jobId = GenerationQueueModel.create({ service_type: 'comfyui', request_payload: { image: ref } })
    await pruneDeletedWorkflowInputAssets()
    assert.ok(resolveWorkflowInputAssetFilePath(ref))
    db.prepare('DELETE FROM generation_queue_jobs WHERE id = ?').run(jobId)
    await pruneDeletedWorkflowInputAssets()
    assert.equal(resolveWorkflowInputAssetFilePath(ref), null)
  })

  await t.test('graph jobs do not occupy role slots or allow a client to forge the origin', async (sub) => {
    sub.mock.method(GenerationQueueService, 'waitForTerminalJob', async () => ({ status: 'failed', failure_message: 'queue stopped' } as any))
    const auth = getAuthDb()
    const group = AuthPermissionGroup.createCustomGroup({ name: 'limited graph', permissionKeys: ['generation.execute', 'workflows.view'] })
    const accountId = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('limited', 'unused', 'guest')").run().lastInsertRowid)
    auth.prepare('INSERT INTO auth_account_group_memberships (account_id, group_id) VALUES (?, ?)').run(accountId, group.id)
    const roleWorkflow = { id: workflowId, public_queue_role_limits: JSON.stringify({ [group.group_key]: 1 }) }
    await assert.rejects(executeComfyModule({ ...context, requestedByAccountId: accountId }, node, queued, { image: graphRef }), /queue stopped/)
    const graphJob = getUserSettingsDb().prepare('SELECT id, requested_by_account_id FROM generation_queue_jobs ORDER BY id DESC LIMIT 1').get() as { id: number; requested_by_account_id: number }
    assert.equal(graphJob.requested_by_account_id, accountId)
    assert.equal(GenerationQueueModel.isGraphOrigin(graphJob.id), true)
    assert.equal(resolveWorkflowRoleQueueLimitState({ workflow: roleWorkflow, accountId, accountType: 'guest' })?.active, 0)
    const userJob = enqueueGenerationJobs({
      service_type: 'comfyui', workflow_id: workflowId, requested_by_account_id: accountId,
      request_payload: { _debug: { __conaiGraphQueueOrigin: true } },
    }, { roleLimitWorkflow: roleWorkflow }).jobIds[0]
    getUserSettingsDb().prepare('UPDATE generation_queue_jobs SET debug_enabled = NULL, debug_meta = NULL WHERE id = ?').run(userJob)
    GenerationQueueModel.updateDebugMeta(userJob, { snapshot: true })
    assert.equal(GenerationQueueModel.isGraphOrigin(userJob), false)
    assert.equal(resolveWorkflowRoleQueueLimitState({ workflow: roleWorkflow, accountId, accountType: 'guest' })?.active, 1)
    assert.throws(() => enqueueGenerationJobs({
      service_type: 'comfyui', workflow_id: workflowId, requested_by_account_id: accountId, request_payload: {},
    }, { roleLimitWorkflow: roleWorkflow }), /1/)
    getUserSettingsDb().prepare("UPDATE generation_queue_jobs SET status = 'failed' WHERE id = ?").run(graphJob.id)
    getUserSettingsDb().prepare('UPDATE workflows SET public_queue_role_limits = ? WHERE id = ?').run(roleWorkflow.public_queue_role_limits, workflowId)
    const adminId = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('admin', 'unused', 'admin')").run().lastInsertRowid)
    auth.prepare("INSERT INTO auth_account_group_memberships (account_id, group_id) SELECT ?, id FROM auth_permission_groups WHERE group_key = 'admin'").run(adminId)
    invalidateConfiguredAuthCache()
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
      const isAdmin = req.get('x-test-admin') === 'true'
      Object.assign(req, { session: { authenticated: true, accountId: isAdmin ? adminId : accountId, accountType: isAdmin ? 'admin' : 'guest' } })
      next()
    })
    app.use('/api/generation-queue', createGenerationQueueActionRoutes())
    const server = http.createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    sub.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/generation-queue/${graphJob.id}/retry`
    const retry = (isAdmin = false) => fetch(url, { method: 'POST', headers: isAdmin ? { 'x-test-admin': 'true' } : {} })
    assert.equal((await retry()).status, 429)
    getUserSettingsDb().prepare("UPDATE generation_queue_jobs SET status = 'completed' WHERE id = ?").run(userJob)
    const accepted = await retry()
    assert.equal(accepted.status, 201)
    const guestRetry = (await accepted.json() as { record: { id: number; requested_by_account_id: number } }).record
    assert.equal(GenerationQueueModel.isGraphOrigin(guestRetry.id), false)
    assert.equal(guestRetry.requested_by_account_id, accountId)
    for (let attempt = 0; attempt < 4; attempt += 1) assert.equal((await retry()).status, 429)
    assert.equal(resolveWorkflowRoleQueueLimitState({ workflow: roleWorkflow, accountId, accountType: 'guest' })?.active, 1)
    const adminResponse = await retry(true)
    assert.equal(adminResponse.status, 201)
    const adminRetry = (await adminResponse.json() as { record: { id: number; requested_by_account_id: number } }).record
    assert.equal(GenerationQueueModel.isGraphOrigin(adminRetry.id), true)
    assert.equal(adminRetry.requested_by_account_id, accountId)
    assert.equal(resolveWorkflowRoleQueueLimitState({ workflow: roleWorkflow, accountId, accountType: 'guest' })?.active, 1)
  })

  await t.test('graph-origin jobs do not lower scheduled graph concurrency', async (sub) => {
    const db = getUserSettingsDb()
    db.prepare("UPDATE generation_queue_jobs SET status = 'completed'").run()
    const settings = settingsService.loadSettings()
    const reservations = { ...settings.generationThrottle.reservations, maxConcurrentJobs: 4 }
    reservations.userQueuePolicy = 'hold_until_empty'
    sub.mock.method(settingsService, 'loadSettings', () => ({
      ...settings, generationThrottle: { ...settings.generationThrottle, reservations },
    }))
    const graphJob = GenerationQueueModel.create({ service_type: 'comfyui', requested_by_account_id: 1, request_payload: {} })
    GenerationQueueModel.markGraphOrigin(graphJob)
    for (const status of ['queued', 'dispatching', 'running']) {
      db.prepare('UPDATE generation_queue_jobs SET status = ? WHERE id = ?').run(status, graphJob)
      assert.equal(GenerationQueueModel.hasActiveUserSubmittedJobs(), false)
      assert.equal(GraphWorkflowExecutionQueue.getWorkflowRuntimeQueueState(1).schedule_concurrency_limit, 4)
    }
    const userJob = GenerationQueueModel.create({
      service_type: 'comfyui', requested_by_account_id: 1,
      request_payload: { _debug: { __conaiGraphQueueOrigin: true } },
    })
    assert.equal(GenerationQueueModel.hasActiveUserSubmittedJobs(), true)
    assert.equal(GraphWorkflowExecutionQueue.getWorkflowRuntimeQueueState(1).schedule_concurrency_limit, 0)
    reservations.userQueuePolicy = 'continue_limited'
    assert.equal(GraphWorkflowExecutionQueue.getWorkflowRuntimeQueueState(1).schedule_concurrency_limit, 1)
    db.prepare('UPDATE generation_queue_jobs SET cancel_requested = 1 WHERE id = ?').run(userJob)
    assert.equal(GraphWorkflowExecutionQueue.getWorkflowRuntimeQueueState(1).schedule_concurrency_limit, 4)
  })

  await t.test('bounded orphan sweeping preserves claimed blobs', async () => {
    const orphan = storeQueueInputBuffer(Buffer.from('orphan'))
    const claimed = storeQueueInputBuffer(Buffer.from('claimed'))
    GenerationQueueModel.create({ service_type: 'comfyui', request_payload: { image: claimed } })
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
    await fs.promises.utimes(resolveQueueInputFilePath(orphan)!, old, old)
    await fs.promises.utimes(resolveQueueInputFilePath(claimed)!, old, old)
    const result = await sweepOrphanQueueInputFiles()
    assert.ok(result.removed >= 1)
    assert.equal(resolveQueueInputFilePath(orphan), null)
    assert.ok(resolveQueueInputFilePath(claimed))
  })

  await t.test('reusing an old blob starts a new in-flight grace period', async () => {
    const data = Buffer.from('reused')
    const ref = storeQueueInputBuffer(data)
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
    await fs.promises.utimes(resolveQueueInputFilePath(ref)!, old, old)
    storeQueueInputBuffer(data)
    await sweepOrphanQueueInputFiles()
    assert.ok(resolveQueueInputFilePath(ref))
  })
})
