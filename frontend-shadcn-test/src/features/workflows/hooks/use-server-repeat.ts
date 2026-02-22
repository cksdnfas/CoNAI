import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComfyUIServer } from '../../../../legacy-src/services/api/comfyuiServerApi'
import type { RepeatConfig } from '../components/repeat-controls'
import type { ServerRepeatState } from '../types/workflow.types'

interface UseServerRepeatProps {
  servers: ComfyUIServer[]
  repeatConfig: RepeatConfig
  handleGenerateOnServer: (serverId: number) => Promise<void>
}

export function useServerRepeat({ servers, repeatConfig, handleGenerateOnServer }: UseServerRepeatProps) {
  const [serverRepeatStates, setServerRepeatStates] = useState<Record<number, ServerRepeatState>>({})
  const repeatConfigRef = useRef(repeatConfig)
  const serverRepeatStatesRef = useRef(serverRepeatStates)

  useEffect(() => {
    repeatConfigRef.current = repeatConfig
  }, [repeatConfig])

  useEffect(() => {
    serverRepeatStatesRef.current = serverRepeatStates
  }, [serverRepeatStates])

  const handleStopServerRepeat = useCallback((serverId: number) => {
    setServerRepeatStates((previous) => {
      const state = previous[serverId]
      if (state?.timeoutId) {
        clearTimeout(state.timeoutId)
      }

      const next = { ...previous }
      delete next[serverId]
      return next
    })
  }, [])

  const executeServerGenerationCycle = useCallback(
    async function runCycle(serverId: number, iteration: number) {
      const currentConfig = repeatConfigRef.current
      const currentState = serverRepeatStatesRef.current[serverId]
      if (!currentState || !currentState.isRunning) {
        return
      }

      const maxSafeIterations = 100
      if (iteration >= maxSafeIterations) {
        handleStopServerRepeat(serverId)
        return
      }

      const totalIterations = currentState.totalIterations
      if (totalIterations !== -1 && iteration >= totalIterations) {
        handleStopServerRepeat(serverId)
        return
      }

      setServerRepeatStates((previous) => ({
        ...previous,
        [serverId]: {
          ...previous[serverId],
          currentIteration: iteration,
        },
      }))

      try {
        await handleGenerateOnServer(serverId)

        const latestState = serverRepeatStatesRef.current[serverId]
        if (!latestState || !latestState.isRunning) {
          return
        }

        const nextIteration = iteration + 1
        const shouldContinue = totalIterations === -1 || nextIteration < totalIterations

        if (shouldContinue) {
          const timeoutId = window.setTimeout(() => {
            void runCycle(serverId, nextIteration)
          }, currentConfig.delaySeconds * 1000)

          setServerRepeatStates((previous) => ({
            ...previous,
            [serverId]: {
              ...previous[serverId],
              timeoutId,
            },
          }))
        } else {
          handleStopServerRepeat(serverId)
        }
      } catch {
        handleStopServerRepeat(serverId)
      }
    },
    [handleGenerateOnServer, handleStopServerRepeat],
  )

  const handleStartServerRepeat = useCallback(
    (serverId: number) => {
      const server = servers.find((item) => item.id === serverId)
      if (!server) {
        return
      }

      const newState: ServerRepeatState = {
        isRunning: true,
        currentIteration: 0,
        totalIterations: repeatConfig.count === -1 ? -1 : repeatConfig.count,
        timeoutId: null,
      }

      setServerRepeatStates((previous) => ({
        ...previous,
        [serverId]: newState,
      }))

      serverRepeatStatesRef.current = {
        ...serverRepeatStatesRef.current,
        [serverId]: newState,
      }

      void executeServerGenerationCycle(serverId, 0)
    },
    [executeServerGenerationCycle, repeatConfig.count, servers],
  )

  return {
    serverRepeatStates,
    handleStartServerRepeat,
    handleStopServerRepeat,
  }
}
