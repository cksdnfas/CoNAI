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
import { initializeUserSettingsDb, closeUserSettingsDb } from '../src/database/userSettingsDb'
import { runtimePaths } from '../src/config/runtimePaths'
import { AuthPermissionGroup } from '../src/models/AuthPermissionGroup'
import { invalidateConfiguredAuthCache } from '../src/services/auth/sessionAccess'
import { WorkflowModel } from '../src/models/Workflow'
import { GenerationQueueModel } from '../src/models/GenerationQueue'
import { workflowRoutes } from '../src/routes/workflows'
import publicWorkflowRoutes from '../src/routes/public-workflows.routes'
import { createGenerationQueueActionRoutes } from '../src/routes/generation-queue/queue-action-routes'
import { prepareComfyPromptData } from '../src/services/prepareComfyPromptData'
import { getIncomingArtifacts } from '../src/services/graph-workflow-executor/artifacts'
import { executeComfyModule } from '../src/services/graph-workflow-executor/execute-comfy'
import { executeLoadImageFromReference, executeRandomImageFromLibrary, executeRandomVideoFromLibrary } from '../src/services/graph-workflow-executor/system-reference-operations'
import { executeGenerationQueueJob } from '../src/services/generation-queue/queueJobExecutors'
import { isQueueInputRef, storeQueueInputBuffer } from '../src/services/generation-queue/queueInputStore'
import { storeWorkflowInputAssetFile } from '../src/services/workflowInputAssetStore'

test('ComfyUI media inputs reject client paths while trusted references remain usable', { timeout: 60000 }, async (t) => {
  initializeAuthDb()
  await initializeDatabase()
  initializeUserSettingsDb()
  const auth = getAuthDb()
  const admin = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('admin', 'unused', 'admin')").run().lastInsertRowid)
  auth.prepare("INSERT INTO auth_account_group_memberships (account_id, group_id) SELECT ?, id FROM auth_permission_groups WHERE group_key = 'admin'").run(admin)
  const guest = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('generator', 'unused', 'guest')").run().lastInsertRowid)
  const group = AuthPermissionGroup.createCustomGroup({ name: 'generator', permissionKeys: ['generation.execute', 'workflows.view'] })
  AuthPermissionGroup.addAccountMembership(group.id, guest)
  invalidateConfiguredAuthCache()

  const fields = [
    { id: 'image', label: 'Image', type: 'image', jsonPath: '1.inputs.image', required: false },
    { id: 'director', label: 'Director', type: 'node', node_editor: 'minimax_h3_director_dasiwa', jsonPath: '2.inputs', required: false },
  ] as any[]
  const workflowId = WorkflowModel.create({
    name: 'security', workflow_json: '{}', marked_fields: fields, is_public_page: true, public_slug: 'security',
  })
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    Object.assign(req, { session: { authenticated: true, accountId: guest, accountType: 'guest' } })
    next()
  })
  app.use('/api/workflows', workflowRoutes)
  app.use('/api/public-workflows', publicWorkflowRoutes)
  app.use('/api/generation-queue', createGenerationQueueActionRoutes())
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    auth.close()
    closeUserSettingsDb()
    closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
  })
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const post = (url: string, body: unknown) => fetch(origin + url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const secret = path.join(runtimePaths.basePath, 'private-server-file.txt')
  await fs.promises.writeFile(secret, 'not a workflow input')
  const targets = [
    { url: `/api/workflows/${workflowId}/generate`, body: (prompt_data: unknown) => ({ prompt_data }) },
    { url: '/api/public-workflows/security/queue', body: (prompt_data: unknown) => ({ request_payload: { prompt_data } }) },
    { url: '/api/generation-queue', body: (prompt_data: unknown) => ({ service_type: 'comfyui', workflow_id: workflowId, request_payload: { prompt_data } }) },
  ]
  for (const target of targets) {
    for (const key of ['storagePath', 'originalPath', 'original_file_path', 'filePath', 'file_path', 'path']) {
      const response = await post(target.url, target.body({ image: { [key]: secret, dataUrl: 'data:image/png;base64,eA==' } }))
      assert.equal(response.status, 400, `${target.url}: ${key}`)
      assert.match((await response.json() as { error: string }).error, /경로/)
    }
    const nested = { director: { __conai_minimax_h3_director: { assets: { a: { filePath: secret } } } } }
    assert.equal((await post(target.url, target.body(nested))).status, 400, `${target.url}: director asset`)
    assert.equal((await post(target.url, target.body({ image: { composite_hash: 'a'.repeat(48) } }))).status, 403, `${target.url}: library permission`)
  }

  const uploads: Buffer[] = []
  const comfy = {
    async uploadInputImage(_name: string, input: NodeJS.ReadableStream | Buffer) {
      if (Buffer.isBuffer(input)) uploads.push(input)
      else {
        const chunks: Buffer[] = []
        for await (const chunk of input as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk))
        uploads.push(Buffer.concat(chunks))
      }
      return 'uploaded.png'
    },
  } as any
  await assert.rejects(prepareComfyPromptData(comfy, fields, { image: { path: secret } }), /경로/)
  assert.equal(uploads.length, 0)
  const graphContext = {
    executionId: 1,
    workflow: { name: 'graph', graph: { nodes: [], edges: [] } },
    requestedByAccountId: guest,
    signal: new AbortController().signal,
    getAbortReason: () => null,
  } as any
  const graphNode = { id: 'target', input_values: { image: { storagePath: secret } } } as any
  await assert.rejects(executeLoadImageFromReference(graphContext, graphNode, {} as any, { composite_hash: 'a'.repeat(48) }), /images.view/)
  await assert.rejects(executeRandomImageFromLibrary(graphContext, graphNode, {} as any), /images.view/)
  await assert.rejects(executeRandomVideoFromLibrary(graphContext, graphNode, {} as any), /images.view/)
  const directModule = { name: 'direct', template_defaults: { workflow_json: {}, marked_fields: fields, api_endpoint: 'http://127.0.0.1:1' } } as any
  await assert.rejects(executeComfyModule(graphContext, graphNode, directModule, graphNode.input_values), /경로/)
  const queuedModule = { name: 'queued', source_workflow_id: workflowId, template_defaults: {} } as any
  await assert.rejects(executeComfyModule(graphContext, graphNode, queuedModule, graphNode.input_values), /경로/)
  const oldJobId = GenerationQueueModel.create({
    service_type: 'comfyui', workflow_id: workflowId, request_payload: { prompt_data: { image: { path: secret } } },
  })
  await assert.rejects(executeGenerationQueueJob(GenerationQueueModel.findById(oldJobId)!, null, {} as any), /경로/)

  const source = Buffer.from('trusted media bytes')
  const temporary = path.join(runtimePaths.basePath, 'asset-upload.tmp')
  await fs.promises.writeFile(temporary, source)
  const asset = storeWorkflowInputAssetFile(temporary, { fileName: 'asset.png', mimeType: 'image/png', bytes: source.length })
  const queueRef = storeQueueInputBuffer(source, { fileName: 'queue.png', mimeType: 'image/png' })
  const folderId = (db.prepare('SELECT id FROM watched_folders ORDER BY id LIMIT 1').get() as { id: number }).id
  const hash = 'b'.repeat(48)
  const libraryPath = path.join(runtimePaths.uploadsDir, 'library.png')
  await fs.promises.mkdir(runtimePaths.uploadsDir, { recursive: true })
  await fs.promises.writeFile(libraryPath, source)
  db.prepare('INSERT INTO media_metadata (composite_hash) VALUES (?)').run(hash)
  db.prepare("INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_size, mime_type) VALUES (?, ?, ?, ?, 'image/png')").run(hash, 'library.png', folderId, source.length)
  for (const input of [asset, queueRef, { composite_hash: hash }, { dataUrl: `data:image/png;base64,${source.toString('base64')}` }]) {
    const result = await prepareComfyPromptData(comfy, fields, { image: input })
    assert.equal(result.image, 'uploaded.png')
  }
  assert.deepEqual(uploads, [source, source, source, source])

  const graphFile = path.join(runtimePaths.basePath, 'trusted-graph-output.png')
  await fs.promises.writeFile(graphFile, source)
  const context = {
    workflow: { graph: {
      nodes: [{ id: 'source', module_id: 1 }, { id: 'target', module_id: 2 }],
      edges: [{ source_node_id: 'source', source_port_key: 'image', target_node_id: 'target', target_port_key: 'image' }],
    } },
    modulesById: new Map([[2, { engine_type: 'comfyui', exposed_inputs: [{ key: 'image', data_type: 'image' }] }]]),
    artifactsByNode: new Map([['source', { image: { type: 'image', value: { storagePath: graphFile }, storagePath: graphFile } }]]),
  } as any
  const incoming = await getIncomingArtifacts(context, 'target')
  const graphRef = (incoming.image as any).value
  assert.equal(isQueueInputRef(graphRef), false)
  assert.equal('storagePath' in graphRef, false)
  assert.equal((await prepareComfyPromptData(comfy, fields, { image: graphRef })).image, 'uploaded.png')
})
