import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('ComfyUI dropdown collection isolates API failures and preserves data across failed replacements', { timeout: 60000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-comfy-dropdowns-'))
  const environment = { ...process.env }
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
  t.after(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in environment)) delete process.env[key]
    }
    Object.assign(process.env, environment)
  })

  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  const auth = await import('../src/database/authDb')
  auth.initializeAuthDb()
  t.after(async () => {
    auth.getAuthDb().close()
    user.closeUserSettingsDb()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const { CustomDropdownListModel: lists } = await import('../src/models/CustomDropdownList')
  const { ComfyUIServerModel } = await import('../src/models/ComfyUIServer')
  const { AUTO_COLLECT_SOURCE_PATH } = await import('../src/services/comfyDropdownAutoCollectionService')
  const { customDropdownListRoutes } = await import('../src/routes/customDropdownLists')
  ComfyUIServerModel.create({ name: 'test default', endpoint: 'http://comfy.invalid', is_default: true })
  const adminId = Number(auth.getAuthDb().prepare(
    "INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('collector', 'unused', 'admin')"
  ).run().lastInsertRowid)

  const axios = require('axios') as typeof import('axios').default
  const responses = new Map<string, unknown>()
  const requestedPaths: string[] = []
  t.mock.method(axios, 'get', async (apiPath: string, options: { baseURL: string }) => {
    assert.equal(options.baseURL, 'http://comfy.invalid')
    assert.ok(responses.has(apiPath), `Unexpected API path: ${apiPath}`)
    requestedPaths.push(apiPath)
    const response = responses.get(apiPath)
    if (response instanceof Error) throw response
    return { data: response }
  })

  const express = (await import('express')).default
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    Object.assign(req, { session: { authenticated: true, accountId: adminId } })
    next()
  })
  app.use('/api/custom-dropdown-lists', customDropdownListRoutes)
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const collect = async (apiPaths: string[]) => {
    const response = await fetch(`${origin}/api/custom-dropdown-lists/scan-comfyui-models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiPaths }),
    })
    return { status: response.status, body: await response.json() as any }
  }
  const auto = (name: string, items: string[], sourcePath = AUTO_COLLECT_SOURCE_PATH) => lists.create({
    name, items, is_auto_collected: 1, source_path: sourcePath,
  })
  const snapshot = () => lists.findAll().sort((left, right) => left.id - right.id)

  auto('checkpoints (통합)', ['old.ckpt', 'fresh\\old.ckpt'], 'models')
  auto('checkpoints', ['old.ckpt'], 'models')
  auto('checkpoints/fresh', ['fresh\\old.ckpt'], 'client-selected')
  auto('loras (통합)', ['old-lora.safetensors'], 'client-selected')
  auto('loras', ['old-lora.safetensors'], 'models')
  auto('vae (통합)', ['old-vae.pt'], 'models')
  auto('vae', ['old-vae.pt'], 'client-selected')
  lists.create({ name: 'checkpoints/manual favorites', items: ['favorite.safetensors'] })
  const untouched = snapshot().filter((list) => !['checkpoints (통합)', 'checkpoints', 'checkpoints/fresh'].includes(list.name))

  const failures = [
    { apiPath: '/models/loras', error: 'Request failed with status code 404' },
    { apiPath: '/models/unet_gguf?mode=all', error: 'connect ECONNREFUSED 127.0.0.1:8188' },
  ]
  responses.set('/models/checkpoints', ['fresh/model.safetensors', 'fresh\\model.safetensors'])
  for (const failure of failures) responses.set(failure.apiPath, new Error(failure.error))
  const partial = await collect([
    ' models/checkpoints ', '/models/loras', 'https://ignored.invalid/models/unet_gguf?mode=all', '/models/loras',
  ])
  assert.equal(partial.status, 200, 'successful paths replace legacy auto rows even when their peers fail')
  assert.equal(partial.body.success, true)
  assert.deepEqual(partial.body.data.apiPaths, ['/models/checkpoints', '/models/loras', '/models/unet_gguf?mode=all'])
  assert.deepEqual(requestedPaths, partial.body.data.apiPaths)
  assert.equal(partial.body.data.scannedFolders, 1)
  assert.equal(partial.body.data.createdLists, 2)
  assert.equal(partial.body.data.deletedLists, 3)
  assert.deepEqual(partial.body.data.failedPaths, failures)
  for (const failure of failures) {
    assert.ok(partial.body.data.message.includes(failure.apiPath))
    assert.ok(partial.body.data.message.includes(failure.error))
  }
  assert.match(partial.body.data.message, /2.*목록/)
  assert.deepEqual(lists.findByName('checkpoints (통합)')?.items, ['fresh\\model.safetensors'])
  assert.deepEqual(lists.findByName('checkpoints/fresh')?.items, ['fresh\\model.safetensors'])
  assert.equal(lists.findByName('checkpoints'), null)
  for (const list of untouched) assert.deepEqual(lists.findById(list.id), list)
  assert.equal(lists.findByName('checkpoints (통합)')?.source_path, AUTO_COLLECT_SOURCE_PATH)
  assert.equal(lists.findByName('checkpoints/fresh')?.source_path, AUTO_COLLECT_SOURCE_PATH)

  const beforeAllFailure = snapshot()
  const allFailed = await collect(failures.map((failure) => failure.apiPath))
  assert.ok(allFailed.status >= 400)
  assert.equal(allFailed.body.success, false)
  assert.equal(allFailed.body.data.scannedFolders, 0)
  assert.deepEqual(allFailed.body.data.failedPaths, failures)
  for (const failure of failures) {
    assert.ok(allFailed.body.error.includes(failure.apiPath))
    assert.ok(allFailed.body.error.includes(failure.error))
  }
  assert.deepEqual(snapshot(), beforeAllFailure, 'an all-path failure never changes stored lists')

  auto('checkpoints/legacy', ['legacy\\old.ckpt'], 'client-selected')
  responses.set('/models/checkpoints?source=one', ['next/model.ckpt'])
  responses.set('/extra/checkpoints?source=two', new Error('second source unavailable'))
  const sharedRoot = await collect(['/models/checkpoints?source=one', '/extra/checkpoints?source=two'])
  assert.equal(sharedRoot.status, 200)
  assert.equal(sharedRoot.body.data.scannedFolders, 1)
  assert.deepEqual(sharedRoot.body.data.failedPaths, [
    { apiPath: '/extra/checkpoints?source=two', error: 'second source unavailable' },
  ])
  assert.deepEqual(lists.findByName('checkpoints (통합)')?.items, ['fresh\\model.safetensors', 'legacy\\old.ckpt', 'next\\model.ckpt'])
  assert.deepEqual(lists.findByName('checkpoints/fresh')?.items, ['fresh\\model.safetensors'])
  assert.deepEqual(lists.findByName('checkpoints/legacy')?.items, ['legacy\\old.ckpt'])
  assert.deepEqual(lists.findByName('checkpoints/next')?.items, ['next\\model.ckpt'])

  responses.set('/models/checkpoints', [])
  const empty = await collect(['/models/checkpoints'])
  assert.equal(empty.status, 200)
  assert.equal(empty.body.success, true)
  assert.equal(empty.body.data.scannedFolders, 1)
  assert.equal(empty.body.data.createdLists, 0)
  assert.equal(empty.body.data.deletedLists, 4)
  assert.deepEqual(empty.body.data.failedPaths, [])
  for (const name of ['checkpoints (통합)', 'checkpoints/fresh', 'checkpoints/legacy', 'checkpoints/next']) assert.equal(lists.findByName(name), null)
  for (const list of untouched) assert.deepEqual(lists.findById(list.id), list)

  responses.set('/models/loras', ['current.safetensors'])
  const success = await collect(['/models/loras'])
  assert.equal(success.status, 200)
  assert.equal(success.body.success, true)
  assert.equal(success.body.data.scannedFolders, 1)
  assert.deepEqual(success.body.data.failedPaths, [])
  assert.deepEqual(lists.findByName('loras (통합)')?.items, ['current.safetensors'])
  assert.deepEqual(lists.findByName('loras')?.items, ['current.safetensors'])

  lists.create({ name: 'loras/new', items: ['manual choice'] })
  responses.set('/models/loras', ['new/item.safetensors'])
  const beforeStorageFailure = snapshot()
  const storageFailure = await collect(['/models/loras', '/models/unet_gguf?mode=all'])
  assert.ok(storageFailure.status >= 400)
  assert.equal(storageFailure.body.success, false)
  assert.match(storageFailure.body.error, /UNIQUE constraint failed/)
  assert.ok(storageFailure.body.error.includes(failures[1].apiPath))
  assert.ok(storageFailure.body.error.includes(failures[1].error))
  assert.deepEqual(storageFailure.body.data.failedPaths, [failures[1]])
  assert.deepEqual(snapshot(), beforeStorageFailure, 'a name collision rolls back deletions and earlier inserts')
})
