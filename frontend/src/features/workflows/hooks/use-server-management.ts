import { useCallback, useState } from 'react'
import { comfyuiServerApi, type ComfyUIServer } from '@/services/comfyui-server-api'
import type { ServerConnectionStatus, ServerGenerationStatus } from '../types/workflow.types'

export function useServerManagement() {
  const [servers, setServers] = useState<ComfyUIServer[]>([])
  const [serverStatus, setServerStatus] = useState<Record<number, ServerConnectionStatus>>({})
  const [generationStatus, setGenerationStatus] = useState<Record<number, ServerGenerationStatus>>({})

  const testAllServers = useCallback(async (serverList: ComfyUIServer[]) => {
    const results = await Promise.all(
      serverList.map(async (server) => {
        try {
          const startTime = Date.now()
          const response = await comfyuiServerApi.testConnection(server.id)
          const responseTime = Date.now() - startTime

          return {
            serverId: server.id,
            connected: response.data?.isConnected || false,
            responseTime,
          }
        } catch {
          return {
            serverId: server.id,
            connected: false,
            error: 'Connection failed',
          }
        }
      }),
    )

    const statusMap: Record<number, ServerConnectionStatus> = {}
    results.forEach((result) => {
      statusMap[result.serverId] = {
        connected: result.connected,
        responseTime: result.responseTime,
        error: result.error,
      }
    })
    setServerStatus(statusMap)
  }, [])

  const loadServers = useCallback(async () => {
    try {
      const response = await comfyuiServerApi.getAllServers(true)
      const nextServers = response.data || []
      setServers(nextServers)

      const statusMap: Record<number, ServerGenerationStatus> = {}
      nextServers.forEach((server: ComfyUIServer) => {
        statusMap[server.id] = { status: 'idle' }
      })
      setGenerationStatus(statusMap)

      await testAllServers(nextServers)
    } catch (loadError) {
      console.error('Failed to load servers:', loadError)
    }
  }, [testAllServers])

  const getConnectedServers = useCallback(() => {
    return servers.filter((server) => serverStatus[server.id]?.connected)
  }, [serverStatus, servers])

  return {
    servers,
    serverStatus,
    generationStatus,
    setGenerationStatus,
    loadServers,
    getConnectedServers,
  }
}
