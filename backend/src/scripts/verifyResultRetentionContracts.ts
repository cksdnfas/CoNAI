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
    const {
      pruneGenerationResultRetention,
      pruneGenerationResultRetentionBatch,
    } = await import('../services/generationResultRetentionService')
    const { MediaMetadataFileQueries } = await import('../models/Image/MediaMetadataFileQueries')
    const {
      findGraphWorkflowRetentionOverflowArtifactIds,
      pruneGraphWorkflowOutputRetention,
    } = await import('../services/graphWorkflowOutputRetentionService')
    const graphWorkflowExecutorSource = fs.readFileSync(path.resolve(process.cwd(), 'src/services/graphWorkflowExecutor.ts'), 'utf8')
    const graphWorkflowRetentionScannerSource = fs.readFileSync(path.resolve(process.cwd(), 'src/services/graphWorkflowRetentionScanner.ts'), 'utf8')
    const generationHistoryModelSource = fs.readFileSync(path.resolve(process.cwd(), 'src/models/GenerationHistory.ts'), 'utf8')
    const generationHistoryRetentionSource = fs.readFileSync(path.resolve(process.cwd(), 'src/services/generationResultRetentionService.ts'), 'utf8')

    closeUserSettingsDb = userSettings.closeUserSettingsDb
    closeMainDatabase = mainDatabase.closeDatabase
    ensureRuntimeDirectories()
    await mainDatabase.initializeDatabase()
    userSettings.initializeUserSettingsDb()
    initializeApiGenerationDb()

    const db = userSettings.getUserSettingsDb()
    const mediaDb = mainDatabase.db
    const retainedMediaHash = 'retention-media-hash'
    const retainedMediaPath = path.join(runtimePaths.uploadsDir, 'retention-test', 'retention-media.mp4')
    fs.mkdirSync(path.dirname(retainedMediaPath), { recursive: true })
    fs.writeFileSync(retainedMediaPath, Buffer.from('retained-video'))
    mediaDb.prepare("UPDATE rating_tiers SET feed_visibility = 'hide' WHERE tier_name = 'NSFW'").run()
    const watchedFolderId = Number(mediaDb.prepare(`
      INSERT INTO watched_folders (folder_path, folder_name, is_active)
      VALUES (?, 'retention-test', 1)
    `).run(path.dirname(retainedMediaPath)).lastInsertRowid)
    mediaDb.prepare(`
      INSERT INTO media_metadata (
        composite_hash, width, height, rating_score, postprocess_status, postprocess_completed_at
      ) VALUES (?, 16, 16, 99, 'ready', CURRENT_TIMESTAMP)
    `).run(retainedMediaHash)
    mediaDb.prepare(`
      INSERT INTO image_files (
        composite_hash, file_type, original_file_path, folder_id, file_status, file_size, mime_type
      ) VALUES (?, 'video', ?, ?, 'active', ?, 'video/mp4')
    `).run(retainedMediaHash, retainedMediaPath, watchedFolderId, fs.statSync(retainedMediaPath).size)

    assert.equal(
      MediaMetadataFileQueries.findByHashWithFile(retainedMediaHash),
      null,
      'ordinary gallery detail queries must keep hidden-rated media blocked',
    )
    assert.equal(
      MediaMetadataFileQueries.findByHashWithFile(retainedMediaHash, { includeHidden: true })?.composite_hash,
      retainedMediaHash,
      'authorized generation-history detail queries must be able to resolve hidden-rated media',
    )

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
    const failedHistoryId = GenerationHistoryModel.create({
      service_type: 'codex',
      generation_status: 'failed',
      nai_model: 'codex',
    })
    GenerationHistoryModel.updateImagePaths(historyIds[0], { compositeHash: retainedMediaHash })

    const firstHistoryRetentionBatch = pruneGenerationResultRetentionBatch(2, 2)
    assert.equal(firstHistoryRetentionBatch.deleted_count, 2)
    assert.equal(firstHistoryRetentionBatch.remaining_overflow_count, 2)
    const historyRetention = await pruneGenerationResultRetention(2)
    assert.equal(historyRetention.deleted_count, 2)
    assert.equal(historyRetention.remaining_overflow_count, 0)
    historyIds.forEach((historyId) => assert.equal(GenerationHistoryModel.findById(historyId), null))
    assert.notEqual(GenerationHistoryModel.findById(pendingHistoryId), null)
    assert.notEqual(GenerationHistoryModel.findById(failedHistoryId), null)
    assert.equal(fs.existsSync(retainedMediaPath), true, 'history retention must not delete generated media files')
    assert.equal(
      (mediaDb.prepare('SELECT COUNT(*) as total FROM media_metadata WHERE composite_hash = ?').get(retainedMediaHash) as { total: number }).total,
      1,
      'history retention must not delete media metadata',
    )
    assert.equal(
      (mediaDb.prepare('SELECT COUNT(*) as total FROM image_files WHERE composite_hash = ?').get(retainedMediaHash) as { total: number }).total,
      1,
      'history retention must not delete image-file rows',
    )
    assert.match(
      generationHistoryRetentionSource,
      /DELETE FROM api_generation_history[\s\S]*?WHERE generation_status IN \('completed', 'failed'\)[\s\S]*?ORDER BY id ASC[\s\S]*?LIMIT \?/,
      'history retention should delete only bounded batches of oldest terminal DB rows',
    )
    assert.doesNotMatch(
      generationHistoryRetentionSource,
      /unlink|rmSync|recycle|DELETE FROM (?:media_metadata|image_files)/,
      'history retention must not include generated-media deletion paths',
    )
    assert.match(
      generationHistoryModelSource,
      /static updateStatus[\s\S]*?requestGenerationResultRetentionPrune\(\)[\s\S]*?static updateImagePaths/,
      'terminal status updates should request the shared retention pass',
    )
    assert.match(
      generationHistoryModelSource,
      /static recordError[\s\S]*?requestGenerationResultRetentionPrune\(\)[\s\S]*?static recordErrorByQueueJobIds/,
      'failed histories should request the same retention pass',
    )

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
      graphWorkflowRetentionScannerSource,
      /findByWorkflowIdPage\(workflowId, RETENTION_SCAN_PAGE_SIZE/,
      'graph workflow retention should scan workflow rows in pages instead of hydrating the full workflow',
    )
    assert.doesNotMatch(
      graphWorkflowRetentionScannerSource,
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
