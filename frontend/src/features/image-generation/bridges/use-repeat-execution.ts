import { useCallback, useEffect, useRef, useState } from 'react'

interface RepeatConfig {
  enabled: boolean
  count: number
  delaySeconds: number
}

interface RepeatState {
  isRunning: boolean
  currentIteration: number
  totalIterations: number
}

interface UseRepeatExecutionOptions {
  onExecute: () => Promise<void>
}

const MAX_SAFE_ITERATIONS = 100

const DEFAULT_REPEAT_CONFIG: RepeatConfig = {
  enabled: false,
  count: 3,
  delaySeconds: 3,
}

const DEFAULT_REPEAT_STATE: RepeatState = {
  isRunning: false,
  currentIteration: 0,
  totalIterations: 0,
}

export function useRepeatExecution({ onExecute }: UseRepeatExecutionOptions) {
  const [repeatConfig, setRepeatConfig] = useState<RepeatConfig>(DEFAULT_REPEAT_CONFIG)
  const [repeatState, setRepeatState] = useState<RepeatState>(DEFAULT_REPEAT_STATE)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopRequestedRef = useRef(false)

  const clearRepeatTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const stopRepeat = useCallback(() => {
    stopRequestedRef.current = true
    clearRepeatTimer()
    setRepeatState(DEFAULT_REPEAT_STATE)
  }, [clearRepeatTimer])

  const startRepeat = useCallback(() => {
    if (!repeatConfig.enabled || repeatState.isRunning) {
      return
    }

    stopRequestedRef.current = false
    const totalIterations = repeatConfig.count === -1 ? -1 : Math.max(repeatConfig.count, 1)
    setRepeatState({
      isRunning: true,
      currentIteration: 0,
      totalIterations,
    })

    const runIteration = async (iteration: number) => {
      if (stopRequestedRef.current) {
        return
      }

      if (iteration >= MAX_SAFE_ITERATIONS) {
        stopRepeat()
        return
      }

      if (totalIterations !== -1 && iteration >= totalIterations) {
        stopRepeat()
        return
      }

      setRepeatState((previous) => ({
        ...previous,
        currentIteration: iteration + 1,
      }))

      clearRepeatTimer()

      try {
        await onExecute()
      } catch {
        stopRepeat()
        return
      }

      if (stopRequestedRef.current) {
        return
      }

      timerRef.current = setTimeout(() => {
        void runIteration(iteration + 1)
      }, Math.max(repeatConfig.delaySeconds, 1) * 1000)
    }

    void runIteration(0)
  }, [clearRepeatTimer, onExecute, repeatConfig.count, repeatConfig.delaySeconds, repeatConfig.enabled, repeatState.isRunning, stopRepeat])

  useEffect(() => {
    return () => {
      stopRequestedRef.current = true
      clearRepeatTimer()
    }
  }, [clearRepeatTimer])

  return {
    repeatConfig,
    repeatState,
    setRepeatConfig,
    startRepeat,
    stopRepeat,
    isRepeatMode: repeatConfig.enabled,
  }
}
