import './support/testTemp'
import './support/scratchRuntime'
import assert from 'node:assert/strict'
import http from 'node:http'
import { test } from 'node:test'
import express from 'express'
import { initializeAuthDb, getAuthDb } from '../src/database/authDb'
import { initializeDatabase, closeDatabase } from '../src/database/init'
import { initializeUserSettingsDb, closeUserSettingsDb, getUserSettingsDb } from '../src/database/userSettingsDb'
import { GraphWorkflowModel } from '../src/models/GraphWorkflow'
import { createGraphWorkflowExecutionRoutes } from '../src/routes/graph-workflows/execution-routes'

test('graph execution rejects supplied media paths before creating a run', async (t) => {
  initializeAuthDb()
  await initializeDatabase()
  initializeUserSettingsDb()
  const graphId = GraphWorkflowModel.create({
    name: 'input security',
    graph: {
      nodes: [{ id: 'node', module_id: 1, position: { x: 0, y: 0 } }],
      edges: [],
      metadata: { exposed_inputs: [
        { id: 'image', node_id: 'node', port_key: 'image', label: 'Image', data_type: 'image' },
        { id: 'media', node_id: 'node', port_key: 'media', label: 'Media', data_type: 'any' },
        { id: 'director', node_id: 'node', port_key: 'director', label: 'Director', data_type: 'json' },
        { id: 'config', node_id: 'node', port_key: 'config', label: 'Config', data_type: 'json' },
        { id: 'apiFile', node_id: 'node', port_key: 'values.imagePath', label: 'API file', data_type: 'text' },
      ] },
    },
  })
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { Object.assign(req, { session: {} }); next() })
  app.use('/api/graph-workflows', createGraphWorkflowExecutionRoutes())
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    getAuthDb().close()
    closeUserSettingsDb()
    closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
  })
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const routes = [`/api/graph-workflows/${graphId}/execute`, `/api/graph-workflows/${graphId}/nodes/node/execute`]
  const post = (route: string, input_values: unknown) => fetch(origin + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input_values }),
  })
  for (const route of routes) {
    for (const key of ['storagePath', 'originalPath', 'original_file_path', 'filePath', 'file_path', 'path']) {
      const response = await post(route, { image: { [key]: '/private/server-file' } })
      assert.equal(response.status, 400, `${route}: ${key}`)
      assert.match((await response.json() as { error: string }).error, /경로/)
    }
    assert.equal((await post(route, { media: [{ filePath: '/private/server-file' }] })).status, 400)
    assert.equal((await post(route, { director: { __conai_minimax_h3_director: { assets: { item: { path: '/private/server-file' } } } } })).status, 400)
    assert.equal((await post(route, { unknown: { path: '/private/server-file' } })).status, 400)
    for (const key of ['storage_path', 'outputPath', 'output_path', 'originalFilePath', 'imagePath', 'image_path']) {
      assert.equal((await post(route, { config: { nested: [{ [key]: '/private/server-file' }] } })).status, 400, `${route}: nested ${key}`)
      assert.equal((await post(route, { config: JSON.stringify({ [key]: '/private/server-file' }) })).status, 400, `${route}: JSON ${key}`)
    }
    assert.equal((await post(route, { config: [{ key: 'imagePath', value: '/private/server-file' }] })).status, 400)
    assert.equal((await post(route, { apiFile: '/private/server-file' })).status, 400)
    assert.equal((await post(route, { __conaiGraphImageAuthority: 'legacy-schedule' })).status, 400)
    assert.equal((await post(route, { __conaiGraphImageAuthority: 'stdio' })).status, 400)
  }
  assert.equal((getUserSettingsDb().prepare('SELECT COUNT(*) AS count FROM graph_executions').get() as { count: number }).count, 0)

  // JSON configuration can still have a non-media path; valid media references are accepted.
  assert.equal((await post(routes[0], { config: { path: 'layout/section' }, image: { composite_hash: 'a'.repeat(48) } })).status, 201)
  assert.equal((await post(routes[1], { image: { dataUrl: 'data:image/png;base64,eA==' } })).status, 201)
})
