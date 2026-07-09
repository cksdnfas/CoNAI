import { settingsService } from '../settingsService'

export type ThrottledServiceType = 'novelai' | 'codex'

type ServiceThrottleState = {
  windowStartedAt: number | null
  startedInWindow: number
  scheduledOffsetsMs: number[]
  scheduleKey: string | null
}

function createInitialServiceThrottleState(): Record<ThrottledServiceType, ServiceThrottleState> {
  return {
    novelai: { windowStartedAt: null, startedInWindow: 0, scheduledOffsetsMs: [], scheduleKey: null },
    codex: { windowStartedAt: null, startedInWindow: 0, scheduledOffsetsMs: [], scheduleKey: null },
  }
}

export class QueueServiceThrottle {
  private state = createInitialServiceThrottleState()

  reset() {
    this.state = createInitialServiceThrottleState()
  }

  getMaxConcurrentJobs(serviceType: ThrottledServiceType) {
    return Math.max(1, this.getServiceThrottleConfig(serviceType).maxConcurrentJobs)
  }

  /** Forecast the next service-level throttle start slots without mutating dispatcher state. */
  getStartDelaySeconds(serviceType: ThrottledServiceType, count: number, now = Date.now()) {
    const safeCount = Math.max(0, Math.floor(count))
    if (safeCount === 0) {
      return []
    }

    const state = this.state[serviceType]
    const durationMs = this.getServiceScheduleDurationMs(serviceType)
    const scheduleKey = this.getServiceScheduleKey(serviceType)
    const windowExpired = state.windowStartedAt !== null && now >= state.windowStartedAt + durationMs
    const windowStartedAt = state.windowStartedAt === null || state.scheduleKey !== scheduleKey || windowExpired
      ? now
      : state.windowStartedAt
    const scheduledOffsetsMs = state.windowStartedAt === null || state.scheduleKey !== scheduleKey || windowExpired
      ? this.buildServiceScheduleOffsetsMs(serviceType)
      : state.scheduledOffsetsMs
    const offsets = scheduledOffsetsMs.length > 0 ? scheduledOffsetsMs : [0]
    const startedInWindow = windowStartedAt === now ? 0 : Math.max(0, state.startedInWindow)

    return Array.from({ length: safeCount }, (_value, index) => {
      const absoluteStartIndex = startedInWindow + index
      const windowOffset = Math.floor(absoluteStartIndex / offsets.length)
      const offsetIndex = absoluteStartIndex % offsets.length
      const startAtMs = windowStartedAt + windowOffset * durationMs + (offsets[offsetIndex] ?? 0)
      return Math.max(0, Math.ceil((startAtMs - now) / 1000))
    })
  }

  isStartDue(serviceType: ThrottledServiceType) {
    const now = Date.now()
    const state = this.state[serviceType]
    const durationMs = this.getServiceScheduleDurationMs(serviceType)
    const scheduleKey = this.getServiceScheduleKey(serviceType)

    if (state.scheduleKey !== scheduleKey || state.windowStartedAt === null) {
      this.resetServiceScheduleWindow(serviceType, now)
    } else if (now >= state.windowStartedAt + durationMs) {
      this.resetServiceScheduleWindow(serviceType, now)
    }

    if (state.startedInWindow >= state.scheduledOffsetsMs.length) {
      return false
    }

    const nextOffsetMs = state.scheduledOffsetsMs[state.startedInWindow] ?? durationMs
    return now >= (state.windowStartedAt ?? now) + nextOffsetMs
  }

  noteStart(serviceType: ThrottledServiceType) {
    this.state[serviceType].startedInWindow += 1
  }

  private getServiceThrottleConfig(serviceType: ThrottledServiceType) {
    const generationThrottle = settingsService.loadSettings().generationThrottle
    return serviceType === 'novelai' ? generationThrottle.novelai : generationThrottle.codex
  }

  private getServiceScheduleDurationMs(serviceType: ThrottledServiceType) {
    const throttle = this.getServiceThrottleConfig(serviceType)
    return Math.max(60_000, Math.round(throttle.scheduleWindowMinutes * 60_000))
  }

  private getServiceScheduleKey(serviceType: ThrottledServiceType) {
    const throttle = this.getServiceThrottleConfig(serviceType)
    return [
      Math.max(60_000, Math.round(throttle.scheduleWindowMinutes * 60_000)),
      Math.max(1, Math.floor(throttle.scheduleJobCount)),
      throttle.scheduleMode,
      Math.max(0, Math.round(throttle.minStartIntervalSeconds * 1000)),
    ].join(':')
  }

  private buildEvenScheduleOffsetsMs(durationMs: number, jobCount: number) {
    const intervalMs = durationMs / jobCount
    return Array.from({ length: jobCount }, (_value, index) => Math.floor(index * intervalMs))
  }

  private buildRandomScheduleOffsetsMs(durationMs: number, jobCount: number, minStartIntervalMs: number) {
    if (jobCount <= 1) {
      return [0]
    }

    const effectiveMinStartIntervalMs = Math.min(
      Math.max(0, minStartIntervalMs),
      Math.floor(durationMs / Math.max(jobCount - 1, 1)),
    )
    const remainingMs = Math.max(0, durationMs - effectiveMinStartIntervalMs * (jobCount - 1))
    const weights = Array.from({ length: jobCount }, () => -Math.log(Math.max(Number.EPSILON, Math.random())))
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1
    const offsets = [0]
    let elapsedMs = 0

    for (let index = 0; index < jobCount - 1; index += 1) {
      const jitterMs = remainingMs * ((weights[index] ?? 0) / totalWeight)
      elapsedMs += effectiveMinStartIntervalMs + jitterMs
      offsets.push(Math.min(durationMs, Math.round(elapsedMs)))
    }

    return offsets
  }

  private buildServiceScheduleOffsetsMs(serviceType: ThrottledServiceType) {
    const throttle = this.getServiceThrottleConfig(serviceType)
    const durationMs = this.getServiceScheduleDurationMs(serviceType)
    const jobCount = Math.max(1, Math.floor(throttle.scheduleJobCount))
    const minStartIntervalMs = Math.max(0, Math.round(throttle.minStartIntervalSeconds * 1000))

    if (throttle.scheduleMode === 'random') {
      return this.buildRandomScheduleOffsetsMs(durationMs, jobCount, minStartIntervalMs)
    }

    return this.buildEvenScheduleOffsetsMs(durationMs, jobCount)
  }

  private resetServiceScheduleWindow(serviceType: ThrottledServiceType, now: number) {
    const state = this.state[serviceType]
    state.windowStartedAt = now
    state.startedInWindow = 0
    state.scheduleKey = this.getServiceScheduleKey(serviceType)
    state.scheduledOffsetsMs = this.buildServiceScheduleOffsetsMs(serviceType)
  }
}
