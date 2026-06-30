import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const runtimeBase = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-comfy-server-default-'))
process.env.RUNTIME_BASE_PATH = runtimeBase

type ServerDefaultRow = { id: number; is_default: number | boolean | null }

function isDefaultValue(value: number | boolean | null) {
  return value === true || value === 1
}

async function main() {
  const { initializeUserSettingsDb, getUserSettingsDb, closeUserSettingsDb } = await import('../database/userSettingsDb')
  const { ComfyUIServerModel } = await import('../models/ComfyUIServer')
  const { comfyuiServerRoutes } = await import('../routes/comfyuiServers')
  const expressModule = await import('express')

  initializeUserSettingsDb()
  const db = getUserSettingsDb()

  try {
    const indexes = db.prepare("PRAGMA index_list('comfyui_servers')").all() as Array<{ name: string; unique: number }>
    assert.ok(
      indexes.some((index) => index.name === 'idx_comfyui_servers_single_default' && index.unique === 1),
      'comfyui_servers must enforce at most one representative server with a unique partial index',
    )

    const listDefaultIds = () => {
      const rows = db.prepare('SELECT id, is_default FROM comfyui_servers ORDER BY id ASC').all() as ServerDefaultRow[]
      return rows.filter((row) => isDefaultValue(row.is_default)).map((row) => row.id)
    }

    const firstId = ComfyUIServerModel.create({
      name: 'Local GPU',
      endpoint: 'http://127.0.0.1:8188',
      backend_type: 'comfyui',
      capacity: 1,
      is_default: true,
    })
    assert.deepEqual(listDefaultIds(), [firstId], 'creating a representative server should mark it as the only representative')
    assert.equal(ComfyUIServerModel.findById(firstId)?.is_default, true, 'server records should expose is_default as a boolean')

    const secondId = ComfyUIServerModel.create({
      name: 'Modal GPU',
      endpoint: 'https://example.invalid/generate',
      backend_type: 'modal',
      capacity: 10,
      is_default: true,
    })
    assert.deepEqual(listDefaultIds(), [firstId], 'creating a Modal server as representative should be ignored')
    assert.equal(ComfyUIServerModel.findById(secondId)?.is_default, false, 'Modal servers should never expose representative status')
    assert.equal(ComfyUIServerModel.findDefault()?.id, firstId, 'findDefault should ignore Modal servers')
    assert.equal(ComfyUIServerModel.setDefault(secondId), false, 'setDefault should reject Modal servers')
    assert.equal(ComfyUIServerModel.update(secondId, { is_default: true }), false, 'updating a Modal server as representative should be rejected')
    assert.deepEqual(listDefaultIds(), [firstId], 'rejecting a Modal representative must not clear the current representative')

    const thirdId = ComfyUIServerModel.create({
      name: 'Backup GPU',
      endpoint: 'http://127.0.0.1:8190',
      backend_type: 'comfyui',
      capacity: 1,
    })
    assert.deepEqual(listDefaultIds(), [firstId], 'creating a non-representative server should not change the current representative')

    assert.equal(ComfyUIServerModel.setDefault(thirdId), true, 'setDefault should report success for an existing ComfyUI server')
    assert.deepEqual(listDefaultIds(), [thirdId], 'setDefault should atomically move representative status')
    assert.equal(ComfyUIServerModel.findDefault()?.id, thirdId)
    assert.equal(ComfyUIServerModel.findDefaultActive()?.id, thirdId)

    assert.equal(ComfyUIServerModel.update(thirdId, { is_active: false }), true, 'deactivating a representative should preserve its saved record')
    assert.equal(ComfyUIServerModel.findDefault()?.id, thirdId, 'findDefault should preserve saved representative status even when inactive')
    assert.equal(ComfyUIServerModel.findDefaultActive(), null, 'findDefaultActive should exclude inactive representative servers')
    assert.equal(ComfyUIServerModel.findAll(true).some((server) => server.id === thirdId), false, 'active-only server lists should exclude inactive records')
    assert.equal(ComfyUIServerModel.update(thirdId, { is_active: true }), true, 'reactivating a representative should restore it to active default candidates')
    assert.equal(ComfyUIServerModel.findDefaultActive()?.id, thirdId)

    assert.equal(ComfyUIServerModel.update(thirdId, { backend_type: 'modal' }), true, 'converting a representative to Modal should clear representative status')
    assert.deepEqual(listDefaultIds(), [], 'Modal conversion should leave no representative')
    assert.equal(ComfyUIServerModel.findById(thirdId)?.is_default, false)
    assert.equal(ComfyUIServerModel.findDefault(), null)

    assert.equal(ComfyUIServerModel.setDefault(firstId), true)
    assert.deepEqual(listDefaultIds(), [firstId])
    assert.equal(ComfyUIServerModel.update(firstId, { is_default: false }), true, 'explicit false should allow clearing representative status')
    assert.deepEqual(listDefaultIds(), [], 'clearing the only representative should leave no representative')
    assert.equal(ComfyUIServerModel.findDefault(), null)

    assert.equal(ComfyUIServerModel.setDefault(999_999), false, 'setDefault should return false for missing server IDs')
    assert.deepEqual(listDefaultIds(), [], 'missing setDefault calls must not mutate representative state')

    const express = ((expressModule as any).default ?? expressModule) as typeof import('express')
    const app = express()
    app.use(express.json())
    app.use('/api/comfyui-servers', comfyuiServerRoutes)
    const server = await new Promise<any>((resolve) => {
      const startedServer = app.listen(0, '127.0.0.1', () => resolve(startedServer))
    })

    try {
      const address = server.address()
      assert.ok(address && typeof address === 'object', 'test server should expose a local port')
      const baseUrl = `http://127.0.0.1:${address.port}`
      const modalCreateResponse = await fetch(`${baseUrl}/api/comfyui-servers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'API Modal GPU',
          endpoint: 'https://example.invalid/api-generate',
          backend_type: 'modal',
          capacity: 10,
          is_default: true,
        }),
      })
      assert.equal(modalCreateResponse.status, 400, 'API should reject Modal server registration as representative')
      assert.match(await modalCreateResponse.text(), /Modal servers cannot be representative servers/)

      const apiServerId = ComfyUIServerModel.create({
        name: 'API Local GPU',
        endpoint: 'http://127.0.0.1:8191',
        backend_type: 'comfyui',
        capacity: 1,
      })
      const modalUpdateResponse = await fetch(`${baseUrl}/api/comfyui-servers/${apiServerId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ backend_type: 'modal', is_default: true }),
      })
      assert.equal(modalUpdateResponse.status, 400, 'API should reject updating a server to Modal representative')
      assert.match(await modalUpdateResponse.text(), /Modal servers cannot be representative servers/)
      assert.deepEqual(listDefaultIds(), [], 'API Modal representative rejection must not mutate representative state')
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve())
      })
    }

    console.log('✅ ComfyUI representative server contracts passed')
  } finally {
    closeUserSettingsDb()
    fs.rmSync(runtimeBase, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
