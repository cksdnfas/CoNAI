import './support/testTemp'
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
    ;(await import('../src/database/init')).closeDatabase()
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

  await t.test('a run cancelled while its final result uploads records no final result and fills no group', async (sub) => {
    const main = await import('../src/database/init')
    await main.initializeDatabase()
    ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
    const { GenerationHistoryService } = await import('../src/services/generationHistoryService')
    const { HistoryCommandService } = await import('../src/services/historyCommandService')
    const { MediaPostprocessCoordinator } = await import('../src/services/background-media/mediaPostprocessCoordinator')
    const { GroupModel } = await import('../src/models/Group')
    const abort = await import('../src/services/graph-workflow-executor/execution-abort')
    const { executeFinalResultNode } = await import('../src/services/graph-workflow-executor/system-result-operations')
    const workflowId = workflow('cancelled final')
    const executionId = Number(db.prepare("INSERT INTO graph_executions (graph_workflow_id, graph_version, status) VALUES (?, 1, 'running')").run(workflowId).lastInsertRowid)
    const storagePath = path.join(root, 'cancelled-final.png')
    fs.writeFileSync(storagePath, 'png')
    const artifactRecordId = Number(db.prepare("INSERT INTO graph_execution_artifacts (execution_id, node_id, port_key, artifact_type, storage_path) VALUES (?, 'n1', 'image', 'image', ?)").run(executionId, storagePath).lastInsertRowid)
    const handle = abort.createExecutionAbortHandle(executionId)
    abort.registerExecutionAbortHandle(handle)
    sub.after(() => abort.unregisterExecutionAbortHandle(executionId))
    const groupId = GroupModel.create({ name: 'cancelled final group' })
    const hash = 'cd'.repeat(24)
    main.db.prepare('INSERT INTO media_metadata (composite_hash) VALUES (?)').run(hash)
    // The cancel lands while the upload runs; the upload still finishes and files its row's group as the real one does.
    sub.mock.method(GenerationHistoryService, 'processAndUploadGeneratedFile', async (historyId: number) => {
      handle.abort({ kind: 'user_cancel' })
      HistoryCommandService.updateImagePaths(historyId, { compositeHash: hash })
      HistoryCommandService.updateStatus(historyId, 'completed')
      await MediaPostprocessCoordinator.processApiGenerationGroupAssignment(hash)
    })
    const context = {
      executionId, signal: handle.signal, getAbortReason: handle.getReason, outputGroupId: groupId,
      workflow: { id: workflowId, name: 'cancelled final', graph: { nodes: [], edges: [{ source_node_id: 'n1', source_port_key: 'image', target_node_id: 'final', target_port_key: 'value' }] } },
      artifactsByNode: new Map([['n1', { image: { type: 'image', value: null, storagePath, artifactRecordId } }]]),
    } as any
    await assert.rejects(executeFinalResultNode(context, { id: 'final' } as any, { name: 'final' } as any, {}), (error) => abort.isGraphCancellationError(error))
    assert.deepEqual(GraphExecutionFinalResultModel.findByExecution(executionId), [])
    assert.equal(main.db.prepare('SELECT 1 FROM image_groups WHERE group_id = ?').get(groupId), undefined)
  })

  await t.test('scope cleanup pages technical artifacts without deleting reused final results or active runs', async () => {
    const { deleteGraphWorkflowArtifactsInScope } = await import('../src/services/graphWorkflowOutputManagementService')
    const sourceWorkflow = workflow('scope-source')
    const finalWorkflow = workflow('scope-final')
    const execution = (workflowId: number, status = 'completed') => Number(db.prepare('INSERT INTO graph_executions (graph_workflow_id, graph_version, status) VALUES (?, 1, ?)').run(workflowId, status).lastInsertRowid)
    const sourceRun = execution(sourceWorkflow)
    const finalRun = execution(finalWorkflow)
    const activeRun = execution(sourceWorkflow, 'running')
    const insert = db.prepare("INSERT INTO graph_execution_artifacts (execution_id, node_id, port_key, artifact_type, metadata) VALUES (?, 'n', 'out', ?, ?)")
    // A text-typed source becomes a visual final result in a different workflow.
    const reused = Number(insert.run(sourceRun, 'text', '{}').lastInsertRowid)
    db.prepare("INSERT INTO graph_execution_final_results (execution_id, final_node_id, source_artifact_id, source_node_id, source_port_key, artifact_type) VALUES (?, 'final', ?, 'n', 'out', 'image')").run(finalRun, reused)
    for (const rows of [
      GraphExecutionFinalResultModel.findByExecutionIds([finalRun]),
      GraphExecutionFinalResultModel.findByExecution(finalRun),
      GraphExecutionFinalResultModel.findByWorkflowIdPage(finalWorkflow),
    ]) {
      assert.equal(rows.length, 1)
      const [row] = rows
      assert.deepEqual({
        execution_id: row.execution_id,
        source_execution_id: row.source_execution_id,
        source_artifact_id: row.source_artifact_id,
        artifact_type: row.artifact_type,
        source_storage_path: row.source_storage_path,
        source_metadata: row.source_metadata,
      }, {
        execution_id: finalRun,
        source_execution_id: sourceRun,
        source_artifact_id: reused,
        artifact_type: 'image',
        source_storage_path: null,
        source_metadata: '{}',
      })
    }
    const active = Number(insert.run(activeRun, 'text', '{}').lastInsertRowid)
    const fallback = Number(insert.run(sourceRun, 'image', '{}').lastInsertRowid)
    const technical = db.transaction(() => Array.from({ length: 503 }, () => Number(insert.run(sourceRun, 'text', '{"note":"temporary"}').lastInsertRowid)))()
    const deleted = await deleteGraphWorkflowArtifactsInScope({ folderId: null, kind: 'artifacts', searchTerm: 'scope-source' })
    assert.deepEqual(new Set(deleted.deleted_artifact_ids), new Set(technical))
    for (const id of [reused, active, fallback]) assert.ok(db.prepare('SELECT id FROM graph_execution_artifacts WHERE id=?').get(id))
    assert.ok(deleted.skipped_files.some(item => item.artifact_id === active))
  })

  await t.test('MCP preserves zero and false defaults and rejects invalid inputs before execution', async (sub) => {
    const { McpServer } = await import('@modelcontextprotocol/server')
    const { Client, InMemoryTransport } = await import('@modelcontextprotocol/client')
    const { registerGraphWorkflowTools } = await import('../src/mcp/tools/graphWorkflowTools')
    const { GraphWorkflowExecutor } = await import('../src/services/graphWorkflowExecutor')
    const graphId = Number(db.prepare('INSERT INTO graph_workflows (name, graph_json) VALUES (?, ?)').run('MCP inputs', JSON.stringify({
      nodes: [], edges: [], metadata: { exposed_inputs: [
        { id: 'amount', label: 'Amount', data_type: 'number', required: true, default_value: 0 },
        { id: 'enabled', label: 'Enabled', data_type: 'boolean', required: true, default_value: false },
      ] },
    })).lastInsertRowid)
    result(graphId, 'text', { note: 'stored result' })
    const execution = db.prepare('SELECT id FROM graph_executions WHERE graph_workflow_id = ?').get(graphId) as { id: number }
    const execute = sub.mock.method(GraphWorkflowExecutor, 'execute', async () => ({ executionId: execution.id }))
    const server = new McpServer({ name: 'graph-inputs-test', version: '1.0.0' })
    const client = new Client({ name: 'graph-inputs-test-client', version: '1.0.0' })
    sub.after(async () => { await client.close(); await server.close() })
    registerGraphWorkflowTools(server, { scopes: ['read', 'generate'] })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const response = await client.callTool({ name: 'get_graph_workflow_details', arguments: { workflow_id: graphId } })
    assert.notEqual(response.isError, true)
    const details = JSON.parse((response.content![0] as { text: string }).text)
    assert.deepEqual(details.input_values_template, { amount: 0, enabled: false })
    assert.deepEqual(details.invocation, { tool: 'execute_graph_workflow', arguments: { workflow_id: graphId, input_values: { amount: 0, enabled: false } } })
    assert.deepEqual(details.input_schema.map(({ id, required, default_value }: { id: string; required: boolean; default_value: unknown }) => ({ id, required, default_value })), [
      { id: 'amount', required: true, default_value: 0 },
      { id: 'enabled', required: true, default_value: false },
    ])

    for (const [input, message] of [
      [{ unknown: 1 }, /Unknown graph workflow input/],
      [{ amount: '1' }, /must be a finite number/],
      [{ enabled: 'true' }, /must be a boolean/],
    ] as const) {
      const rejected = await client.callTool({ name: 'execute_graph_workflow', arguments: { workflow_id: graphId, input_values: input } })
      assert.equal(rejected.isError, true)
      assert.match((rejected.content![0] as { text: string }).text, message)
    }
    assert.equal(execute.mock.callCount(), 0)

    const accepted = await client.callTool({ name: 'execute_graph_workflow', arguments: { workflow_id: graphId, input_values: {} } })
    assert.notEqual(accepted.isError, true)
    assert.equal(execute.mock.callCount(), 1)
    assert.deepEqual(execute.mock.calls[0].arguments[1].runtimeInputValues, { amount: 0, enabled: false })
    const saved = JSON.parse((accepted.content![0] as { text: string }).text)
    assert.equal(saved.execution.id, execution.id)
    assert.equal(saved.final_results.length, 1)
    assert.equal(saved.final_results[0].artifact_type, 'text')
    assert.deepEqual(saved.artifacts, [])
    const fetched = await client.callTool({ name: 'get_graph_workflow_execution', arguments: { execution_id: execution.id } })
    assert.notEqual(fetched.isError, true)
    assert.deepEqual(JSON.parse((fetched.content![0] as { text: string }).text), saved)
  })
})
