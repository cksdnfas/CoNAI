import { getUserSettingsDb } from '../database/userSettingsDb'
import type {
  GenerationQueueCancelOrigin,
  GenerationQueueCancelState,
  GenerationQueueDispatchCandidateRecord,
  GenerationQueueDurationSample,
  GenerationQueueJobCreateData,
  GenerationQueueJobListRecord,
  GenerationQueueJobRecord,
  GenerationQueueJobStatus,
  GenerationQueueJobUpdateData,
  GenerationQueueProviderSubmitState,
  GenerationQueueReconcileCandidate,
} from '../types/generationQueue'
import { buildUpdateQuery, filterDefined, sqlLiteral } from '../utils/dynamicUpdate'

function stringifyPayload(value: Record<string, unknown> | undefined) {
  if (value === undefined) {
    return undefined
  }

  return JSON.stringify(value)
}

function asPlainObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

type QueueDebugColumns = { debug_enabled: number | null; debug_meta: string | null }

/** Read the two debug columns through the covering index, falling back if the index is absent. */
function readQueueDebugColumns(db: ReturnType<typeof getUserSettingsDb>, id: number) {
  if (generationQueueDebugStateIndexUsable) {
    try {
      return db.prepare(`
        SELECT debug_enabled, debug_meta
        FROM generation_queue_jobs INDEXED BY ${GENERATION_QUEUE_DEBUG_STATE_INDEX}
        WHERE id = ?
      `).get(id) as QueueDebugColumns | undefined
    } catch (error) {
      generationQueueDebugStateIndexUsable = false
      console.warn(`⚠️ ${GENERATION_QUEUE_DEBUG_STATE_INDEX} is unavailable; queue debug reads fall back to the wide row:`, error)
    }
  }

  return db.prepare(`
    SELECT debug_enabled, debug_meta
    FROM generation_queue_jobs
    WHERE id = ?
  `).get(id) as QueueDebugColumns | undefined
}

/** Parse one small `debug_meta` JSON object. Never touches the request payload. */
function parseDebugMetaJson(debugMetaJson: string | null) {
  if (!debugMetaJson) {
    return null
  }

  try {
    return asPlainObject(JSON.parse(debugMetaJson) as unknown)
  } catch {
    return null
  }
}

/** Read the enqueue-time debug bag so 029's columns can be seeded without re-parsing the payload later. */
function readCreateDebugSection(payload: Record<string, unknown> | undefined) {
  const debugSection = asPlainObject(payload?._debug)

  return {
    debugEnabled: debugSection !== null
      && (debugSection.workflow_debug_mode === true || debugSection.detailed_snapshots === true)
      ? 1
      : 0,
    // The `_debug` bag is a handful of scalars; serializing it is nothing like
    // serializing the payload it used to live inside.
    debugMeta: debugSection === null ? null : JSON.stringify(debugSection),
  }
}

function toPersistedQueueUpdates(data: GenerationQueueJobUpdateData) {
  return filterDefined({
    ...data,
    request_payload: stringifyPayload(data.request_payload),
    cancel_requested: data.cancel_requested === undefined ? undefined : (data.cancel_requested ? 1 : 0),
    updated_date: sqlLiteral('CURRENT_TIMESTAMP'),
  })
}

type GenerationQueueFilters = {
  statuses?: GenerationQueueJobStatus[]
  serviceType?: GenerationQueueJobRecord['service_type']
  workflowId?: number
  requesterAccountId?: number
  limit?: number
  offset?: number
}

type GenerationQueueFindAllInput = GenerationQueueJobStatus[] | GenerationQueueFilters
type GenerationQueueStatusCountFilters = Pick<GenerationQueueFilters, 'serviceType' | 'workflowId'>
type GenerationQueueRecentCompletedFilters = GenerationQueueStatusCountFilters & { limit?: number }
type GenerationQueueCountFilters = Pick<GenerationQueueFilters, 'statuses' | 'serviceType' | 'workflowId' | 'requesterAccountId'>
type GenerationQueuePayloadPruneInput = {
  retainRecentTerminalJobs?: number
}

export type GenerationQueuePayloadPruneResult = {
  pruned: number
  retainRecentTerminalJobs: number
  compactPayload: string
}

export const DEFAULT_TERMINAL_PAYLOAD_RETAIN_LIMIT = 2000
export const COMPACTED_TERMINAL_REQUEST_PAYLOAD = JSON.stringify({ pruned: true })

const GENERATION_QUEUE_LIST_COLUMNS = `
  id, service_type, status, priority,
  requested_by_account_id, requested_by_account_type,
  workflow_id, workflow_name,
  requested_group_id, requested_server_id, requested_server_tag,
  assigned_server_id, provider_job_id,
  request_summary, failure_code, failure_message,
  cancel_requested, cancel_requested_at, cancel_origin,
  provider_submit_state, provider_submit_started_at,
  provider_cancel_state, submit_attempt_count,
  queued_at, started_at, completed_at,
  created_date, updated_date
`

const GENERATION_QUEUE_RECONCILE_COLUMNS = `
  id, service_type, status, workflow_id, assigned_server_id,
  provider_job_id, provider_submit_state, provider_submit_started_at,
  cancel_requested
`

/** 상류에 작업이 남아 있을 수 있어 reconcile 대상이 되는 제출 상태들. */
const ORPHAN_RECONCILE_SUBMIT_STATES: GenerationQueueProviderSubmitState[] = ['orphan_suspected', 'orphan_unresolved', 'cancel_sent']
const ORPHAN_RECONCILE_SUBMIT_STATE_PLACEHOLDERS = ORPHAN_RECONCILE_SUBMIT_STATES.map(() => '?').join(', ')

const GENERATION_QUEUE_DISPATCH_CANDIDATE_COLUMNS = `
  id, service_type, status, priority,
  workflow_id, requested_server_id, requested_server_tag,
  assigned_server_id, cancel_requested, queued_at
`

const TERMINAL_QUEUE_STATUSES: GenerationQueueJobStatus[] = ['completed', 'failed', 'cancelled']
const TERMINAL_QUEUE_STATUS_PLACEHOLDERS = TERMINAL_QUEUE_STATUSES.map(() => '?').join(', ')

/**
 * PAYLOAD-2: 디버그 상태 읽기용 커버링 인덱스(마이그레이션 029가 생성).
 *
 * `INDEXED BY` 는 취향이 아니라 필수다. `request_payload` 가 행에서 물리적으로 앞에 있어
 * rowid 시크로 뒤쪽 컬럼을 읽으면 멀티 MB 오버플로 페이지 체인을 그대로 걸어야 한다.
 * 5MB 페이로드 행 실측: rowid 시크 3,433us/행 → 커버링 인덱스 2.8us/행.
 * 플래너는 오버플로 비용을 모델링하지 않아 힌트 없이는 항상 rowid 를 고른다.
 */
const GENERATION_QUEUE_DEBUG_STATE_INDEX = 'idx_generation_queue_jobs_debug_state'

/** 인덱스가 없는 DB(마이그레이션 미적용 등)에서 `INDEXED BY` 가 실패하면 한 번만 평문 조회로 내려간다. */
let generationQueueDebugStateIndexUsable = true

/**
 * PAYLOAD-2: 029 이전 행 전용 폴백 프로젝션.
 *
 * 인라인 `_debug` 해석을 SQLite 안에서 끝내므로 멀티 MB `request_payload` 문자열이
 * JS 로 넘어오지 않는다. 이 SQL 은 `debug_enabled IS NULL` 인 행에서만 실행되고,
 * 그런 행은 첫 `updateDebugMeta` 에서 컬럼으로 승격되므로 사실상 1회성이다.
 */
const GENERATION_QUEUE_LEGACY_DEBUG_STATE_COLUMNS = `
  CASE
    WHEN json_valid(request_payload)
      AND (
        json_extract(request_payload, '$._debug.workflow_debug_mode') = 1
        OR json_extract(request_payload, '$._debug.detailed_snapshots') = 1
      )
    THEN 1
    ELSE 0
  END AS debug_enabled,
  CASE
    WHEN json_valid(request_payload) THEN json_extract(request_payload, '$._debug')
    ELSE NULL
  END AS debug_meta
`

type QueueWhereOptions = {
  includeStatuses?: boolean
}

function normalizeFindAllInput(input?: GenerationQueueFindAllInput): GenerationQueueFilters {
  if (Array.isArray(input)) {
    return { statuses: input }
  }

  return input ?? {}
}

function appendQueueFilterClauses(
  clauses: string[],
  values: Array<string | number>,
  filters: GenerationQueueFilters,
  options: QueueWhereOptions = {},
) {
  if (options.includeStatuses !== false && filters.statuses && filters.statuses.length > 0) {
    clauses.push(`status IN (${filters.statuses.map(() => '?').join(', ')})`)
    values.push(...filters.statuses)
  }

  if (filters.serviceType) {
    clauses.push('service_type = ?')
    values.push(filters.serviceType)
  }

  if (filters.workflowId !== undefined) {
    clauses.push('workflow_id = ?')
    values.push(filters.workflowId)
  }

  if (filters.requesterAccountId !== undefined) {
    clauses.push('requested_by_account_id = ?')
    values.push(filters.requesterAccountId)
  }
}

function buildQueueWhereClause(filters: GenerationQueueFilters, options: QueueWhereOptions = {}) {
  const clauses: string[] = []
  const values: Array<string | number> = []
  appendQueueFilterClauses(clauses, values, filters, options)

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    values,
  }
}

function emptyStatusCounts(): Record<GenerationQueueJobStatus, number> {
  return {
    queued: 0,
    dispatching: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  }
}

function getQueueOrderSql(hasStatusFilter: boolean) {
  return hasStatusFilter
    ? 'ORDER BY priority ASC, queued_at ASC, id ASC'
    : `
      ORDER BY
        CASE status
          WHEN 'running' THEN 0
          WHEN 'dispatching' THEN 1
          WHEN 'queued' THEN 2
          ELSE 3
        END ASC,
        priority ASC,
        queued_at ASC,
        id ASC
    `
}

export class GenerationQueueModel {
  /** Create one persistent queue job row. */
  static create(data: GenerationQueueJobCreateData) {
    const db = getUserSettingsDb()
    const queuedAt = data.queued_at ?? new Date().toISOString()
    // PAYLOAD-2: the debug flag/metadata are lifted out of the payload at insert
    // time, so no later stage has to parse the payload just to read them.
    const debugSection = readCreateDebugSection(data.request_payload)
    const info = db.prepare(`
      INSERT INTO generation_queue_jobs (
        service_type, status, priority,
        requested_by_account_id, requested_by_account_type,
        workflow_id, workflow_name,
        requested_group_id, requested_server_id, requested_server_tag, assigned_server_id,
        provider_job_id,
        request_payload, request_summary,
        failure_code, failure_message,
        cancel_requested, cancel_requested_at, cancel_origin,
        provider_submit_state, provider_submit_started_at,
        provider_cancel_state, submit_attempt_count,
        debug_enabled, debug_meta,
        queued_at, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.service_type,
      data.status ?? 'queued',
      data.priority ?? 100,
      data.requested_by_account_id ?? null,
      data.requested_by_account_type ?? null,
      data.workflow_id ?? null,
      data.workflow_name ?? null,
      data.requested_group_id ?? null,
      data.requested_server_id ?? null,
      data.requested_server_tag ?? null,
      data.assigned_server_id ?? null,
      data.provider_job_id ?? null,
      JSON.stringify(data.request_payload),
      data.request_summary ?? null,
      data.failure_code ?? null,
      data.failure_message ?? null,
      data.cancel_requested ? 1 : 0,
      data.cancel_requested_at ?? null,
      data.cancel_origin ?? null,
      data.provider_submit_state ?? 'none',
      data.provider_submit_started_at ?? null,
      data.provider_cancel_state ?? null,
      data.submit_attempt_count ?? 0,
      debugSection.debugEnabled,
      debugSection.debugMeta,
      queuedAt,
      data.started_at ?? null,
      data.completed_at ?? null,
    )

    return info.lastInsertRowid as number
  }

  /** Find one queue job by id. */
  static findById(id: number) {
    const db = getUserSettingsDb()
    const row = db.prepare('SELECT * FROM generation_queue_jobs WHERE id = ?').get(id) as GenerationQueueJobRecord | undefined
    return row ?? null
  }

  /**
   * Read the whole cancellation decision state in one lean SELECT (hot polling path).
   * Executors poll this every 2s, so it must never hydrate the request payload.
   */
  static readCancelState(id: number): GenerationQueueCancelState | null {
    const db = getUserSettingsDb()
    const row = db.prepare(`
      SELECT status, cancel_requested, provider_submit_state, provider_job_id
      FROM generation_queue_jobs
      WHERE id = ?
    `).get(id) as {
      status: GenerationQueueJobStatus
      cancel_requested: number
      provider_submit_state: GenerationQueueProviderSubmitState | null
      provider_job_id: string | null
    } | undefined

    if (!row) {
      return null
    }

    return {
      status: row.status,
      cancelRequested: (row.cancel_requested ?? 0) > 0,
      providerSubmitState: row.provider_submit_state ?? 'none',
      providerJobId: row.provider_job_id ?? null,
    }
  }

  /** Check cancellation flag without hydrating the heavyweight request payload (hot polling path). */
  static isCancelRequested(id: number) {
    return this.readCancelState(id)?.cancelRequested ?? false
  }

  /**
   * Read the debug flag + metadata without hydrating the request payload (PAYLOAD-2).
   *
   * Fast path: two narrow columns answered from `idx_generation_queue_jobs_debug_state`
   * as a covering index, so the wide row (and its payload overflow pages) is never read.
   * Rows written before migration 029 keep working through the legacy statement below,
   * which resolves the inline `_debug` object inside SQLite.
   */
  static readDebugState(id: number) {
    const db = getUserSettingsDb()
    const row = readQueueDebugColumns(db, id)

    if (!row) {
      return null
    }

    if (row.debug_enabled !== null) {
      return {
        debugEnabled: row.debug_enabled > 0,
        debugMetaJson: row.debug_meta ?? null,
      }
    }

    const legacyRow = db.prepare(`
      SELECT ${GENERATION_QUEUE_LEGACY_DEBUG_STATE_COLUMNS}
      FROM generation_queue_jobs
      WHERE id = ?
    `).get(id) as { debug_enabled: number | null; debug_meta: string | null } | undefined

    return {
      debugEnabled: (legacyRow?.debug_enabled ?? 0) > 0,
      // 이미 컬럼에 쓰인 메타가 있으면 그게 우선이다(승격 도중의 행).
      debugMetaJson: row.debug_meta ?? legacyRow?.debug_meta ?? null,
    }
  }

  /** Check whether detailed request snapshots were requested, reading the flag column only. */
  static isDetailedDebugEnabled(id: number) {
    return this.readDebugState(id)?.debugEnabled ?? false
  }

  /** Read the parsed debug metadata bag for one queue job, or null when it has none. */
  static readDebugMeta(id: number) {
    return parseDebugMetaJson(this.readDebugState(id)?.debugMetaJson ?? null)
  }

  /**
   * Merge one patch into the debug metadata column.
   * The old implementation rewrote the whole `request_payload` blob for this;
   * now only a small JSON object is read back and written.
   */
  static updateDebugMeta(id: number, meta: Record<string, unknown>) {
    const db = getUserSettingsDb()
    const current = this.readDebugState(id)
    if (!current) {
      return false
    }

    const currentMeta = parseDebugMetaJson(current.debugMetaJson) ?? {}
    // `debug_enabled` 도 함께 확정해 029 이전 행을 첫 쓰기에서 컬럼 기반으로 승격시킨다.
    // 그래야 이후 읽기가 폴백 SQL(=페이로드 오버플로 페이지 워크)을 두 번 다시 타지 않는다.
    const info = db.prepare(`
      UPDATE generation_queue_jobs
      SET debug_meta = ?,
          debug_enabled = ?,
          updated_date = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(JSON.stringify({ ...currentMeta, ...meta }), current.debugEnabled ? 1 : 0, id)

    return info.changes > 0
  }

  /** Find one queue job for API responses without hydrating heavyweight request payloads. */
  static findListRecordById(id: number) {
    const db = getUserSettingsDb()
    const row = db.prepare(`
      SELECT ${GENERATION_QUEUE_LIST_COLUMNS}
      FROM generation_queue_jobs
      WHERE id = ?
    `).get(id) as GenerationQueueJobListRecord | undefined
    return row ?? null
  }

  /** List full queue jobs, newest queue entries last within status groups. */
  static findAll(input?: GenerationQueueFindAllInput) {
    const db = getUserSettingsDb()
    const filters = normalizeFindAllInput(input)
    const { whereSql, values } = buildQueueWhereClause(filters)
    const orderSql = getQueueOrderSql(Boolean(filters.statuses && filters.statuses.length > 0))
    const limitSql = filters.limit !== undefined ? 'LIMIT ?' : ''
    const offsetSql = filters.limit !== undefined && filters.offset !== undefined ? 'OFFSET ?' : ''
    const pageValues = filters.limit !== undefined
      ? filters.offset !== undefined
        ? [Math.max(1, Math.floor(filters.limit)), Math.max(0, Math.floor(filters.offset))]
        : [Math.max(1, Math.floor(filters.limit))]
      : []

    return db.prepare(`
      SELECT * FROM generation_queue_jobs
      ${whereSql}
      ${orderSql}
      ${limitSql}
      ${offsetSql}
    `).all(...values, ...pageValues) as GenerationQueueJobRecord[]
  }

  /** List queue jobs for polling/UI without hydrating heavyweight request payloads. */
  static findAllListRecords(input?: GenerationQueueFindAllInput) {
    const db = getUserSettingsDb()
    const filters = normalizeFindAllInput(input)
    const { whereSql, values } = buildQueueWhereClause(filters)
    const orderSql = getQueueOrderSql(Boolean(filters.statuses && filters.statuses.length > 0))
    const limitSql = filters.limit !== undefined ? 'LIMIT ?' : ''
    const offsetSql = filters.limit !== undefined && filters.offset !== undefined ? 'OFFSET ?' : ''
    const pageValues = filters.limit !== undefined
      ? filters.offset !== undefined
        ? [Math.max(1, Math.floor(filters.limit)), Math.max(0, Math.floor(filters.offset))]
        : [Math.max(1, Math.floor(filters.limit))]
      : []

    return db.prepare(`
      SELECT ${GENERATION_QUEUE_LIST_COLUMNS}
      FROM generation_queue_jobs
      ${whereSql}
      ${orderSql}
      ${limitSql}
      ${offsetSql}
    `).all(...values, ...pageValues) as GenerationQueueJobListRecord[]
  }

  /** Count queue rows for a list/read filter without hydrating the backlog. */
  static countListRecords(filters: GenerationQueueCountFilters = {}) {
    const db = getUserSettingsDb()
    const { whereSql, values } = buildQueueWhereClause(filters)
    const row = db.prepare(`
      SELECT COUNT(*) as total
      FROM generation_queue_jobs
      ${whereSql}
    `).get(...values) as { total: number } | undefined
    return row?.total ?? 0
  }

  /** Check whether a queued ComfyUI job exists without hydrating queue rows. */
  static hasQueuedComfyJob() {
    const db = getUserSettingsDb()
    const row = db.prepare(`
      SELECT 1 FROM generation_queue_jobs
      WHERE status = 'queued'
        AND service_type = 'comfyui'
        AND cancel_requested = 0
      LIMIT 1
    `).get() as { 1: number } | undefined
    return Boolean(row)
  }

  /** List queued ComfyUI jobs ordered by dispatch priority. */
  static findQueuedComfyJobs() {
    const db = getUserSettingsDb()
    return db.prepare(`
      SELECT * FROM generation_queue_jobs
      WHERE status = 'queued'
        AND service_type = 'comfyui'
        AND cancel_requested = 0
      ORDER BY priority ASC, queued_at ASC, id ASC
    `).all() as GenerationQueueJobRecord[]
  }

  /** List queued ComfyUI dispatch candidates without hydrating heavyweight request payloads. */
  static findQueuedComfyDispatchCandidates(limit = 200) {
    const db = getUserSettingsDb()
    const safeLimit = Math.max(1, Math.floor(limit))
    return db.prepare(`
      SELECT ${GENERATION_QUEUE_DISPATCH_CANDIDATE_COLUMNS}
      FROM generation_queue_jobs
      WHERE status = 'queued'
        AND service_type = 'comfyui'
        AND cancel_requested = 0
      ORDER BY priority ASC, queued_at ASC, id ASC
      LIMIT ?
    `).all(safeLimit) as GenerationQueueDispatchCandidateRecord[]
  }

  /** List lean recent completed queue jobs for ETA sampling without scanning or hydrating whole history. */
  static findRecentCompleted(input: number | GenerationQueueRecentCompletedFilters = 60) {
    const db = getUserSettingsDb()
    const filters: GenerationQueueRecentCompletedFilters = typeof input === 'number'
      ? { limit: input }
      : input
    const limit = Math.max(1, Math.floor(filters.limit ?? 60))
    const clauses = ['status = ?']
    const values: Array<string | number> = ['completed']
    appendQueueFilterClauses(clauses, values, filters, { includeStatuses: false })

    return db.prepare(`
      SELECT
        id, service_type, workflow_id, requested_server_id,
        assigned_server_id, started_at, completed_at
      FROM generation_queue_jobs
      WHERE ${clauses.join(' AND ')}
      ORDER BY completed_at DESC, id DESC
      LIMIT ?
    `).all(...values, limit) as GenerationQueueDurationSample[]
  }

  /**
   * Compact heavyweight request payloads from old terminal queue rows.
   * Queue/history rows stay intact; only already-finished payload JSON is reduced.
   */
  static pruneTerminalRequestPayloads(input: GenerationQueuePayloadPruneInput = {}): GenerationQueuePayloadPruneResult {
    const db = getUserSettingsDb()
    const retainRecentTerminalJobs = Math.max(
      0,
      Math.floor(input.retainRecentTerminalJobs ?? DEFAULT_TERMINAL_PAYLOAD_RETAIN_LIMIT),
    )

    const info = db.prepare(`
      WITH retained_recent AS (
        SELECT id
        FROM generation_queue_jobs
        WHERE status IN (${TERMINAL_QUEUE_STATUS_PLACEHOLDERS})
        ORDER BY COALESCE(completed_at, started_at, queued_at, created_date) DESC, id DESC
        LIMIT ?
      )
      UPDATE generation_queue_jobs
      SET request_payload = ?
      WHERE status IN (${TERMINAL_QUEUE_STATUS_PLACEHOLDERS})
        AND request_payload IS NOT NULL
        AND request_payload != ?
        AND id NOT IN (SELECT id FROM retained_recent)
    `).run(
      ...TERMINAL_QUEUE_STATUSES,
      retainRecentTerminalJobs,
      COMPACTED_TERMINAL_REQUEST_PAYLOAD,
      ...TERMINAL_QUEUE_STATUSES,
      COMPACTED_TERMINAL_REQUEST_PAYLOAD,
    )

    return {
      pruned: info.changes,
      retainRecentTerminalJobs,
      compactPayload: COMPACTED_TERMINAL_REQUEST_PAYLOAD,
    }
  }

  /** Update one queue job row. */
  static update(id: number, data: GenerationQueueJobUpdateData) {
    const db = getUserSettingsDb()
    const updates = toPersistedQueueUpdates(data)

    if (Object.keys(updates).length === 0) {
      return false
    }

    const { sql, values } = buildUpdateQuery('generation_queue_jobs', updates, { id })
    const info = db.prepare(sql).run(...values)
    return info.changes > 0
  }

  /** Update one queue job only if its current status still matches one expected status. */
  static updateIfCurrentStatus(id: number, expectedStatuses: GenerationQueueJobStatus[], data: GenerationQueueJobUpdateData) {
    const db = getUserSettingsDb()
    const updates = toPersistedQueueUpdates(data)

    if (expectedStatuses.length === 0 || Object.keys(updates).length === 0) {
      return false
    }

    const setClauses: string[] = []
    const values: any[] = []
    for (const [key, value] of Object.entries(updates)) {
      if (value && typeof value === 'object' && '__sqlLiteral' in value && value.__sqlLiteral === true) {
        setClauses.push(`${key} = ${value.value}`)
      } else {
        setClauses.push(`${key} = ?`)
        values.push(value)
      }
    }

    const statusPlaceholders = expectedStatuses.map(() => '?').join(', ')
    const sql = `
      UPDATE generation_queue_jobs
      SET ${setClauses.join(', ')}
      WHERE id = ?
        AND status IN (${statusPlaceholders})
    `

    values.push(id, ...expectedStatuses)
    const info = db.prepare(sql).run(...values)
    return info.changes > 0
  }

  /** Mark a queued or running job as cancellation-requested. */
  static requestCancel(id: number) {
    return this.update(id, { cancel_requested: true })
  }

  /** Mark a queue job as cancellation-requested only if its status still matches. */
  static requestCancelIfCurrentStatus(id: number, expectedStatuses: GenerationQueueJobStatus[]) {
    return this.updateIfCurrentStatus(id, expectedStatuses, { cancel_requested: true })
  }

  /**
   * CR-1: 취소의 유일한 진입점인 원자 UPDATE.
   * 업스트림 호출·상태 전이·인메모리 abort 그 어떤 것보다 먼저 실행되어야 한다.
   * `false` 는 실패가 아니라 "이미 terminal 이거나 없는 잡" 이라는 뜻이다(멱등).
   */
  static markCancelRequested(id: number, origin: GenerationQueueCancelOrigin, nowIso = new Date().toISOString()) {
    const db = getUserSettingsDb()
    const info = db.prepare(`
      UPDATE generation_queue_jobs
      SET cancel_requested = 1,
          cancel_requested_at = COALESCE(cancel_requested_at, ?),
          cancel_origin = COALESCE(cancel_origin, ?),
          updated_date = CURRENT_TIMESTAMP
      WHERE id = ?
        AND status IN ('queued', 'dispatching', 'running')
    `).run(nowIso, origin, id)

    return info.changes > 0
  }

  /**
   * PJ-1/PJ-2: 상류 제출 상태를 한 번의 UPDATE로 커밋한다.
   * `expectedStatuses` 를 주면 그 상태일 때만 반영되므로 레이스 중에도 안전하다.
   */
  static markProviderSubmitState(
    id: number,
    state: GenerationQueueProviderSubmitState,
    patch: {
      providerJobId?: string | null
      providerSubmitStartedAt?: string | null
      providerCancelState?: string | null
      assignedServerId?: number | null
      incrementSubmitAttempt?: boolean
      expectedStatuses?: GenerationQueueJobStatus[]
    } = {},
  ) {
    const db = getUserSettingsDb()
    const setClauses = ['provider_submit_state = ?', 'updated_date = CURRENT_TIMESTAMP']
    const values: Array<string | number | null> = [state]

    if (patch.providerJobId !== undefined) {
      setClauses.push('provider_job_id = ?')
      values.push(patch.providerJobId)
    }

    if (patch.providerSubmitStartedAt !== undefined) {
      setClauses.push('provider_submit_started_at = ?')
      values.push(patch.providerSubmitStartedAt)
    }

    if (patch.providerCancelState !== undefined) {
      setClauses.push('provider_cancel_state = ?')
      values.push(patch.providerCancelState)
    }

    if (patch.assignedServerId !== undefined) {
      setClauses.push('assigned_server_id = ?')
      values.push(patch.assignedServerId)
    }

    if (patch.incrementSubmitAttempt) {
      setClauses.push('submit_attempt_count = submit_attempt_count + 1')
    }

    const statusClause = patch.expectedStatuses && patch.expectedStatuses.length > 0
      ? ` AND status IN (${patch.expectedStatuses.map(() => '?').join(', ')})`
      : ''

    values.push(id)
    if (patch.expectedStatuses && patch.expectedStatuses.length > 0) {
      values.push(...patch.expectedStatuses)
    }

    const info = db.prepare(`
      UPDATE generation_queue_jobs
      SET ${setClauses.join(', ')}
      WHERE id = ?${statusClause}
    `).run(...values)

    return info.changes > 0
  }

  /**
   * PJ-2: 상류 응답에서 핸들을 읽은 즉시, await 홉 없이 running/accepted 를 한 번에 커밋한다.
   * 이 UPDATE 가 "상류 작업이 실제로 존재한다"는 유일한 durable 증거다.
   */
  static markProviderAccepted(id: number, providerJobId: string | null, nowIso = new Date().toISOString()) {
    const db = getUserSettingsDb()
    const info = db.prepare(`
      UPDATE generation_queue_jobs
      SET provider_job_id = COALESCE(?, provider_job_id),
          provider_submit_state = 'accepted',
          status = 'running',
          started_at = COALESCE(started_at, ?),
          completed_at = NULL,
          updated_date = CURRENT_TIMESTAMP
      WHERE id = ?
        AND status = 'dispatching'
    `).run(providerJobId && providerJobId.length > 0 ? providerJobId : null, nowIso, id)

    return info.changes > 0
  }

  /** Record the last upstream cancellation outcome without rewriting the request payload. */
  static markProviderCancelState(id: number, cancelState: string) {
    const db = getUserSettingsDb()
    const info = db.prepare(`
      UPDATE generation_queue_jobs
      SET provider_cancel_state = ?,
          updated_date = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(cancelState, id)

    return info.changes > 0
  }

  /** List jobs whose upstream work may still exist so the orphan reconciler can chase them. */
  static findOrphanReconcileCandidates(limit = 50) {
    const db = getUserSettingsDb()
    const safeLimit = Math.max(1, Math.floor(limit))
    return db.prepare(`
      SELECT ${GENERATION_QUEUE_RECONCILE_COLUMNS}
      FROM generation_queue_jobs
      WHERE provider_submit_state IN (${ORPHAN_RECONCILE_SUBMIT_STATE_PLACEHOLDERS})
      LIMIT ?
    `).all(...ORPHAN_RECONCILE_SUBMIT_STATES, safeLimit) as GenerationQueueReconcileCandidate[]
  }

  /**
   * List cancel-requested jobs that no worker confirmed within the grace period.
   * CR-2 로 라우트가 `dispatching`/`running` 을 확정하지 않게 된 이상, 이 스위퍼가 안전망이다.
   */
  static findAbandonedCancellations(staleSeconds: number, limit = 50) {
    const db = getUserSettingsDb()
    const safeStaleSeconds = Math.max(0, Math.floor(staleSeconds))
    const safeLimit = Math.max(1, Math.floor(limit))
    return db.prepare(`
      SELECT ${GENERATION_QUEUE_RECONCILE_COLUMNS}
      FROM generation_queue_jobs
      WHERE cancel_requested = 1
        AND status IN ('dispatching', 'running')
        AND updated_date <= datetime('now', ?)
      ORDER BY id ASC
      LIMIT ?
    `).all(`-${safeStaleSeconds} seconds`, safeLimit) as GenerationQueueReconcileCandidate[]
  }

  /** Check whether a user-submitted generation queue job is waiting or running. */
  static hasActiveUserSubmittedJobs() {
    const db = getUserSettingsDb()
    const row = db.prepare(`
      SELECT 1 AS present
      FROM generation_queue_jobs
      WHERE status IN ('queued', 'dispatching', 'running')
        AND requested_by_account_id IS NOT NULL
        AND cancel_requested = 0
      LIMIT 1
    `).get() as { present: number } | undefined

    return Boolean(row)
  }

  /** Summarize queue totals by status. */
  static getStatusCounts(filters: GenerationQueueStatusCountFilters = {}) {
    const db = getUserSettingsDb()
    const { whereSql, values } = buildQueueWhereClause(filters)
    const rows = db.prepare(`
      SELECT status, COUNT(*) as total
      FROM generation_queue_jobs
      ${whereSql}
      GROUP BY status
    `).all(...values) as Array<{ status: GenerationQueueJobStatus; total: number }>

    const counts = emptyStatusCounts()

    for (const row of rows) {
      counts[row.status] = row.total
    }

    return counts
  }

  /** List jobs visible for one requester. */
  static findByRequester(accountId: number) {
    const db = getUserSettingsDb()
    return db.prepare(`
      SELECT * FROM generation_queue_jobs
      WHERE requested_by_account_id = ?
      ORDER BY queued_at DESC, id DESC
    `).all(accountId) as GenerationQueueJobRecord[]
  }
}
