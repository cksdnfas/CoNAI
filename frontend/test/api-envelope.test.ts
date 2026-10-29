import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApiFallbackError } from '../src/i18n/api-error-fallbacks'
import { deleteBackupSource, getBackupSources } from '../src/lib/api-backup-sources'
import { testCustomNode } from '../src/lib/api-custom-nodes'
import { deleteWatchedFolder, getWatchedFolders } from '../src/lib/api-folders'
import { uploadStoredFiles } from '../src/lib/api-files'
import { getPromptPresets } from '../src/lib/api-prompt-presets'
import { ApiRequestError, requestApiData } from '../src/lib/api-request'
import { getSearchHistory } from '../src/lib/api-search'
import { updateMetadataSettings } from '../src/lib/api-settings'
import { updateAiRuntimeSettings, updateEmbeddingSettings } from '../src/lib/api-settings-ai'
import { updateAppearanceSettings } from '../src/lib/api-settings-appearance'
import { updateGeneralSettings } from '../src/lib/api-settings-general'
import { updateKaloscopeSettings } from '../src/lib/api-settings-kaloscope'
import { updateLlmSettings } from '../src/lib/api-settings-llm'
import { updateMcpHttpEnabled } from '../src/lib/api-settings-mcp'
import { updateTaggerSettings } from '../src/lib/api-settings-tagger'
import { getWildcards } from '../src/lib/api-wildcards'

const clients = [
  { list: getWatchedFolders, remove: () => deleteWatchedFolder(7, true), failureKey: 'folders.delete' },
  { list: getBackupSources, remove: () => deleteBackupSource(11), failureKey: 'backupSources.delete' },
] as const

test('folder and backup requests preserve data, session credentials and deletion targets', async t => {
  const calls: Array<{ url: string; method: string | undefined; credentials: RequestCredentials | undefined }> = []
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method, credentials: init?.credentials })
    return Response.json({ success: true, data: init?.method === 'DELETE' ? { message: 'deleted' } : [{ id: 7 }] })
  })
  for (const client of clients) {
    assert.deepEqual(await client.list(), [{ id: 7 }])
    assert.deepEqual(await client.remove(), { message: 'deleted' })
  }
  assert.deepEqual(calls, [
    { url: '/api/folders?', method: undefined, credentials: 'include' },
    { url: '/api/folders/7?delete_files=true', method: 'DELETE', credentials: 'include' },
    { url: '/api/backup-sources?', method: undefined, credentials: 'include' },
    { url: '/api/backup-sources/11', method: 'DELETE', credentials: 'include' },
  ])
})

test('HTTP success with a failed API operation rejects with its server message or localized fallback', async t => {
  let error: string | undefined = 'The server refused the operation'
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: false, error }))
  for (const client of clients) {
    await assert.rejects(client.remove(), value =>
      value instanceof ApiFallbackError
      && value.backendMessage === error
      && value.fallbackKey === client.failureKey)
  }
  error = undefined
  for (const client of clients) {
    await assert.rejects(client.remove(), value =>
      value instanceof ApiFallbackError
      && value.backendMessage === null
      && value.fallbackKey === client.failureKey)
  }
})

test('HTTP failures retain the status and machine-readable code instead of becoming an envelope fallback', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Resource changed', code: 'conflict' }, { status: 409 }))
  for (const client of clients) {
    await assert.rejects(client.remove(), { status: 409, code: 'conflict', message: 'Resource changed' })
  }
})

test('revision conflict data and request abort signals survive localized envelope handling', async t => {
  const controller = new AbortController()
  const current = { revision: 'remote-v2', value: 'remote edit' }
  t.mock.method(globalThis, 'fetch', async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.equal(init?.signal, controller.signal)
    return Response.json({ error: 'Resource changed', code: 'revision_conflict', data: current }, { status: 409 })
  })
  await assert.rejects(
    requestApiData('/api/settings/metadata', 'settings.metadata.update', { signal: controller.signal }, { timeoutMs: 0 }),
    (error) => error instanceof ApiRequestError
      && error.status === 409
      && error.code === 'revision_conflict'
      && error.message === 'Resource changed'
      && assert.deepEqual(error.data, current) === undefined,
  )
})

test('required-data clients preserve empty lists but reject missing or malformed data with the server error', async t => {
  let data: unknown = []
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, data, error: 'Missing data' }))
  const requiredClients = [
    { list: () => getPromptPresets(), failureKey: 'promptPresets.list.load' },
    { list: () => getWildcards(), failureKey: 'wildcards.list.load' },
    { list: getSearchHistory, failureKey: 'search.history.load' },
  ]
  for (const client of requiredClients) {
    assert.deepEqual(await client.list(), [])
  }
  for (data of [undefined, null, false, 0, '']) {
    for (const client of requiredClients) {
      await assert.rejects(client.list(), value =>
        value instanceof ApiFallbackError
        && value.backendMessage === 'Missing data'
        && value.fallbackKey === client.failureKey)
    }
  }
})

test('custom node execution preserves its encoded key, inputs, result and backend failure', async t => {
  const result = { key: 'custom/node', name: 'Custom node', entry: 'main.js', folderPath: null, outputs: { answer: 42 }, metadata: null, logs: [] }
  let success = true
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.equal(String(input), '/api/custom-nodes/custom%2Fnode/test')
    assert.equal(init?.method, 'POST')
    assert.equal(init?.credentials, 'include')
    assert.deepEqual(JSON.parse(String(init?.body)), { inputs: { value: 7 } })
    return Response.json({ success, data: result, error: 'Node execution failed' })
  })
  assert.deepEqual(await testCustomNode('custom/node', { value: 7 }), result)
  success = false
  await assert.rejects(testCustomNode('custom/node', { value: 7 }), value =>
    value instanceof ApiFallbackError
    && value.backendMessage === 'Node execution failed'
    && value.fallbackKey === 'customNodes.test.run')
})

test('stored-file uploads keep the count, per-file, request-size and restricted-type boundaries', async t => {
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => {
    requests += 1
    return Response.json({ success: true, data: [] })
  })
  const file = (size: number, name = 'document.txt') => Object.defineProperty(new File(['x'], name), 'size', { value: size })
  const maxFileBytes = 500 * 1024 * 1024
  const remainingBytes = 1024 ** 3 - 2 * maxFileBytes
  await uploadStoredFiles(null, [file(maxFileBytes), file(maxFileBytes), file(remainingBytes)])
  await uploadStoredFiles(null, Array.from({ length: 20 }, () => file(1)))
  await assert.rejects(uploadStoredFiles(null, []), /Upload 1–20 files/)
  await assert.rejects(uploadStoredFiles(null, Array.from({ length: 21 }, () => file(1))), /Upload 1–20 files/)
  await assert.rejects(uploadStoredFiles(null, [file(maxFileBytes + 1)]), /Limit: 500 MB per file, 1 GB total/)
  await assert.rejects(uploadStoredFiles(null, [file(maxFileBytes), file(maxFileBytes), file(remainingBytes + 1)]), /Limit: 500 MB per file, 1 GB total/)
  await assert.rejects(uploadStoredFiles(null, [file(1, 'program.exe')], { allowAnyType: false }), /Restricted file type: program.exe/)
  assert.equal(requests, 2, 'invalid uploads never send their bytes')
})

test('settings saves preserve revision headers, request bodies and both envelope and HTTP conflicts', async t => {
  const cases = [
    { call: (revision?: string) => updateMetadataSettings({}, revision), path: 'metadata', key: 'settings.metadata.update', body: {}, revisioned: true },
    { call: (revision?: string) => updateEmbeddingSettings({}, revision), path: 'embedding', key: 'settings.embedding.update', body: {}, revisioned: true },
    { call: (revision?: string) => updateAiRuntimeSettings({}, revision), path: 'ai-runtime', key: 'settings.aiRuntime.update', body: {}, revisioned: true },
    { call: (revision?: string) => updateAppearanceSettings({}, revision), path: 'appearance', key: 'settings.appearance.update', body: {}, revisioned: true },
    { call: (revision?: string) => updateGeneralSettings({ language: 'en' }, revision), path: 'general', key: 'settings.general.update', body: { language: 'en' }, revisioned: true },
    { call: (revision?: string) => updateKaloscopeSettings({}, revision), path: 'kaloscope', key: 'settings.kaloscope.update', body: {}, revisioned: true },
    { call: (revision?: string) => updateLlmSettings({}, revision), path: 'llm', key: 'settings.llm.update', body: {}, revisioned: true },
    { call: () => updateMcpHttpEnabled(true), path: 'mcp-http', key: 'settings.mcp.update', body: { enabled: true }, revisioned: false },
    { call: (revision?: string) => updateTaggerSettings({}, revision), path: 'tagger', key: 'settings.tagger.update', body: {}, revisioned: true },
  ]
  let current = cases[0]
  let revision: string | undefined = 'settings-v1'
  let success = true
  let status = 200
  const saved = { snapshot: 'saved settings' }
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.equal(String(input), `/api/settings/${current.path}`)
    assert.equal(init?.method, 'PUT')
    assert.equal(init?.credentials, 'include')
    assert.equal(new Headers(init?.headers).get('If-Match'), current.revisioned ? revision ?? null : null)
    assert.deepEqual(JSON.parse(String(init?.body)), current.body)
    return Response.json({ success, data: saved, error: 'Settings changed', code: 'conflict' }, { status })
  })
  for (current of cases) assert.deepEqual(await current.call(revision), saved)
  revision = undefined
  for (current of cases) assert.deepEqual(await current.call(), saved)
  success = false
  for (current of cases) {
    await assert.rejects(current.call(), value =>
      value instanceof ApiFallbackError
      && value.backendMessage === 'Settings changed'
      && value.fallbackKey === current.key)
  }
  status = 409
  for (current of cases) await assert.rejects(current.call(), { status: 409, code: 'conflict', message: 'Settings changed' })
})
