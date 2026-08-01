/**
 * 프로세스 로컬 취소 시그널 레지스트리.
 *
 * 인메모리 abort 는 **지연 최적화**일 뿐이고, 정확성은 DB의 `cancel_requested` 폴링이 보증한다.
 * `CONAI_RUNTIME_ROLE=api` 분리 모드처럼 소유 워커가 다른 프로세스에 있으면 `abort()` 가
 * `false` 를 돌려주고, 취소는 폴링 주기(2초) + 스테일 스위퍼 경로로 되돌아간다.
 */
export class QueueCancellationRegistry {
  private controllers = new Map<number, AbortController>()

  /** Register the abort controller owned by this process for one claimed job. */
  register(jobId: number) {
    const existing = this.controllers.get(jobId)
    if (existing) {
      return existing
    }

    const controller = new AbortController()
    this.controllers.set(jobId, controller)
    return controller
  }

  /** Read the abort signal for one job, if this process owns its worker. */
  signalFor(jobId: number): AbortSignal | undefined {
    return this.controllers.get(jobId)?.signal
  }

  /** Abort the in-process worker for one job. Returns false when no local worker owns it. */
  abort(jobId: number, reason: string) {
    const controller = this.controllers.get(jobId)
    if (!controller) {
      return false
    }

    if (controller.signal.aborted) {
      return true
    }

    controller.abort(new Error(reason))
    return true
  }

  /** Drop one job's controller once its worker finished. */
  release(jobId: number) {
    this.controllers.delete(jobId)
  }

  /** List jobs whose worker still lives in this process (stale sweeper ownership check). */
  ownedJobIds() {
    return [...this.controllers.keys()]
  }

  /** Abort every locally owned worker, e.g. on service shutdown. */
  abortAll(reason: string) {
    let aborted = 0
    for (const jobId of this.controllers.keys()) {
      if (this.abort(jobId, reason)) {
        aborted += 1
      }
    }
    this.controllers.clear()
    return aborted
  }
}

export const queueCancellationRegistry = new QueueCancellationRegistry()
