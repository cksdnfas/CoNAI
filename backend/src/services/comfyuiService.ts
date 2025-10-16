import axios, { AxiosInstance } from 'axios';
import * as path from 'path';
import * as fs from 'fs';
import { WorkflowRecord, MarkedField, ComfyUIPromptResponse, ComfyUIHistoryResponse } from '../types/workflow';
import { resolveUploadsPath } from '../config/runtimePaths';

/**
 * ComfyUI API 서비스
 */
export class ComfyUIService {
  private axiosInstance: AxiosInstance;

  constructor(private apiEndpoint: string) {
    this.axiosInstance = axios.create({
      baseURL: apiEndpoint,
      timeout: 30000, // 30초 타임아웃
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * 워크플로우 JSON의 특정 경로에 값 설정
   * @param obj 대상 객체
   * @param path 경로 (예: "6.inputs.text")
   * @param value 설정할 값
   */
  private setValueByPath(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current)) {
        current[key] = {};
      }
      current = current[key];
    }

    current[keys[keys.length - 1]] = value;
  }

  /**
   * 워크플로우 JSON에 프롬프트 데이터 치환
   * @param workflowJson 원본 워크플로우 JSON 문자열
   * @param markedFields 마킹된 필드 배열
   * @param promptData 사용자 입력 프롬프트 데이터
   * @returns 치환된 워크플로우 객체
   */
  substitutePromptData(
    workflowJson: string,
    markedFields: MarkedField[],
    promptData: Record<string, any>
  ): any {
    const workflow = JSON.parse(workflowJson);

    // 각 마킹된 필드에 대해 값 치환
    for (const field of markedFields) {
      const value = promptData[field.id];
      if (value !== undefined && value !== null) {
        this.setValueByPath(workflow, field.jsonPath, value);
      } else if (field.default_value !== undefined) {
        // 사용자 입력이 없으면 기본값 사용
        this.setValueByPath(workflow, field.jsonPath, field.default_value);
      }
    }

    return workflow;
  }

  /**
   * ComfyUI에 프롬프트 제출
   * @param workflow 치환된 워크플로우 객체
   * @returns ComfyUI 프롬프트 ID
   */
  async submitPrompt(workflow: any): Promise<string> {
    try {
      const response = await this.axiosInstance.post<ComfyUIPromptResponse>('/prompt', {
        prompt: workflow
      });

      if (response.data.node_errors && Object.keys(response.data.node_errors).length > 0) {
        throw new Error(`ComfyUI node errors: ${JSON.stringify(response.data.node_errors)}`);
      }

      return response.data.prompt_id;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`ComfyUI API error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * ComfyUI 히스토리 조회
   * @param promptId ComfyUI 프롬프트 ID
   * @returns 히스토리 데이터
   */
  async getHistory(promptId: string): Promise<ComfyUIHistoryResponse> {
    try {
      const response = await this.axiosInstance.get<ComfyUIHistoryResponse>(`/history/${promptId}`);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`ComfyUI history API error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 프롬프트 완료 대기 (폴링)
   * @param promptId ComfyUI 프롬프트 ID
   * @param maxAttempts 최대 시도 횟수 (기본 60회)
   * @param intervalMs 폴링 간격 (기본 2초)
   * @returns 완료된 히스토리 데이터
   */
  async waitForCompletion(
    promptId: string,
    maxAttempts: number = 60,
    intervalMs: number = 2000
  ): Promise<ComfyUIHistoryResponse> {
    for (let i = 0; i < maxAttempts; i++) {
      const history = await this.getHistory(promptId);

      if (history[promptId]) {
        const item = history[promptId];
        if (item.status.completed) {
          return history;
        }
        // 에러가 있는지 확인
        if (item.status.status_str === 'error') {
          throw new Error(`ComfyUI execution error: ${JSON.stringify(item.status.messages)}`);
        }
      }

      // 대기
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error(`ComfyUI execution timeout after ${maxAttempts * intervalMs / 1000} seconds`);
  }

  /**
   * 생성된 이미지 다운로드
   * @param filename 파일명
   * @param subfolder 서브폴더
   * @param type 타입 (output, input, temp)
   * @returns 다운로드된 파일의 로컬 경로
   */
  async downloadImage(filename: string, subfolder: string = '', type: string = 'output'): Promise<string> {
    try {
      // 다운로드 URL 구성
      const params = new URLSearchParams({
        filename,
        subfolder,
        type
      });
      const url = `/view?${params.toString()}`;

      // 이미지 다운로드
      const response = await this.axiosInstance.get(url, {
        responseType: 'arraybuffer'
      });

      // 저장할 경로 생성 (날짜별 폴더)
      const dateFolder = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const uploadDir = resolveUploadsPath(dateFolder);

      // 폴더가 없으면 생성
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      // 고유한 파일명 생성
      const ext = path.extname(filename);
      const uniqueFilename = `comfyui_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${ext}`;
      const relativePath = path.join(dateFolder, uniqueFilename);
      const fullPath = resolveUploadsPath(relativePath);

      // 파일 저장
      fs.writeFileSync(fullPath, Buffer.from(response.data));

      return relativePath; // 상대 경로 반환
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`ComfyUI image download error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 히스토리에서 생성된 이미지 정보 추출
   * @param history ComfyUI 히스토리 응답
   * @param promptId 프롬프트 ID
   * @param onlyFinalImage true면 SaveImage 노드의 이미지만, false면 모든 이미지 (기본값: true)
   * @returns 이미지 파일 정보 배열
   */
  extractImageInfo(
    history: ComfyUIHistoryResponse,
    promptId: string,
    onlyFinalImage: boolean = true
  ): Array<{
    filename: string;
    subfolder: string;
    type: string;
    nodeId: string;
  }> {
    const item = history[promptId];
    if (!item || !item.outputs) {
      return [];
    }

    const allImages: Array<{
      filename: string;
      subfolder: string;
      type: string;
      nodeId: string;
    }> = [];

    // outputs의 모든 노드를 순회하여 이미지 찾기
    for (const nodeId in item.outputs) {
      const output = item.outputs[nodeId];
      if (output.images && Array.isArray(output.images)) {
        output.images.forEach((img: any) => {
          allImages.push({
            ...img,
            nodeId
          });
        });
      }
    }

    // 최종 이미지만 필터링
    if (onlyFinalImage && allImages.length > 0) {
      // SaveImage 노드의 이미지를 우선적으로 선택
      const saveImageNodes = allImages.filter(img => {
        // 노드 class_type 정보가 없으므로, 일반적으로 가장 큰 노드 ID를 가진 것이 최종 출력
        return true;
      });

      // 가장 마지막 노드의 이미지만 반환 (노드 ID가 가장 큰 것)
      const maxNodeId = Math.max(...allImages.map(img => parseInt(img.nodeId)));
      const finalImages = allImages.filter(img => parseInt(img.nodeId) === maxNodeId);

      console.log(`📸 Found ${allImages.length} images, returning ${finalImages.length} final image(s) from node #${maxNodeId}`);
      return finalImages;
    }

    console.log(`📸 Found ${allImages.length} images, returning all`);
    return allImages;
  }

  /**
   * 전체 이미지 생성 프로세스 실행
   * @param workflow 워크플로우 레코드
   * @param promptData 사용자 입력 프롬프트 데이터
   * @returns 생성된 이미지의 로컬 경로 배열
   */
  async generateImages(
    workflow: WorkflowRecord,
    promptData: Record<string, any>
  ): Promise<{ promptId: string; imagePaths: string[] }> {
    // 1. 마킹된 필드 파싱
    const markedFields: MarkedField[] = workflow.marked_fields ?
      JSON.parse(workflow.marked_fields) : [];

    // 2. 워크플로우 JSON에 프롬프트 데이터 치환
    const substitutedWorkflow = this.substitutePromptData(
      workflow.workflow_json,
      markedFields,
      promptData
    );

    // 3. ComfyUI에 프롬프트 제출
    const promptId = await this.submitPrompt(substitutedWorkflow);

    // 4. 완료 대기
    const history = await this.waitForCompletion(promptId);

    // 5. 생성된 이미지 정보 추출
    const imageInfos = this.extractImageInfo(history, promptId);

    if (imageInfos.length === 0) {
      throw new Error('No images generated by ComfyUI');
    }

    // 6. 이미지 다운로드
    const imagePaths: string[] = [];
    for (const imageInfo of imageInfos) {
      const localPath = await this.downloadImage(
        imageInfo.filename,
        imageInfo.subfolder,
        imageInfo.type
      );
      imagePaths.push(localPath);
    }

    return { promptId, imagePaths };
  }

  /**
   * ComfyUI 서버 연결 테스트
   * @returns 연결 가능 여부
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.axiosInstance.get('/system_stats', { timeout: 5000 });
      return true;
    } catch (error) {
      return false;
    }
  }
}

/**
 * 워크플로우에 맞는 ComfyUI 서비스 인스턴스 생성
 */
export function createComfyUIService(apiEndpoint: string): ComfyUIService {
  return new ComfyUIService(apiEndpoint);
}

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
    servers: Array<{ id: number; name: string; endpoint: string }>,
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
          const comfyService = new ComfyUIService(server.endpoint);
          const result = await comfyService.generateImages(workflow, promptData);

          return {
            serverId: server.id,
            serverName: server.name,
            success: true,
            promptId: result.promptId,
            imagePaths: result.imagePaths
          };
        } catch (error) {
          return {
            serverId: server.id,
            serverName: server.name,
            success: false,
            error: (error as Error).message
          };
        }
      })
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          serverId: servers[index].id,
          serverName: servers[index].name,
          success: false,
          error: result.reason?.message || 'Unknown error'
        };
      }
    });
  }

  /**
   * 여러 서버에 프롬프트만 제출 (비동기 생성용)
   * @param servers 서버 목록
   * @param workflow 워크플로우 레코드
   * @param promptData 프롬프트 데이터
   * @returns 각 서버의 프롬프트 ID
   */
  static async submitToMultipleServers(
    servers: Array<{ id: number; name: string; endpoint: string }>,
    workflow: WorkflowRecord,
    promptData: Record<string, any>
  ): Promise<Array<{
    serverId: number;
    serverName: string;
    success: boolean;
    promptId?: string;
    error?: string;
  }>> {
    // 마킹된 필드 파싱
    const markedFields: MarkedField[] = workflow.marked_fields ?
      JSON.parse(workflow.marked_fields) : [];

    const results = await Promise.allSettled(
      servers.map(async (server) => {
        try {
          const comfyService = new ComfyUIService(server.endpoint);

          // 워크플로우 JSON에 프롬프트 데이터 치환
          const substitutedWorkflow = comfyService.substitutePromptData(
            workflow.workflow_json,
            markedFields,
            promptData
          );

          // ComfyUI에 프롬프트 제출
          const promptId = await comfyService.submitPrompt(substitutedWorkflow);

          return {
            serverId: server.id,
            serverName: server.name,
            success: true,
            promptId
          };
        } catch (error) {
          return {
            serverId: server.id,
            serverName: server.name,
            success: false,
            error: (error as Error).message
          };
        }
      })
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          serverId: servers[index].id,
          serverName: servers[index].name,
          success: false,
          error: result.reason?.message || 'Unknown error'
        };
      }
    });
  }

  /**
   * 여러 서버의 연결 상태 동시 확인
   * @param servers 서버 목록
   * @returns 각 서버의 연결 상태
   */
  static async testMultipleConnections(
    servers: Array<{ id: number; name: string; endpoint: string }>
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
          const comfyService = new ComfyUIService(server.endpoint);
          const isConnected = await comfyService.testConnection();
          const responseTime = Date.now() - startTime;

          return {
            serverId: server.id,
            serverName: server.name,
            isConnected,
            responseTime
          };
        } catch (error) {
          return {
            serverId: server.id,
            serverName: server.name,
            isConnected: false,
            responseTime: Date.now() - startTime,
            error: (error as Error).message
          };
        }
      })
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          serverId: servers[index].id,
          serverName: servers[index].name,
          isConnected: false,
          error: result.reason?.message || 'Unknown error'
        };
      }
    });
  }
}
