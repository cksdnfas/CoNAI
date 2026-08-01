import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { resolveRuntimeSideEffectRole } from '../../startup/runtimeRole'
import { publishRuntimeJobHintEvent } from '../runtime-events/runtimeEventPublishers'
import {
  RUNTIME_JOB_FAILURE_CODES,
  type RuntimeJobKind,
  type RuntimeJobOwnerRole,
  type RuntimeJobProgressPatch,
  type RuntimeJobRecord,
} from '../../types/runtimeJob'
import { RuntimeJobConflictError, RuntimeJobStore } from './runtimeJobStore'

/**
 * 잡 실행 계층.
 *
 * 라우트는 `start()` 한 번으로 202 + jobId 를 즉시 돌려주고, 실행은 이 러너가 소유한다.
 * 진행률/취소/복구는 전부 `runtime_jobs` 테이블을 정본으로 삼는다.
 */

/** 진행률 쓰기 스로틀. WAL 부담을 초당 최대 2회로 묶는다. */
const PROGRESS_THROTTLE_MS = 500
/** 취소 플래그 교차 프로세스 조회 캐시 TTL. */
const CANCEL_CHECK_TTL_MS = 500
/** 핸들러가 오래 조용해도 스위퍼가 오탐하지 않도록 찍는 별도 하트비트 주기. */
const HEARTBEAT_INTERVAL_MS = 30_000
/** 스테일 스위프 / 만료 정리 주기. */
const MAINTENANCE_INTERVAL_MS = 60_000

/** 핸들러가 취소 체크포인트에서 빠져나올 때 던지는 오류. */
export class RuntimeJobCancelledError extends Error {
  constructor(jobId: string) {
    super(`Runtime job ${jobId} was cancelled`)
    this.name = 'RuntimeJobCancelledError'
  }
}

export interface RuntimeJobContext<TParams = Record<string, unknown>> {
  readonly jobId: string
  readonly params: TParams
  /** 표준 AbortSignal. 그래프 실행/큐 취소 레지스트리와 그대로 합성된다. */
  readonly signal: AbortSignal
  /** 진행률 보고. 쓰기 스로틀 내장. */
  report(patch: RuntimeJobProgressPatch): void
  /** 진행률을 스로틀 무시하고 즉시 기록한다. 단계 전환처럼 놓치면 안 되는 지점에서 쓴다. */
  flush(patch?: RuntimeJobProgressPatch): void
  recordError(target: string, error: unknown): void
  recordWarning(warning: string): void
  /** 취소 요청 시 RuntimeJobCancelledError 를 던진다. 항목 루프 선두/배치 경계에서 호출한다. */
  throwIfCancelled(): void
  isCancelRequested(): boolean
  /** 이벤트 루프 양보. 동기 루프가 HTTP 응답을 굶기지 않게 한다. */
  yield(): Promise<void>
}

export interface RuntimeJobHandlerOptions<TParams, TResult> {
  kind: RuntimeJobKind
  /** 같은 키의 live 잡이 있으면 충돌. 기본값 = kind. null 이면 동시 실행 무제한. */
  singletonKey?: (params: TParams) => string | null
  /** 'inline'(기본) | 'subprocess' — subprocess 는 runRuntimeJob 스크립트로 spawn 한다. */
  execution?: 'inline' | 'subprocess'
  handler: (ctx: RuntimeJobContext<TParams>) => Promise<TResult>
}

type RegisteredHandler = RuntimeJobHandlerOptions<any, unknown>

/** 이 프로세스가 실행 중인 잡의 abort 컨트롤러. 없으면 취소는 DB 플래그 경로로만 전파된다. */
const localControllers = new Map<string, AbortController>()
const registry = new Map<RuntimeJobKind, RegisteredHandler>()

let maintenanceHandle: ReturnType<typeof setInterval> | null = null
let isBootstrapped = false

/** 잡 상태 전이를 SSE 채널에 얹는 경량 힌트. 진행률 수치는 절대 싣지 않는다. */
function emitJobHint(job: RuntimeJobRecord | null): void {
  if (!job) {
    return
  }

  publishRuntimeJobHintEvent({
    job_id: job.jobId,
    kind: job.kind,
    status: job.status,
    updated_at: job.updatedAt,
  })
}

function resolveOwnerRole(): RuntimeJobOwnerRole {
  if (process.env.CONAI_RUNTIME_ROLE === 'runtime-job') {
    return 'subprocess'
  }

  return resolveRuntimeSideEffectRole()
}

/** Resolve the node command that runs one job in a child process (built JS first, tsx source second). */
function resolveSubprocessRunnerCommand(): { command: string; args: string[] } {
  const compiledScript = path.resolve(__dirname, '../../scripts/runRuntimeJob.js')
  if (fs.existsSync(compiledScript)) {
    return { command: process.execPath, args: [compiledScript] }
  }

  const sourceScript = path.resolve(__dirname, '../../scripts/runRuntimeJob.ts')
  if (fs.existsSync(sourceScript)) {
    return {
      command: process.execPath,
      args: [path.resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs'), sourceScript],
    }
  }

  throw new Error('Runtime job runner script not found')
}

/** Build the per-job execution context handed to one handler. */
function createJobContext<TParams>(jobId: string, params: TParams, controller: AbortController): RuntimeJobContext<TParams> {
  let lastProgressWriteAt = 0
  let pendingPatch: RuntimeJobProgressPatch | null = null
  let lastCancelCheckAt = 0
  let cachedCancelRequested = false

  const writePending = () => {
    if (!pendingPatch) {
      return
    }

    const patch = pendingPatch
    pendingPatch = null
    lastProgressWriteAt = Date.now()
    RuntimeJobStore.patchProgress(jobId, patch)
  }

  const isCancelRequested = () => {
    if (controller.signal.aborted) {
      return true
    }

    const now = Date.now()
    if (now - lastCancelCheckAt < CANCEL_CHECK_TTL_MS) {
      return cachedCancelRequested
    }

    lastCancelCheckAt = now
    cachedCancelRequested = RuntimeJobStore.isCancelRequested(jobId)
    return cachedCancelRequested
  }

  return {
    jobId,
    params,
    signal: controller.signal,
    report(patch) {
      pendingPatch = { ...(pendingPatch ?? {}), ...patch }
      if (Date.now() - lastProgressWriteAt >= PROGRESS_THROTTLE_MS) {
        writePending()
      }
    },
    flush(patch) {
      if (patch) {
        pendingPatch = { ...(pendingPatch ?? {}), ...patch }
      }
      writePending()
    },
    recordError(target, error) {
      RuntimeJobStore.appendError(jobId, target, error instanceof Error ? error.message : String(error))
    },
    recordWarning(warning) {
      RuntimeJobStore.appendWarning(jobId, warning)
    },
    throwIfCancelled() {
      if (isCancelRequested()) {
        throw new RuntimeJobCancelledError(jobId)
      }
    },
    isCancelRequested,
    async yield() {
      await new Promise<void>((resolve) => setImmediate(resolve))
    },
  }
}

/** Run one registered handler to completion inside this process. */
async function executeJob(job: RuntimeJobRecord, registered: RegisteredHandler, params: unknown): Promise<void> {
  const controller = new AbortController()
  localControllers.set(job.jobId, controller)

  RuntimeJobStore.markRunning(job.jobId, resolveOwnerRole())
  emitJobHint(RuntimeJobStore.get(job.jobId))

  // 항목 하나가 120초를 넘겨도 스위퍼가 잡을 죽이지 않도록 별도 타이머로 하트비트를 찍는다.
  const heartbeatHandle = setInterval(() => {
    RuntimeJobStore.heartbeat(job.jobId)
  }, HEARTBEAT_INTERVAL_MS)
  heartbeatHandle.unref?.()

  const ctx = createJobContext(job.jobId, params, controller)

  try {
    const result = await registered.handler(ctx)
    ctx.flush()
    RuntimeJobStore.markCompleted(job.jobId, result ?? null)
  } catch (error) {
    ctx.flush()
    if (error instanceof RuntimeJobCancelledError || controller.signal.aborted || ctx.isCancelRequested()) {
      // 부분 완료는 롤백하지 않는다. 어디까지 처리했는지는 progress 에 남는다.
      RuntimeJobStore.markCancelled(job.jobId, '사용자 요청으로 작업이 중단되었습니다.')
    } else {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`❌ Runtime job ${job.kind} (${job.jobId}) failed:`, error)
      RuntimeJobStore.markFailed(job.jobId, RUNTIME_JOB_FAILURE_CODES.handlerError, message)
    }
  } finally {
    clearInterval(heartbeatHandle)
    localControllers.delete(job.jobId)
    emitJobHint(RuntimeJobStore.get(job.jobId))
  }
}

/** Spawn one job into a dedicated Node process, preserving the legacy group rematch topology. */
function spawnJobSubprocess(job: RuntimeJobRecord): void {
  const runner = resolveSubprocessRunnerCommand()
  const args = [...runner.args, '--job-id', job.jobId]

  const child = spawn(runner.command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CONAI_RUNTIME_JOB_ID: job.jobId,
      CONAI_RUNTIME_ROLE: 'runtime-job',
    },
    windowsHide: true,
    detached: false,
    stdio: ['ignore', 'inherit', 'inherit'],
  })

  child.unref()

  child.on('error', (error) => {
    RuntimeJobStore.markFailed(job.jobId, RUNTIME_JOB_FAILURE_CODES.handlerError, error.message)
    emitJobHint(RuntimeJobStore.get(job.jobId))
  })

  // 부모가 먼저 죽으면 이 리스너도 사라지지만, 그때는 하트비트 스위퍼가 잡을 마감한다.
  child.on('exit', (code) => {
    if (code === 0) {
      return
    }

    const current = RuntimeJobStore.get(job.jobId)
    if (current && (current.status === 'queued' || current.status === 'running')) {
      RuntimeJobStore.markFailed(
        job.jobId,
        RUNTIME_JOB_FAILURE_CODES.handlerError,
        `작업 프로세스가 코드 ${code ?? 'unknown'} 으로 종료되었습니다.`,
      )
      emitJobHint(RuntimeJobStore.get(job.jobId))
    }
  })
}

export class RuntimeJobRunner {
  /** Register one job kind. 중복 등록은 마지막 정의가 이긴다(핫 리로드 안전). */
  static register<TParams, TResult>(options: RuntimeJobHandlerOptions<TParams, TResult>): void {
    registry.set(options.kind, options as RegisteredHandler)
  }

  static isRegistered(kind: RuntimeJobKind): boolean {
    return registry.has(kind)
  }

  static registeredKinds(): RuntimeJobKind[] {
    return [...registry.keys()]
  }

  /**
   * Create one job row and hand execution to the background.
   * 라우트는 이 반환값을 그대로 202 로 실어 보낸다. 충돌 시 `RuntimeJobConflictError`.
   */
  static start<TParams>(
    kind: RuntimeJobKind,
    params: TParams,
    meta?: { requestedByAccountId?: number | null; total?: number },
  ): RuntimeJobRecord {
    const registered = registry.get(kind)
    if (!registered) {
      throw new Error(`No runtime job handler registered for kind: ${kind}`)
    }

    const singletonKey = registered.singletonKey ? registered.singletonKey(params) : kind
    const job = RuntimeJobStore.create({
      kind,
      params: (params ?? {}) as Record<string, unknown>,
      total: meta?.total,
      singletonKey,
      requestedByAccountId: meta?.requestedByAccountId ?? null,
    })

    emitJobHint(job)

    if (registered.execution === 'subprocess') {
      try {
        spawnJobSubprocess(job)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        RuntimeJobStore.markFailed(job.jobId, RUNTIME_JOB_FAILURE_CODES.handlerError, message)
        emitJobHint(RuntimeJobStore.get(job.jobId))
        throw error
      }

      return job
    }

    void executeJob(job, registered, params).catch((error) => {
      console.error(`❌ Runtime job runner crashed for ${kind}:`, error)
    })

    return job
  }

  /**
   * Execute one already-created job row in this process.
   * subprocess 러너 스크립트 전용 진입점이다.
   */
  static async runExisting(jobId: string): Promise<void> {
    const job = RuntimeJobStore.get(jobId)
    if (!job) {
      throw new Error(`Runtime job not found: ${jobId}`)
    }

    const registered = registry.get(job.kind)
    if (!registered) {
      RuntimeJobStore.markFailed(
        jobId,
        RUNTIME_JOB_FAILURE_CODES.handlerError,
        `No runtime job handler registered for kind: ${job.kind}`,
      )
      throw new Error(`No runtime job handler registered for kind: ${job.kind}`)
    }

    await executeJob(job, registered, this.readParams(jobId))
  }

  /** Read the stored params blob for one job. 깨진 JSON 은 빈 인자로 되돌린다. */
  private static readParams(jobId: string): unknown {
    const raw = RuntimeJobStore.getParamsJson(jobId)
    if (!raw) {
      return {}
    }

    try {
      return JSON.parse(raw)
    } catch {
      return {}
    }
  }

  /**
   * Request cancellation.
   * DB 플래그를 먼저 쓰고(정확성), 이 프로세스에 컨트롤러가 있으면 즉시 abort 한다(지연 최적화).
   */
  static cancel(jobId: string): RuntimeJobRecord | null {
    const updated = RuntimeJobStore.requestCancel(jobId)
    const controller = localControllers.get(jobId)
    if (controller && !controller.signal.aborted) {
      controller.abort(new Error('runtime_job_cancelled'))
    }

    emitJobHint(updated)
    return updated
  }

  /** Report whether this process owns the worker for one job. */
  static ownsJob(jobId: string): boolean {
    return localControllers.has(jobId)
  }

  /**
   * Recover interrupted jobs and start the maintenance timers. 기동 시 1회.
   * 역할과 무관하게 실행해도 안전하다 — 복구가 단일 트랜잭션이기 때문이다.
   */
  static bootstrap(): { cancelled: number; failedQueued: number; failedRunning: number } {
    const recovery = RuntimeJobStore.recoverInterruptedJobs()

    if (!isBootstrapped) {
      isBootstrapped = true
      maintenanceHandle = setInterval(() => {
        try {
          const swept = RuntimeJobStore.sweepStaleJobs()
          if (swept > 0) {
            console.warn(`⚠️  Runtime jobs closed after losing their worker: ${swept}`)
          }
          RuntimeJobStore.pruneExpired()
        } catch (error) {
          console.warn('⚠️  Runtime job maintenance pass failed:', error instanceof Error ? error.message : error)
        }
      }, MAINTENANCE_INTERVAL_MS)
      maintenanceHandle.unref?.()
    }

    RuntimeJobStore.pruneExpired()
    console.log(
      `🧾 Runtime job runner ready (recovered_cancelled=${recovery.cancelled}, recovered_queued=${recovery.failedQueued}, recovered_running=${recovery.failedRunning})`,
    )
    return recovery
  }

  /**
   * Stop timers, abort in-process handlers, and record every still-running job as interrupted.
   *
   * **DB 를 닫기 전에** 호출되어야 한다. 그렇지 않으면 다음 기동의 복구 루틴이 돌 때까지
   * 잡이 running 으로 남아 클라이언트가 계속 폴링한다.
   */
  static shutdown(): number {
    if (maintenanceHandle) {
      clearInterval(maintenanceHandle)
      maintenanceHandle = null
    }
    isBootstrapped = false

    const ownedJobIds = [...localControllers.keys()]
    for (const controller of localControllers.values()) {
      if (!controller.signal.aborted) {
        controller.abort(new Error('runtime_job_runner_shutdown'))
      }
    }
    localControllers.clear()

    return RuntimeJobStore.markOwnedJobsInterrupted(ownedJobIds)
  }
}
