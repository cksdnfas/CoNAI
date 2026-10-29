import './support/testTemp'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('snapshot module routes preserve authoring data, versions and engine isolation', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-module-authoring-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
  const auth = await import('../src/database/authDb')
  auth.initializeAuthDb()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  const { ModuleDefinitionModel } = await import('../src/models/ModuleDefinition')
  const { moduleDefinitionRoutes } = await import('../src/routes/moduleDefinitions')
  const express = (await import('express')).default
  const session = (await import('express-session')).default
  const app = express()
  app.use(express.json())
  app.use(session({ secret: 'module-authoring-test', resave: false, saveUninitialized: false }))
  app.use('/modules', moduleDefinitionRoutes)
  const listener = app.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  t.after(async () => {
    await new Promise<void>((resolve) => listener.close(() => resolve()))
    user.closeUserSettingsDb()
    auth.getAuthDb().close()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
  })

  const base = `http://127.0.0.1:${(listener.address() as { port: number }).port}/modules`
  const post = async (engine: string, body: unknown) => {
    const response = await fetch(`${base}/from-${engine}-snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return {
      status: response.status,
      body: await response.json() as { success: boolean; error?: string; data?: { id: number; message: string } },
    }
  }
  const snapshot = { prompt: 'blue sky', seed: 7, steps: 12 }
  const ids = new Map<string, number>()
  const cases = [
    { engine: 'nai', source: 'nai_form_snapshot', label: 'NAI' },
    { engine: 'codex', source: 'codex_form_snapshot', label: 'Codex' },
  ] as const

  for (const { engine, source, label } of cases) {
    await t.test(`${engine}: create defaults, preserve overrides and update the same record`, async () => {
      const name = `${label} snapshot`
      const input = { name, description: 'before', snapshot, exposed_fields: ['prompt', 'seed'], color: '#123456', is_active: false }
      const created = await post(engine, input)
      assert.equal(created.status, 201)
      assert.equal(created.body.success, true)
      assert.equal(created.body.data?.message, `${label} snapshot module created successfully`)
      const id = created.body.data!.id
      ids.set(engine, id)
      const record = ModuleDefinitionModel.findById(id)!
      assert.equal(record.engine_type, engine)
      assert.equal(record.authoring_source, source)
      assert.equal(record.category, 'generation')
      assert.equal(record.description, 'before')
      assert.equal(record.color, '#123456')
      assert.equal(Boolean(record.is_active), false)
      assert.equal(record.version, 1)
      // Codex snapshots are stored with the form's reference/preserve defaults filled in.
      const engineDefaults = engine === 'codex' ? { references: [], preserve: '' } : {}
      assert.deepEqual(JSON.parse(record.template_defaults), { ...engineDefaults, ...snapshot })
      assert.deepEqual(JSON.parse(record.internal_fixed_values), { ...engineDefaults, steps: 12 })
      assert.deepEqual(JSON.parse(record.exposed_inputs).map((port: { key: string; source_path: string; default_value: unknown }) => ({
        key: port.key, source: port.source_path, value: port.default_value,
      })), [{ key: 'prompt', source: 'prompt', value: 'blue sky' }, { key: 'seed', source: 'seed', value: 7 }])
      assert.deepEqual(JSON.parse(record.output_ports).map((port: { key: string }) => port.key), ['image', 'metadata'])
      assert.deepEqual(JSON.parse(record.ui_schema).map((field: { key: string }) => field.key), ['prompt', 'seed'])

      const duplicate = await post(engine, input)
      assert.equal(duplicate.status, 409)
      assert.equal(duplicate.body.error, 'Module definition name already exists')
      const outputPorts = [{ key: 'caption', label: 'Caption', direction: 'output', data_type: 'text', required: true, multiple: false }]
      const uiSchema = [{ key: 'prompt', label: 'Prompt override', data_type: 'text' }]
      const edited = await post(engine, {
        ...input,
        target_module_id: id,
        name: `${name} edited`,
        description: 'after',
        category: 'custom',
        snapshot: { ...snapshot, steps: 24 },
        output_ports: outputPorts,
        ui_schema: uiSchema,
        is_active: true,
      })
      assert.equal(edited.status, 200)
      assert.deepEqual(edited.body.data, { id, message: `${label} snapshot module updated successfully` })
      const updated = ModuleDefinitionModel.findById(id)!
      assert.equal(updated.name, `${name} edited`)
      assert.equal(updated.description, 'after')
      assert.equal(updated.category, 'custom')
      assert.equal(Boolean(updated.is_active), true)
      assert.equal(updated.version, 2)
      assert.deepEqual(JSON.parse(updated.internal_fixed_values), { ...engineDefaults, steps: 24 })
      assert.deepEqual(JSON.parse(updated.output_ports), outputPorts)
      assert.deepEqual(JSON.parse(updated.ui_schema), uiSchema)
    })
  }

  await t.test('missing inputs and foreign or missing targets leave existing modules unchanged', async () => {
    const before = [...ids.values()].map((id) => ModuleDefinitionModel.findById(id))
    for (const { engine, label } of cases) {
      const invalid = await post(engine, { name: 'Missing snapshot' })
      assert.equal(invalid.status, 400)
      assert.equal(invalid.body.error, 'name and snapshot are required')
      const foreign = await post(engine, { name: 'Wrong engine', snapshot, target_module_id: ids.get(engine === 'nai' ? 'codex' : 'nai') })
      assert.equal(foreign.status, 400)
      assert.equal(foreign.body.error, `Target module is not a ${label} snapshot module`)
      const missing = await post(engine, { name: 'Missing target', snapshot, target_module_id: 999999999 })
      assert.equal(missing.status, 404)
      assert.equal(missing.body.error, 'Target module definition not found')
    }
    assert.deepEqual([...ids.values()].map((id) => ModuleDefinitionModel.findById(id)), before)
  })
})
