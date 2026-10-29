import './support/testTemp'
import './support/scratchRuntime'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { test } from 'node:test'
import express from 'express'
import { initializeAuthDb, getAuthDb } from '../src/database/authDb'
import { initializeDatabase, closeDatabase, db } from '../src/database/init'
import { initializeUserSettingsDb, closeUserSettingsDb, getUserSettingsDb } from '../src/database/userSettingsDb'
import { initializeApiGenerationDb, closeApiGenerationDb } from '../src/database/apiGenerationDb'
import { runtimePaths } from '../src/config/runtimePaths'
import { AuthPermissionGroup } from '../src/models/AuthPermissionGroup'
import { invalidateConfiguredAuthCache } from '../src/services/auth/sessionAccess'
import { WorkflowModel } from '../src/models/Workflow'
import { ComfyUIServerModel } from '../src/models/ComfyUIServer'
import { GenerationQueueModel } from '../src/models/GenerationQueue'
import { GenerationQueueService } from '../src/services/generationQueueService'
import { ComfyUIService } from '../src/services/comfyuiService'
import { executeGenerationQueueJob } from '../src/services/generation-queue/queueJobExecutors'
import { mcpHttpSettingsService } from '../src/services/mcpHttpSettingsService'
import { enqueueMcpGenerationJob } from '../src/mcp/tools/generationJobTools'
import { requireMcpToolAccess } from '../src/mcp/toolAccess'
import { createGenerationQueueActionRoutes } from '../src/routes/generation-queue/queue-action-routes'
import publicWorkflowRoutes from '../src/routes/public-workflows.routes'

test('accountless MCP image jobs retain only their authenticated key authority', { timeout: 60000 }, async (t) => {
  initializeAuthDb()
  await initializeDatabase()
  initializeUserSettingsDb()
  initializeApiGenerationDb()
  const auth = getAuthDb()
  const admin = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('admin', 'unused', 'admin')").run().lastInsertRowid)
  auth.prepare("INSERT INTO auth_account_group_memberships (account_id, group_id) SELECT ?, id FROM auth_permission_groups WHERE group_key = 'admin'").run(admin)
  invalidateConfiguredAuthCache()
  const allowed = AuthPermissionGroup.createCustomGroup({ name: 'image generator', permissionKeys: ['generation.execute', 'workflows.view', 'images.view'] })
  const denied = AuthPermissionGroup.createCustomGroup({ name: 'generator without images', permissionKeys: ['generation.execute', 'workflows.view'] })
  const alsoAllowed = AuthPermissionGroup.createCustomGroup({ name: 'other image generator', permissionKeys: ['generation.execute', 'workflows.view', 'images.view'] })
  const allowedSettings = mcpHttpSettingsService.createApiKey('allowed', allowed.group_key)
  const allowedKey = allowedSettings.keys.find((key) => key.name === 'allowed')!
  const deniedSettings = mcpHttpSettingsService.createApiKey('denied', denied.group_key)
  const deniedKey = deniedSettings.keys.find((key) => key.name === 'denied')!
  mcpHttpSettingsService.updateEnabled(true)
  const allowedContext = { ...mcpHttpSettingsService.authenticate(allowedKey.apiKey)!, source: 'http' as const }
  const deniedContext = { ...mcpHttpSettingsService.authenticate(deniedKey.apiKey)!, source: 'http' as const }

  ComfyUIServerModel.create({ name: 'test server', endpoint: 'http://127.0.0.1:1' })
  const workflowId = WorkflowModel.create({
    name: 'MCP image input',
    workflow_json: '{}',
    is_public_page: true,
    public_slug: 'mcp-image-input',
    marked_fields: [{ id: 'image', label: 'Image', type: 'image', jsonPath: '1.inputs.image', required: false }],
  })
  const hash = 'a'.repeat(48)
  const bytes = Buffer.from('authorized library image')
  await fs.promises.mkdir(runtimePaths.uploadsDir, { recursive: true })
  await fs.promises.writeFile(path.join(runtimePaths.uploadsDir, 'mcp-image.png'), bytes)
  const folder = (db.prepare('SELECT id FROM watched_folders ORDER BY id LIMIT 1').get() as { id: number }).id
  db.prepare('INSERT INTO media_metadata (composite_hash) VALUES (?)').run(hash)
  db.prepare("INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_size, mime_type) VALUES (?, ?, ?, ?, 'image/png')").run(hash, 'mcp-image.png', folder, bytes.length)
  const input = { service_type: 'comfyui' as const, workflow_id: workflowId, inputs: { image: { composite_hash: hash } } }
  requireMcpToolAccess(allowedContext, 'submit_generation_job', input)
  requireMcpToolAccess(deniedContext, 'submit_generation_job', input)
  await assert.rejects(enqueueMcpGenerationJob(deniedContext, input), /images\.view/)
  const queued = await enqueueMcpGenerationJob(allowedContext, input)
  const job = GenerationQueueModel.findById(queued.id)!
  const payload = JSON.parse(job.request_payload)
  assert.equal(job.requested_by_account_id, null)
  assert.ok(payload.__conaiMcpImageGrant)

  let uploads = 0
  t.mock.method(ComfyUIService.prototype, 'uploadInputImage', async (_name, stream) => {
    const chunks: Buffer[] = []
    for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk))
    assert.deepEqual(Buffer.concat(chunks), bytes)
    uploads += 1
    throw new Error('upload reached')
  })
  await assert.rejects(executeGenerationQueueJob(job, null, {} as any), /upload reached/)
  assert.equal(uploads, 1)
  const tampered = JSON.parse(job.request_payload)
  tampered.prompt_data.image.composite_hash = 'b'.repeat(48)
  await assert.rejects(executeGenerationQueueJob({ ...job, request_payload: JSON.stringify(tampered) }, null, {} as any), /authorization/)
  assert.equal(uploads, 1)

  getUserSettingsDb().prepare("UPDATE generation_queue_jobs SET status = 'failed' WHERE id = ?").run(job.id)
  const retryRecord = GenerationQueueService.retryJob(job.id)!
  const retry = GenerationQueueModel.findById(retryRecord.id)!
  await assert.rejects(executeGenerationQueueJob(retry, null, {} as any), /upload reached/)
  assert.equal(uploads, 2)
  const stdio = await enqueueMcpGenerationJob({ scopes: ['generate'] }, input)
  const stdioJob = GenerationQueueModel.findById(stdio.id)!
  assert.equal(JSON.parse(stdioJob.request_payload).__conaiMcpImageGrant.kind, 'stdio')
  await assert.rejects(executeGenerationQueueJob(stdioJob, null, {} as any), /upload reached/)
  assert.equal(uploads, 3)

  // The worker must re-read the key file even if its in-process settings cache is stale.
  const keyFile = path.join(runtimePaths.basePath, 'config', 'mcp-http.json')
  const stored = JSON.parse(await fs.promises.readFile(keyFile, 'utf8'))
  stored.keys.find((key: { id: string }) => key.id === allowedKey.id).groupKey = denied.group_key
  await fs.promises.writeFile(keyFile, JSON.stringify(stored))
  await assert.rejects(executeGenerationQueueJob(retry, null, {} as any), /images\.view/)
  assert.throws(() => GenerationQueueService.retryJob(job.id), /images\.view/)
  stored.keys.find((key: { id: string }) => key.id === allowedKey.id).groupKey = alsoAllowed.group_key
  await fs.promises.writeFile(keyFile, JSON.stringify(stored))
  const movedJob = await enqueueMcpGenerationJob(allowedContext, input)
  const movedPayload = JSON.parse(GenerationQueueModel.findById(movedJob.id)!.request_payload)
  assert.equal(movedPayload.__conaiMcpImageGrant.groupKey, alsoAllowed.group_key)
  await assert.rejects(executeGenerationQueueJob(GenerationQueueModel.findById(movedJob.id)!, null, {} as any), /upload reached/)
  assert.equal(uploads, 4)
  stored.keys.find((key: { id: string }) => key.id === allowedKey.id).groupKey = allowed.group_key
  await fs.promises.writeFile(keyFile, JSON.stringify(stored))
  await assert.rejects(executeGenerationQueueJob(retry, null, {} as any), /upload reached/)
  assert.equal(uploads, 5)
  stored.keys = stored.keys.filter((key: { id: string }) => key.id !== allowedKey.id)
  await fs.promises.writeFile(keyFile, JSON.stringify(stored))
  await assert.rejects(executeGenerationQueueJob(retry, null, {} as any), /authorization/)
  assert.throws(() => GenerationQueueService.retryJob(job.id), /authorization/)
  stored.keys.push(allowedKey)
  await fs.promises.writeFile(keyFile, JSON.stringify(stored))

  const forgedPayload = { prompt_data: input.inputs, __conaiMcpImageGrant: payload.__conaiMcpImageGrant }
  await assert.rejects(enqueueMcpGenerationJob(deniedContext, { ...input, request_payload: forgedPayload }), /server-issued/)
  await assert.rejects(enqueueMcpGenerationJob(deniedContext, { ...input, request_payload: { ...forgedPayload, __conaiMcpImageGrant: { kind: 'stdio', signature: '0'.repeat(64) } } }), /server-issued/)
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { Object.assign(req, { session: { authenticated: true, accountId: admin, accountType: 'admin' } }); next() })
  app.use('/api/generation-queue', createGenerationQueueActionRoutes())
  app.use('/api/public-workflows', publicWorkflowRoutes)
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    closeApiGenerationDb()
    auth.close()
    closeUserSettingsDb()
    closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
  })
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  for (const [route, body] of [
    ['/api/generation-queue', { service_type: 'comfyui', workflow_id: workflowId, request_payload: forgedPayload }],
    ['/api/public-workflows/mcp-image-input/queue', { request_payload: forgedPayload }],
  ] as const) {
    const response = await fetch(origin + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    assert.equal(response.status, 400, route)
  }
  AuthPermissionGroup.updateCustomGroup(allowed.id, { name: allowed.name, permissionKeys: ['generation.execute', 'workflows.view'] })
  await assert.rejects(executeGenerationQueueJob(retry, null, {} as any), /images\.view/)
  assert.equal(uploads, 5)
  auth.prepare('DELETE FROM auth_accounts WHERE id = ?').run(admin)
  invalidateConfiguredAuthCache()
  const bootstrapPayload = { ...payload }
  delete bootstrapPayload.__conaiMcpImageGrant
  await assert.rejects(executeGenerationQueueJob({ ...job, request_payload: JSON.stringify(bootstrapPayload) }, null, {} as any), /upload reached/)
  assert.equal(uploads, 6)
})
