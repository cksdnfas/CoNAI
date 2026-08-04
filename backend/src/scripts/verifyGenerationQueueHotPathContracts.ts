import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const runtimeBase = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-generation-queue-hot-path-'))
process.env.RUNTIME_BASE_PATH = runtimeBase

type QueryPlanRow = { detail: string }

/**
 * QLIST-1: 큐 목록 스냅샷 캐시가 권한 중립인지, 그리고 폴링 비용이 상수인지 검사한다.
 *
 * 최대 리스크는 캐시 키에 요청자 권한 차원이 섞여 다른 사용자의 큐가 보이는 것이다.
 * 그래서 (1) 스냅샷 빌더가 `is_mine` 을 만들지 않고, (2) `is_mine` 이 캐시 **밖에서만** 붙고,
 * (3) 키가 필터/페이지 차원만으로 구성되는지를 소스와 런타임 양쪽에서 단언한다.
 */
async function assertQueueListSnapshotCacheContracts(queueListServiceSource: string) {
  const {
    buildQueueListSnapshotCacheKey,
    getQueueListSnapshotCacheStats,
    invalidateQueueListSnapshots,
    readQueueListSnapshot,
    resetQueueListSnapshotCacheForTests,
    QUEUE_LIST_SNAPSHOT_TTL_MS,
  } = await import('../routes/generation-queue/queue-list-snapshot-cache')

  assert.ok(
    QUEUE_LIST_SNAPSHOT_TTL_MS >= 1_000 && QUEUE_LIST_SNAPSHOT_TTL_MS <= 2_000,
    `queue list snapshots must stay on a 1~2s TTL so 30 pollers share one computation, got ${QUEUE_LIST_SNAPSHOT_TTL_MS}ms`,
  )

  const snapshotBuilder = /function buildQueueListSnapshot\([\s\S]*?\n\}/.exec(queueListServiceSource)?.[0] ?? ''
  assert.ok(snapshotBuilder.length > 0, 'queue list service must expose a dedicated permission-neutral snapshot builder')
  assert.doesNotMatch(
    snapshotBuilder,
    /is_mine/,
    'the cached queue list snapshot must never contain requester-scoped fields such as is_mine',
  )
  assert.match(
    queueListServiceSource,
    /const snapshot = readQueueListSnapshot\([\s\S]*?buildQueueListSnapshotCacheKey\(\{[\s\S]*?\}\),[\s\S]*?\(\) => buildQueueListSnapshot\(filters, limit, offset\),[\s\S]*?\)[\s\S]*?is_mine: requesterAccountId !== null && record\.requested_by_account_id === requesterAccountId/,
    'is_mine must be applied to the shared snapshot per request, never computed inside the cached value',
  )

  // 요청자 계정이 결과 집합을 바꾸는 `mine=true` 만 키에 들어간다. 그 외 요청자 차원은 키에 없다.
  const sharedKey = buildQueueListSnapshotCacheKey({ statuses: ['running', 'queued'], limit: 200, offset: 0 })
  assert.equal(
    buildQueueListSnapshotCacheKey({ statuses: ['queued', 'running'], limit: 200, offset: 0 }),
    sharedKey,
    'status filter order must not fragment the shared snapshot key',
  )
  assert.notEqual(
    buildQueueListSnapshotCacheKey({ statuses: ['running', 'queued'], requesterAccountId: 7, limit: 200, offset: 0 }),
    sharedKey,
    'a mine=true scope filter must never share a snapshot with the unscoped queue list',
  )
  assert.notEqual(
    buildQueueListSnapshotCacheKey({ statuses: ['running', 'queued'], requesterAccountId: 7, limit: 200, offset: 0 }),
    buildQueueListSnapshotCacheKey({ statuses: ['running', 'queued'], requesterAccountId: 9, limit: 200, offset: 0 }),
    'two accounts scoping to their own queue must never share a snapshot',
  )
  for (const [label, changed] of [
    ['service type', buildQueueListSnapshotCacheKey({ statuses: ['running', 'queued'], serviceType: 'comfyui', limit: 200, offset: 0 })],
    ['workflow id', buildQueueListSnapshotCacheKey({ statuses: ['running', 'queued'], workflowId: 7, limit: 200, offset: 0 })],
    ['limit', buildQueueListSnapshotCacheKey({ statuses: ['running', 'queued'], limit: 50, offset: 0 })],
    ['offset', buildQueueListSnapshotCacheKey({ statuses: ['running', 'queued'], limit: 200, offset: 200 })],
  ] as const) {
    assert.notEqual(changed, sharedKey, `${label} must be part of the snapshot cache key`)
  }

  resetQueueListSnapshotCacheForTests()
  let computations = 0
  const compute = () => {
    computations += 1
    return { records: [], total: computations, limit: 200, offset: 0 }
  }

  // 30 클라이언트가 같은 필터로 동시에 폴링하는 상황: 계산은 1회, 나머지는 캐시 히트여야 한다.
  const responses = Array.from({ length: 30 }, () => readQueueListSnapshot(sharedKey, compute))
  assert.equal(computations, 1, 'a TTL window must compute the queue list snapshot exactly once for concurrent pollers')
  assert.ok(responses.every((response) => response === responses[0]), 'concurrent pollers must share one snapshot instance')

  const stats = getQueueListSnapshotCacheStats()
  assert.equal(stats.hits, 29)
  assert.equal(stats.misses, 1)
  assert.ok(stats.hits / (stats.hits + stats.misses) >= 0.9, 'shared snapshot hit rate must stay at or above 90%')

  invalidateQueueListSnapshots()
  assert.equal(getQueueListSnapshotCacheStats().invalidations, 1, 'queue runtime events must be able to shorten snapshot lifetime')
  resetQueueListSnapshotCacheForTests()
}

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
    const queueListServiceSource = fs.readFileSync(path.resolve(process.cwd(), 'src/routes/generation-queue/queue-list-service.ts'), 'utf8')
    const publicWorkflowRoutesSource = fs.readFileSync(path.resolve(process.cwd(), 'src/routes/public-workflows.routes.ts'), 'utf8')
    const generationHistoryServiceSource = fs.readFileSync(path.resolve(process.cwd(), 'src/services/generationHistoryService.ts'), 'utf8')
    const apiImageProcessorSource = fs.readFileSync(path.resolve(process.cwd(), 'src/services/APIImageProcessor.ts'), 'utf8')
    const backgroundQueueSource = fs.readFileSync(path.resolve(process.cwd(), 'src/services/backgroundQueue.ts'), 'utf8')
    const backgroundProcessorServiceSource = fs.readFileSync(path.resolve(process.cwd(), 'src/services/backgroundProcessorService.ts'), 'utf8')
    const autoTagSchedulerSource = fs.readFileSync(path.resolve(process.cwd(), 'src/services/autoTagScheduler.ts'), 'utf8')
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
      /GenerationQueueModel\.findQueuedComfyDispatchCandidates\(candidateLimit\)/,
      'ComfyUI dispatcher should read a bounded lean queued-candidate window before hydrating a claimed queue job payload',
    )
    assert.match(
      queueServiceSource,
      /COMFY_DISPATCH_CANDIDATE_BATCH_LIMIT/,
      'ComfyUI dispatcher must cap queued candidate scans so cold backlog size cannot dominate each dispatch tick',
    )
    assert.ok(
      queueServiceSource.indexOf('const serversWithLocalCapacity = activeServers.filter') < queueServiceSource.indexOf('GenerationQueueModel.findQueuedComfyDispatchCandidates(candidateLimit)'),
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
      /findQueuedComfyDispatchCandidates\(limit = 200\)[\s\S]*SELECT \$\{GENERATION_QUEUE_DISPATCH_CANDIDATE_COLUMNS\}[\s\S]*LIMIT \?/,
      'queued ComfyUI dispatch candidates should use a lean explicit column set with a bounded LIMIT',
    )
    // PAYLOAD-1: only the dispatch claim may hydrate the multi-MB request payload.
    // Everything else on the job lifecycle reads the lean list projection.
    const queueRouteHelperSource = fs.readFileSync(path.resolve(process.cwd(), 'src/routes/generation-queue/queue-route-helpers.ts'), 'utf8')
    const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    const sliceMethod = (source: string, start: string, end: string) => {
      const startIndex = source.indexOf(start)
      assert.ok(startIndex >= 0, `expected queue service source to contain ${start}`)
      const endIndex = source.indexOf(end, startIndex)
      assert.ok(endIndex > startIndex, `expected queue service source to contain ${end} after ${start}`)
      return stripComments(source.slice(startIndex, endIndex))
    }

    const transitionJobBody = sliceMethod(queueServiceSource, 'static transitionJob(', 'static claimNextDispatchableJob(')
    assert.doesNotMatch(
      transitionJobBody,
      /GenerationQueueModel\.findById\(/,
      'queue transitions must read lean list records, not hydrate request payloads (PAYLOAD-1)',
    )
    assert.equal(
      (transitionJobBody.match(/GenerationQueueModel\.findListRecordById\(/g) ?? []).length,
      2,
      'queue transitions should read the lean record before and after the guarded UPDATE (PAYLOAD-1)',
    )

    const requestCancellationBody = sliceMethod(queueServiceSource, 'static async requestCancellation(', 'static finalizeAbandonedCancellations(')
    assert.doesNotMatch(
      requestCancellationBody,
      /GenerationQueueModel\.findById\(/,
      'cancellation requests must not hydrate request payloads (PAYLOAD-1)',
    )

    assert.doesNotMatch(
      sliceMethod(queueServiceSource, 'private static async cancelJobIfActive(', 'private static async failJobIfActive('),
      /GenerationQueueModel\.findById\(/,
      'worker cancel finalization must not hydrate request payloads (PAYLOAD-1)',
    )

    assert.doesNotMatch(
      stripComments(queueRouteHelperSource),
      /GenerationQueueModel\.findById\(/,
      'queue route access resolution must not hydrate request payloads (PAYLOAD-1)',
    )
    assert.match(
      queueRouteHelperSource,
      /GenerationQueueModel\.findListRecordById\(jobId\)/,
      'queue route access resolution should read the lean list record (PAYLOAD-1)',
    )

    const claimTransactionBody = sliceMethod(queueServiceSource, 'static claimNextDispatchableJob(', 'static claimQueuedJobForDispatch(')
    assert.doesNotMatch(
      claimTransactionBody,
      /SELECT \* FROM generation_queue_jobs\s*WHERE \$\{whereClauses/,
      'dispatch candidate selection must not hydrate the payload before the claim succeeds (PAYLOAD-1)',
    )
    assert.equal(
      (claimTransactionBody.match(/SELECT \* FROM generation_queue_jobs/g) ?? []).length,
      1,
      'the claim transaction should hydrate the payload exactly once, after the claim UPDATE lands (PAYLOAD-1)',
    )

    // PAYLOAD-2: the debug flag/metadata live in their own columns behind a covering index.
    assert.match(
      generationQueueModelSource,
      /FROM generation_queue_jobs INDEXED BY \$\{GENERATION_QUEUE_DEBUG_STATE_INDEX\}/,
      'debug state reads must be pinned to the covering index; a rowid seek walks the payload overflow chain (PAYLOAD-2)',
    )

    assert.match(
      queueReadRoutesSource,
      /buildGenerationQueueListResponse\(req\)/,
      'queue list route should delegate list composition instead of owning queue query/enrichment flow',
    )
    assert.match(
      queueListServiceSource,
      /GenerationQueueModel\.findAllListRecords\(/,
      'queue list service should use lean list records without request_payload',
    )
    assert.match(
      queueListServiceSource,
      /DEFAULT_QUEUE_LIST_LIMIT/,
      'queue list service should default to a bounded page instead of returning the whole active backlog',
    )
    assert.match(
      queueListServiceSource,
      /QUEUE_ETA_WINDOW_LIMIT/,
      'queue list service should compute ETA over a bounded active window instead of the entire waiting backlog',
    )
    await assertQueueListSnapshotCacheContracts(queueListServiceSource)
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
      /hasQueuedOrActiveMetadataExtractionTask\(filePath: string, compositeHash: string\)/,
      'background queue should check for exact queued or active metadata tasks before adding duplicate work',
    )
    assert.match(
      backgroundQueueSource,
      /activeMetadataTaskKeys = new Set<string>\(\)/,
      'background metadata task coalescing should track in-flight work after a task leaves the queued list',
    )
    assert.match(
      backgroundQueueSource,
      /activeMetadataTaskKeys\.has\(metadataTaskKey\)/,
      'background metadata task coalescing should suppress duplicates while an exact task is active',
    )
    assert.match(
      backgroundQueueSource,
      /task\.type === TaskType\.METADATA_EXTRACTION[\s\S]*task\.compositeHash === compositeHash[\s\S]*path\.resolve\(task\.filePath\) === normalizedFilePath/,
      'background metadata task coalescing should be scoped by type, hash, and resolved file path',
    )
    assert.match(
      backgroundQueueSource,
      /activeCount: number;[\s\S]*activeTasksByType: Record<TaskType, number>;/,
      'background queue status should expose active work separately from queued work',
    )
    assert.match(
      backgroundQueueSource,
      /if \(SystemMaintenanceLockService\.isExclusiveActive\(\)\) \{[\s\S]*?this\.scheduleProcessQueueAfterMaintenanceLock\(\);[\s\S]*?return;/,
      'background queue should schedule a retry when queued work arrives during an exclusive maintenance lock',
    )
    assert.match(
      backgroundQueueSource,
      /private static scheduleProcessQueueAfterMaintenanceLock\(\): void \{[\s\S]*?if \(this\.lockRetryScheduled\) \{[\s\S]*?return;[\s\S]*?this\.lockRetryScheduled = true;[\s\S]*?setTimeout/,
      'background queue maintenance-lock retry scheduling should be coalesced',
    )
    assert.match(
      backgroundProcessorServiceSource,
      /private static scheduleHashGenerationAfterMaintenanceLock\(options: BackgroundProcessorOptions = \{\}\): void \{[\s\S]*?if \(this\.lockRetryScheduled\) \{[\s\S]*?return;[\s\S]*?this\.lockRetryScheduled = true;[\s\S]*?setTimeout[\s\S]*?this\.triggerHashGeneration\(\{ \.\.\.options, quietIfIdle: true \}\)/,
      'background hash generation should coalesce maintenance-lock retries without waiting for another scan event',
    )
    assert.match(
      backgroundProcessorServiceSource,
      /if \(SystemMaintenanceLockService\.isExclusiveActive\(\)\) \{[\s\S]*?this\.scheduleHashGenerationAfterMaintenanceLock\(options\);[\s\S]*?return;/,
      'background hash generation trigger should schedule a retry when maintenance lock blocks processing',
    )
    assert.match(
      autoTagSchedulerSource,
      /private scheduleProcessPendingAfterMaintenanceLock\(\): void \{[\s\S]*?if \(this\.lockRetryScheduled\) \{[\s\S]*?return;[\s\S]*?this\.lockRetryScheduled = true;[\s\S]*?setTimeout[\s\S]*?void this\.processPendingMedia\(\)/,
      'auto-tag postprocess scheduler should coalesce maintenance-lock retries',
    )
    assert.match(
      autoTagSchedulerSource,
      /if \(SystemMaintenanceLockService\.isExclusiveActive\(\)\) \{[\s\S]*?this\.scheduleProcessPendingAfterMaintenanceLock\(\);[\s\S]*?return;/,
      'auto-tag postprocess scheduler should retry when maintenance lock blocks processing',
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

    for (let index = 0; index < 8; index += 1) {
      createJob({ service_type: 'comfyui', status: 'queued', workflow_id: 7, requested_server_id: 1 })
    }

    const dispatchCandidates = GenerationQueueModel.findQueuedComfyDispatchCandidates(3)
    assert.equal(dispatchCandidates.length, 3)
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

    // PAYLOAD-2 runtime contract: debug state must be answered from the covering index,
    // never from a rowid seek that has to walk the request_payload overflow pages.
    assert.ok(
      (db.prepare(`PRAGMA index_list('generation_queue_jobs')`).all() as Array<{ name: string }>)
        .some((index) => index.name === 'idx_generation_queue_jobs_debug_state'),
      'migration 029 must create the queue debug-state covering index',
    )

    const debugStatePlan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT debug_enabled, debug_meta
      FROM generation_queue_jobs INDEXED BY idx_generation_queue_jobs_debug_state
      WHERE id = ?
    `).all(1) as QueryPlanRow[]
    assert.ok(
      debugStatePlan.some((row) => row.detail.includes('COVERING INDEX idx_generation_queue_jobs_debug_state')),
      `queue debug state read should be covered by its index, got: ${debugStatePlan.map((row) => row.detail).join(' | ')}`,
    )

    const debugJobId = GenerationQueueModel.create({
      service_type: 'comfyui',
      workflow_id: 7,
      request_payload: { prompt_data: {}, _debug: { detailed_snapshots: true, graph_execution_id: 5 } },
    })
    assert.equal(
      GenerationQueueModel.isDetailedDebugEnabled(debugJobId),
      true,
      'detailed snapshot requests must be readable from the debug_enabled column',
    )
    GenerationQueueModel.updateDebugMeta(debugJobId, { history_id: 3 })
    assert.deepEqual(
      GenerationQueueModel.readDebugMeta(debugJobId),
      { detailed_snapshots: true, graph_execution_id: 5, history_id: 3 },
      'debug metadata patches must merge into debug_meta',
    )
    assert.deepEqual(
      JSON.parse(GenerationQueueModel.findById(debugJobId)!.request_payload)._debug,
      { detailed_snapshots: true, graph_execution_id: 5 },
      'debug metadata writes must leave request_payload untouched (PAYLOAD-2)',
    )

    // Rows written before migration 029 keep both columns NULL and must still resolve (plan §1-8).
    const legacyJobId = GenerationQueueModel.create({
      service_type: 'comfyui',
      workflow_id: 7,
      request_payload: { prompt_data: {}, _debug: { workflow_debug_mode: true, history_id: 12 } },
    })
    db.prepare('UPDATE generation_queue_jobs SET debug_enabled = NULL, debug_meta = NULL WHERE id = ?').run(legacyJobId)
    assert.equal(
      GenerationQueueModel.isDetailedDebugEnabled(legacyJobId),
      true,
      'pre-029 rows must still resolve their debug flag from the inline payload _debug',
    )
    assert.deepEqual(
      GenerationQueueModel.readDebugMeta(legacyJobId),
      { workflow_debug_mode: true, history_id: 12 },
      'pre-029 rows must still resolve their debug metadata from the inline payload _debug',
    )
    GenerationQueueModel.updateDebugMeta(legacyJobId, { result_prompt_id: 'p1' })
    assert.deepEqual(
      db.prepare('SELECT debug_enabled FROM generation_queue_jobs WHERE id = ?').get(legacyJobId),
      { debug_enabled: 1 },
      'the first debug write must promote a pre-029 row onto the columns so later reads skip the payload fallback',
    )

    console.log('✅ Generation queue hot-path contracts passed (SQL filters, recent-completed index, lean ETA samples, lean lifecycle reads, covered debug state)')
  } finally {
    closeUserSettingsDb()
    fs.rmSync(runtimeBase, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
