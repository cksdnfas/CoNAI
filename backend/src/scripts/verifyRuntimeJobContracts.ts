import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * 책임형 잡 러너 계약.
 *
 * 정적 검사(소스 문자열) + 동적 스모크(임시 user.db) 혼합이다.
 * 동적 부분은 임시 RUNTIME_BASE_PATH 를 먼저 심어야 실제 사용자 DB 를 건드리지 않는다.
 */

const runtimeBase = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-runtime-job-'))
process.env.RUNTIME_BASE_PATH = runtimeBase

const backendSrc = path.resolve(__dirname, '..')

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.join(backendSrc, ...segments), 'utf8')
}

const userSettingsSchemaSource = readSource('database', 'userSettingsSchema.ts')
const runnerSource = readSource('services', 'runtimeJobs', 'runtimeJobRunner.ts')
const storeSource = readSource('services', 'runtimeJobs', 'runtimeJobStore.ts')
const jobRoutesSource = readSource('routes', 'runtime-jobs.routes.ts')
const registerAppRoutesSource = readSource('startup', 'registerAppRoutes.ts')
const indexSource = readSource('index.ts')
const thumbnailRouteSource = readSource('routes', 'thumbnails.ts')
const thumbnailServiceSource = readSource('services', 'thumbnailRegenerationService.ts')
const watchedFolderRouteSource = readSource('routes', 'watchedFolders.ts')
const typesSource = readSource('types', 'runtimeJob.ts')
const handlerSources: Array<[string, string]> = [
  ['thumbnailHandlers.ts', readSource('services', 'runtimeJobs', 'handlers', 'thumbnailHandlers.ts')],
  ['groupRematchHandlers.ts', readSource('services', 'runtimeJobs', 'handlers', 'groupRematchHandlers.ts')],
  ['folderScanHandlers.ts', readSource('services', 'runtimeJobs', 'handlers', 'folderScanHandlers.ts')],
]

/* ------------------------------------------------------------------ *
 * RJ-1: 스키마 — 상태 정본은 user.db 의 runtime_jobs 테이블이다.
 * ------------------------------------------------------------------ */

for (const requiredFragment of [
  'CREATE TABLE IF NOT EXISTS runtime_jobs',
  'uq_runtime_jobs_singleton_live',
  'cancel_requested',
  'heartbeat_at',
  'singleton_key',
  'owner_role',
]) {
  assert.ok(
    userSettingsSchemaSource.includes(requiredFragment),
    `userSettingsSchema.ts must declare "${requiredFragment}" for the runtime job store`,
  )
}

assert.ok(
  /CREATE UNIQUE INDEX IF NOT EXISTS uq_runtime_jobs_singleton_live[\s\S]*?WHERE singleton_key IS NOT NULL AND status IN \('queued', 'running'\)/.test(userSettingsSchemaSource),
  'the singleton index must be partial, or a finished job keeps blocking the next start',
)

/* ------------------------------------------------------------------ *
 * RJ-2: 라우트 규약 — /api/jobs 가 진행률/취소의 정본 경로다.
 * ------------------------------------------------------------------ */

assert.match(jobRoutesSource, /router\.get\('\/:jobId'/, 'runtime job routes must expose the progress lookup')
assert.match(jobRoutesSource, /router\.post\('\/:jobId\/cancel'/, 'runtime job routes must expose cancellation')
assert.match(jobRoutesSource, /router\.get\('\/'/, 'runtime job routes must expose the job list')
assert.ok(
  registerAppRoutesSource.includes("app.use('/api/jobs', optionalAuth, runtimeJobRoutes)"),
  'registerAppRoutes must mount the shared runtime job routes',
)
assert.match(
  jobRoutesSource,
  /function canAccessJob[\s\S]*?requestedByAccountId === null \|\| isAdminRequest\(req\)/,
  'job lookups must be limited to the requesting account or an admin',
)

/* ------------------------------------------------------------------ *
 * RJ-3: 202 규약 — 이관된 라우트는 장기 작업을 인라인 await 하지 않는다.
 * ------------------------------------------------------------------ */

assert.match(thumbnailRouteSource, /res\.status\(202\)/, 'thumbnail regenerate must answer 202 with a job record')
assert.doesNotMatch(
  thumbnailRouteSource,
  /ThumbnailRegenerationService\.regenerateAllThumbnails\(/,
  'the thumbnail route must not run regeneration itself; the runner owns execution and failure reporting',
)
assert.match(watchedFolderRouteSource, /res\.status\(202\)/, 'scan-all must answer 202 with a job record')
assert.doesNotMatch(
  watchedFolderRouteSource,
  /await FolderScanService\.scanAllFolders\(/,
  'scan-all must not run inline: the 60s socket timeout kills the response while the scan keeps going',
)
assert.match(
  indexSource,
  /bootstrapRuntimeJobs\(\)/,
  'index.ts must recover interrupted runtime jobs on startup',
)
// 셧다운에서 잡을 마감하지 않으면 다음 기동까지 running 으로 남아 클라이언트가 계속 폴링한다.
const runnerShutdownIndex = indexSource.indexOf('RuntimeJobRunner.shutdown()')
const userDbCloseIndex = indexSource.indexOf('closeUserSettingsDb()')
assert.ok(runnerShutdownIndex > 0, 'index.ts must close out in-flight runtime jobs during shutdown')
assert.ok(
  runnerShutdownIndex < userDbCloseIndex,
  'RuntimeJobRunner.shutdown() must run before the user database closes, or the interrupted marks are lost',
)

/* ------------------------------------------------------------------ *
 * RJ-4: 취소 체크포인트 — 모든 핸들러가 최소 1회 확인한다.
 * ------------------------------------------------------------------ */

/**
 * 핸들러가 루프를 서비스에 위임하면 체크포인트도 그 서비스에 있다.
 * 위임 대상은 여기에 명시해 두고, 아래에서 해당 서비스의 체크포인트를 따로 강제한다.
 */
const HANDLER_CHECKPOINT_DELEGATES: Record<string, RegExp> = {
  'thumbnailHandlers.ts': /ThumbnailRegenerationService\.regenerateAllThumbnails\(ctx\)/,
  'folderScanHandlers.ts': /FolderScanService\.scanAllFolders\(ctx\)/,
}

for (const [label, source] of handlerSources) {
  const delegate = HANDLER_CHECKPOINT_DELEGATES[label]
  assert.ok(
    /throwIfCancelled/.test(source) || (delegate !== undefined && delegate.test(source)),
    `${label} must reach a cancellation checkpoint, or a started job can never be stopped`,
  )
}

assert.match(
  readSource('services', 'folderScan', 'index.ts'),
  /ctx\?\.throwIfCancelled\(\)/,
  'scanAllFolders must check cancellation at folder boundaries',
)
assert.match(
  thumbnailServiceSource,
  /ctx\.throwIfCancelled\(\)/,
  'thumbnail regeneration must check cancellation between batches',
)
assert.doesNotMatch(
  thumbnailServiceSource,
  /private static isRunning/,
  'the thumbnail service must not keep a static running flag: the partial unique index replaced that TOCTOU check',
)

assert.match(
  runnerSource,
  /const updated = RuntimeJobStore\.requestCancel\(jobId\)[\s\S]*?controller\.abort\(/,
  'cancellation must write the DB flag first and only then abort the in-process controller',
)

/* ------------------------------------------------------------------ *
 * RJ-5: 실패 코드 3종이 존재한다.
 * ------------------------------------------------------------------ */

for (const failureCode of ['process_restarted', 'worker_lost', 'cancelled', 'handler_error']) {
  assert.ok(typesSource.includes(`'${failureCode}'`), `runtimeJob.ts must declare the "${failureCode}" failure code`)
}
assert.match(storeSource, /RUNTIME_JOB_FAILURE_CODES\.workerLost/, 'the stale sweeper must record worker_lost')
assert.match(storeSource, /RUNTIME_JOB_FAILURE_CODES\.processRestarted/, 'startup recovery must record process_restarted')

/* ------------------------------------------------------------------ *
 * RJ-6: 테이블 재구축은 모든 컬럼을 실어야 한다.
 *
 * generation_queue_jobs 의 CHECK 재구축 블록이 컬럼 하나를 빠뜨리면 그 컬럼 데이터가 조용히
 * 사라진다. runtime_jobs 를 같은 파일에 추가하는 이상, 이 위험을 계약으로 고정해 둔다.
 * ------------------------------------------------------------------ */

function assertRebuildCarriesEveryColumn(tableName: string) {
  const rebuildInsert = new RegExp(`INSERT INTO ${tableName} \\(([\\s\\S]*?)\\)\\s*SELECT([\\s\\S]*?)FROM ${tableName}_legacy`, 'g')
  const matches = [...userSettingsSchemaSource.matchAll(rebuildInsert)]

  for (const match of matches) {
    const insertColumns = match[1].split(',').map((entry) => entry.trim()).filter(Boolean).sort()
    const selectColumns = match[2].split(',').map((entry) => entry.trim()).filter(Boolean).sort()
    assert.deepEqual(
      selectColumns,
      insertColumns,
      `${tableName} rebuild must SELECT exactly the columns it INSERTs, or data is dropped during the migration`,
    )
  }

  return matches.length
}

const generationQueueRebuildCount = assertRebuildCarriesEveryColumn('generation_queue_jobs')
assert.ok(generationQueueRebuildCount >= 1, 'the generation queue rebuild block must stay covered by this check')

/* ------------------------------------------------------------------ *
 * RJ-7: 동적 스모크 — 임시 user.db 위에서 실제 저장소 동작을 확인한다.
 * ------------------------------------------------------------------ */

async function runStoreSmoke() {
  const { initializeUserSettingsDb, closeUserSettingsDb, getUserSettingsDb } = await import('../database/userSettingsDb')
  const { RuntimeJobStore, RuntimeJobConflictError } = await import('../services/runtimeJobs/runtimeJobStore')

  initializeUserSettingsDb()

  try {
    const db = getUserSettingsDb()
    const columns = new Set(
      (db.prepare('PRAGMA table_info(runtime_jobs)').all() as Array<{ name: string }>).map((column) => column.name),
    )
    for (const requiredColumn of [
      'job_id', 'kind', 'status', 'phase', 'params', 'total', 'processed', 'succeeded', 'failed', 'skipped',
      'current_label', 'message', 'result', 'errors', 'warnings', 'failure_code', 'failure_message',
      'cancel_requested', 'singleton_key', 'owner_role', 'owner_pid', 'requested_by_account_id',
      'heartbeat_at', 'queued_at', 'started_at', 'completed_at', 'created_date', 'updated_date',
    ]) {
      assert.ok(columns.has(requiredColumn), `runtime_jobs must expose the "${requiredColumn}" column`)
    }

    // 부분 유니크 인덱스가 동시 시작을 DB 레벨에서 막는다.
    const first = RuntimeJobStore.create({ kind: 'thumbnail-regenerate', singletonKey: 'thumbnail-regenerate' })
    assert.equal(first.status, 'queued')
    assert.equal(first.progress.percentage, 0)
    assert.throws(
      () => RuntimeJobStore.create({ kind: 'thumbnail-regenerate', singletonKey: 'thumbnail-regenerate' }),
      RuntimeJobConflictError,
      'a second live job with the same singleton key must be rejected by the database, not by an app-level flag',
    )

    RuntimeJobStore.markRunning(first.jobId, 'all', { total: 4, processed: 0 })
    RuntimeJobStore.patchProgress(first.jobId, { processed: 1, succeeded: 1, currentLabel: 'batch-1' })
    const midway = RuntimeJobStore.get(first.jobId)
    assert.ok(midway)
    assert.equal(midway.status, 'running')
    assert.equal(midway.progress.percentage, 25, 'percentage must be derived from processed/total on every read')
    assert.equal(midway.progress.currentLabel, 'batch-1')

    RuntimeJobStore.appendError(first.jobId, 'hash-1', 'boom')
    assert.deepEqual(RuntimeJobStore.get(first.jobId)?.errors, [{ target: 'hash-1', error: 'boom' }])

    assert.equal(RuntimeJobStore.isCancelRequested(first.jobId), false)
    RuntimeJobStore.requestCancel(first.jobId)
    assert.equal(RuntimeJobStore.isCancelRequested(first.jobId), true)
    RuntimeJobStore.markCancelled(first.jobId, 'stopped')
    const cancelled = RuntimeJobStore.get(first.jobId)
    assert.equal(cancelled?.status, 'cancelled')
    assert.equal(cancelled?.failureCode, 'cancelled')
    assert.equal(cancelled?.progress.processed, 1, 'a cancelled job must keep the work it already finished')

    // 같은 키를 다시 쓸 수 있어야 한다 — 종료된 잡은 부분 인덱스에서 빠지기 때문이다.
    const second = RuntimeJobStore.create({ kind: 'thumbnail-regenerate', singletonKey: 'thumbnail-regenerate' })
    RuntimeJobStore.markRunning(second.jobId, 'all', { total: 2 })
    const recovery = RuntimeJobStore.recoverInterruptedJobs()
    assert.equal(recovery.failedRunning, 1, 'a restart must close out running jobs instead of leaving them stuck')
    const recovered = RuntimeJobStore.get(second.jobId)
    assert.equal(recovered?.status, 'failed')
    assert.equal(recovered?.failureCode, 'process_restarted')

    // 하트비트가 끊긴 잡은 스위퍼가 마감한다.
    const stale = RuntimeJobStore.create({ kind: 'folder-scan-all', singletonKey: 'folder-scan-all' })
    RuntimeJobStore.markRunning(stale.jobId, 'subprocess')
    assert.equal(RuntimeJobStore.sweepStaleJobs(600_000), 0, 'a fresh heartbeat must not be swept')
    assert.equal(RuntimeJobStore.sweepStaleJobs(0), 1, 'a lost heartbeat must close the job as worker_lost')
    assert.equal(RuntimeJobStore.get(stale.jobId)?.failureCode, 'worker_lost')

    assert.equal(RuntimeJobStore.list({ status: ['queued', 'running'] }).length, 0)
    assert.ok(RuntimeJobStore.pruneExpired(0) >= 3, 'expired terminal jobs must be deleted')
    assert.equal(RuntimeJobStore.list().length, 0)
  } finally {
    closeUserSettingsDb()
  }
}

runStoreSmoke()
  .then(() => {
    console.log('Runtime job contracts verified.')
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
