import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { WorkflowRecord } from '../src/types/workflow'

test('paged directory snapshots preserve boundaries, names, paths and scope across writes', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-listing-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  const save = process.env.RUNTIME_SAVE_DIR
  const artifacts = path.join(root, 'artifacts-fixture')
  fs.mkdirSync(path.join(save, 'nested'), { recursive: true })
  fs.mkdirSync(artifacts, { recursive: true })
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  for (const [directory, names] of [[save, ['a.png', 'b.png', 'c.png']], [path.join(save, 'nested'), ['a.png']], [artifacts, ['a.png', 'b.png', 'c.png']]] as const) {
    for (const name of names) {
      const file = path.join(directory, name)
      fs.writeFileSync(file, name)
      fs.utimesSync(file, new Date('2020-01-01'), new Date('2020-01-01'))
    }
  }

  const { parseDirectoryPageRequest } = await import('../src/services/directoryListingSnapshot')
  const { listSaveBrowserImagePage, listSaveBrowserImages } = await import('../src/routes/imageEditorRouteHelpers')
  const { listWorkflowArtifacts, moveFileIntoWorkflowArtifacts } = await import('../src/services/workflowArtifactService')
  const page = (query: Record<string, string>) => parseDirectoryPageRequest(query)!
  const first = await listSaveBrowserImagePage(page({ limit: '2' }))
  const second = await listSaveBrowserImagePage(page({ limit: '2', cursor: first.nextCursor! }))
  const all = await listSaveBrowserImages()
  assert.equal(first.total, 4)
  assert.deepEqual([...first.items, ...second.items].map((item) => item.relative_path), all.map((item) => item.relative_path))
  assert.equal(new Set(all.map((item) => item.relative_path)).size, 4)
  assert.deepEqual((await listSaveBrowserImagePage(page({ limit: '2', search: 'A.PNG' }))).items.map((item) => item.file_name), ['a.png', 'a.png'])
  fs.writeFileSync(path.join(save, 'nested', 'new.png'), 'new')
  assert.ok((await listSaveBrowserImages()).some((item) => item.relative_path === 'nested/new.png'))
  const freshSave = await listSaveBrowserImagePage(page({ limit: '2', refresh: '1' }))
  assert.equal(freshSave.items[0].relative_path, 'nested/new.png')
  const oldSaveSearch = await listSaveBrowserImagePage(page({ limit: '2', search: 'new', snapshot: first.snapshot }))
  assert.equal(oldSaveSearch.snapshot, freshSave.snapshot)
  assert.deepEqual(oldSaveSearch.items.map((item) => item.relative_path), ['nested/new.png'])
  const oldSaveContinuation = await listSaveBrowserImagePage(page({ limit: '2', cursor: first.nextCursor! }))
  assert.deepEqual(oldSaveContinuation.items.map((item) => item.relative_path), second.items.map((item) => item.relative_path))

  const workflow = { id: 1, name: 'fixture', artifact_root_path: artifacts, artifact_directory_mode: 'shared' } as WorkflowRecord
  const privateScope = { kind: 'workflow', workflowId: 1 } as const
  const publicScope = { kind: 'public', publicSlug: 'visible' } as const
  const before = await listWorkflowArtifacts(workflow, '', privateScope, page({ limit: '2' }))
  const source = path.join(root, 'new.png')
  fs.writeFileSync(source, 'new')
  await moveFileIntoWorkflowArtifacts({ workflow, sourcePath: source, originalFileName: 'new.png', promptId: 'run' })
  const afterWriteSearch = await listWorkflowArtifacts(workflow, '', privateScope, page({ limit: '2', search: 'new', snapshot: before.snapshot! }))
  assert.deepEqual(afterWriteSearch.entries.map((entry) => entry.name), ['new.png'])
  assert.notEqual(afterWriteSearch.snapshot, before.snapshot)
  const clearedSearch = await listWorkflowArtifacts(workflow, '', privateScope, page({ limit: '2', snapshot: before.snapshot! }))
  assert.equal(clearedSearch.entries[0].name, 'new.png')
  assert.equal(clearedSearch.snapshot, afterWriteSearch.snapshot)
  const continuation = await listWorkflowArtifacts(workflow, '', publicScope, page({ limit: '2', cursor: before.nextCursor!, snapshot: afterWriteSearch.snapshot! }))
  assert.deepEqual([...before.entries, ...continuation.entries].map((entry) => entry.name), ['a.png', 'b.png', 'c.png'])
  assert.ok(continuation.entries[0].fileUrl?.startsWith('/api/public-workflows/visible/artifacts/file?'))
  const fresh = await listWorkflowArtifacts(workflow, '', privateScope, page({ limit: '2' }))
  assert.equal(fresh.entries[0].name, 'new.png')
  assert.equal((await listWorkflowArtifacts(workflow)).entries[0].name, 'new.png')
  fs.writeFileSync(path.join(artifacts, 'external.png'), 'external')
  assert.ok((await listWorkflowArtifacts(workflow)).entries.some((entry) => entry.name === 'external.png'))
  assert.ok(fresh.entries[0].fileUrl?.startsWith('/api/workflows/1/artifacts/file?'))
  assert.deepEqual((await listWorkflowArtifacts(workflow, '', privateScope, page({ limit: '2', search: 'B.PNG' }))).entries.map((entry) => entry.name), ['b.png'])
  await assert.rejects(() => listWorkflowArtifacts(workflow, '../outside', publicScope, page({ limit: '2' })), /escapes workflow root/)
  assert.throws(() => parseDirectoryPageRequest({ limit: '2', cursor: 'invalid' }), /Invalid listing cursor/)
  assert.throws(() => parseDirectoryPageRequest({ snapshot: [] }), /Invalid listing snapshot/)

  await t.test('an app write during a listing scan makes the next fresh listing wait for a new scan', async () => {
    const directory = path.join(root, 'concurrent')
    fs.mkdirSync(directory)
    fs.writeFileSync(path.join(directory, 'old.png'), 'old')
    const concurrentWorkflow = { ...workflow, id: 2, artifact_root_path: directory }
    const sourcePath = path.join(root, 'fresh.png')
    fs.writeFileSync(sourcePath, 'fresh')
    let release!: () => void
    let signalStarted!: () => void
    let signalRelist!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { signalStarted = resolve })
    const relistStarted = new Promise<void>((resolve) => { signalRelist = resolve })
    const originalReaddir = fs.promises.readdir
    const originalStat = fs.promises.stat
    let delayed = false
    fs.promises.readdir = (async (target: fs.PathLike, options?: Parameters<typeof originalReaddir>[1]) => {
      const result = await originalReaddir(target, options)
      if (!delayed && path.resolve(String(target)) === directory) {
        delayed = true
        signalStarted()
        await blocked
      }
      return result
    }) as typeof fs.promises.readdir
    fs.promises.stat = (async (target: fs.PathLike, options?: Parameters<typeof originalStat>[1]) => {
      const result = await originalStat(target, options)
      if (delayed && path.resolve(String(target)) === directory) signalRelist()
      return result
    }) as typeof fs.promises.stat
    try {
      const oldListing = listWorkflowArtifacts(concurrentWorkflow, '', undefined, page({ limit: '2' }))
      await started
      await moveFileIntoWorkflowArtifacts({ workflow: concurrentWorkflow, sourcePath, promptId: 'run' })
      const newListing = listWorkflowArtifacts(concurrentWorkflow, '', undefined, page({ limit: '2' }))
      await relistStarted
      await new Promise<void>((resolve) => setImmediate(resolve))
      release()
      const [old, fresh] = await Promise.all([oldListing, newListing])
      assert.deepEqual(old.entries.map((entry) => entry.name), ['old.png'])
      assert.equal(fresh.total, 2)
      assert.equal(fresh.entries[0].name, 'fresh.png')
      const search = await listWorkflowArtifacts(concurrentWorkflow, '', undefined, page({ limit: '2', search: 'fresh', snapshot: old.snapshot! }))
      assert.equal(search.snapshot, fresh.snapshot)
      assert.equal(search.entries[0].name, 'fresh.png')
    } finally {
      release()
      fs.promises.readdir = originalReaddir
      fs.promises.stat = originalStat
    }
  })

  await t.test('refresh does not inherit an invalidated scan failure', async () => {
    const { DirectoryListingSnapshots } = await import('../src/services/directoryListingSnapshot')
    const snapshots = new DirectoryListingSnapshots<string>()
    let rejectScan!: (error: Error) => void
    const failedScan = snapshots.read('failure', () => new Promise<string[]>((_resolve, reject) => { rejectScan = reject })).catch((error: Error) => error)
    const refreshed = snapshots.read('failure', async () => ['new'], page({ limit: '2', refresh: '1' }))
    rejectScan(new Error('old scan failed'))
    assert.match((await failedScan as Error).message, /old scan failed/)
    assert.deepEqual((await refreshed).items, ['new'])
  })

  await t.test('search snapshots survive the fresh-list TTL and expire after inactivity', async (sub) => {
    const { DirectoryListingSnapshots } = await import('../src/services/directoryListingSnapshot')
    let now = 10_000
    Object.defineProperty(performance, 'now', { configurable: true, value: () => now })
    sub.mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const snapshots = new DirectoryListingSnapshots<string>()
      let scans = 0
      const load = async () => { scans += 1; return ['original'] }
      const first = await snapshots.read('directory', load, page({ limit: '2' }))
      now += 6_000
      sub.mock.timers.tick(6_000)
      const search = await snapshots.read('directory', load, page({ limit: '2', search: 'orig', snapshot: first.id }))
      assert.equal(search.id, first.id)
      assert.equal(scans, 1)
      await snapshots.read('directory', load, page({ limit: '2' }))
      assert.equal(scans, 2, 'the latest-list TTL elapsed independently')
      now += 299_000
      sub.mock.timers.tick(299_000)
      assert.equal((await snapshots.read('directory', load, page({ snapshot: first.id }))).id, first.id)
      now += 2_000
      sub.mock.timers.tick(2_000)
      assert.equal((await snapshots.read('directory', load, page({ snapshot: first.id }))).id, first.id)
      now += 300_001
      sub.mock.timers.tick(300_001)
      assert.notEqual((await snapshots.read('directory', load, page({ snapshot: first.id }))).id, first.id)
    } finally {
      sub.mock.timers.reset()
      Reflect.deleteProperty(performance, 'now')
    }
  })
})
