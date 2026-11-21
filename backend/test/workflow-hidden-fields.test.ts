import './support/testTemp'
import './support/scratchRuntime'
import assert from 'node:assert/strict'
import http from 'node:http'
import { after, before, test } from 'node:test'
import express from 'express'
import { initializeAuthDb, getAuthDb } from '../src/database/authDb'
import { initializeDatabase, closeDatabase } from '../src/database/init'
import { initializeUserSettingsDb, closeUserSettingsDb } from '../src/database/userSettingsDb'
import { initializeApiGenerationDb, closeApiGenerationDb } from '../src/database/apiGenerationDb'
import { AuthPermissionGroup } from '../src/models/AuthPermissionGroup'
import { invalidateConfiguredAuthCache } from '../src/services/auth/sessionAccess'
import { WorkflowModel } from '../src/models/Workflow'
import { GenerationQueueModel } from '../src/models/GenerationQueue'
import publicWorkflowRoutes from '../src/routes/public-workflows.routes'
import { workflowRoutes } from '../src/routes/workflows'
import { isHiddenWorkflowField, visibleWorkflowFields } from '../src/services/workflowHiddenFieldPolicy'
import { normalizeWorkflowNumericPromptValues } from '../src/services/workflowNumericFieldPolicy'
import { resolveWorkflowPromptValues } from '../src/services/workflowPromptValueResolver'
import { substituteComfyPromptData } from '../src/services/comfyui/workflowSubstitution'
import { createMcpWorkflowInputTemplate, normalizeMcpWorkflowInputs } from '../src/services/comfyui/comfyWorkflowInputs'
import { buildUiSchemaFromMarkedFields, convertMarkedFieldsToPorts } from '../src/services/moduleDefinitions/schemaBuilder'
import { checkComfyWorkflowAgainst } from '../src/services/comfyui/workflowServerCheck'
import type { MarkedField } from '../src/types/workflow'

/**
 * A hidden marked field is a fixed value: callers never see it (public page, MCP and chat schemas, module ports), a
 * value they send for it is ignored, its default runs, an empty default keeps the workflow's own input, and required
 * means nothing on it. Image and node fields ignore the flag.
 */

const workflowJson = JSON.stringify({
  '1': { class_type: 'CLIPTextEncode', inputs: { text: 'workflow prompt' } },
  '2': { class_type: 'KSampler', inputs: { seed: 5, steps: 20, sampler_name: 'euler' } },
  '3': { class_type: 'CLIPTextEncode', inputs: { text: 'workflow negative' } },
  '4': { class_type: 'LoadImage', inputs: { image: 'a.png' } },
  '5': { class_type: 'Power Lora Loader (rgthree)', inputs: { a: 1 } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'workflow style' } },
})

const fields = [
  { id: 'prompt', label: 'Prompt', type: 'textarea', jsonPath: '1.inputs.text' },
  { id: 'steps', label: 'Steps', type: 'number', jsonPath: '2.inputs.steps', hidden: true, required: true, default_value: 30 },
  { id: 'sampler', label: 'Sampler', type: 'select', jsonPath: '2.inputs.sampler_name', hidden: true, default_value: '__random__', options: ['dpmpp_2m', 'uni_pc'] },
  { id: 'negative', label: 'Negative', type: 'text', jsonPath: '3.inputs.text', hidden: true, required: true },
  { id: 'seed', label: 'Seed', type: 'number', jsonPath: '2.inputs.seed', hidden: true, default_value: '' },
  { id: 'style', label: 'Style', type: 'text', jsonPath: '6.inputs.text', hidden: true, default_value: '' },
  { id: 'image', label: 'Image', type: 'image', jsonPath: '4.inputs.image', hidden: true },
  { id: 'lora', label: 'LoRA', type: 'node', node_editor: 'power_lora_loader_rgthree', jsonPath: '5.inputs', hidden: true },
] as MarkedField[]

before(async () => {
  initializeAuthDb()
  await initializeDatabase()
  initializeUserSettingsDb()
  initializeApiGenerationDb()
})

after(async () => {
  getAuthDb().close()
  closeApiGenerationDb()
  closeUserSettingsDb()
  closeDatabase()
  await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
})

const supplied = { prompt: 'a cat', steps: 99, sampler: 'bogus', negative: 'caller negative', seed: 123, style: 'caller style', image: 'b.png', lora: { b: 2 } }

test('hidden fields: the predicate, the chokepoint and the substituted workflow', () => {
  assert.deepEqual(fields.filter(isHiddenWorkflowField).map((field) => field.id), ['steps', 'sampler', 'negative', 'seed', 'style'], 'image and node fields ignore the flag')
  assert.deepEqual(visibleWorkflowFields(fields).map((field) => field.id), ['prompt', 'image', 'lora'])

  // Every entry path normalizes caller data here: hidden values are dropped, the number default is clamped in.
  const normalized = normalizeWorkflowNumericPromptValues(fields, supplied)
  assert.equal(normalized.steps, 30)
  for (const id of ['sampler', 'negative', 'seed', 'style']) assert.equal(id in normalized, false, id)
  assert.equal(normalized.image, 'b.png')
  assert.deepEqual(normalized.lora, { b: 2 })
  // A hidden number with an empty fixed value is not an invalid number.
  assert.doesNotThrow(() => normalizeWorkflowNumericPromptValues(fields, { seed: '' }))

  // The run path resolves the raw data (a stale queue payload) the same way, then substitutes the resolved values.
  const resolved = resolveWorkflowPromptValues(fields, supplied, 'comfyui')
  assert.equal(resolved.steps, 30)
  assert.ok(['dpmpp_2m', 'uni_pc'].includes(resolved.sampler), 'a hidden __random__ default still rolls per run')
  const workflow = substituteComfyPromptData(workflowJson, fields, resolved)
  assert.equal(workflow['1'].inputs.text, 'a cat')
  assert.equal(workflow['2'].inputs.steps, 30)
  assert.equal(workflow['2'].inputs.sampler_name, resolved.sampler, 'substitution keeps the resolved pick')
  assert.equal(workflow['3'].inputs.text, 'workflow negative', 'no default: the workflow keeps its own input')
  assert.equal(workflow['6'].inputs.text, 'workflow style', 'an empty default: the workflow keeps its own input')
  assert.equal(typeof workflow['2'].inputs.seed, 'number')
  assert.notEqual(workflow['2'].inputs.seed, 123, 'the caller seed is ignored and the seed rolls')
  assert.equal(workflow['4'].inputs.image, 'b.png', 'an image field ignores the flag')
  assert.deepEqual(workflow['5'].inputs, { b: 2 }, 'a node field ignores the flag')
})

test('hidden fields: MCP inputs ignore them, never report them missing, and leave them out of the template', () => {
  const normalized = normalizeMcpWorkflowInputs(fields, supplied)
  assert.equal(normalized.sampler, '__random__', 'a stale or wrong value for a hidden dropdown is ignored, not refused')
  assert.equal(normalized.steps, 30)
  assert.equal('negative' in normalized, false, 'hidden + required + no default is not missing')
  assert.equal(normalized.style, '')
  assert.equal(normalized.prompt, 'a cat')
  assert.throws(() => normalizeMcpWorkflowInputs(fields, { unknown_field: 1 }), /Unknown workflow input/)
  const requiredPrompt = fields.map((field) => field.id === 'prompt' ? { ...field, required: true } : field)
  assert.throws(() => normalizeMcpWorkflowInputs(requiredPrompt, {}), /Required workflow input is missing: Prompt/)
  assert.deepEqual(Object.keys(createMcpWorkflowInputTemplate(fields)), ['prompt', 'image', 'lora'])
})

test('hidden fields: module ports and ui schema leave them out', () => {
  assert.deepEqual(convertMarkedFieldsToPorts(fields).map((port) => port.key), ['prompt', 'image'])
  assert.deepEqual(convertMarkedFieldsToPorts(fields, ['prompt', 'steps']).map((port) => port.key), ['prompt'])
  assert.deepEqual(buildUiSchemaFromMarkedFields(fields).map((field) => field.key), ['prompt', 'image', 'lora'])
})

test('server check: choices of literal combo inputs, without dynamic, upload or long lists', async () => {
  const info: Record<string, unknown> = {
    KSampler: { input: { required: { seed: ['INT', {}], sampler_name: [['euler', 'dpmpp_2m']], scheduler: [['normal', 'karras']], cfg_mode: ['COMBO', { options: ['a', 'b'] }] } } },
    LoadImage: { input: { required: { image: [['a.png', 'b.png'], { image_upload: true }] } } },
    BigLoader: { input: { required: { model: [Array.from({ length: 300 }, (_, index) => 'm' + index)] } } },
    DynamicNode: { input: { required: { mode: ['COMBO', { options: [] }] } } },
    SaveImage: { input: { required: { images: ['IMAGE'] } }, output_node: true },
  }
  const server = http.createServer((req, res) => {
    const type = decodeURIComponent((req.url ?? '').replace('/object_info/', ''))
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(type in info ? { [type]: info[type] } : {}))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  try {
    const graph = JSON.stringify({
      '1': { class_type: 'KSampler', inputs: { seed: 1, sampler_name: 'euler', scheduler: ['9', 0], cfg_mode: 'a' } },
      '2': { class_type: 'LoadImage', inputs: { image: 'a.png' } },
      '3': { class_type: 'BigLoader', inputs: { model: 'm1' } },
      '4': { class_type: 'DynamicNode', inputs: { mode: 'x' } },
      '5': { class_type: 'SaveImage', inputs: { images: ['1', 0] } },
    })
    const result = await checkComfyWorkflowAgainst(graph, [{ id: 1, name: 'local', endpoint: 'http://127.0.0.1:' + port }])
    assert.deepEqual(result.input_choices, { '1.inputs.sampler_name': ['euler', 'dpmpp_2m'], '1.inputs.cfg_mode': ['a', 'b'] })
    const unreachable = await checkComfyWorkflowAgainst(graph, [{ id: 2, name: 'down', endpoint: 'http://127.0.0.1:9' }])
    assert.equal(unreachable.input_choices, null, 'no server answered: no choices')
  } finally {
    server.close()
  }
})

test('hidden fields: the public page, MCP details and chat presets never offer them; a public queue ignores their values', { timeout: 60000 }, async (t) => {
  const auth = getAuthDb()
  const guest = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('hidden-guest', 'unused', 'guest')").run().lastInsertRowid)
  const group = AuthPermissionGroup.createCustomGroup({ name: 'hidden-generator', permissionKeys: ['generation.execute', 'workflows.view'] })
  AuthPermissionGroup.addAccountMembership(group.id, guest)
  invalidateConfiguredAuthCache()
  const workflowId = WorkflowModel.create({ name: 'hidden fields', workflow_json: workflowJson, marked_fields: fields, is_public_page: true, public_slug: 'hidden-fields' })

  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    Object.assign(req, { session: { authenticated: true, accountId: guest, accountType: 'guest' } })
    next()
  })
  app.use('/api/public-workflows', publicWorkflowRoutes)
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { createMcpServer } = await import('../src/mcp/server')
  const { ALL_MCP_HTTP_SCOPES } = await import('../src/mcp/context')
  const { Client, InMemoryTransport } = await import('@modelcontextprotocol/client')
  const mcpServer = createMcpServer({ scopes: ALL_MCP_HTTP_SCOPES })
  const client = new Client({ name: 'hidden-fields', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)])
  t.after(async () => {
    await client.close()
    await mcpServer.close()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })
  const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port

  // Saved as given: the owner's CRUD view and export keep the flag.
  assert.deepEqual(JSON.parse(WorkflowModel.findById(workflowId)!.marked_fields!).filter((field: MarkedField) => field.hidden === true).map((field: MarkedField) => field.id), ['steps', 'sampler', 'negative', 'seed', 'style', 'image', 'lora'])

  const page = await (await fetch(origin + '/api/public-workflows/hidden-fields')).json() as { data: { marked_fields: MarkedField[] } }
  assert.deepEqual(page.data.marked_fields.map((field) => field.id), ['prompt', 'image', 'lora'])
  const listed = await (await fetch(origin + '/api/public-workflows')).json() as { data: Array<{ id: number; marked_fields: MarkedField[] }> }
  assert.deepEqual(listed.data.find((entry) => entry.id === workflowId)?.marked_fields.map((field) => field.id), ['prompt', 'image', 'lora'])

  const queued = await fetch(origin + '/api/public-workflows/hidden-fields/queue', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_payload: { prompt_data: { prompt: 'a cat', steps: 99, sampler: 'bogus', negative: 'caller negative', seed: 123 } } }),
  })
  assert.equal(queued.status, 201, await queued.clone().text())
  const record = (await queued.json() as { record: { id: number } }).record
  const job = GenerationQueueModel.findById(record.id)!
  const payload = typeof job.request_payload === 'string' ? JSON.parse(job.request_payload) : job.request_payload
  assert.deepEqual(payload.prompt_data, { prompt: 'a cat', steps: 30 }, 'hidden values are dropped; the number default is applied')

  const text = (result: Awaited<ReturnType<InstanceType<typeof Client>['callTool']>>) => (result.content as Array<{ text?: string }>).map((part) => part.text ?? '').join('')
  const details = JSON.parse(text(await client.callTool({ name: 'get_workflow_details', arguments: { workflow_id: workflowId } }))) as { input_schema: Array<{ id: string }>; input_values_template: Record<string, unknown> }
  assert.deepEqual(details.input_schema.map((field) => field.id), ['prompt', 'image', 'lora'])
  assert.deepEqual(Object.keys(details.input_values_template), ['prompt', 'image', 'lora'])
  const list = JSON.parse(text(await client.callTool({ name: 'list_workflows', arguments: {} }))) as Array<{ id: number; input_fields: Array<{ id: string }> }>
  assert.deepEqual(list.find((entry) => entry.id === workflowId)?.input_fields.map((field) => field.id), ['prompt', 'image', 'lora'])

  // A chat preset that still exposes a now-hidden field does not ask for it, and its stale fixed value is no problem.
  const { ChatGenerationPresetStore } = await import('../src/services/codex-chat/chatGenerationPresets')
  const { presetInputShape } = await import('../src/services/codex-chat/chatGenerationInputs')
  const preset = ChatGenerationPresetStore.create({ name: 'hidden preset', kind: 'comfyui', comfyui: { workflowId, exposedFieldIds: ['prompt', 'negative', 'steps'], fixedInputs: { sampler: 'bogus' } } })
  const shape = presetInputShape(preset)
  assert.equal(shape.problem, null)
  assert.deepEqual(Object.keys(shape.shape), ['prompt'])
})

test('hidden fields: the flag survives the owner save and reload', { timeout: 60000 }, async (t) => {
  const auth = getAuthDb()
  const admin = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('hidden-admin', 'unused', 'admin')").run().lastInsertRowid)
  auth.prepare("INSERT INTO auth_account_group_memberships (account_id, group_id) SELECT ?, id FROM auth_permission_groups WHERE group_key = 'admin'").run(admin)
  invalidateConfiguredAuthCache()
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    Object.assign(req, { session: { authenticated: true, accountId: admin, accountType: 'admin' } })
    next()
  })
  app.use('/api/workflows', workflowRoutes)
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
  const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port
  const created = await fetch(origin + '/api/workflows', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'hidden round trip', workflow_json: workflowJson, marked_fields: fields }),
  })
  assert.equal(created.status, 201, await created.clone().text())
  const id = (await created.json() as { data: { id: number } }).data.id
  const detail = await (await fetch(origin + '/api/workflows/' + id)).json() as { data: { marked_fields: MarkedField[] } }
  assert.deepEqual(detail.data.marked_fields, fields)
})
