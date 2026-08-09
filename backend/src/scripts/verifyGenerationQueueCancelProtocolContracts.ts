import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import verifyHelpers from '../../../scripts/verify-helpers'

const runtimeBase = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-queue-cancel-protocol-'))
process.env.RUNTIME_BASE_PATH = runtimeBase
const { createSourceReader, reportVerificationSuccess } = verifyHelpers
// Source contracts must stay independent of CRLF checkouts on Windows.
const readSource = createSourceReader(process.cwd(), { normalizeLineEndings: true })

type QueryPlanRow = { detail: string }

const NEW_CANCEL_PROTOCOL_COLUMNS = [
  'cancel_requested_at',
  'cancel_origin',
  'provider_submit_state',
  'provider_submit_started_at',
  'provider_cancel_state',
  'submit_attempt_count',
]

const CONTRACT_COMFY_ENDPOINT = process.env.CONAI_COMFY_CONTRACT_ENDPOINT ?? 'http://127.0.0.1:8188'

/** win32 는 SQLite/로그 핸들 반환이 늦어 곧바로 지우면 EPERM 이 난다. 정리 실패로 계약을 깨뜨리지 않는다. */
async function removeRuntimeBaseWithRetries(attempts = 10) {
  // 임시 런타임 경로를 지우기 전에 파일 로그 스트림을 먼저 닫는다(닫지 않으면 열기 도중 ENOENT 로 죽는다).
  const { logger } = await import('../utils/logger')
  await new Promise<void>((resolve) => logger.close(resolve))

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.rmSync(runtimeBase, { recursive: true, force: true })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)))
    }
  }

  console.warn(`⚠️ Failed to remove cancel protocol contract temp directory ${runtimeBase}`)
}

/** Extract one `CREATE TABLE generation_queue_jobs (...)` column name set from schema source. */
function extractCreateTableColumns(source: string, fromIndex: number) {
  const createIndex = source.indexOf('CREATE TABLE', fromIndex)
  assert.ok(createIndex >= 0, 'expected another generation_queue_jobs CREATE TABLE copy')
  const openIndex = source.indexOf('(', createIndex)
  let depth = 0
  let closeIndex = -1
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '(') {
      depth += 1
    } else if (source[index] === ')') {
      depth -= 1
      if (depth === 0) {
        closeIndex = index
        break
      }
    }
  }
  assert.ok(closeIndex > openIndex, 'expected a balanced CREATE TABLE body')

  const body = source.slice(openIndex + 1, closeIndex)
  const columns = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/,$/, ''))
    .filter((line) => !/^(FOREIGN KEY|PRIMARY KEY|UNIQUE|CHECK)\b/i.test(line))
    .map((line) => line.split(/\s+/)[0])
    .filter((name) => /^[a-z_][a-z0-9_]*$/i.test(name))

  return { columns, endIndex: closeIndex }
}

function extractColumnList(source: string, marker: string) {
  const markerIndex = source.indexOf(marker)
  assert.ok(markerIndex >= 0, `expected schema source to contain ${marker}`)
  const openIndex = source.indexOf('(', markerIndex)
  const closeIndex = source.indexOf(')', openIndex)
  return source
    .slice(openIndex + 1, closeIndex)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/**
 * R-b: CHECK 재구축 블록이 도는 구 DB 에서 `INSERT ... SELECT` 컬럼 목록이 한 칸이라도
 * 빠지면 조용히 데이터가 사라진다. 세 벌의 CREATE TABLE 사본과 복사 목록이 모두 같아야 한다.
 */
function assertSchemaRebuildPreservesEveryColumn() {
  const schemaSource = readSource('src/database/userSettingsSchema.ts')

  const baseCreate = extractCreateTableColumns(schemaSource, schemaSource.indexOf('CREATE TABLE IF NOT EXISTS generation_queue_jobs'))
  const migrationCreateIndex = schemaSource.indexOf('CREATE TABLE generation_queue_jobs')
  const migrationCreate = extractCreateTableColumns(schemaSource, migrationCreateIndex)
  const rebuildCreate = extractCreateTableColumns(schemaSource, schemaSource.indexOf('CREATE TABLE generation_queue_jobs', migrationCreate.endIndex))

  assert.deepEqual(
    migrationCreate.columns,
    baseCreate.columns,
    'migration CREATE TABLE copy must stay column-identical to the base CREATE TABLE',
  )
  assert.deepEqual(
    rebuildCreate.columns,
    baseCreate.columns,
    'CHECK-rebuild CREATE TABLE copy must stay column-identical to the base CREATE TABLE',
  )

  const insertColumns = extractColumnList(schemaSource, 'INSERT INTO generation_queue_jobs (')
  const selectColumns = schemaSource
    .slice(schemaSource.indexOf('FROM generation_queue_jobs_legacy_codex') - 900, schemaSource.indexOf('FROM generation_queue_jobs_legacy_codex'))
    .split('SELECT')
    .pop()!
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => /^[a-z_][a-z0-9_]*$/i.test(entry))

  assert.deepEqual(
    [...insertColumns].sort(),
    [...baseCreate.columns].sort(),
    'CHECK-rebuild INSERT column list must cover every generation_queue_jobs column (R-b)',
  )
  assert.deepEqual(
    [...selectColumns].sort(),
    [...baseCreate.columns].sort(),
    'CHECK-rebuild SELECT column list must cover every generation_queue_jobs column (R-b)',
  )

  for (const column of NEW_CANCEL_PROTOCOL_COLUMNS) {
    assert.ok(
      schemaSource.includes(`hasColumn('generation_queue_jobs', '${column}')`),
      `existing databases must gain ${column} through an ALTER TABLE migration`,
    )
    assert.ok(
      schemaSource.indexOf(`hasColumn('generation_queue_jobs', '${column}')`) < schemaSource.indexOf('generation_queue_jobs_legacy_codex'),
      `${column} ALTER migration must run before the CHECK rebuild copies rows out of the legacy table`,
    )
  }
}

function assertProtocolSourceContracts() {
  const queueServiceSource = readSource('src/services/generationQueueService.ts')
  const executorsSource = readSource('src/services/generation-queue/queueJobExecutors.ts')
  const comfyServiceSource = readSource('src/services/comfyuiService.ts')
  const naiExecutorSource = readSource('src/services/naiGenerationExecutor.ts')
  const codexExecutorSource = readSource('src/services/codexGenerationExecutor.ts')
  const queueModelSource = readSource('src/models/GenerationQueue.ts')
  const routeSource = readSource('src/routes/generation-queue/queue-action-routes.ts')

  // CR-1: 취소의 첫 DB 쓰기는 반드시 markCancelRequested 여야 한다.
  const requestCancellationBody = queueServiceSource
    .slice(queueServiceSource.indexOf('static async requestCancellation('))
    .split('\n  /**')[0]
  assert.ok(
    requestCancellationBody.indexOf('GenerationQueueModel.markCancelRequested(') > 0,
    'requestCancellation must commit the atomic cancel flag (CR-1)',
  )
  assert.ok(
    requestCancellationBody.indexOf('GenerationQueueModel.markCancelRequested(')
      < requestCancellationBody.indexOf('attemptUpstreamCancellation('),
    'requestCancellation must set cancel_requested before any upstream cancellation call (CR-1)',
  )
  assert.ok(
    requestCancellationBody.indexOf('GenerationQueueModel.markCancelRequested(')
      < requestCancellationBody.indexOf('queueCancellationRegistry.abort('),
    'requestCancellation must set cancel_requested before the in-memory abort (CR-1)',
  )

  // CR-2: dispatching/running 을 라우트가 확정하면 안 된다.
  const cancelTransitions = [...requestCancellationBody.matchAll(/this\.transitionJob\([^)]*'cancelled'[\s\S]{0,220}?\)\n/g)]
  assert.equal(cancelTransitions.length, 1, 'requestCancellation must finalize exactly one status path (CR-2)')
  assert.match(
    cancelTransitions[0][0],
    /expectedCurrentStatuses: \['queued'\]/,
    'requestCancellation must only finalize queued jobs; workers finalize dispatching/running (CR-2)',
  )
  assert.match(
    routeSource,
    /existing\.status === 'queued' \? 'Queue job cancelled' : 'Cancellation requested'/,
    'cancel route must report non-queued cancellations as requested, not finalized (CR-2)',
  )
  assert.doesNotMatch(
    routeSource,
    /changed state before/,
    'cancel route must drop the 409 conflict mapping now that cancellation is idempotent (CR-3/R10)',
  )

  // PJ-1: comfy 경로는 submitPrompt 전에 in_flight 를 커밋해야 한다.
  const comfyExecutorBody = executorsSource.slice(
    executorsSource.indexOf('const result = await executeComfyGeneration({'),
    executorsSource.indexOf('if (workflow.result_view_mode ==='),
  )
  assert.match(
    comfyExecutorBody,
    /onUpstreamSubmitting: \(\) => \{[\s\S]*?markProviderSubmitState\(job\.id, 'in_flight'/,
    'ComfyUI queue path must commit provider_submit_state=in_flight before submitting (PJ-1)',
  )
  assert.match(
    comfyExecutorBody,
    /onPromptAccepted: \(promptId\) => \{[\s\S]*?markProviderAccepted\(job\.id, promptId\)/,
    'ComfyUI queue path must persist the prompt handle through the synchronous accept hook (PJ-2)',
  )
  assert.match(
    comfyExecutorBody,
    /queueJobId: job\.id/,
    'ComfyUI queue path must stamp the CoNAI job marker for /queue reverse matching (PJ-3)',
  )

  // PJ-2: 응답 파싱과 지속 사이에 await 홉이 없어야 한다.
  const submitPromptBody = comfyServiceSource.slice(
    comfyServiceSource.indexOf('async submitPrompt('),
    comfyServiceSource.indexOf('async getHistory('),
  )
  const promptIdIndex = submitPromptBody.indexOf('const promptId = response.data.prompt_id')
  const onAcceptedIndex = submitPromptBody.indexOf('options?.onAccepted?.(promptId)')
  const nodeErrorsIndex = submitPromptBody.indexOf('response.data.node_errors')
  assert.ok(promptIdIndex > 0 && onAcceptedIndex > promptIdIndex, 'submitPrompt must call onAccepted right after reading prompt_id (PJ-2)')
  assert.ok(onAcceptedIndex < nodeErrorsIndex, 'submitPrompt must persist the handle before the node_errors check (PJ-2)')
  assert.doesNotMatch(
    // 설명 주석에 등장하는 await 단어는 계약 대상이 아니므로 걷어내고 본다.
    submitPromptBody.slice(promptIdIndex, onAcceptedIndex).replace(/\/\/[^\n]*/g, ''),
    /await/,
    'no await hop may sit between reading prompt_id and persisting it (PJ-2)',
  )
  assert.match(
    submitPromptBody,
    /extra_data = \{[\s\S]*?\[COMFY_QUEUE_JOB_MARKER_KEY\]: queueJobId/,
    'submitPrompt must inject the CoNAI job marker into extra_data (PJ-3)',
  )

  // GEN-6 회귀 가드: 확인된 매칭 없이는 절대 /interrupt 하지 않는다.
  const cancelPromptBody = comfyServiceSource.slice(
    comfyServiceSource.indexOf('async cancelPrompt('),
    comfyServiceSource.indexOf('* 전체 이미지 생성 프로세스 실행'),
  )
  assert.match(
    cancelPromptBody,
    /const matchedRunning = runningMatch !== null/,
    'matchedRunning must come from a confirmed queue entry match (GEN-6)',
  )
  assert.doesNotMatch(
    cancelPromptBody,
    /matchedRunning = [^\n]*running_count/,
    'matchedRunning must never be derived from a bare running_count (GEN-6)',
  )
  assert.match(
    cancelPromptBody,
    /entry\.conaiQueueJobId === queueJobId/,
    'cancelPrompt must close the GEN-6 gap through CoNAI marker matching (PJ-3/R6)',
  )

  // GEN-8 회귀 가드 + abortable sleep 확장
  assert.match(comfyServiceSource, /await abortableSleep\(backoffMs, options\?\.signal\)/, 'history poll backoff must be abortable (GEN-8)')
  assert.match(comfyServiceSource, /await abortableSleep\(intervalMs, options\?\.signal\)/, 'history poll interval must be abortable (GEN-8)')
  assert.match(comfyServiceSource, /TOLERATED_CONSECUTIVE_HISTORY_POLL_FAILURES/, 'history poll failure tolerance must stay (GEN-8)')
  assert.match(comfyServiceSource, /this\.getHistory\(promptId, HISTORY_POLL_TIMEOUT_MS, options\?\.signal\)/, 'history polls must carry the cancel signal (E-1)')
  assert.match(
    comfyServiceSource,
    /attachComfyAbandonedCancelResult\(\s*new Error\(\s*`ComfyUI history polling failed/,
    'the poll give-up path must report its best-effort cancellation outcome (GEN-8)',
  )
  assert.match(
    executorsSource,
    /resolveComfyAbandonedCancelResult\(error\)[\s\S]*?markProviderSubmitState\(job\.id, cancelConfirmed \? 'cancel_confirmed' : 'orphan_suspected'/,
    'abandoned prompts must be recorded and handed to the orphan reconciler when cancellation is unconfirmed (GEN-8)',
  )

  // GEN-2 회귀 가드 + E-2
  const naiExecuteBody = naiExecutorSource.slice(naiExecutorSource.indexOf('export async function executeNaiGeneration('))
  const submittingIndex = naiExecuteBody.indexOf('onUpstreamSubmitting?.()')
  const postIndex = naiExecuteBody.indexOf('axios.post(')
  const acceptedIndex = naiExecuteBody.indexOf('onUpstreamAccepted?.()')
  assert.ok(submittingIndex > 0 && submittingIndex < postIndex, 'NovelAI must mark the submit intent before POST (GEN-2/PJ-1)')
  assert.ok(acceptedIndex > postIndex, 'NovelAI must mark acceptance after the upstream response (E-2)')
  assert.match(naiExecuteBody, /timeout: 120000,\n\s*signal: options\?\.signal,/, 'NovelAI POST must carry the cancel signal (E-2)')

  // GEN-9 회귀 가드: spawn 내장 timeout 대신 트리 kill 워치독을 쓴다. 취소는 여기에 병기만 한다.
  assert.match(codexExecutorSource, /const CODEX_EXEC_TIMEOUT_MS = 30 \* 60 \* 1000/, 'Codex exec timeout budget must stay (GEN-9)')
  assert.match(codexExecutorSource, /const processTimeout = scheduleCodexProcessTimeout\(child, CODEX_EXEC_TIMEOUT_MS\)/, 'Codex exec must keep its timeout watchdog (GEN-9)')
  assert.match(codexExecutorSource, /killCodexProcessTree\(child, 'SIGTERM'\)/, 'Codex kill must start from SIGTERM so wrappers can clean up (GEN-9)')
  assert.match(codexExecutorSource, /killCodexProcessTree\(child, 'SIGKILL'\)/, 'Codex kill escalation must stay (GEN-9)')
  assert.match(codexExecutorSource, /taskkill', \['\/pid', String\(pid\), '\/T', '\/F'\]/, 'Codex win32 tree kill must stay (GEN-9)')
  assert.match(codexExecutorSource, /const processAbort = bindCodexProcessAbort\(child, options\?\.signal\)/, 'Codex exec must kill its process tree on cancel (E-3)')

  // GEN-3 hot path 회귀 가드
  const readCancelStateBody = queueModelSource.slice(
    queueModelSource.indexOf('static readCancelState('),
    queueModelSource.indexOf('static isCancelRequested('),
  )
  assert.equal((readCancelStateBody.match(/db\.prepare\(/g) ?? []).length, 1, 'readCancelState must stay a single SELECT (GEN-3/CR-4)')
  assert.doesNotMatch(readCancelStateBody, /request_payload/, 'readCancelState must never hydrate request_payload (GEN-3/CR-4)')
  assert.doesNotMatch(
    executorsSource,
    /GenerationQueueModel\.isCancelRequested\(/,
    'queue executors should read the full lean cancel state instead of the boolean-only wrapper (CR-4)',
  )
}

async function readLiveComfyQueue(): Promise<unknown | null> {
  return await new Promise((resolve) => {
    const request = http.get(`${CONTRACT_COMFY_ENDPOINT}/queue`, { timeout: 2000 }, (response) => {
      if (response.statusCode !== 200) {
        response.resume()
        resolve(null)
        return
      }

      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch {
          resolve(null)
        }
      })
    })

    request.on('timeout', () => {
      request.destroy()
      resolve(null)
    })
    request.on('error', () => resolve(null))
  })
}

/**
 * ComfyUI 큐 아이템 튜플 계약을 못 박는다.
 * index 1 = prompt_id, index 3 = extra_data 라는 전제가 PJ-3 마커 역매칭의 근거다.
 * 로컬 ComfyUI 가 살아 있고 running 항목이 있으면 실제 응답으로도 검증한다.
 */
async function assertComfyQueueTupleContract() {
  const { extractComfyQueueEntries, COMFY_QUEUE_JOB_MARKER_KEY } = await import('../services/comfyui/queueState')

  const syntheticResponse = {
    queue_running: [[0, 'running-prompt-id', { '1': {} }, { extra_pnginfo: {}, client_id: 'conai-job-77', create_time: 1, [COMFY_QUEUE_JOB_MARKER_KEY]: 77 }, ['9']]],
    queue_pending: [[1, 'pending-prompt-id', { '1': {} }, { client_id: 'conai-job-78' }, ['9']]],
  }

  const entries = extractComfyQueueEntries(syntheticResponse)
  assert.equal(entries.running[0].promptId, 'running-prompt-id', 'queue tuple index 1 must be the prompt id')
  assert.equal(entries.running[0].conaiQueueJobId, 77, 'queue tuple index 3 must expose the CoNAI job marker (PJ-3)')
  assert.equal(entries.pending[0].conaiQueueJobId, 78, 'client_id must remain a secondary marker fallback for pre-marker jobs')
  assert.equal(entries.pending[0].promptId, 'pending-prompt-id')

  const liveQueue = await readLiveComfyQueue() as { queue_running?: unknown[] } | null
  const liveRunning = Array.isArray(liveQueue?.queue_running) ? liveQueue.queue_running : []
  if (liveRunning.length === 0) {
    reportVerificationSuccess('ℹ️ Live ComfyUI queue_running was empty or unreachable; tuple contract verified against the pinned synthetic shape only')
    return
  }

  const liveEntry = liveRunning[0]
  assert.ok(Array.isArray(liveEntry), 'live /queue running entries must be queue-item tuples')
  assert.equal(typeof liveEntry[1], 'string', 'live /queue running entry index 1 must be the prompt id')
  assert.ok(
    liveEntry[3] !== null && typeof liveEntry[3] === 'object' && !Array.isArray(liveEntry[3]),
    'live /queue running entry index 3 must expose extra_data (PJ-3 premise)',
  )
  reportVerificationSuccess('✅ Live ComfyUI /queue running entry exposes extra_data at index 3')
}

function assertSubmitFailureClassifier(classifySubmitFailure: (error: unknown) => string) {
  assert.equal(classifySubmitFailure(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })), 'not_sent')
  assert.equal(classifySubmitFailure(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })), 'not_sent')
  assert.equal(classifySubmitFailure({ response: { status: 422 } }), 'rejected')
  assert.equal(classifySubmitFailure(new Error('ComfyUI node errors: {"3":{}}')), 'rejected')
  assert.equal(classifySubmitFailure(Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ETIMEDOUT' })), 'ambiguous')
  assert.equal(classifySubmitFailure(Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' })), 'ambiguous')
  assert.equal(classifySubmitFailure(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })), 'ambiguous')
  assert.equal(classifySubmitFailure({ response: { status: 502 } }), 'ambiguous')
  // 래핑된 에러도 원인 체인으로 분류가 유지되어야 한다.
  assert.equal(
    classifySubmitFailure(Object.assign(new Error('ComfyUI API error: connect ECONNREFUSED'), { cause: { code: 'ECONNREFUSED' } })),
    'not_sent',
  )
}

function assertCancellationRegistry(QueueCancellationRegistry: any) {
  const registry = new QueueCancellationRegistry()
  const controller = registry.register(41)
  assert.equal(registry.signalFor(41), controller.signal, 'register should expose the owned signal')
  assert.deepEqual(registry.ownedJobIds(), [41], 'owned job ids should list locally claimed jobs')
  assert.equal(registry.abort(41, 'test'), true, 'abort should report local ownership')
  assert.equal(controller.signal.aborted, true, 'abort should trip the owned signal')
  assert.equal(registry.abort(41, 'test'), true, 'repeated abort must not throw')
  registry.release(41)
  assert.equal(registry.signalFor(41), undefined, 'release should drop the controller')
  assert.equal(registry.abort(41, 'test'), false, 'aborting a released job should report no local owner')
  assert.deepEqual(registry.ownedJobIds(), [], 'released jobs should leave the ownership list')
}

async function main() {
  assertSchemaRebuildPreservesEveryColumn()
  assertProtocolSourceContracts()
  await assertComfyQueueTupleContract()

  const { classifySubmitFailure } = await import('../services/generation-queue/queueSubmitFailureClassifier')
  assertSubmitFailureClassifier(classifySubmitFailure)

  const { QueueCancellationRegistry } = await import('../services/generation-queue/queueCancellationRegistry')
  assertCancellationRegistry(QueueCancellationRegistry)

  const { ensureRuntimeDirectories } = await import('../config/runtimePaths')
  const { initializeUserSettingsDb, getUserSettingsDb, closeUserSettingsDb } = await import('../database/userSettingsDb')
  const { initializeApiGenerationDb } = await import('../database/apiGenerationDb')
  const mainDatabase = await import('../database/init')
  const { GenerationQueueModel } = await import('../models/GenerationQueue')
  const { GenerationQueueService } = await import('../services/generationQueueService')

  ensureRuntimeDirectories()
  initializeUserSettingsDb()
  // 기동 recovery 가 history 를 함께 만지므로 생성 히스토리 DB 도 열어 둔다.
  initializeApiGenerationDb()
  const db = getUserSettingsDb()

  try {
    const columns = db.prepare(`PRAGMA table_info(generation_queue_jobs)`).all() as Array<{ name: string; notnull: number; dflt_value: string | null }>
    const columnsByName = new Map(columns.map((column) => [column.name, column]))
    for (const column of NEW_CANCEL_PROTOCOL_COLUMNS) {
      assert.ok(columnsByName.has(column), `generation_queue_jobs must expose ${column}`)
    }
    assert.equal(columnsByName.get('provider_submit_state')?.notnull, 1, 'provider_submit_state must be NOT NULL')
    assert.equal(columnsByName.get('provider_submit_state')?.dflt_value, `'none'`, "provider_submit_state must default to 'none'")
    assert.equal(columnsByName.get('submit_attempt_count')?.notnull, 1, 'submit_attempt_count must be NOT NULL')

    const indexes = db.prepare(`PRAGMA index_list('generation_queue_jobs')`).all() as Array<{ name: string }>
    assert.ok(
      indexes.some((index) => index.name === 'idx_generation_queue_jobs_orphan_reconcile'),
      'generation queue must index the orphan reconcile scan',
    )

    const reconcilePlan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT id, service_type, status, workflow_id, assigned_server_id,
             provider_job_id, provider_submit_state, provider_submit_started_at,
             cancel_requested
      FROM generation_queue_jobs
      WHERE provider_submit_state IN ('orphan_suspected', 'orphan_unresolved', 'cancel_sent')
      LIMIT 25
    `).all() as QueryPlanRow[]
    assert.ok(
      reconcilePlan.some((row) => row.detail.includes('idx_generation_queue_jobs_orphan_reconcile')),
      `orphan reconcile scan should use its index, got: ${reconcilePlan.map((row) => row.detail).join(' | ')}`,
    )
    assert.ok(
      reconcilePlan.every((row) => !row.detail.includes('USE TEMP B-TREE')),
      `orphan reconcile scan must not sort through a temp B-tree, got: ${reconcilePlan.map((row) => row.detail).join(' | ')}`,
    )

    // R1 회귀 가드: dispatching 잡의 취소 요청은 상태를 확정하지 않는다.
    const dispatchingJobId = GenerationQueueModel.create({
      service_type: 'novelai',
      status: 'dispatching',
      request_payload: { prompt: 'cancel protocol dispatching job' },
    })
    await GenerationQueueService.requestCancellation(dispatchingJobId)

    const afterRequest = GenerationQueueModel.findById(dispatchingJobId)
    assert.equal(afterRequest?.status, 'dispatching', 'cancelling a dispatching job must not finalize it from the route (R1/CR-2)')
    assert.equal(afterRequest?.cancel_requested, 1, 'cancelling a dispatching job must set the durable cancel flag (CR-1)')
    assert.equal(afterRequest?.cancel_origin, 'user', 'cancellation origin must be recorded')
    assert.ok(afterRequest?.cancel_requested_at, 'cancellation request time must be recorded')

    // 멱등성: 두 번째 요청은 예외 없이 통과해야 한다 (R10/CR-3).
    await GenerationQueueService.requestCancellation(dispatchingJobId)
    assert.equal(GenerationQueueModel.findById(dispatchingJobId)?.status, 'dispatching', 'repeated cancellation must stay idempotent (R10)')

    // 스테일 스위퍼가 소유 워커 없는 취소를 확정한다 (5단계).
    const finalized = GenerationQueueService.finalizeAbandonedCancellations({ staleSeconds: 0 })
    assert.ok(finalized >= 1, 'stale sweeper must finalize abandoned cancellations')
    assert.equal(
      GenerationQueueModel.findById(dispatchingJobId)?.status,
      'cancelled',
      'stale sweeper must finalize a cancel-requested dispatching job with no owning worker',
    )

    // queued 는 라우트가 즉시 확정한다 (CR-2).
    const queuedJobId = GenerationQueueModel.create({
      service_type: 'novelai',
      status: 'queued',
      request_payload: { prompt: 'cancel protocol queued job' },
    })
    await GenerationQueueService.requestCancellation(queuedJobId)
    assert.equal(GenerationQueueModel.findById(queuedJobId)?.status, 'cancelled', 'queued jobs must be finalized immediately (CR-2)')

    // in_flight 잡을 취소 확정하면 정리 미완료로 승격된다.
    const inFlightJobId = GenerationQueueModel.create({
      service_type: 'comfyui',
      status: 'dispatching',
      provider_submit_state: 'in_flight',
      provider_submit_started_at: new Date().toISOString(),
      request_payload: { prompt: 'cancel protocol in-flight job' },
    })
    GenerationQueueModel.markCancelRequested(inFlightJobId, 'system')
    GenerationQueueService.finalizeAbandonedCancellations({ staleSeconds: 0 })
    const finalizedInFlight = GenerationQueueModel.findById(inFlightJobId)
    assert.equal(finalizedInFlight?.status, 'cancelled', 'abandoned in-flight cancellation must reach a terminal state')
    assert.equal(
      finalizedInFlight?.provider_submit_state,
      'orphan_unresolved',
      'an in-flight job finalized as cancelled must stay flagged for orphan reconcile',
    )
    assert.ok(
      GenerationQueueModel.findOrphanReconcileCandidates(10).some((candidate) => candidate.id === inFlightJobId),
      'unresolved orphans must remain reconcile candidates',
    )

    // R5/G절: 기동 recovery 는 상류 흔적이 있는 잡을 failed 로 만들지 않는다.
    const restartOrphanJobId = GenerationQueueModel.create({
      service_type: 'comfyui',
      status: 'running',
      provider_submit_state: 'in_flight',
      provider_submit_started_at: new Date().toISOString(),
      request_payload: { prompt: 'cancel protocol restart orphan' },
    })
    const restartCleanJobId = GenerationQueueModel.create({
      service_type: 'comfyui',
      status: 'running',
      request_payload: { prompt: 'cancel protocol restart clean' },
    })

    GenerationQueueService.recoverInterruptedJobs()

    const recoveredOrphan = GenerationQueueModel.findById(restartOrphanJobId)
    assert.equal(recoveredOrphan?.status, 'running', 'restart recovery must not finalize jobs whose upstream work may exist (R5)')
    assert.equal(recoveredOrphan?.provider_submit_state, 'orphan_suspected', 'restart recovery must flag possible orphans for reconcile (R5)')
    assert.equal(recoveredOrphan?.cancel_requested, 1, 'restart recovery must request cancellation for possible orphans (R5)')
    assert.equal(recoveredOrphan?.cancel_origin, 'reconcile', 'restart recovery cancellations must be attributed to reconcile')
    assert.equal(
      GenerationQueueModel.findById(restartCleanJobId)?.status,
      'failed',
      'restart recovery must still fail jobs proven to have no upstream work',
    )

    // readCancelState 가 hot path 계약을 지키는지 실동작으로도 확인한다.
    const cancelState = GenerationQueueModel.readCancelState(restartOrphanJobId)
    assert.deepEqual(
      cancelState,
      { status: 'running', cancelRequested: true, providerSubmitState: 'orphan_suspected', providerJobId: null },
      'readCancelState must return the full lean cancellation snapshot (CR-4)',
    )

    reportVerificationSuccess('✅ Generation queue cancel protocol contracts passed (schema rebuild, CR-1/CR-2, PJ-1/PJ-2/PJ-3, stale sweeper, restart reconcile)')
  } finally {
    GenerationQueueService.stop()
    closeUserSettingsDb()
    try {
      mainDatabase.closeDatabase()
    } catch {
      // 부분 초기화 상태의 정리 실패는 무시한다.
    }
    await removeRuntimeBaseWithRetries()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
