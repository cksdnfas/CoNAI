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
  const request = async (url: string, method = 'GET', body?: unknown, revision?: string) => {
    const response = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', ...(revision ? { 'If-Match': revision } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, json: await response.json() as { data: RecordData | RecordData[] } }
  }
  const presetInput = (value: string, parent_id: number | null = null) => ({ name: 'Child preset', parent_id, items: [{ description: 'Style', value }] })
  const parent = await request('/presets', 'POST', { name: 'Parent preset', items: [{ description: 'Parent', value: 'parent' }] })
  assert.equal(parent.status, 201)
  const parentId = (parent.json.data as RecordData).id
  const preset = await request('/presets', 'POST', presetInput('old', parentId))
  assert.equal(preset.status, 201)
  const presetId = (preset.json.data as RecordData).id
  const tree = await request('/presets?hierarchical=true&withItems=true')
  const presetRead = (tree.json.data as RecordData[]).find((item) => item.id === parentId)?.children?.find((item) => item.id === presetId)
  assert.ok(presetRead?.assistant_revision)
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
})
