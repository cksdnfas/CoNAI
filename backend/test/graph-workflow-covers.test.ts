import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/** A workflow's face is its newest image result that reached the library; results without a library image are skipped. */
test('graph workflow covers: newest library image per workflow, refreshed when a result lands', { timeout: 120000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-graph-covers-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
  process.env.FRONTEND_DIST_PATH = path.join(root, 'no-frontend')

  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  t.after(async () => {
    user.closeUserSettingsDb()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  const db = user.getUserSettingsDb()
  const { GraphExecutionFinalResultModel } = await import('../src/models/GraphExecutionFinalResult')
  const workflow = (name: string) => Number(db.prepare("INSERT INTO graph_workflows (name, graph_json) VALUES (?, '{}')").run(name).lastInsertRowid)
  const result = (workflowId: number, type: string, metadata: unknown) => {
    const executionId = Number(db.prepare("INSERT INTO graph_executions (graph_workflow_id, graph_version, status) VALUES (?, 1, 'completed')").run(workflowId).lastInsertRowid)
    const artifactId = Number(db.prepare("INSERT INTO graph_execution_artifacts (execution_id, node_id, port_key, artifact_type, metadata) VALUES (?, 'n1', 'image', ?, ?)")
      .run(executionId, type, metadata === null ? null : JSON.stringify(metadata)).lastInsertRowid)
    db.prepare("INSERT INTO graph_execution_final_results (execution_id, final_node_id, source_artifact_id, source_node_id, source_port_key, artifact_type) VALUES (?, 'final', ?, 'n1', 'image', ?)")
      .run(executionId, artifactId, type)
  }

  const sheet = workflow('sheet')
  const upscale = workflow('upscale')
  const textOnly = workflow('text only')
  result(sheet, 'image', { actualCompositeHash: 'old-sheet' })
  result(sheet, 'image', { compositeHash: 'new-sheet' })
  result(upscale, 'image', { actual_composite_hash: 'upscaled' })
  // The newest upscale result never reached the library: the one before it stays the face.
  result(upscale, 'image', { storagePath: '/temp/graph-executions/1/out.png' })
  result(textOnly, 'text', { compositeHash: 'not-an-image' })

  assert.deepEqual(GraphExecutionFinalResultModel.findLatestImageCovers(), { [sheet]: 'new-sheet', [upscale]: 'upscaled' })

  result(textOnly, 'image', { compositeHash: 'first-image' })
  assert.deepEqual(GraphExecutionFinalResultModel.findLatestImageCovers(), { [sheet]: 'new-sheet', [upscale]: 'upscaled', [textOnly]: 'first-image' })
})
