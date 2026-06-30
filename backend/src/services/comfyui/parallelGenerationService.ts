import type { ComfyUIBackendType } from '../../types/comfyuiServer';
import type { WorkflowRecord } from '../../types/workflow';
import { ComfyUIService } from '../comfyuiService';

type ParallelServer = {
  id: number;
  name: string;
  endpoint: string;
  backend_type?: ComfyUIBackendType;
  capacity?: number;
};

/**
 * 여러 ComfyUI 서버에서 병렬로 이미지 생성
 */
export class ParallelGenerationService {
  /**
   * 여러 서버에 동시에 이미지 생성 요청
   * @param servers 서버 목록
   * @param workflow 워크플로우 레코드
   * @param promptData 프롬프트 데이터
   * @returns 각 서버의 생성 결과
   */
  static async generateOnMultipleServers(
    servers: ParallelServer[],
    workflow: WorkflowRecord,
    promptData: Record<string, any>
  ): Promise<Array<{
    serverId: number;
    serverName: string;
    success: boolean;
    promptId?: string;
    imagePaths?: string[];
    error?: string;
  }>> {
    const results = await Promise.allSettled(
      servers.map(async (server) => {
        try {
          const comfyService = new ComfyUIService(server.endpoint, {
            backendType: server.backend_type,
            capacity: server.capacity,
          });
          const result = await comfyService.generateImages(workflow, promptData);

          return {
            serverId: server.id,
            serverName: server.name,
            success: true,
            promptId: result.promptId,
            imagePaths: result.imagePaths,
          };
        } catch (error) {
          return {
            serverId: server.id,
            serverName: server.name,
            success: false,
            error: (error as Error).message,
          };
        }
      })
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }

      return {
        serverId: servers[index].id,
        serverName: servers[index].name,
        success: false,
        error: result.reason?.message || 'Unknown error',
      };
    });
  }

  /**
   * 여러 서버에 프롬프트만 제출 (비동기 생성용)
   * @param servers 서버 목록
   * @param workflow 워크플로우 레코드 (미사용, 하위 호환성 유지용)
   * @param promptData Frontend에서 이미 치환된 완전한 ComfyUI workflow 객체
   * @returns 각 서버의 프롬프트 ID
   */
  static async submitToMultipleServers(
    servers: ParallelServer[],
    workflow: WorkflowRecord,
    promptData: Record<string, any>
  ): Promise<Array<{
    serverId: number;
    serverName: string;
    success: boolean;
    promptId?: string;
    error?: string;
  }>> {
    // Frontend에서 이미 완전한 workflow로 치환되어 전송됨
    console.log('🚀 Submitting to multiple servers (pre-substituted from frontend)');

    const results = await Promise.allSettled(
      servers.map(async (server) => {
        try {
          const comfyService = new ComfyUIService(server.endpoint, {
            backendType: server.backend_type,
            capacity: server.capacity,
          });

          // ComfyUI에 프롬프트 제출 (promptData가 이미 완전한 workflow)
          const promptId = comfyService.isModalBackend()
            ? comfyService.createProviderJobId()
            : await comfyService.submitPrompt(promptData);
          if (comfyService.isModalBackend()) {
            await comfyService.runModalWorkflowAndCollectOutputs(promptData, promptId);
          }

          return {
            serverId: server.id,
            serverName: server.name,
            success: true,
            promptId,
          };
        } catch (error) {
          return {
            serverId: server.id,
            serverName: server.name,
            success: false,
            error: (error as Error).message,
          };
        }
      })
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }

      return {
        serverId: servers[index].id,
        serverName: servers[index].name,
        success: false,
        error: result.reason?.message || 'Unknown error',
      };
    });
  }

  /**
   * 여러 서버의 연결 상태 동시 확인
   * @param servers 서버 목록
   * @returns 각 서버의 연결 상태
   */
  static async testMultipleConnections(
    servers: ParallelServer[]
  ): Promise<Array<{
    serverId: number;
    serverName: string;
    isConnected: boolean;
    responseTime?: number;
    error?: string;
  }>> {
    const results = await Promise.allSettled(
      servers.map(async (server) => {
        const startTime = Date.now();
        try {
          if (server.backend_type === 'modal') {
            return {
              serverId: server.id,
              serverName: server.name,
              isConnected: true,
              error: 'Modal connection test skipped to avoid waking the GPU endpoint.',
            };
          }

          const comfyService = new ComfyUIService(server.endpoint, {
            backendType: server.backend_type,
            capacity: server.capacity,
          });
          const isConnected = await comfyService.testConnection();
          const responseTime = Date.now() - startTime;

          return {
            serverId: server.id,
            serverName: server.name,
            isConnected,
            responseTime,
          };
        } catch (error) {
          return {
            serverId: server.id,
            serverName: server.name,
            isConnected: false,
            responseTime: Date.now() - startTime,
            error: (error as Error).message,
          };
        }
      })
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }

      return {
        serverId: servers[index].id,
        serverName: servers[index].name,
        isConnected: false,
        error: result.reason?.message || 'Unknown error',
      };
    });
  }
}
