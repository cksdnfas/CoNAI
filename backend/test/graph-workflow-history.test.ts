import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/**
 * Graph-workflow final results live in their own history columns: they no longer reuse `workflow_id` (a ComfyUI
 * workflow id), so the ComfyUI tab stops showing them and the workflows tab can list them per graph workflow.
 */
test('graph workflow history: own columns, legacy rows moved, separate from ComfyUI workflow history', { timeout: 120000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-graph-history-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
  process.env.FRONTEND_DIST_PATH = path.join(root, 'no-frontend')

  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  t.after(async () => {
    authModule.getAuthDb().close()
    user.closeUserSettingsDb()
    main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  const db = user.getUserSettingsDb()
  const { ensureGraphWorkflowHistoryColumns } = await import('../src/database/userSettingsBootstrap')
  const { HistoryCommandService } = await import('../src/services/historyCommandService')
  const { GenerationHistoryService } = await import('../src/services/generationHistoryService')
  const { HistoryQueryRepository } = await import('../src/repositories/history/HistoryQueryRepository')

  // An older user.db: no graph columns, graph results stored with workflow_id = graph id.
  db.exec('DROP INDEX IF EXISTS idx_api_gen_graph_workflow_id')
  db.exec('ALTER TABLE api_generation_history DROP COLUMN graph_workflow_id')
  db.exec('ALTER TABLE api_generation_history DROP COLUMN graph_execution_id')
  const insertLegacy = db.prepare(`
    INSERT INTO api_generation_history (service_type, generation_status, workflow_id, workflow_name, metadata)
    VALUES (?, 'completed', ?, ?, ?)
  `)
  const legacyGraphRowId = Number(insertLegacy.run('comfyui', 7, 'Graph seven', JSON.stringify({ graph_workflow_id: 7, graph_execution_id: 31, graph_final_node_id: 'final' })).lastInsertRowid)
  const comfyRowId = Number(insertLegacy.run('comfyui', 7, 'Comfy seven', JSON.stringify({ prompt_id: 'abc' })).lastInsertRowid)
  const brokenMetadataRowId = Number(insertLegacy.run('novelai', 9, 'Broken', '{"graph_workflow_id": ').lastInsertRowid)

  ensureGraphWorkflowHistoryColumns(db)
  ensureGraphWorkflowHistoryColumns(db) // idempotent

  const read = (id: number) => db.prepare('SELECT workflow_id, graph_workflow_id, graph_execution_id FROM api_generation_history WHERE id = ?').get(id) as { workflow_id: number | null; graph_workflow_id: number | null; graph_execution_id: number | null }
  assert.deepEqual(read(legacyGraphRowId), { workflow_id: null, graph_workflow_id: 7, graph_execution_id: 31 })
  assert.deepEqual(read(comfyRowId), { workflow_id: 7, graph_workflow_id: null, graph_execution_id: null })
  assert.deepEqual(read(brokenMetadataRowId), { workflow_id: 9, graph_workflow_id: null, graph_execution_id: null })

  // New graph results are written with the graph columns only.
  const newGraphRowId = HistoryCommandService.create({
    service_type: 'novelai',
    generation_status: 'completed',
    graph_workflow_id: 7,
    graph_execution_id: 32,
    workflow_name: 'Graph seven',
  })
  assert.deepEqual(read(newGraphRowId), { workflow_id: null, graph_workflow_id: 7, graph_execution_id: 32 })
  HistoryQueryRepository.invalidateListCountCache()

  const comfyHistory = await GenerationHistoryService.getHistoryByWorkflow(7, {})
  assert.deepEqual(comfyHistory.records.map((record) => record.id), [comfyRowId])
  assert.equal(comfyHistory.total, 1)

  const graphHistory = await GenerationHistoryService.getHistoryByGraphWorkflow(7, {})
  assert.deepEqual(graphHistory.records.map((record) => record.id).sort((a, b) => Number(a) - Number(b)), [legacyGraphRowId, newGraphRowId])
  assert.equal(graphHistory.total, 2)
  assert.ok(graphHistory.records.every((record) => record.graph_workflow_id === 7))

  const otherGraph = await GenerationHistoryService.getHistoryByGraphWorkflow(8, {})
  assert.equal(otherGraph.total, 0)
})
