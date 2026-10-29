import './support/testTemp'
import './support/scratchRuntime'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'
import { McpServer } from '@modelcontextprotocol/server'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { initializeAuthDb, getAuthDb } from '../src/database/authDb'
import { initializeDatabase, closeDatabase, db } from '../src/database/init'
import { initializeUserSettingsDb, closeUserSettingsDb } from '../src/database/userSettingsDb'
import { runtimePaths } from '../src/config/runtimePaths'
import { AuthPermissionGroup } from '../src/models/AuthPermissionGroup'
import { invalidateConfiguredAuthCache } from '../src/services/auth/sessionAccess'
import { GraphWorkflowModel } from '../src/models/GraphWorkflow'
import { GraphWorkflowScheduleModel } from '../src/models/GraphWorkflowSchedule'
import { GraphExecutionModel } from '../src/models/GraphExecution'
import { ModuleDefinitionModel } from '../src/models/ModuleDefinition'
import { WorkflowModel } from '../src/models/Workflow'
import { GenerationQueueModel } from '../src/models/GenerationQueue'
import { GenerationQueueService } from '../src/services/generationQueueService'
import { ComfyUIService } from '../src/services/comfyuiService'
import { ImageUploadService } from '../src/services/imageUploadService'
import { GraphWorkflowExecutor } from '../src/services/graphWorkflowExecutor'
import { materializeLibraryImageInputs } from '../src/services/workflowInputImages'
import { GraphWorkflowScheduleService } from '../src/services/graphWorkflowScheduleService'
import { parseQueuedExecutionMetadata } from '../src/services/graphWorkflowExecutionQueueMetadata'
import { mcpHttpSettingsService } from '../src/services/mcpHttpSettingsService'
import { registerGraphWorkflowTools } from '../src/mcp/tools/graphWorkflowTools'
import { GRAPH_IMAGE_AUTHORITY_INPUT } from '../src/services/graph-workflow-executor/graphImageAuthority'
import { withMcpGraphImageAuthority } from '../src/services/graph-workflow-executor/graphImageAuthority'
import { executeComfyModule } from '../src/services/graph-workflow-executor/execute-comfy'
import { executeGenerationQueueJob } from '../src/services/generation-queue/queueJobExecutors'

test('accountless graph callers use explicit key, stdio, or legacy-schedule authority', { timeout: 60000 }, async (t) => {
  initializeAuthDb()
  await initializeDatabase()
  initializeUserSettingsDb()
  const auth = getAuthDb()
  auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('admin', 'unused', 'admin')").run()
  invalidateConfiguredAuthCache()
  const allowed = AuthPermissionGroup.createCustomGroup({ name: 'graph images', permissionKeys: ['generation.execute', 'workflows.view', 'images.view'] })
  const denied = AuthPermissionGroup.createCustomGroup({ name: 'graph without images', permissionKeys: ['generation.execute', 'workflows.view'] })
  const key = mcpHttpSettingsService.createApiKey('graph key', allowed.group_key).keys.find((item) => item.name === 'graph key')!
  const keyContext = { ...mcpHttpSettingsService.authenticate(key.apiKey)!, source: 'http' as const }
  const hash = 'a'.repeat(48)
  await fs.promises.mkdir(runtimePaths.uploadsDir, { recursive: true })
  const imagePath = path.join(runtimePaths.uploadsDir, 'graph-image.png')
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#3366cc' } }).png().toBuffer()
  const imageDataUrl = `data:image/png;base64,${image.toString('base64')}`
  await fs.promises.writeFile(imagePath, image)
  const folder = (db.prepare('SELECT id FROM watched_folders ORDER BY id LIMIT 1').get() as { id: number }).id
  db.prepare('INSERT INTO media_metadata (composite_hash, prompt) VALUES (?, ?)').run(hash, 'image prompt')
  db.prepare("INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_size, mime_type) VALUES (?, ?, ?, ?, 'image/png')").run(hash, imagePath, folder, image.length)
  const moduleId = ModuleDefinitionModel.create({
    name: 'load image', engine_type: 'system', authoring_source: 'manual',
    template_defaults: { operation_key: 'system.load_image_from_reference' },
    exposed_inputs: [{ key: 'composite_hash', label: 'Image', direction: 'input', data_type: 'text' }],
    output_ports: [{ key: 'image_ref', label: 'Reference', direction: 'output', data_type: 'json' }],
  })
  const graphId = GraphWorkflowModel.create({
    name: 'image graph',
    graph: { nodes: [{ id: 'load', module_id: moduleId, position: { x: 0, y: 0 }, input_values: { composite_hash: hash } }], edges: [] },
  })
  const promptModuleId = ModuleDefinitionModel.create({
    name: 'load image prompt', engine_type: 'system', authoring_source: 'manual',
    template_defaults: { operation_key: 'system.load_prompt_from_reference' },
    exposed_inputs: [{ key: 'composite_hash', label: 'Image', direction: 'input', data_type: 'text' }],
    output_ports: [{ key: 'prompt', label: 'Prompt', direction: 'output', data_type: 'prompt' }],
  })
  const promptGraphId = GraphWorkflowModel.create({
    name: 'image prompt graph',
    graph: { nodes: [{ id: 'load', module_id: promptModuleId, position: { x: 0, y: 0 }, input_values: { composite_hash: hash } }], edges: [] },
  })
  const inputModuleId = ModuleDefinitionModel.create({
    name: 'materialize input', engine_type: 'system', authoring_source: 'manual',
    template_defaults: { operation_key: 'system.constant_image' },
    exposed_inputs: [
      { key: 'image', label: 'Image', direction: 'input', data_type: 'image' },
      { key: 'mask', label: 'Mask', direction: 'input', data_type: 'mask' },
      { key: 'others', label: 'Images', direction: 'input', data_type: 'image', multiple: true },
      { key: 'references', label: 'References', direction: 'input', data_type: 'json' },
    ],
    output_ports: [{ key: 'image', label: 'Image', direction: 'output', data_type: 'image' }],
  })
  const libraryRef = { composite_hash: hash }
  const materializedGraphIds = [
    { image: libraryRef },
    { image: imageDataUrl, mask: libraryRef },
    { image: imageDataUrl, others: [libraryRef] },
    { image: imageDataUrl, references: JSON.stringify([{ role: 'item', data_url: libraryRef }]) },
    { image: libraryRef, mask: libraryRef },
  ].map((input_values, index) => GraphWorkflowModel.create({
    name: `materialized input ${index}`,
    graph: { nodes: [{ id: 'input', module_id: inputModuleId, position: { x: 0, y: 0 }, input_values }], edges: [] },
  }))
  const inlineGraphId = GraphWorkflowModel.create({
    name: 'inline input',
    graph: { nodes: [{ id: 'input', module_id: inputModuleId, position: { x: 0, y: 0 }, input_values: { image: imageDataUrl } }], edges: [] },
  })
  const makeClient = async (context: any) => {
    const server = new McpServer({ name: 'graph-authority', version: '1' })
    const client = new Client({ name: 'graph-authority-test', version: '1' })
    registerGraphWorkflowTools(server, context)
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    t.after(async () => { await client.close(); await server.close() })
    return client
  }
  const keyClient = await makeClient(keyContext)
  const run = (client: Client) => client.callTool({ name: 'execute_graph_workflow', arguments: { workflow_id: graphId, input_values: {} } })
  const runPrompt = (client: Client) => client.callTool({ name: 'execute_graph_workflow', arguments: { workflow_id: promptGraphId, input_values: {} } })
  const runMaterialized = (client: Client, workflowId: number) => client.callTool({ name: 'execute_graph_workflow', arguments: { workflow_id: workflowId, input_values: {} } })
  assert.notEqual((await run(keyClient)).isError, true)
  assert.notEqual((await runPrompt(keyClient)).isError, true)
  for (const workflowId of materializedGraphIds) assert.notEqual((await runMaterialized(keyClient, workflowId)).isError, true)
  await assert.rejects(materializeLibraryImageInputs('system', [{ key: 'image', label: 'Image', direction: 'input', data_type: 'image' }], { image: libraryRef }), /images\.view/)
  const account = auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES (?, 'unused', 'guest')")
  const allowedAccountId = Number(account.run('image-user').lastInsertRowid)
  const deniedAccountId = Number(account.run('no-image-user').lastInsertRowid)
  const membership = auth.prepare('INSERT INTO auth_account_group_memberships (account_id, group_id) VALUES (?, ?)')
  membership.run(allowedAccountId, allowed.id)
  membership.run(deniedAccountId, denied.id)
  assert.equal((await GraphWorkflowExecutor.execute(materializedGraphIds[0], { requestedByAccountId: allowedAccountId })).status, 'completed')
  await assert.rejects(GraphWorkflowExecutor.execute(materializedGraphIds[0], { requestedByAccountId: deniedAccountId }), /images\.view/)
  const fields = [{ id: 'image', type: 'image' }]
  const comfyWorkflowId = WorkflowModel.create({ name: 'graph comfy', workflow_json: '{}', marked_fields: fields as any })
  const controller = new AbortController()
  const graphContext = {
    executionId: 1, workflow: { id: graphId, name: 'graph', graph: { nodes: [], edges: [] } },
    requestedByAccountId: null, signal: controller.signal, getAbortReason: () => null,
  } as any
  const graphNode = { id: 'comfy', input_values: { image: { composite_hash: hash } } } as any
  const direct = { name: 'direct', template_defaults: { workflow_json: {}, marked_fields: fields, api_endpoint: 'http://127.0.0.1:1' } } as any
  const queuedModule = { name: 'queue', source_workflow_id: comfyWorkflowId, template_defaults: {}, output_ports: [] } as any
  t.mock.method(ComfyUIService.prototype, 'uploadInputImage', async () => { throw new Error('graph upload reached') })
  t.mock.method(GenerationQueueService, 'waitForTerminalJob', async () => ({ status: 'failed', failure_message: 'graph job queued' } as any))
  await assert.rejects(withMcpGraphImageAuthority(keyContext, () => executeComfyModule(graphContext, graphNode, direct, graphNode.input_values)), /graph upload reached/)
  await assert.rejects(withMcpGraphImageAuthority(keyContext, () => executeComfyModule(graphContext, graphNode, queuedModule, graphNode.input_values)), /graph job queued/)
  const queuedJobId = (await import('../src/database/userSettingsDb')).getUserSettingsDb().prepare('SELECT id FROM generation_queue_jobs ORDER BY id DESC LIMIT 1').get() as { id: number }
  await assert.rejects(executeGenerationQueueJob(GenerationQueueModel.findById(queuedJobId.id)!, null, {} as any), /graph upload reached/)
  await assert.rejects(withMcpGraphImageAuthority({ scopes: ['generate'] }, () => executeComfyModule(graphContext, graphNode, queuedModule, graphNode.input_values)), /graph job queued/)
  const stdioJobId = (await import('../src/database/userSettingsDb')).getUserSettingsDb().prepare('SELECT id FROM generation_queue_jobs ORDER BY id DESC LIMIT 1').get() as { id: number }
  const stdioJob = GenerationQueueModel.findById(stdioJobId.id)!
  assert.equal(JSON.parse(stdioJob.request_payload).__conaiMcpImageGrant.kind, 'stdio')
  await assert.rejects(executeGenerationQueueJob(stdioJob, null, {} as any), /graph upload reached/)

  // A different process can move the key without updating this process's settings cache.
  const keyFile = path.join(runtimePaths.basePath, 'config', 'mcp-http.json')
  const stored = JSON.parse(await fs.promises.readFile(keyFile, 'utf8'))
  await t.test('key authority is rechecked between library input reads', async (sub) => {
    let lookups = 0
    const resolve = ImageUploadService.getActiveFilePath.bind(ImageUploadService)
    sub.mock.method(ImageUploadService, 'getActiveFilePath', (compositeHash) => {
      const result = resolve(compositeHash)
      if (++lookups === 1) {
        stored.keys.find((item: { id: string }) => item.id === key.id).groupKey = denied.group_key
        fs.writeFileSync(keyFile, JSON.stringify(stored))
      }
      return result
    })
    const result = await runMaterialized(keyClient, materializedGraphIds[4])
    assert.equal(result.isError, true)
    assert.match((result.content![0] as { text: string }).text, /images\.view/)
    assert.equal(lookups, 1)
  })
  stored.keys.find((item: { id: string }) => item.id === key.id).groupKey = denied.group_key
  await fs.promises.writeFile(keyFile, JSON.stringify(stored))
  const deniedRun = await run(keyClient)
  assert.equal(deniedRun.isError, true)
  assert.match((deniedRun.content![0] as { text: string }).text, /images\.view/)
  assert.equal((await runPrompt(keyClient)).isError, true)
  await t.test('library input variants are denied before resolving any file', async (sub) => {
    sub.mock.method(ImageUploadService, 'getActiveFilePath', () => { throw new Error('unauthorized library lookup') })
    for (const workflowId of materializedGraphIds) {
      const deniedInput = await runMaterialized(keyClient, workflowId)
      assert.equal(deniedInput.isError, true)
      assert.match((deniedInput.content![0] as { text: string }).text, /images\.view/)
    }
  })
  assert.notEqual((await runMaterialized(keyClient, inlineGraphId)).isError, true)
  await assert.rejects(withMcpGraphImageAuthority(keyContext, () => executeComfyModule(graphContext, graphNode, direct, graphNode.input_values)), /images\.view/)
  await assert.rejects(executeGenerationQueueJob(GenerationQueueModel.findById(queuedJobId.id)!, null, {} as any), /images\.view/)
  stored.keys = stored.keys.filter((item: { id: string }) => item.id !== key.id)
  await fs.promises.writeFile(keyFile, JSON.stringify(stored))
  assert.equal((await run(keyClient)).isError, true)

  const stdio = await makeClient({ scopes: ['generate'] })
  assert.notEqual((await run(stdio)).isError, true)
  assert.notEqual((await runMaterialized(stdio, materializedGraphIds[0])).isError, true)
  const forged = await stdio.callTool({ name: 'execute_graph_workflow', arguments: { workflow_id: graphId, input_values: { [GRAPH_IMAGE_AUTHORITY_INPUT]: 'stdio' } } })
  assert.equal(forged.isError, true)

  const runAt = new Date(Date.now() - 60_000).toISOString()
  const scheduleId = GraphWorkflowScheduleModel.create({
    graph_workflow_id: graphId, name: 'legacy', schedule_type: 'once', status: 'active',
    run_at: runAt, next_run_at: runAt, run_as_account_id: null,
  })
  const schedule = GraphWorkflowScheduleModel.findById(scheduleId)!
  await (GraphWorkflowScheduleService as any).handleDueSchedule(schedule, new Date())
  const queued = GraphWorkflowScheduleModel.findById(scheduleId)!.last_execution_id!
  const queuedExecution = GraphExecutionModel.findById(queued)!
  const queuedInputs = parseQueuedExecutionMetadata(queuedExecution.execution_plan).inputValues!
  assert.equal(queuedInputs[GRAPH_IMAGE_AUTHORITY_INPUT], 'legacy-schedule')
  const result = await GraphWorkflowExecutor.execute(graphId, { executionId: queued, runtimeInputValues: queuedInputs, requestedByAccountId: null })
  assert.equal(result.status, 'completed')
  const inputScheduleId = GraphWorkflowScheduleModel.create({
    graph_workflow_id: materializedGraphIds[0], name: 'legacy input', schedule_type: 'once', status: 'active',
    run_at: runAt, next_run_at: runAt, run_as_account_id: null,
  })
  await (GraphWorkflowScheduleService as any).handleDueSchedule(GraphWorkflowScheduleModel.findById(inputScheduleId)!, new Date())
  const inputExecutionId = GraphWorkflowScheduleModel.findById(inputScheduleId)!.last_execution_id!
  const inputExecution = GraphExecutionModel.findById(inputExecutionId)!
  const inputValues = parseQueuedExecutionMetadata(inputExecution.execution_plan).inputValues!
  assert.equal((await GraphWorkflowExecutor.execute(materializedGraphIds[0], { executionId: inputExecutionId, runtimeInputValues: inputValues, requestedByAccountId: null })).status, 'completed')
  await assert.rejects(executeComfyModule({ ...graphContext, executionId: queued }, graphNode, queuedModule, graphNode.input_values), /graph job queued/)
  const scheduleJobId = (await import('../src/database/userSettingsDb')).getUserSettingsDb().prepare('SELECT id FROM generation_queue_jobs ORDER BY id DESC LIMIT 1').get() as { id: number }
  const scheduleJob = GenerationQueueModel.findById(scheduleJobId.id)!
  assert.equal(JSON.parse(scheduleJob.request_payload).__conaiMcpImageGrant.kind, 'legacy-schedule')
  await assert.rejects(executeGenerationQueueJob(scheduleJob, null, {} as any), /graph upload reached/)

  auth.prepare("DELETE FROM auth_accounts WHERE username = 'admin'").run()
  invalidateConfiguredAuthCache()
  const bootstrapResult = await GraphWorkflowExecutor.execute(graphId, { requestedByAccountId: null })
  assert.equal(bootstrapResult.status, 'completed')
  assert.equal((await GraphWorkflowExecutor.execute(materializedGraphIds[0], { requestedByAccountId: null })).status, 'completed')

  t.after(async () => {
    auth.close()
    closeUserSettingsDb()
    closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
  })
})
