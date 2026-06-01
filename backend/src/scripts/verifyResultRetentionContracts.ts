import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

async function main() {
  const tempBasePath = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-result-retention-'))
  process.env.RUNTIME_BASE_PATH = tempBasePath

  let closeUserSettingsDb: (() => void) | null = null
  let closeMainDatabase: (() => void) | null = null

  try {
    const { ensureRuntimeDirectories, runtimePaths } = await import('../config/runtimePaths')
    const mainDatabase = await import('../database/init')
    const userSettings = await import('../database/userSettingsDb')
    const { initializeApiGenerationDb } = await import('../database/apiGenerationDb')
    const { GenerationHistoryModel } = await import('../models/GenerationHistory')
    const { pruneGenerationResultRetention } = await import('../services/generationResultRetentionService')
    const {
      findGraphWorkflowRetentionOverflowArtifactIds,
      pruneGraphWorkflowOutputRetention,
    } = await import('../services/graphWorkflowOutputRetentionService')
    const graphWorkflowExecutorSource = fs.readFileSync(path.resolve(process.cwd(), 'src/services/graphWorkflowExecutor.ts'), 'utf8')
    const graphWorkflowRetentionSource = fs.readFileSync(path.resolve(process.cwd(), 'src/services/graphWorkflowOutputRetentionService.ts'), 'utf8')

    closeUserSettingsDb = userSettings.closeUserSettingsDb
    closeMainDatabase = mainDatabase.closeDatabase
    ensureRuntimeDirectories()
    userSettings.initializeUserSettingsDb()
    initializeApiGenerationDb()

    const db = userSettings.getUserSettingsDb()
    const historyIds: number[] = []
    for (let index = 0; index < 4; index += 1) {
      historyIds.push(GenerationHistoryModel.create({
        service_type: 'codex',
        generation_status: 'completed',
        nai_model: 'codex',
        completed_at: `2026-05-29T00:0${index}:00.000Z`,
      }))
    }
    const pendingHistoryId = GenerationHistoryModel.create({
      service_type: 'codex',
      generation_status: 'pending',
      nai_model: 'codex',
    })

    const historyRetention = pruneGenerationResultRetention(2)
    assert.deepEqual(historyRetention.deleted_history_ids, [historyIds[1], historyIds[0]])
    assert.equal(GenerationHistoryModel.findById(historyIds[0]), null)
    assert.equal(GenerationHistoryModel.findById(historyIds[1]), null)
    assert.notEqual(GenerationHistoryModel.findById(historyIds[2]), null)
    assert.notEqual(GenerationHistoryModel.findById(historyIds[3]), null)
    assert.notEqual(GenerationHistoryModel.findById(pendingHistoryId), null)

    const workflowId = (db.prepare(`
      INSERT INTO graph_workflows (name, graph_json, version, is_active)
      VALUES (?, ?, 1, 1)
    `).run('retention-smoke', JSON.stringify({ nodes: [], edges: [] })).lastInsertRowid) as number
    const outputArtifactIds: number[] = []
    const textArtifactIds: number[] = []
    const outputPaths: string[] = []
    const graphTempRoot = path.join(runtimePaths.tempDir, 'graph-executions')

    for (let index = 0; index < 4; index += 1) {
      const executionId = (db.prepare(`
        INSERT INTO graph_executions (
          graph_workflow_id, graph_version, status, started_at, completed_at, created_date, updated_date
        ) VALUES (?, 1, 'completed', ?, ?, ?, ?)
      `).run(
        workflowId,
        `2026-05-29T00:0${index}:00.000Z`,
        `2026-05-29T00:0${index}:10.000Z`,
        `2026-05-29T00:0${index}:00.000Z`,
        `2026-05-29T00:0${index}:10.000Z`,
      ).lastInsertRowid) as number

      const executionDir = path.join(graphTempRoot, String(executionId))
      fs.mkdirSync(executionDir, { recursive: true })
      const outputPath = path.join(executionDir, `output-${index}.png`)
      fs.writeFileSync(outputPath, Buffer.from(`image-${index}`))
      outputPaths.push(outputPath)

      const outputArtifactId = (db.prepare(`
        INSERT INTO graph_execution_artifacts (
          execution_id, node_id, port_key, artifact_type, storage_path, metadata, created_date
        ) VALUES (?, ?, 'image', 'image', ?, ?, ?)
      `).run(
        executionId,
        `image-node-${index}`,
        outputPath,
        JSON.stringify({ mimeType: 'image/png' }),
        `2026-05-29T00:0${index}:11.000Z`,
      ).lastInsertRowid) as number
      outputArtifactIds.push(outputArtifactId)

      const textArtifactId = (db.prepare(`
        INSERT INTO graph_execution_artifacts (
          execution_id, node_id, port_key, artifact_type, metadata, created_date
        ) VALUES (?, ?, 'text', 'text', ?, ?)
      `).run(
        executionId,
        `text-node-${index}`,
        JSON.stringify({ value: `text-${index}` }),
        `2026-05-29T00:0${index}:12.000Z`,
      ).lastInsertRowid) as number
      textArtifactIds.push(textArtifactId)

      db.prepare(`
        INSERT INTO graph_execution_final_results (
          execution_id, final_node_id, source_artifact_id, source_node_id, source_port_key, artifact_type, created_date
        ) VALUES (?, ?, ?, ?, 'image', 'image', ?)
      `).run(
        executionId,
        `final-${index}`,
        outputArtifactId,
        `image-node-${index}`,
        `2026-05-29T00:0${index}:13.000Z`,
      )
    }

    const overflow = findGraphWorkflowRetentionOverflowArtifactIds(workflowId, 2)
    assert.deepEqual(overflow.generated_output_artifact_ids, [outputArtifactIds[1], outputArtifactIds[0]])
    assert.deepEqual(overflow.technical_artifact_ids, [textArtifactIds[1], textArtifactIds[0]])

    const graphRetention = await pruneGraphWorkflowOutputRetention(workflowId, 2)
    assert.equal(graphRetention.deleted_count, 4)
    assert.equal(graphRetention.deleted_file_count, 2)
    assert.equal(fs.existsSync(outputPaths[0]), false)
    assert.equal(fs.existsSync(outputPaths[1]), false)
    assert.equal(fs.existsSync(outputPaths[2]), true)
    assert.equal(fs.existsSync(outputPaths[3]), true)

    const remainingArtifacts = db.prepare('SELECT id FROM graph_execution_artifacts ORDER BY id ASC').all() as Array<{ id: number }>
    assert.deepEqual(remainingArtifacts.map((row) => row.id), [
      outputArtifactIds[2],
      textArtifactIds[2],
      outputArtifactIds[3],
      textArtifactIds[3],
    ])
    const remainingFinalResults = db.prepare('SELECT source_artifact_id FROM graph_execution_final_results ORDER BY source_artifact_id ASC').all() as Array<{ source_artifact_id: number }>
    assert.deepEqual(remainingFinalResults.map((row) => row.source_artifact_id), [outputArtifactIds[2], outputArtifactIds[3]])

    const bulkWorkflowId = (db.prepare(`
      INSERT INTO graph_workflows (name, graph_json, version, is_active)
      VALUES (?, ?, 1, 1)
    `).run('retention-bulk-smoke', JSON.stringify({ nodes: [], edges: [] })).lastInsertRowid) as number
    for (let index = 0; index < 1105; index += 1) {
      const executionId = (db.prepare(`
        INSERT INTO graph_executions (
          graph_workflow_id, graph_version, status, started_at, completed_at, created_date, updated_date
        ) VALUES (?, 1, 'completed', ?, ?, ?, ?)
      `).run(
        bulkWorkflowId,
        `2026-05-30T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
        `2026-05-30T00:${String(index % 60).padStart(2, '0')}:10.000Z`,
        `2026-05-30T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
        `2026-05-30T00:${String(index % 60).padStart(2, '0')}:10.000Z`,
      ).lastInsertRowid) as number

      db.prepare(`
        INSERT INTO graph_execution_artifacts (
          execution_id, node_id, port_key, artifact_type, metadata, created_date
        ) VALUES (?, ?, 'text', 'text', ?, ?)
      `).run(
        executionId,
        `bulk-text-${index}`,
        JSON.stringify({ value: `bulk-${index}` }),
        `2026-05-30T00:${String(index % 60).padStart(2, '0')}:12.000Z`,
      )
    }

    const bulkRetention = await pruneGraphWorkflowOutputRetention(bulkWorkflowId, 2)
    assert.equal(bulkRetention.deleted_count, 1103)
    const bulkRemaining = db.prepare(`
      SELECT COUNT(*) as total
      FROM graph_execution_artifacts ga
      INNER JOIN graph_executions ge ON ge.id = ga.execution_id
      WHERE ge.graph_workflow_id = ?
    `).get(bulkWorkflowId) as { total: number }
    assert.equal(bulkRemaining.total, 2)
    assert.match(
      graphWorkflowExecutorSource,
      /requestGraphWorkflowOutputRetentionPrune\(workflow\.id\)/,
      'graph workflow completion should schedule retention cleanup instead of awaiting workflow-wide pruning inline',
    )
    assert.match(
      graphWorkflowRetentionSource,
      /findByWorkflowIdPage\(workflowId, RETENTION_SCAN_PAGE_SIZE/,
      'graph workflow retention should scan workflow rows in pages instead of hydrating the full workflow',
    )
    assert.doesNotMatch(
      graphWorkflowRetentionSource,
      /GraphExecutionArtifactModel\.findByWorkflowIds\(\[workflowId\]\)/,
      'graph workflow retention must not load all workflow artifacts at once',
    )

    console.log('✅ Result retention contracts verified (generation history, graph outputs, text artifacts)')
  } finally {
    try {
      closeUserSettingsDb?.()
      closeMainDatabase?.()
    } catch {
      // Ignore cleanup errors from partially initialized runs.
    }

    // Windows can keep sqlite handles alive briefly under tsx; leave OS-temp cleanup to the platform.
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
