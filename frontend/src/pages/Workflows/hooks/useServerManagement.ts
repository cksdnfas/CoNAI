import { useState } from 'react';
import { comfyuiServerApi, type ComfyUIServer } from '../../../services/api/comfyuiServerApi';
import type { ServerConnectionStatus, ServerGenerationStatus } from '../types/workflow.types';

/**
 * 서버 관리 Hook
 * - 서버 목록 로딩
 * - 서버 연결 상태 관리
 * - 서버 생성 상태 관리
 */
export function useServerManagement() {
  const [servers, setServers] = useState<ComfyUIServer[]>([]);
  const [serverStatus, setServerStatus] = useState<Record<number, ServerConnectionStatus>>({});
  const [generationStatus, setGenerationStatus] = useState<Record<number, ServerGenerationStatus>>({});

  /**
   * 서버 목록 로딩
   */
  const loadServers = async () => {
    try {
      const response = await comfyuiServerApi.getAllServers(true); // activeOnly
      setServers(response.data || []);

      // 각 서버별 상태 초기화
      const statusMap: Record<number, ServerGenerationStatus> = {};
      (response.data || []).forEach((server: ComfyUIServer) => {
        statusMap[server.id] = { status: 'idle' };
      });
      setGenerationStatus(statusMap);

      // 연결 테스트
      testAllServers(response.data || []);
    } catch (err: any) {
      console.error('Failed to load servers:', err);
    }
  };

  /**
   * 모든 서버 연결 테스트
   */
  const testAllServers = async (serverList: ComfyUIServer[]) => {
    const results = await Promise.all(
      serverList.map(async (server) => {
        try {
          const startTime = Date.now();
          const response = await comfyuiServerApi.testConnection(server.id);
          const responseTime = Date.now() - startTime;

          return {
            serverId: server.id,
            connected: response.data?.isConnected || false,
            responseTime
          };
        } catch (err) {
          return {
            serverId: server.id,
            connected: false,
            error: 'Connection failed'
          };
        }
      })
    );

    const statusMap: Record<number, ServerConnectionStatus> = {};
    results.forEach(result => {
      statusMap[result.serverId] = {
        connected: result.connected,
        responseTime: result.responseTime,
        error: result.error
      };
    });
    setServerStatus(statusMap);
  };

  /**
   * 연결된 서버 목록 가져오기
   */
  const getConnectedServers = () => {
    return servers.filter(s => serverStatus[s.id]?.connected);
  };

  return {
    servers,
    serverStatus,
    generationStatus,
    setGenerationStatus,
    loadServers,
    getConnectedServers
  };
}
