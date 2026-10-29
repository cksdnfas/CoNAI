import './support/testTemp'
import './support/scratchRuntime'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { initializeDatabase, closeDatabase } from '../src/database/init'
import { getUserSettingsDb, initializeUserSettingsDb, closeUserSettingsDb } from '../src/database/userSettingsDb'
import { runtimePaths } from '../src/config/runtimePaths'
import { GenerationQueueModel } from '../src/models/GenerationQueue'
import {
  markWorkflowInputAssetForDeletion,
  pruneDeletedWorkflowInputAssets,
  releaseWorkflowInputAssetRefs,
  resolveWorkflowInputAssetFilePath,
  resolveWorkflowInputAssetPath,
  storeWorkflowInputAssetFile,
} from '../src/services/workflowInputAssetStore'

test('marked assets survive retained jobs and live graphs, then collect only after their references end', async (t) => {
  await initializeDatabase()
  initializeUserSettingsDb()
  const db = getUserSettingsDb()
  t.after(async () => {
    closeUserSettingsDb()
    closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
  })
  const makeAsset = async (name: string, marked: boolean) => {
    const temporary = path.join(runtimePaths.basePath, `${name}.tmp`)
    await fs.promises.writeFile(temporary, name)
    const ref = storeWorkflowInputAssetFile(temporary, { fileName: `${name}.png`, bytes: name.length })
    const file = resolveWorkflowInputAssetPath(ref.id)!
    if (marked) {
      assert.equal(markWorkflowInputAssetForDeletion(ref.id), true)
      const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
      await fs.promises.utimes(`${file}.deleted`, old, old)
    } else {
      const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      await fs.promises.utimes(file, old, old)
    }
    return ref
  }
  const legacy = await makeAsset('legacy', true)
  const current = await makeAsset('current', true)
  const orphan = await makeAsset('orphan', true)
  const graphInput = await makeAsset('graph', true)
  const draft = await makeAsset('draft', false)

  // A row created before the reference table existed must be backfilled before collection.
  db.prepare("INSERT INTO generation_queue_jobs (service_type, request_payload) VALUES ('comfyui', ?)").run('{broken json')
  const legacyId = Number(db.prepare("INSERT INTO generation_queue_jobs (service_type, request_payload) VALUES ('comfyui', ?)").run(JSON.stringify({ prompt_data: { deep: { asset: legacy } } })).lastInsertRowid)
  let nested: unknown = current
  for (let i = 0; i < 20; i += 1) nested = { nested }
  const currentId = GenerationQueueModel.create({ service_type: 'comfyui', request_payload: { nested } })
  releaseWorkflowInputAssetRefs([currentId])
  assert.equal(await pruneDeletedWorkflowInputAssets(), 2)
  assert.ok(resolveWorkflowInputAssetFilePath(legacy))
  assert.ok(resolveWorkflowInputAssetFilePath(current))
  assert.equal(resolveWorkflowInputAssetFilePath(orphan), null)
  assert.equal(resolveWorkflowInputAssetFilePath(graphInput), null)
  assert.ok(resolveWorkflowInputAssetFilePath(draft), 'unmarked browser draft assets do not expire')

  const graphRef = await makeAsset('live-graph', true)
  const workflowId = Number(db.prepare("INSERT INTO graph_workflows (name, graph_json) VALUES ('graph', '{}')").run().lastInsertRowid)
  const executionId = Number(db.prepare("INSERT INTO graph_executions (graph_workflow_id, graph_version, status, execution_plan) VALUES (?, 1, 'running', ?)").run(workflowId, JSON.stringify({ runtimeInputValues: { image: graphRef } })).lastInsertRowid)
  db.prepare("UPDATE generation_queue_jobs SET status = 'failed' WHERE id IN (?, ?)").run(legacyId, currentId)
  GenerationQueueModel.pruneTerminalRequestPayloads({ retainRecentTerminalJobs: 0 })
  assert.equal(await pruneDeletedWorkflowInputAssets(), 0)
  assert.ok(resolveWorkflowInputAssetFilePath(legacy))
  assert.ok(resolveWorkflowInputAssetFilePath(current))
  assert.ok(resolveWorkflowInputAssetFilePath(graphRef))

  db.prepare("UPDATE graph_executions SET status = 'completed' WHERE id = ?").run(executionId)
  assert.equal(await pruneDeletedWorkflowInputAssets(), 3)
  assert.equal(resolveWorkflowInputAssetFilePath(legacy), null)
  assert.equal(resolveWorkflowInputAssetFilePath(current), null)
  assert.equal(resolveWorkflowInputAssetFilePath(graphRef), null)
  assert.ok(resolveWorkflowInputAssetFilePath(draft))
  assert.throws(() => GenerationQueueModel.create({ service_type: 'comfyui', request_payload: { image: legacy } }), /다시 첨부/)

  const racing = await makeAsset('racing', true)
  const marker = `${resolveWorkflowInputAssetPath(racing.id)!}.deleted`
  const originalStat = fs.promises.stat.bind(fs.promises)
  let reached!: () => void
  let release!: () => void
  const entered = new Promise<void>((resolve) => { reached = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  t.after(() => release())
  t.mock.method(fs.promises, 'stat', async (...args: Parameters<typeof fs.promises.stat>) => {
    const stat = await originalStat(...args)
    if (String(args[0]) === marker) {
      reached()
      await gate
    }
    return stat
  })
  const collecting = pruneDeletedWorkflowInputAssets()
  await entered
  const racingId = GenerationQueueModel.create({ service_type: 'comfyui', request_payload: { image: racing } })
  release()
  assert.equal(await collecting, 0)
  assert.ok(resolveWorkflowInputAssetFilePath(racing), 'a job claimed during collection retains its asset')
  db.prepare("UPDATE generation_queue_jobs SET status = 'failed' WHERE id = ?").run(racingId)
  GenerationQueueModel.pruneTerminalRequestPayloads({ retainRecentTerminalJobs: 0 })
  assert.equal(await pruneDeletedWorkflowInputAssets(), 1)
})
