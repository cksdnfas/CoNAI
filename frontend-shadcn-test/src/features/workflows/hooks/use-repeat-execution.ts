import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { ComfyUIServer } from '../../../../legacy-src/services/api/comfyuiServerApi'
import type { RepeatConfig } from '../components/repeat-controls'

interface UseRepeatExecutionProps {
  servers: ComfyUIServer[]
  serverStatus: Record<number, { connected: boolean }>
  repeatConfig: RepeatConfig
  handleGenerateOnServer: (serverId: number) => Promise<void>
  handleStartServerRepeat: (serverId: number) => void
  setError: (error: string | null) => void
}

export function useRepeatExecution({
  servers,
  serverStatus,
  repeatConfig,
  handleGenerateOnServer,
  handleStartServerRepeat,
  setError,
}: UseRepeatExecutionProps) {
  const { t } = useTranslation(['workflows'])

  const handleGenerateOnAllServers = useCallback(async () => {
    const connectedServers = servers.filter((server) => serverStatus[server.id]?.connected)

    if (connectedServers.length === 0) {
      setError(t('workflows:generate.noConnectedServers'))
      return
    }

    if (repeatConfig.enabled) {
      connectedServers.forEach((server) => {
        handleStartServerRepeat(server.id)
      })
      return
    }

    await Promise.all(connectedServers.map((server) => handleGenerateOnServer(server.id)))
  }, [handleGenerateOnServer, handleStartServerRepeat, repeatConfig.enabled, serverStatus, servers, setError, t])

  return {
    handleGenerateOnAllServers,
  }
}
