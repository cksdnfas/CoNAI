import './support/testTemp'
import './support/scratchRuntime'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { initializeAuthDb, getAuthDb } from '../src/database/authDb'
import { initializeDatabase, closeDatabase, db } from '../src/database/init'
import { initializeUserSettingsDb, closeUserSettingsDb } from '../src/database/userSettingsDb'
import { runtimePaths } from '../src/config/runtimePaths'
import { AuthPermissionGroup } from '../src/models/AuthPermissionGroup'
import { invalidateConfiguredAuthCache } from '../src/services/auth/sessionAccess'
import { prepareComfyPromptData } from '../src/services/prepareComfyPromptData'
import { storeQueueInputBuffer } from '../src/services/generation-queue/queueInputStore'
import { storeWorkflowInputAssetFile } from '../src/services/workflowInputAssetStore'
import { mcpHttpSettingsService } from '../src/services/mcpHttpSettingsService'
import { createTrustedGraphMedia } from '../src/services/graph-workflow-executor/trustedGraphMedia'
import { withMcpGraphImageAuthority } from '../src/services/graph-workflow-executor/graphImageAuthority'
import { executeApiRequestNode, executeBase64EncodeNode } from '../src/services/graph-workflow-executor/system-api-operations'
import { resolveFinalResultPromotionCandidate } from '../src/services/graph-workflow-executor/final-result-promotion'

test('graph API inputs never read request paths and resolve only authorized references', { timeout: 60000 }, async (t) => {
  initializeAuthDb()
  await initializeDatabase()
  initializeUserSettingsDb()
  const auth = getAuthDb()
  auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('admin', 'unused', 'admin')").run()
  invalidateConfiguredAuthCache()
  const allowed = AuthPermissionGroup.createCustomGroup({ name: 'api images', permissionKeys: ['images.view'] })
  const denied = AuthPermissionGroup.createCustomGroup({ name: 'api no images', permissionKeys: [] })
  const insert = auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES (?, 'unused', 'guest')")
  const allowedId = Number(insert.run('api-allowed').lastInsertRowid)
  const deniedId = Number(insert.run('api-denied').lastInsertRowid)
  const membership = auth.prepare('INSERT INTO auth_account_group_memberships (account_id, group_id) VALUES (?, ?)')
  membership.run(allowedId, allowed.id)
  membership.run(deniedId, denied.id)
  t.after(async () => {
    auth.close()
    closeUserSettingsDb()
    closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
  })

  const secret = path.join(runtimePaths.basePath, 'private-server.png')
  const secretBytes = Buffer.from('server private bytes')
  await fs.promises.writeFile(secret, secretBytes)
  const controller = new AbortController()
  const context = { executionId: 1, workflow: { id: 1 }, requestedByAccountId: allowedId, signal: controller.signal, getAbortReason: () => null } as any
  const deniedContext = { ...context, requestedByAccountId: deniedId }
  const node = { id: 'api' } as any
  const module = { name: 'api' } as any
  let body: unknown
  let fetches = 0
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    fetches += 1
    if (init?.body instanceof FormData) {
      const values: Record<string, string> = {}
      for (const [key, value] of init.body.entries()) {
        values[key] = typeof value === 'string' ? value : `data:${value.type};base64,${Buffer.from(await value.arrayBuffer()).toString('base64')}`
      }
      body = values
    } else {
      body = JSON.parse(String(init?.body))
    }
    throw new Error('fetch reached')
  })
  const runApi = (payload: unknown, caller = context) => executeApiRequestNode(caller, node, module, {
    url: 'http://127.0.0.1:1', method: 'POST', body_mode: 'json', payload,
  })
  for (const key of ['storagePath', 'storage_path', 'outputPath', 'output_path', 'originalFilePath', 'original_file_path', 'imagePath', 'image_path', 'filePath', 'file_path']) {
    await assert.rejects(runApi({ nested: [{ [key]: secret }] }), /경로/, key)
    await assert.rejects(executeBase64EncodeNode(context, node, module, { value: { [key]: secret } }), /경로/, key)
  }
  assert.equal(fetches, 0)
  assert.equal(resolveFinalResultPromotionCandidate({ type: 'json', value: { outputPath: secret, mimeType: 'image/png' } } as any).shouldPromote, false)

  await t.test('a bare string image is data, never a server path', async (sub) => {
    const originalRead = fs.promises.readFile.bind(fs.promises)
    sub.mock.method(fs.promises, 'readFile', async (...args: Parameters<typeof fs.promises.readFile>) => {
      if (String(args[0]) === secret) throw new Error('unexpected private file read')
      return originalRead(...args)
    })
    await assert.rejects(runApi({ image: secret }), /fetch reached/)
    assert.deepEqual(body, { image: secret })
    let upload: Buffer | undefined
    const comfy = { uploadInputImage: async (_name: string, value: Buffer) => { upload = value; return 'input.png' } } as any
    await prepareComfyPromptData(comfy, [{ id: 'image', type: 'image' }], { image: secret })
    assert.ok(Buffer.isBuffer(upload))
    assert.notDeepEqual(upload, secretBytes)
  })

  const bytes = Buffer.from('trusted input bytes')
  const temp = path.join(runtimePaths.basePath, 'asset.tmp')
  await fs.promises.writeFile(temp, bytes)
  const asset = storeWorkflowInputAssetFile(temp, { fileName: 'input.png', mimeType: 'image/png', bytes: bytes.length })
  const queue = storeQueueInputBuffer(bytes, { fileName: 'input.png', mimeType: 'image/png' })
  const graphFile = path.join(runtimePaths.basePath, 'graph-output.png')
  await fs.promises.writeFile(graphFile, bytes)
  const graph = createTrustedGraphMedia(graphFile, 'output.png', 'image/png')
  const hash = 'b'.repeat(48)
  await fs.promises.mkdir(runtimePaths.uploadsDir, { recursive: true })
  const libraryFile = path.join(runtimePaths.uploadsDir, 'library.png')
  await fs.promises.writeFile(libraryFile, bytes)
  const folder = (db.prepare('SELECT id FROM watched_folders ORDER BY id LIMIT 1').get() as { id: number }).id
  db.prepare('INSERT INTO media_metadata (composite_hash) VALUES (?)').run(hash)
  db.prepare("INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_size, mime_type) VALUES (?, ?, ?, ?, 'image/png')").run(hash, libraryFile, folder, bytes.length)
  const expected = `data:image/png;base64,${bytes.toString('base64')}`
  for (const input of [asset, queue, graph, { composite_hash: hash }, expected]) {
    await assert.rejects(runApi({ image: input }), /fetch reached/)
    assert.deepEqual(body, { image: expected })
  }
  await assert.rejects(runApi({ imagePath: expected }), /fetch reached/)
  assert.deepEqual(body, { imagePath: expected })
  const before = fetches
  await assert.rejects(runApi({ image: { composite_hash: hash } }, deniedContext), /images\.view/)
  assert.equal(fetches, before)
  const key = mcpHttpSettingsService.createApiKey('api key', allowed.group_key).keys.find((item) => item.name === 'api key')!
  const keyContext = { ...mcpHttpSettingsService.authenticate(key.apiKey)!, source: 'http' as const }
  const accountless = { ...context, requestedByAccountId: null }
  await assert.rejects(withMcpGraphImageAuthority(keyContext, () => runApi({ image: { composite_hash: hash } }, accountless)), /fetch reached/)
  mcpHttpSettingsService.updateApiKey(key.id, key.name, denied.group_key)
  await assert.rejects(withMcpGraphImageAuthority(keyContext, () => runApi({ image: { composite_hash: hash } }, accountless)), /images\.view/)
  mcpHttpSettingsService.revokeApiKey(key.id)
  await assert.rejects(withMcpGraphImageAuthority(keyContext, () => runApi({ image: { composite_hash: hash } }, accountless)), /authorization/)
})
