import { randomUUID } from 'crypto'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import {
  RUNTIME_JOB_ERROR_LIMIT,
  RUNTIME_JOB_FAILURE_CODES,
  RUNTIME_JOB_RESULT_MAX_BYTES,
  resolveRuntimeJobPercentage,
  type RuntimeJobError,
  type RuntimeJobKind,
  type RuntimeJobOwnerRole,
  type RuntimeJobProgressPatch,
  type RuntimeJobRecord,
  type RuntimeJobStatus,
} from '../../types/runtimeJob'

/**
 * `runtime_jobs` 영속 계층.
 *
 * 인메모리 Map 이 아니라 테이블을 쓰는 이유는 세 가지다.
 * 1. 재시작 내구성 — 중단된 잡을 "조용히 사라짐" 이 아니라 `process_restarted` 로 **기록**할 수 있다.
 * 2. 하트비트 스위프 — 실행 프로세스가 죽어도 잡이 영구 running 으로 고착되지 않는다.
 * 3. 부분 유니크 인덱스 — "실행 중인지 확인 후 시작" 의 TOCTOU 창이 DB 제약으로 대체된다.
 */

/** 하트비트가 이 시간 이상 끊긴 running 잡은 워커가 사라졌다고 본다. */
export const RUNTIME_JOB_STALE_AFTER_MS = 120_000
/** 종료된 잡을 보관하는 기간. 기존 group rematch 파일 TTL 과 같다. */
export const RUNTIME_JOB_TTL_MS = 24 * 60 * 60 * 1000

/** singleton_key 충돌. 라우트는 이 오류에서 살아있는 잡 레코드를 꺼내 응답에 싣는다. */
export class RuntimeJobConflictError extends Error {
  readonly liveJob: RuntimeJobRecord | null

  constructor(kind: RuntimeJobKind, liveJob: RuntimeJobRecord | null) {
    super(`Runtime job of kind "${kind}" is already running`)
    this.name = 'RuntimeJobConflictError'
    this.liveJob = liveJob
  }
}

interface RuntimeJobRow {
  job_id: string
  kind: string
  status: string
  phase: string | null
  params: string
  total: number
  processed: number
  succeeded: number
  failed: number
  skipped: number
  current_label: string | null
  message: string | null
  result: string | null
  errors: string
  warnings: string
  failure_code: string | null
  failure_message: string | null
  cancel_requested: number
  singleton_key: string | null
  owner_role: string | null
  owner_pid: number | null
  requested_by_account_id: number | null
  heartbeat_at: string | null
  queued_at: string | null
  started_at: string | null
  completed_at: string | null
  created_date: string | null
  updated_date: string | null
}

/** 잡 소유권 확인에 필요한 최소 필드만 담은 경량 뷰. */
export interface RuntimeJobOwnership {
  jobId: string
  requestedByAccountId: number | null
}

function nowIso(): string {
  return new Date().toISOString()
}

/** JSON 컬럼 파싱은 절대 throw 하지 않는다. 한 행이 깨져도 목록 조회가 500이 되면 안 된다. */
function parseJsonColumn<T>(raw: string | null, fallback: T): T {
  if (!raw) {
    return fallback
  }

  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** 64KB 를 넘는 result 는 저장하지 않고 크기만 남긴다. 잡 하나가 user.db 를 부풀리지 않게 한다. */
function serializeResult(result: unknown): string | null {
  if (result === undefined || result === null) {
    return null
  }

  let serialized: string
  try {
    serialized = JSON.stringify(result)
  } catch {
    return JSON.stringify({ truncated: true, reason: 'unserializable' })
  }

  if (typeof serialized !== 'string') {
    return null
  }

  if (Buffer.byteLength(serialized, 'utf8') > RUNTIME_JOB_RESULT_MAX_BYTES) {
    return JSON.stringify({ truncated: true, byte_length: Buffer.byteLength(serialized, 'utf8') })
  }

  return serialized
}

function mapRow(row: RuntimeJobRow): RuntimeJobRecord {
  const total = Math.max(0, row.total ?? 0)
  const processed = Math.max(0, row.processed ?? 0)

  return {
    jobId: row.job_id,
    kind: row.kind as RuntimeJobKind,
    status: row.status as RuntimeJobStatus,
    phase: row.phase,
    progress: {
      total,
      processed,
      succeeded: Math.max(0, row.succeeded ?? 0),
      failed: Math.max(0, row.failed ?? 0),
      skipped: Math.max(0, row.skipped ?? 0),
      percentage: resolveRuntimeJobPercentage(total, processed),
      currentLabel: row.current_label,
    },
    message: row.message,
    result: parseJsonColumn<unknown>(row.result, null),
    errors: parseJsonColumn<RuntimeJobError[]>(row.errors, []),
    warnings: parseJsonColumn<string[]>(row.warnings, []),
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    cancelRequested: (row.cancel_requested ?? 0) > 0,
    queuedAt: row.queued_at ?? row.created_date ?? nowIso(),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_date ?? row.created_date ?? nowIso(),
  }
}

/** 진행률 패치를 SET 절 + 바인딩으로 변환한다. 정의된 필드만 쓴다. */
function buildProgressAssignments(patch: RuntimeJobProgressPatch | undefined): { clauses: string[]; values: unknown[] } {
  const clauses: string[] = []
  const values: unknown[] = []

  if (!patch) {
    return { clauses, values }
  }

  const numericColumns: Array<[keyof RuntimeJobProgressPatch, string]> = [
    ['total', 'total'],
    ['processed', 'processed'],
    ['succeeded', 'succeeded'],
    ['failed', 'failed'],
    ['skipped', 'skipped'],
  ]

  for (const [key, column] of numericColumns) {
    const value = patch[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      clauses.push(`${column} = ?`)
      values.push(Math.max(0, Math.floor(value)))
    }
  }

  if (patch.currentLabel !== undefined) {
    clauses.push('current_label = ?')
    values.push(patch.currentLabel)
  }

  if (patch.phase !== undefined) {
    clauses.push('phase = ?')
    values.push(patch.phase)
  }

  if (patch.message !== undefined) {
    clauses.push('message = ?')
    values.push(patch.message)
  }

  return { clauses, values }
}

export class RuntimeJobStore {
  /**
   * Insert one queued job row.
   * singleton_key 충돌은 부분 유니크 인덱스가 잡으며 `RuntimeJobConflictError` 로 번역된다.
   */
  static create(input: {
    kind: RuntimeJobKind
    params?: Record<string, unknown>
    total?: number
    singletonKey?: string | null
    requestedByAccountId?: number | null
  }): RuntimeJobRecord {
    const db = getUserSettingsDb()
    const jobId = randomUUID()
    const singletonKey = input.singletonKey ?? null

    try {
      db.prepare(`
        INSERT INTO runtime_jobs (
          job_id, kind, status, params, total, singleton_key, requested_by_account_id,
          queued_at, created_date, updated_date
        ) VALUES (?, ?, 'queued', ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(
        jobId,
        input.kind,
        JSON.stringify(input.params ?? {}),
        Math.max(0, Math.floor(input.total ?? 0)),
        singletonKey,
        input.requestedByAccountId ?? null,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (singletonKey !== null && /UNIQUE constraint failed/i.test(message)) {
        throw new RuntimeJobConflictError(input.kind, this.findLiveBySingletonKey(singletonKey))
      }
      throw error
    }

    const created = this.get(jobId)
    if (!created) {
      throw new Error(`Runtime job ${jobId} disappeared right after insert`)
    }

    return created
  }

  static get(jobId: string): RuntimeJobRecord | null {
    const db = getUserSettingsDb()
    const row = db.prepare('SELECT * FROM runtime_jobs WHERE job_id = ?').get(jobId) as RuntimeJobRow | undefined
    return row ? mapRow(row) : null
  }

  /** Read only the ownership columns, so access checks never deserialize a 64KB result blob. */
  static getOwnership(jobId: string): RuntimeJobOwnership | null {
    const db = getUserSettingsDb()
    const row = db
      .prepare('SELECT job_id, requested_by_account_id FROM runtime_jobs WHERE job_id = ?')
      .get(jobId) as { job_id: string; requested_by_account_id: number | null } | undefined

    return row ? { jobId: row.job_id, requestedByAccountId: row.requested_by_account_id } : null
  }

  /** Read the raw params blob. subprocess 러너가 실행 인자를 복원할 때 쓴다. */
  static getParamsJson(jobId: string): string | null {
    const db = getUserSettingsDb()
    const row = db.prepare('SELECT params FROM runtime_jobs WHERE job_id = ?').get(jobId) as { params: string } | undefined
    return row?.params ?? null
  }

  static list(filter: {
    kind?: RuntimeJobKind
    status?: RuntimeJobStatus[]
    limit?: number
    /** 지정하면 소유자가 없는 잡 + 이 계정이 시작한 잡만 돌려준다(admin 은 지정하지 않는다). */
    visibleToAccountId?: number | null
  } = {}): RuntimeJobRecord[] {
    const db = getUserSettingsDb()
    const clauses: string[] = []
    const values: unknown[] = []

    if (filter.kind) {
      clauses.push('kind = ?')
      values.push(filter.kind)
    }

    if (filter.status && filter.status.length > 0) {
      clauses.push(`status IN (${filter.status.map(() => '?').join(', ')})`)
      values.push(...filter.status)
    }

    if (filter.visibleToAccountId !== undefined) {
      clauses.push('(requested_by_account_id IS NULL OR requested_by_account_id = ?)')
      values.push(filter.visibleToAccountId)
    }

    const limit = Math.min(200, Math.max(1, Math.floor(filter.limit ?? 50)))
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = db.prepare(`
      SELECT * FROM runtime_jobs
      ${where}
      ORDER BY created_date DESC, job_id DESC
      LIMIT ?
    `).all(...values, limit) as RuntimeJobRow[]

    return rows.map(mapRow)
  }

  /** Read the live job that currently owns one singleton key. */
  static findLiveBySingletonKey(singletonKey: string): RuntimeJobRecord | null {
    const db = getUserSettingsDb()
    const row = db.prepare(`
      SELECT * FROM runtime_jobs
      WHERE singleton_key = ?
        AND status IN ('queued', 'running')
      ORDER BY created_date DESC
      LIMIT 1
    `).get(singletonKey) as RuntimeJobRow | undefined

    return row ? mapRow(row) : null
  }

  /** Read the most recent job of one kind, whatever its status. 레거시 진행률 어댑터가 쓴다. */
  static findLatestByKind(kind: RuntimeJobKind): RuntimeJobRecord | null {
    const db = getUserSettingsDb()
    const row = db.prepare(`
      SELECT * FROM runtime_jobs
      WHERE kind = ?
      ORDER BY created_date DESC, job_id DESC
      LIMIT 1
    `).get(kind) as RuntimeJobRow | undefined

    return row ? mapRow(row) : null
  }

  static markRunning(jobId: string, ownerRole: RuntimeJobOwnerRole, patch?: RuntimeJobProgressPatch): void {
    const db = getUserSettingsDb()
    const { clauses, values } = buildProgressAssignments(patch)

    db.prepare(`
      UPDATE runtime_jobs
      SET status = 'running',
          owner_role = ?,
          owner_pid = ?,
          started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
          heartbeat_at = CURRENT_TIMESTAMP,
          updated_date = CURRENT_TIMESTAMP
          ${clauses.length > 0 ? `, ${clauses.join(', ')}` : ''}
      WHERE job_id = ?
        AND status = 'queued'
    `).run(ownerRole, process.pid, ...values, jobId)
  }

  /**
   * Write one progress patch.
   * 하트비트를 같은 UPDATE 에 실어 쓰기 횟수를 늘리지 않는다(러너가 500ms 로 스로틀한다).
   */
  static patchProgress(jobId: string, patch: RuntimeJobProgressPatch): void {
    const db = getUserSettingsDb()
    const { clauses, values } = buildProgressAssignments(patch)

    db.prepare(`
      UPDATE runtime_jobs
      SET heartbeat_at = CURRENT_TIMESTAMP,
          updated_date = CURRENT_TIMESTAMP
          ${clauses.length > 0 ? `, ${clauses.join(', ')}` : ''}
      WHERE job_id = ?
        AND status IN ('queued', 'running')
    `).run(...values, jobId)
  }

  /** Append one failure entry, keeping only the most recent RUNTIME_JOB_ERROR_LIMIT items. */
  static appendError(jobId: string, target: string, error: string): void {
    const db = getUserSettingsDb()
    const row = db.prepare('SELECT errors FROM runtime_jobs WHERE job_id = ?').get(jobId) as { errors: string } | undefined
    if (!row) {
      return
    }

    const existing = parseJsonColumn<RuntimeJobError[]>(row.errors, [])
    existing.push({ target, error })
    const trimmed = existing.slice(-RUNTIME_JOB_ERROR_LIMIT)

    db.prepare(`
      UPDATE runtime_jobs
      SET errors = ?,
          updated_date = CURRENT_TIMESTAMP
      WHERE job_id = ?
    `).run(JSON.stringify(trimmed), jobId)
  }

  /** Append one warning string. 실패는 아니지만 사용자가 알아야 하는 사건. */
  static appendWarning(jobId: string, warning: string): void {
    const db = getUserSettingsDb()
    const row = db.prepare('SELECT warnings FROM runtime_jobs WHERE job_id = ?').get(jobId) as { warnings: string } | undefined
    if (!row) {
      return
    }

    const existing = parseJsonColumn<string[]>(row.warnings, [])
    existing.push(warning)

    db.prepare(`
      UPDATE runtime_jobs
      SET warnings = ?,
          updated_date = CURRENT_TIMESTAMP
      WHERE job_id = ?
    `).run(JSON.stringify(existing.slice(-RUNTIME_JOB_ERROR_LIMIT)), jobId)
  }

  static markCompleted(jobId: string, result: unknown, patch?: RuntimeJobProgressPatch): void {
    const db = getUserSettingsDb()
    const { clauses, values } = buildProgressAssignments(patch)

    db.prepare(`
      UPDATE runtime_jobs
      SET status = 'completed',
          result = ?,
          completed_at = CURRENT_TIMESTAMP,
          heartbeat_at = CURRENT_TIMESTAMP,
          updated_date = CURRENT_TIMESTAMP,
          current_label = NULL
          ${clauses.length > 0 ? `, ${clauses.join(', ')}` : ''}
      WHERE job_id = ?
        AND status IN ('queued', 'running')
    `).run(serializeResult(result), ...values, jobId)
  }

  static markFailed(jobId: string, failureCode: string, failureMessage: string, patch?: RuntimeJobProgressPatch): void {
    const db = getUserSettingsDb()
    const { clauses, values } = buildProgressAssignments(patch)

    db.prepare(`
      UPDATE runtime_jobs
      SET status = 'failed',
          failure_code = ?,
          failure_message = ?,
          completed_at = CURRENT_TIMESTAMP,
          updated_date = CURRENT_TIMESTAMP
          ${clauses.length > 0 ? `, ${clauses.join(', ')}` : ''}
      WHERE job_id = ?
        AND status IN ('queued', 'running')
    `).run(failureCode, failureMessage, ...values, jobId)
  }

  static markCancelled(jobId: string, message: string, patch?: RuntimeJobProgressPatch): void {
    const db = getUserSettingsDb()
    const { clauses, values } = buildProgressAssignments(patch)

    db.prepare(`
      UPDATE runtime_jobs
      SET status = 'cancelled',
          failure_code = ?,
          failure_message = ?,
          completed_at = CURRENT_TIMESTAMP,
          updated_date = CURRENT_TIMESTAMP
          ${clauses.length > 0 ? `, ${clauses.join(', ')}` : ''}
      WHERE job_id = ?
        AND status IN ('queued', 'running')
    `).run(RUNTIME_JOB_FAILURE_CODES.cancelled, message, ...values, jobId)
  }

  /**
   * Flag one live job for cancellation.
   * 큐 취소 프로토콜과 같은 순서다 — DB 플래그를 **먼저** 쓰고, 인프로세스 abort 는 지연 최적화일 뿐이다.
   */
  static requestCancel(jobId: string): RuntimeJobRecord | null {
    const db = getUserSettingsDb()
    db.prepare(`
      UPDATE runtime_jobs
      SET cancel_requested = 1,
          updated_date = CURRENT_TIMESTAMP
      WHERE job_id = ?
        AND status IN ('queued', 'running')
    `).run(jobId)

    return this.get(jobId)
  }

  /** Lightweight single-column read used by the in-loop cancellation checkpoint. */
  static isCancelRequested(jobId: string): boolean {
    const db = getUserSettingsDb()
    const row = db
      .prepare('SELECT cancel_requested FROM runtime_jobs WHERE job_id = ?')
      .get(jobId) as { cancel_requested: number } | undefined

    return (row?.cancel_requested ?? 0) > 0
  }

  /** Stamp the heartbeat without touching progress. 핸들러가 오래 조용해도 스위퍼 오탐을 막는다. */
  static heartbeat(jobId: string): void {
    const db = getUserSettingsDb()
    db.prepare(`
      UPDATE runtime_jobs
      SET heartbeat_at = CURRENT_TIMESTAMP
      WHERE job_id = ?
        AND status IN ('queued', 'running')
    `).run(jobId)
  }

  /**
   * Close out jobs that a process restart left behind. 기동 시 1회, 단일 트랜잭션.
   *
   * **자동 재개하지 않는다.** 생성 큐 / 그래프 실행 복구와 같은 보수적 정책이다.
   * 다만 `owner_role='subprocess'` 이고 하트비트가 아직 살아 있는 잡은 부모 재시작과 무관하게
   * 계속 돌고 있을 수 있으므로 건드리지 않는다.
   */
  static recoverInterruptedJobs(staleAfterMs: number = RUNTIME_JOB_STALE_AFTER_MS): { cancelled: number; failedQueued: number; failedRunning: number } {
    const db = getUserSettingsDb()
    const staleSeconds = Math.max(1, Math.floor(staleAfterMs / 1000))
    const liveSubprocessClause = `NOT (owner_role = 'subprocess' AND heartbeat_at IS NOT NULL AND heartbeat_at > datetime('now', '-${staleSeconds} seconds'))`

    const recovery = db.transaction(() => {
      const cancelled = db.prepare(`
        UPDATE runtime_jobs
        SET status = 'cancelled',
            failure_code = ?,
            failure_message = ?,
            completed_at = CURRENT_TIMESTAMP,
            updated_date = CURRENT_TIMESTAMP
        WHERE status = 'queued'
          AND cancel_requested = 1
      `).run(
        RUNTIME_JOB_FAILURE_CODES.cancelled,
        '취소 요청된 작업이 시작되기 전에 백엔드가 재시작되었습니다.',
      ).changes

      const failedQueued = db.prepare(`
        UPDATE runtime_jobs
        SET status = 'failed',
            failure_code = ?,
            failure_message = ?,
            completed_at = CURRENT_TIMESTAMP,
            updated_date = CURRENT_TIMESTAMP
        WHERE status = 'queued'
          AND ${liveSubprocessClause}
      `).run(
        RUNTIME_JOB_FAILURE_CODES.processRestarted,
        '백엔드가 재시작되어 대기 중이던 작업이 취소되었습니다. 다시 실행해 주세요.',
      ).changes

      const failedRunning = db.prepare(`
        UPDATE runtime_jobs
        SET status = 'failed',
            failure_code = ?,
            failure_message = ?,
            completed_at = CURRENT_TIMESTAMP,
            updated_date = CURRENT_TIMESTAMP
        WHERE status = 'running'
          AND ${liveSubprocessClause}
      `).run(
        RUNTIME_JOB_FAILURE_CODES.processRestarted,
        '백엔드가 재시작되어 작업이 중단되었습니다. 다시 실행해 주세요.',
      ).changes

      return { cancelled, failedQueued, failedRunning }
    })

    return recovery()
  }

  /**
   * Close out jobs whose worker stopped stamping its heartbeat.
   * G3(영구 running 고착)과 G4(자식 크래시 미감지)를 함께 해소한다.
   */
  static sweepStaleJobs(staleAfterMs: number = RUNTIME_JOB_STALE_AFTER_MS): number {
    const db = getUserSettingsDb()
    const staleSeconds = Math.max(0, Math.floor(staleAfterMs / 1000))

    return db.prepare(`
      UPDATE runtime_jobs
      SET status = 'failed',
          failure_code = ?,
          failure_message = ?,
          completed_at = CURRENT_TIMESTAMP,
          updated_date = CURRENT_TIMESTAMP
      WHERE status = 'running'
        AND heartbeat_at IS NOT NULL
        AND heartbeat_at <= datetime('now', '-${staleSeconds} seconds')
    `).run(
      RUNTIME_JOB_FAILURE_CODES.workerLost,
      '작업을 실행하던 프로세스의 응답이 끊겨 작업을 종료했습니다. 다시 실행해 주세요.',
    ).changes
  }

  /** Delete finished jobs older than the retention window. */
  static pruneExpired(ttlMs: number = RUNTIME_JOB_TTL_MS): number {
    const db = getUserSettingsDb()
    const ttlSeconds = Math.max(0, Math.floor(ttlMs / 1000))

    return db.prepare(`
      DELETE FROM runtime_jobs
      WHERE status IN ('completed', 'failed', 'cancelled')
        AND COALESCE(completed_at, updated_date) <= datetime('now', '-${ttlSeconds} seconds')
    `).run().changes
  }

  /**
   * Mark every job this process still owns as interrupted, before the DB closes.
   * 셧다운에서 이걸 건너뛰면 다음 기동의 복구 루틴이 돌 때까지 잡이 running 으로 남는다.
   */
  static markOwnedJobsInterrupted(jobIds: string[]): number {
    if (jobIds.length === 0) {
      return 0
    }

    const db = getUserSettingsDb()
    const placeholders = jobIds.map(() => '?').join(', ')

    return db.prepare(`
      UPDATE runtime_jobs
      SET status = 'failed',
          failure_code = ?,
          failure_message = ?,
          completed_at = CURRENT_TIMESTAMP,
          updated_date = CURRENT_TIMESTAMP
      WHERE job_id IN (${placeholders})
        AND status IN ('queued', 'running')
    `).run(
      RUNTIME_JOB_FAILURE_CODES.processRestarted,
      '백엔드가 종료되어 작업이 중단되었습니다. 다시 실행해 주세요.',
      ...jobIds,
    ).changes
  }
}
