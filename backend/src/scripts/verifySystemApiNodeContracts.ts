import http from 'http'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ExecutionContext, ParsedModuleDefinition } from '../services/graph-workflow-executor/shared'
import type { GraphWorkflowNode } from '../types/moduleGraph'

type SystemApiOperations = typeof import('../services/graph-workflow-executor/system-api-operations')

let executeApiRequestNode: SystemApiOperations['executeApiRequestNode']
let executeBase64DecodeNode: SystemApiOperations['executeBase64DecodeNode']
let executeBase64EncodeNode: SystemApiOperations['executeBase64EncodeNode']
let executionId = 0

function createExecutionContext(): ExecutionContext {
  return {
    executionId,
    workflow: {
      id: 0,
      name: 'system-api-node-contracts',
      version: 1,
      graph: { nodes: [], edges: [] },
    },
    modulesById: new Map(),
    artifactsByNode: new Map(),
    debugMode: false,
  }
}

const node: GraphWorkflowNode = {
  id: 'node-api',
  module_id: 1,
  position: { x: 0, y: 0 },
}

const moduleDefinition = {
  id: 1,
  name: 'API 요청',
  engine_type: 'system',
  authoring_source: 'manual',
  category: 'utility',
  template_defaults: {},
  exposed_inputs: [],
  output_ports: [],
  internal_fixed_values: { operation_key: 'system.api_request' },
  ui_schema: [],
  version: 1,
  is_active: true,
  created_date: new Date(0).toISOString(),
  updated_date: new Date(0).toISOString(),
} satisfies ParsedModuleDefinition

function readRequestBody(request: http.IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    request.on('error', reject)
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

function startApiServer() {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')

    if (url.pathname === '/get') {
      assert.equal(request.method, 'GET')
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ prompt: url.searchParams.get('prompt'), count: url.searchParams.get('count') }))
      return
    }

    if (url.pathname === '/json') {
      assert.equal(request.method, 'POST')
      assert.match(request.headers['content-type'] ?? '', /application\/json/)
      const body = JSON.parse(await readRequestBody(request))
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ received: body }))
      return
    }

    if (url.pathname === '/multipart') {
      assert.equal(request.method, 'POST')
      assert.equal(request.headers['x-upload-token'], 'secret')
      assert.match(request.headers['content-type'] ?? '', /multipart\/form-data; boundary=/)
      const bodyText = await readRequestBody(request)
      assert.match(bodyText, /name="image"; filename="image\.png"/)
      assert.match(bodyText, /name="note"/)
      response.setHeader('content-type', 'text/plain')
      response.end('ok')
      return
    }

    response.statusCode = 404
    response.end('not found')
  })

  return new Promise<{ server: http.Server; baseUrl: string }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      assert(address && typeof address === 'object')
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` })
    })
  })
}

async function executeApi(inputs: Record<string, unknown>) {
  const context = createExecutionContext()
  await executeApiRequestNode(context, node, moduleDefinition, inputs)
  const responseArtifact = context.artifactsByNode.get(node.id)?.response
  assert.ok(responseArtifact?.artifactRecordId, 'API response output should persist a graph artifact outside debug mode')
  return responseArtifact.value
}

async function verifyApiRequestNode(baseUrl: string) {
  assert.deepEqual(
    await executeApi({
      url: `${baseUrl}/get`,
      method: 'GET',
      values: [
        { key: 'prompt', value: 'hello world' },
        { key: 'count', value: '3' },
      ],
    }),
    { prompt: 'hello world', count: '3' },
  )

  assert.deepEqual(
    await executeApi({
      url: `${baseUrl}/json`,
      method: 'POST',
      values: [
        { key: 'enabled', value: 'true' },
        { key: 'count', value: '3' },
      ],
      payload: { extra: 'value' },
    }),
    { received: { enabled: true, count: 3, extra: 'value' } },
  )

  assert.equal(
    await executeApi({
      url: `${baseUrl}/multipart`,
      method: 'POST',
      body_mode: 'form',
      headers: [],
      'headers.x-upload-token': 'secret',
      values: [
        { key: 'image', value: '' },
        { key: 'note', value: 'sample' },
      ],
      'values.image': 'data:image/png;base64,aGVsbG8=',
    }),
    'ok',
  )
}

function verifyBase64Nodes() {
  const encodeContext = createExecutionContext()
  executeBase64EncodeNode(encodeContext, node, moduleDefinition, {
    value: 'data:text/plain;base64,aGk=',
    input_mode: 'auto',
  })
  assert.equal(encodeContext.artifactsByNode.get(node.id)?.base64.value, 'aGk=')

  const decodeContext = createExecutionContext()
  executeBase64DecodeNode(decodeContext, node, moduleDefinition, {
    base64: 'aGk=',
    output_mode: 'text',
  })
  assert.equal(decodeContext.artifactsByNode.get(node.id)?.value.value, 'hi')
}

async function main() {
  const tempBasePath = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-system-api-node-contracts-'))
  process.env.RUNTIME_BASE_PATH = tempBasePath
  const { server, baseUrl } = await startApiServer()
  let closeUserSettingsDb: (() => void) | null = null

  try {
    const userSettings = await import('../database/userSettingsDb')
    const operations = await import('../services/graph-workflow-executor/system-api-operations')

    executeApiRequestNode = operations.executeApiRequestNode
    executeBase64DecodeNode = operations.executeBase64DecodeNode
    executeBase64EncodeNode = operations.executeBase64EncodeNode

    userSettings.initializeUserSettingsDb()
    closeUserSettingsDb = userSettings.closeUserSettingsDb

    const db = userSettings.getUserSettingsDb()
    const workflowId = db.prepare(`
      INSERT INTO graph_workflows (name, graph_json, version)
      VALUES (?, ?, ?)
    `).run('system-api-node-contracts', JSON.stringify({ nodes: [], edges: [] }), 1).lastInsertRowid as number
    executionId = db.prepare(`
      INSERT INTO graph_executions (graph_workflow_id, graph_version, status)
      VALUES (?, ?, ?)
    `).run(workflowId, 1, 'running').lastInsertRowid as number

    await verifyApiRequestNode(baseUrl)
    verifyBase64Nodes()
  } finally {
    server.close()
    closeUserSettingsDb?.()
    fs.rmSync(tempBasePath, { recursive: true, force: true })
  }

  console.log('System API node contracts verified.')
}

void main()
