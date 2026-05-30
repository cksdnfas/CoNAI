import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const runtimeBase = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-generation-queue-hot-path-'))
process.env.RUNTIME_BASE_PATH = runtimeBase

type QueryPlanRow = { detail: string }

async function main() {
  const { initializeUserSettingsDb, getUserSettingsDb, closeUserSettingsDb } = await import('../database/userSettingsDb')
  const { GenerationQueueModel } = await import('../models/GenerationQueue')

  initializeUserSettingsDb()
  const db = getUserSettingsDb()

  try {
    const indexes = db.prepare(`PRAGMA index_list('generation_queue_jobs')`).all() as Array<{ name: string }>
    assert.ok(
      indexes.some((index) => index.name === 'idx_generation_queue_jobs_completed_recent'),
      'generation queue must index recent completed ETA lookup by status/completed_at/id',
    )

    const plan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT id, service_type, workflow_id, requested_server_id, assigned_server_id, started_at, completed_at
      FROM generation_queue_jobs
      WHERE status = 'completed'
      ORDER BY completed_at DESC, id DESC
      LIMIT 12
    `).all() as QueryPlanRow[]
    assert.ok(
      plan.some((row) => row.detail.includes('idx_generation_queue_jobs_completed_recent')),
      `recent completed ETA query should use completed_at index, got: ${plan.map((row) => row.detail).join(' | ')}`,
    )
    assert.ok(
      plan.every((row) => !row.detail.includes('USE TEMP B-TREE')),
      `recent completed ETA query must not sort through a temp B-tree, got: ${plan.map((row) => row.detail).join(' | ')}`,
    )

    const queueServiceSource = fs.readFileSync(path.resolve(process.cwd(), 'src/services/generationQueueService.ts'), 'utf8')
    const generationQueueModelSource = fs.readFileSync(path.resolve(process.cwd(), 'src/models/GenerationQueue.ts'), 'utf8')
    const queueReadRoutesSource = fs.readFileSync(path.resolve(process.cwd(), 'src/routes/generation-queue/queue-read-routes.ts'), 'utf8')
    const publicWorkflowRoutesSource = fs.readFileSync(path.resolve(process.cwd(), 'src/routes/public-workflows.routes.ts'), 'utf8')
    const generationHistoryServiceSource = fs.readFileSync(path.resolve(process.cwd(), 'src/services/generationHistoryService.ts'), 'utf8')
    const apiImageProcessorSource = fs.readFileSync(path.resolve(process.cwd(), 'src/services/APIImageProcessor.ts'), 'utf8')
    const backgroundQueueSource = fs.readFileSync(path.resolve(process.cwd(), 'src/services/backgroundQueue.ts'), 'utf8')
    const backgroundProcessorServiceSource = fs.readFileSync(path.resolve(process.cwd(), 'src/services/backgroundProcessorService.ts'), 'utf8')
    assert.match(
      queueServiceSource,
      /const compatibleServerIdsByJobId = new Map<number, Set<number>>\(\)/,
      'ComfyUI dispatcher should cache compatible server IDs once per queued job before server-slot scans',
    )
    assert.match(
      queueServiceSource,
      /const routingContext = createGenerationQueueRoutingContext\(activeServers\)/,
      'ComfyUI dispatcher should build shared routing lookup state once per dispatch pass',
    )
    assert.match(
      queueServiceSource,
      /getGenerationQueueEligibleServerIds\(job, routingContext\)/,
      'ComfyUI dispatcher should reuse routing lookup state while resolving queued job eligibility',
    )
    assert.match(
      queueServiceSource,
      /const runnableJobsByServerId = new Map<number, GenerationQueueDispatchCandidateRecord\[\]>\(\)/,
      'ComfyUI dispatcher should pre-bucket runnable jobs by server before capacity-slot scans',
    )
    assert.match(
      queueServiceSource,
      /takeNextRunnableJobForServer\(server\.id\)/,
      'ComfyUI dispatcher should reuse per-server runnable-job cursors while filling local capacity slots',
    )
    assert.doesNotMatch(
      queueServiceSource,
      /runnableQueuedJobs\.find\(\(job\) => !reservedJobIds\.has\(job\.id\) && compatibleServerIdsByJobId\.get\(job\.id\)\?\.has\(server\.id\)\)/,
      'ComfyUI dispatcher must not rescan every runnable job for each server capacity slot',
    )
    assert.match(
      queueServiceSource,
      /GenerationQueueModel\.findQueuedComfyDispatchCandidates\(\)/,
      'ComfyUI dispatcher should read lean queued candidates before hydrating a claimed queue job payload',
    )
    assert.ok(
      queueServiceSource.indexOf('const serversWithLocalCapacity = activeServers.filter') < queueServiceSource.indexOf('GenerationQueueModel.findQueuedComfyDispatchCandidates()'),
      'ComfyUI dispatcher should return early on zero local capacity before reading queued candidates',
    )
    assert.doesNotMatch(
      queueServiceSource,
      /isGenerationQueueComfyJobCompatibleWithServer/,
      'ComfyUI dispatcher must not recompute full job/server compatibility inside nested dispatch loops',
    )
    assert.match(
      generationQueueModelSource,
      /const GENERATION_QUEUE_LIST_COLUMNS = `[\s\S]*request_summary[\s\S]*`/,
      'queue list model should maintain an explicit lean response column set',
    )
    assert.doesNotMatch(
      generationQueueModelSource.match(/const GENERATION_QUEUE_LIST_COLUMNS = `[\s\S]*?`/)?.[0] ?? '',
      /request_payload/,
      'queue list column set must not select request_payload',
    )
    assert.match(
      generationQueueModelSource,
      /findQueuedComfyDispatchCandidates\(\)[\s\S]*SELECT \$\{GENERATION_QUEUE_DISPATCH_CANDIDATE_COLUMNS\}/,
      'queued ComfyUI dispatch candidates should use a lean explicit column set',
    )
    assert.match(
      queueReadRoutesSource,
      /GenerationQueueModel\.findAllListRecords\(/,
      'queue list route should use lean list records without request_payload',
    )
    assert.doesNotMatch(
      publicWorkflowRoutesSource,
      /GenerationQueueModel\.findById\(jobId\)/,
      'public workflow multi-enqueue response must not hydrate full request payloads for every created job',
    )
    assert.match(
      generationHistoryServiceSource,
      /Slow generation postprocess/,
      'generation postprocess should log slow media/group assignment timing for stalled queue diagnosis',
    )
    assert.match(
      apiImageProcessorSource,
      /metadataMode:\s*'background'/,
      'generated-image media registration should queue AI metadata extraction instead of blocking queue completion on it',
    )
    assert.match(
      backgroundProcessorServiceSource,
      /metadataMode\?: 'inline' \| 'background'/,
      'saved-media processing should expose an explicit metadata scheduling mode',
    )
    assert.match(
      backgroundProcessorServiceSource,
      /options\.metadataMode === 'background'[\s\S]*?queueMetadataExtraction\(filePath, compositeHash, logLabel\)/,
      'background metadata mode should hand processed media to the background queue without awaiting extraction',
    )
    assert.doesNotMatch(
      backgroundProcessorServiceSource.match(/const processedRecord =[\s\S]*?if \(!options\.quiet\)/)?.[0] ?? '',
      /processApiGenerationGroupAssignment\(compositeHash\)/,
      'saved-media processing must not rerun API generation group assignment after processFile already handled the hash-level handoff',
    )
    assert.match(
      backgroundQueueSource,
      /hasQueuedMetadataExtractionTask\(filePath: string, compositeHash: string\)/,
      'background queue should check for exact queued metadata tasks before adding duplicate work',
    )
    assert.match(
      backgroundQueueSource,
      /task\.type === TaskType\.METADATA_EXTRACTION[\s\S]*task\.compositeHash === compositeHash[\s\S]*path\.resolve\(task\.filePath\) === normalizedFilePath/,
      'background metadata task coalescing should be scoped by type, hash, and resolved file path',
    )

    db.prepare(`
      INSERT INTO workflows (id, name, workflow_json)
      VALUES (?, ?, ?), (?, ?, ?)
    `).run(7, 'Hot Path Workflow 7', '{}', 8, 'Hot Path Workflow 8', '{}')
    db.prepare(`
      INSERT INTO comfyui_servers (id, name, endpoint, backend_type, capacity)
      VALUES (?, ?, ?, 'comfyui', 1), (?, ?, ?, 'comfyui', 1)
    `).run(1, 'Server 1', 'http://127.0.0.1:8188', 2, 'Server 2', 'http://127.0.0.1:8189')

    const now = Date.parse('2026-05-17T00:00:00.000Z')
    const createJob = (overrides: {
      service_type: 'comfyui' | 'novelai' | 'codex'
      status: 'queued' | 'dispatching' | 'running' | 'completed' | 'failed' | 'cancelled'
      workflow_id?: number | null
      requested_server_id?: number | null
      assigned_server_id?: number | null
      started_at?: string | null
      completed_at?: string | null
      queued_at?: string | null
    }) => GenerationQueueModel.create({
      service_type: overrides.service_type,
      status: overrides.status,
      workflow_id: overrides.workflow_id ?? null,
      requested_server_id: overrides.requested_server_id ?? null,
      assigned_server_id: overrides.assigned_server_id ?? null,
      request_payload: { prompt: 'payload should not be selected for ETA samples' },
      queued_at: overrides.queued_at ?? new Date(now).toISOString(),
      started_at: overrides.started_at ?? null,
      completed_at: overrides.completed_at ?? null,
    })

    createJob({ service_type: 'comfyui', status: 'queued', workflow_id: 7, requested_server_id: 1 })
    createJob({ service_type: 'comfyui', status: 'dispatching', workflow_id: 7, requested_server_id: 1 })
    createJob({ service_type: 'comfyui', status: 'running', workflow_id: 8, assigned_server_id: 2 })
    createJob({ service_type: 'novelai', status: 'queued', workflow_id: null })
    createJob({ service_type: 'codex', status: 'failed', workflow_id: null })

    for (let index = 0; index < 18; index += 1) {
      createJob({
        service_type: index % 2 === 0 ? 'comfyui' : 'novelai',
        status: 'completed',
        workflow_id: index % 3 === 0 ? 7 : 8,
        assigned_server_id: index % 2 === 0 ? 1 : null,
        started_at: new Date(now + index * 60_000).toISOString(),
        completed_at: new Date(now + index * 60_000 + 30_000).toISOString(),
      })
    }

    const visibleCounts = GenerationQueueModel.getStatusCounts({ serviceType: 'comfyui', workflowId: 7 })
    assert.deepEqual(
      visibleCounts,
      { queued: 1, dispatching: 1, running: 0, completed: 3, failed: 0, cancelled: 0 },
      'queue stats must count filtered visibility in SQL without hydrating all queue rows',
    )

    const activeComfyWorkflow = GenerationQueueModel.findAllListRecords({
      statuses: ['queued', 'dispatching', 'running'],
      serviceType: 'comfyui',
      workflowId: 7,
    })
    assert.deepEqual(
      activeComfyWorkflow.map((job) => job.status),
      ['queued', 'dispatching'],
      'queue list must apply service/workflow filters in SQL before route-level enrichment',
    )
    assert.ok(
      activeComfyWorkflow.every((job) => !('request_payload' in job)),
      'queue list records must not hydrate heavyweight request_payload columns',
    )

    const dispatchCandidates = GenerationQueueModel.findQueuedComfyDispatchCandidates()
    assert.ok(dispatchCandidates.length > 0)
    assert.ok(
      dispatchCandidates.every((job) => !('request_payload' in job) && !('request_summary' in job)),
      'dispatch candidates must not hydrate heavyweight request payload/summary columns',
    )

    const completedSamples = GenerationQueueModel.findRecentCompleted({ serviceType: 'comfyui', workflowId: 7, limit: 5 })
    assert.equal(completedSamples.length, 3)
    assert.ok(
      completedSamples.every((job) => job.service_type === 'comfyui' && job.workflow_id === 7),
      'ETA samples must be filtered by service/workflow before leaving the database',
    )
    assert.ok(
      completedSamples.every((job) => !('request_payload' in job) && !('request_summary' in job)),
      'ETA samples must not hydrate heavyweight request payload/summary columns',
    )

    console.log('✅ Generation queue hot-path contracts passed (SQL filters, recent-completed index, lean ETA samples)')
  } finally {
    closeUserSettingsDb()
    fs.rmSync(runtimeBase, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
