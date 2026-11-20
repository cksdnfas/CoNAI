import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('preset and wildcard native read revisions protect whole-item saves without requiring other writers to send one', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-native-editor-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  const userDb = await import('../src/database/userSettingsDb')
  userDb.initializeUserSettingsDb()
  const authDb = await import('../src/database/authDb')
  authDb.initializeAuthDb()
  const express = (await import('express')).default
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { (req as unknown as { session: object }).session = {}; next() })
  app.use('/presets', (await import('../src/routes/prompt-presets.routes')).promptPresetRoutes)
  app.use('/wildcards', (await import('../src/routes/wildcards')).default)
  app.use('/chat', (await import('../src/routes/codex-chat-admin-presets.routes')).default)
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections() })
    authDb.getAuthDb().close()
    userDb.closeUserSettingsDb()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
  })
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  type RecordData = { id: number; assistant_revision: string; items: Array<{ value?: string; content?: string }>; children?: RecordData[] }
  const request = async <T = RecordData | RecordData[]>(url: string, method = 'GET', body?: unknown, revision?: string) => {
    const response = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', ...(revision ? { 'If-Match': revision } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, json: await response.json() as { data: T } }
  }
  const presetInput = (value: string, parent_id: number | null = null) => ({ name: 'Child preset', parent_id, items: [{ description: 'Style', value }] })
  await t.test('shared display block files import together and a legacy edit invalidates an open editor', async () => {
    const db = userDb.getUserSettingsDb()
    const base = '/chat/admin/blocks'
    const file = ['accepted', 'held'].map(key => ({ name: `import-${key}`, block: { key } }))
    db.exec("CREATE TEMP TRIGGER refuse_last_block BEFORE INSERT ON chat_display_blocks WHEN NEW.name='import-held' BEGIN SELECT RAISE(ABORT, 'held'); END")
    try {
      assert.equal((await request(`${base}/import`, 'POST', file)).status, 500)
      assert.equal(db.prepare("SELECT COUNT(*) FROM chat_display_blocks WHERE name LIKE 'import-%'").pluck().get(), 0)
    } finally { db.exec('DROP TRIGGER refuse_last_block') }
    type Block = { id: number; name: string; revision: number }
    const imported = await request<Block[]>(`${base}/import`, 'POST', file)
    assert.equal(imported.status, 201)
    assert.deepEqual(imported.json.data.map(row => row.name), ['import-accepted', 'import-held'])
    const opened = imported.json.data[0]
    const legacy = await request<Block>(`${base}/${opened.id}`, 'PUT', { name: 'Other writer' })
    assert.ok(legacy.json.data.revision > opened.revision)
    const stale = await request<Block>(`${base}/${opened.id}`, 'PUT', { name: 'Stale draft', revision: opened.revision })
    assert.equal(stale.status, 409)
    assert.equal(stale.json.data.name, 'Other writer')
    assert.equal((await request<Block>(`${base}/${opened.id}`, 'PUT', { name: 'Reviewed', revision: legacy.json.data.revision })).status, 200)
  })
  const parent = await request('/presets', 'POST', { name: 'Parent preset', items: [{ description: 'Parent', value: 'parent' }] })
  assert.equal(parent.status, 201)
  const parentId = (parent.json.data as RecordData).id
  const preset = await request('/presets', 'POST', presetInput('old', parentId))
  assert.equal(preset.status, 201)
  const presetId = (preset.json.data as RecordData).id
  const tree = await request('/presets?hierarchical=true&withItems=true')
  const presetRead = (tree.json.data as RecordData[]).find((item) => item.id === parentId)?.children?.find((item) => item.id === presetId)
  assert.ok(presetRead?.assistant_revision)
  assert.equal((await request<RecordData>(`/presets/${presetId}`)).json.data.assistant_revision, presetRead.assistant_revision)
  assert.equal((await request(`/presets/${presetId}`, 'PUT', presetInput('assistant', parentId), presetRead.assistant_revision)).status, 200)
  assert.equal((await request(`/presets/${presetId}`, 'PUT', presetInput('human draft', parentId), presetRead.assistant_revision)).status, 409)
  assert.equal(((await request(`/presets/${presetId}`)).json.data as RecordData).items[0].value, 'assistant')
  assert.equal((await request(`/presets/${presetId}`, 'PUT', presetInput('other writer', parentId))).status, 200)

  const wildcardInput = (content: string) => ({ name: 'Test wildcard', items: { general: [{ content, weight: 1 }], nai: [], comfyui: [] } })
  const wildcard = await request('/wildcards', 'POST', wildcardInput('old'))
  assert.equal(wildcard.status, 201)
  const wildcardId = (wildcard.json.data as RecordData).id
  const wildcardRead = (await request(`/wildcards/${wildcardId}`)).json.data as RecordData
  assert.ok(wildcardRead.assistant_revision)
  assert.equal((await request(`/wildcards/${wildcardId}`, 'PUT', wildcardInput('assistant'), wildcardRead.assistant_revision)).status, 200)
  assert.equal((await request(`/wildcards/${wildcardId}`, 'PUT', wildcardInput('human draft'), wildcardRead.assistant_revision)).status, 409)
  assert.equal(((await request(`/wildcards/${wildcardId}`)).json.data as RecordData).items[0].content, 'assistant')
  assert.equal((await request(`/wildcards/${wildcardId}`, 'PUT', wildcardInput('other writer'))).status, 200)

  await t.test('a rejected delete keeps descendants, item contents and parent links in both libraries', async () => {
    for (const [route, table] of [['/presets', 'prompt_presets'], ['/wildcards', 'wildcards']] as const) {
      const create = async (name: string, parent_id: number | null = null) => {
        const input = route === '/presets' ? presetInput(name) : wildcardInput(name)
        const result = await request<RecordData>(route, 'POST', { ...input, name, parent_id })
        assert.equal(result.status, 201)
        return result.json.data.id
      }
      const root = await create('Tree'), middle = await create('Branch', root), leaf = await create('Leaf', middle)
      const db = userDb.getUserSettingsDb()
      db.exec(`CREATE TEMP TRIGGER keep_branch BEFORE DELETE ON ${table} WHEN OLD.id=${middle} BEGIN SELECT RAISE(ABORT, 'branch in use'); END`)
      try {
        for (const cascade of [true, false]) {
          const rejected = await fetch(`${base}${route}/${middle}?cascade=${cascade}`, { method: 'DELETE' })
          assert.equal(rejected.status, 500)
          await rejected.text()
          const tree = (await request<RecordData[]>(`${route}?hierarchical=true`)).json.data
          const kept = tree.find(node => node.id === root)?.children?.find(node => node.id === middle)?.children?.[0]
          assert.equal(kept?.id, leaf)
          assert.equal(kept.items[0].value ?? kept.items[0].content, 'Leaf')
        }
      } finally { db.exec('DROP TRIGGER keep_branch') }
      assert.equal((await request(`${route}/${middle}`, 'DELETE')).status, 200)
      assert.equal((await request<RecordData[]>(`${route}?hierarchical=true`)).json.data.find(node => node.id === root)?.children?.[0].id, leaf)
      assert.equal((await request(`${route}/${root}?cascade=true`, 'DELETE')).status, 200)
      assert.equal((await request(`${route}/${leaf}`)).status, 404)
    }
  })

  await t.test('LoRA rescan publishes folders, manual links and its log together or not at all', async () => {
    type Log = { totalItems: number; wildcards: Array<{ id: number; name: string; folderName: string; itemCount: number }> }
    const scan = (paths: string[]) => request<{ log: Log }>('/wildcards/scan-lora-folder', 'POST', {
      loraFiles: paths.map(folderName => ({ folderName, loraName: 'model', promptLines: ['line'] })),
    })
    const db = userDb.getUserSettingsDb()
    const manual = await request<RecordData>('/wildcards', 'POST', { ...wildcardInput('manual'), name: 'Kit', customId: 100001 })
    assert.equal(manual.status, 201)
    const first = await scan(['Kit', 'Kit/Child'])
    assert.equal(first.status, 200)
    const { wildcards } = first.json.data.log
    assert.equal(wildcards.length, 2, 'one folder can have both its own files and children')
    const parent = wildcards.find(entry => entry.folderName === 'Kit')!, child = wildcards.find(entry => entry.folderName === 'Kit/Child')!
    assert.deepEqual([parent.name, parent.itemCount, child.itemCount], ['Kit_2', 1, 1])
    const linked = (await request<RecordData>('/wildcards', 'POST', { ...wildcardInput('manual child'), name: 'Linked', parent_id: child.id })).json.data
    db.exec("CREATE TEMP TRIGGER refuse_scan BEFORE INSERT ON wildcards WHEN NEW.name='Blocked' BEGIN SELECT RAISE(ABORT, 'held'); END")
    try {
      assert.equal((await scan(['Kit', 'Blocked'])).status, 500)
      assert.equal((await request('/wildcards/scan-lora-folder', 'POST', { loraFiles: [{ folderName: 7 }] })).status, 400)
      assert.deepEqual((await request<Log>('/wildcards/last-scan-log')).json.data, first.json.data.log)
      assert.equal((await request<RecordData>(`/wildcards/${child.id}`)).json.data.items[0].content, '<lora:model:1>, line')
    } finally { db.exec('DROP TRIGGER refuse_scan') }
    const next = await scan(['Kit/New', 'Kit'])
    assert.equal(next.status, 200)
    assert.equal(next.json.data.log.wildcards.find(entry => entry.folderName === 'Kit')?.id, parent.id)
    assert.equal((await request<{ parent_id: number }>(`/wildcards/${linked.id}`)).json.data.parent_id, parent.id)
    assert.equal((await request<RecordData>(`/wildcards/${manual.json.data.id}`)).json.data.items[0].content, 'manual')
  })
})
