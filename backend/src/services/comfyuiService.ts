import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import { WorkflowRecord, MarkedField, ComfyUIPromptResponse, ComfyUIHistoryResponse } from '../types/workflow';
import type { ComfyUIBackendType, ComfyUIQueueState, ComfyUIServerRecord, ComfyUIServerRuntimeStatus } from '../types/comfyuiServer';
import { resolveAxiosErrorMessage } from './comfyui/errors';
import { downloadComfyOutputFile, uploadComfyInputImage } from './comfyui/fileTransfer';
import {
  buildComfyUIQueueState,
  type ComfyUIQueueResponse,
} from './comfyui/queueState';
import {
  extractComfyOutputInfo,
  writeModalOutputToTemp,
  type CollectedComfyOutput,
  type ModalComfyGenerateResponse,
} from './comfyui/outputCollector';
import {
  buildModalRuntimeStatus,
  buildQueueRuntimeStatus,
  buildRuntimeStatusError,
  normalizeComfyCapacity,
  type ComfyRuntimeStatusMeta,
} from './comfyui/runtimeStatus';
import { substituteComfyPromptData } from './comfyui/workflowSubstitution';

export const COMFYUI_EXECUTION_CANCELLED_MESSAGE = '__COMFYUI_EXECUTION_CANCELLED__';

type WaitForCompletionOptions = {
  shouldCancel?: () => boolean | Promise<boolean>;
  onCancelRequested?: (promptId: string) => void | Promise<void>;
};

type ComfyUIServiceOptions = {
  backendType?: ComfyUIBackendType;
  capacity?: number;
};

export type ComfyUICancelPromptResult = {
  promptId: string;
  matchedRunning: boolean;
  matchedPending: boolean;
  interrupted: boolean;
  deleted: boolean;
};

/**
 * ComfyUI API 서비스
 */
export class ComfyUIService {
  private axiosInstance: AxiosInstance;
  private backendType: ComfyUIBackendType;
  private capacity: number;

  constructor(private apiEndpoint: string, options: ComfyUIServiceOptions = {}) {
    this.backendType = options.backendType ?? 'comfyui';
    this.capacity = Math.max(1, Math.floor(options.capacity ?? (this.backendType === 'modal' ? 10 : 1)));
    this.axiosInstance = axios.create({
      baseURL: apiEndpoint,
      timeout: 1800000, // 30분 타임아웃 (30 * 60 * 1000)
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  isModalBackend() {
    return this.backendType === 'modal';
  }

  createProviderJobId() {
    return this.isModalBackend()
      ? `modal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      : '';
  }

  /** Load the exact allowed option list for one node input from the target ComfyUI server. */
  async getNodeInputOptions(classType: string, inputKey: string): Promise<string[] | null> {
    if (this.isModalBackend()) {
      return null;
    }

    try {
      const response = await this.axiosInstance.get(`/object_info/${classType}`);
      const options = response.data?.[classType]?.input?.required?.[inputKey]?.[0];
      if (!Array.isArray(options)) {
        return null;
      }

      const stringOptions = options.filter((option: unknown): option is string => typeof option === 'string');
      return stringOptions.length > 0 ? stringOptions : null;
    } catch (error) {
      console.warn(`⚠️ Failed to load ComfyUI input options for ${classType}.${inputKey}:`, resolveAxiosErrorMessage(error));
      return null;
    }
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
    return substituteComfyPromptData(workflowJson, markedFields, promptData);
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
        throw new Error(`ComfyUI API error: ${resolveAxiosErrorMessage(error)}`);
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
   * @param maxAttempts 최대 시도 횟수 (기본 1800회 = 1시간)
   * @param intervalMs 폴링 간격 (기본 2초)
   * @returns 완료된 히스토리 데이터
   */
  async waitForCompletion(
    promptId: string,
    maxAttempts: number = 1800,
    intervalMs: number = 2000,
    options?: WaitForCompletionOptions,
  ): Promise<ComfyUIHistoryResponse> {
    let cancelHandled = false;
    const maybeCancel = async () => {
      if (!options?.shouldCancel) {
        return;
      }

      const shouldCancel = await options.shouldCancel();
      if (!shouldCancel) {
        return;
      }

      if (!cancelHandled) {
        cancelHandled = true;
        await options.onCancelRequested?.(promptId);
      }

      throw new Error(COMFYUI_EXECUTION_CANCELLED_MESSAGE);
    };

    for (let i = 0; i < maxAttempts; i++) {
      await maybeCancel();

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

      await maybeCancel();

      // 대기
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error(`ComfyUI execution timeout after ${maxAttempts * intervalMs / 1000} seconds`);
  }

  /**
   * 생성된 출력 파일 다운로드 (임시 폴더에 저장)
   * @param filename 파일명
   * @param subfolder 서브폴더
   * @param type 타입 (output, input, temp)
   * @returns 다운로드된 임시 파일의 절대 경로
   */
  async downloadOutputFile(filename: string, subfolder: string = '', type: string = 'output'): Promise<string> {
    return downloadComfyOutputFile(this.axiosInstance, filename, subfolder, type);
  }

  /**
   * Wait for one submitted ComfyUI prompt and download its generated outputs.
   */
  async collectGeneratedOutputs(promptId: string, options?: WaitForCompletionOptions & { onlyFinalOutput?: boolean }): Promise<Array<CollectedComfyOutput & { tempPath: string }>> {
    const history = await this.waitForCompletion(promptId, 1800, 2000, options);
    const outputInfos = extractComfyOutputInfo(history, promptId, options?.onlyFinalOutput ?? true);

    if (outputInfos.length === 0) {
      throw new Error('No outputs generated by ComfyUI');
    }

    const tempFiles: Array<CollectedComfyOutput & { tempPath: string }> = [];
    for (const outputInfo of outputInfos) {
      const tempPath = await this.downloadOutputFile(
        outputInfo.filename,
        outputInfo.subfolder,
        outputInfo.type
      );
      tempFiles.push({
        ...outputInfo,
        tempPath,
      });
    }

    return tempFiles;
  }

  /**
   * Run a workflow through the Modal wrapper endpoint and materialize returned base64 outputs locally.
   */
  async runModalWorkflowAndCollectOutputs(
    workflow: Record<string, any>,
    providerJobId: string,
    options?: WaitForCompletionOptions & { onlyFinalOutput?: boolean },
  ): Promise<Array<CollectedComfyOutput & { tempPath: string }>> {
    if (!this.isModalBackend()) {
      throw new Error('runModalWorkflowAndCollectOutputs requires a modal backend server');
    }

    if (await options?.shouldCancel?.()) {
      await options?.onCancelRequested?.(providerJobId);
      throw new Error(COMFYUI_EXECUTION_CANCELLED_MESSAGE);
    }

    let response;
    try {
      response = await axios.post<ModalComfyGenerateResponse>(this.apiEndpoint, { workflow }, {
        timeout: 1800000,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw new Error(`Modal ComfyUI request failed: ${resolveAxiosErrorMessage(error)}`);
    }

    if (response.data?.error) {
      throw new Error(`Modal ComfyUI generation error: ${response.data.error}`);
    }

    if (await options?.shouldCancel?.()) {
      throw new Error(COMFYUI_EXECUTION_CANCELLED_MESSAGE);
    }

    const imageOutputs = Array.isArray(response.data?.images) ? response.data.images : [];
    const videoOutputs = Array.isArray(response.data?.videos) ? response.data.videos : [];
    const outputs = [
      ...imageOutputs.map((file, index) => writeModalOutputToTemp(file, `modal_image_${index}.png`, 'image')),
      ...videoOutputs.map((file, index) => writeModalOutputToTemp(file, `modal_video_${index}.mp4`, 'video')),
    ];

    if (outputs.length === 0) {
      const responseKeys = response.data && typeof response.data === 'object'
        ? Object.keys(response.data).join(', ') || 'none'
        : 'none';
      throw new Error(`No outputs generated by Modal ComfyUI (response keys: ${responseKeys}; images: ${imageOutputs.length}; videos: ${videoOutputs.length})`);
    }

    return options?.onlyFinalOutput === false ? outputs : outputs.slice(-1);
  }

  /**
   * Try to cancel one submitted prompt on the upstream ComfyUI server.
   * Pending prompts are removed from the queue and running prompts trigger /interrupt.
   */
  async cancelPrompt(promptId: string): Promise<ComfyUICancelPromptResult> {
    const normalizedPromptId = typeof promptId === 'string' ? promptId.trim() : '';
    if (!normalizedPromptId) {
      throw new Error('ComfyUI prompt cancellation requires a prompt id');
    }

    if (this.isModalBackend()) {
      return {
        promptId: normalizedPromptId,
        matchedRunning: false,
        matchedPending: false,
        interrupted: false,
        deleted: false,
      };
    }

    try {
      const queueState = await this.getQueueState();
      const pendingPromptIds = queueState.pending_prompt_ids ?? [];
      const runningPromptIds = queueState.running_prompt_ids ?? [];
      const matchedPending = pendingPromptIds.includes(normalizedPromptId);
      const matchedRunning = runningPromptIds.includes(normalizedPromptId)
        || (queueState.running_count > 0 && runningPromptIds.length === 0);

      let deleted = false;
      if (matchedPending) {
        await this.axiosInstance.post('/queue', {
          delete: [normalizedPromptId],
        });
        deleted = true;
      }

      let interrupted = false;
      if (matchedRunning) {
        await this.axiosInstance.post('/interrupt', {});
        interrupted = true;
      }

      return {
        promptId: normalizedPromptId,
        matchedRunning,
        matchedPending,
        interrupted,
        deleted,
      };
    } catch (error) {
      throw new Error(`ComfyUI prompt cancellation error: ${resolveAxiosErrorMessage(error)}`);
    }
  }

  /**
   * 전체 이미지 생성 프로세스 실행
   * @param workflow 워크플로우 레코드 (미사용, 하위 호환성 유지용)
   * @param promptData Frontend에서 이미 치환된 완전한 ComfyUI workflow 객체
   * @returns 생성된 임시 이미지 파일 경로 배열 (절대 경로)
   */
  async generateImages(
    workflow: WorkflowRecord,
    promptData: Record<string, any>
  ): Promise<{ promptId: string; imagePaths: string[] }> {
    // Frontend에서 이미 완전한 workflow로 치환되어 전송됨
    // 따라서 promptData를 그대로 ComfyUI로 전송

    console.log('🚀 Submitting workflow to ComfyUI (pre-substituted from frontend)');

    if (this.isModalBackend()) {
      const promptId = this.createProviderJobId();
      const outputs = await this.runModalWorkflowAndCollectOutputs(promptData, promptId);
      return { promptId, imagePaths: outputs.map((output) => output.tempPath) };
    }

    const promptId = await this.submitPrompt(promptData);
    const outputs = await this.collectGeneratedOutputs(promptId);
    const imagePaths = outputs.map((output) => output.tempPath);

    return { promptId, imagePaths };
  }

  /**
   * Upload an input image to the target ComfyUI server and return the stored filename.
   */
  async uploadInputImage(fileName: string, imageInput: Buffer | fs.ReadStream, options?: { contentType?: string }): Promise<string> {
    return uploadComfyInputImage(this.axiosInstance, fileName, imageInput, options);
  }

  /**
   * Read the current upstream ComfyUI queue state.
   */
  async getQueueState(timeout: number = 5000): Promise<ComfyUIQueueState> {
    try {
      const response = await this.axiosInstance.get<ComfyUIQueueResponse>('/queue', { timeout });
      return buildComfyUIQueueState(response.data);
    } catch (error) {
      throw new Error(`ComfyUI queue API error: ${resolveAxiosErrorMessage(error)}`);
    }
  }

  /**
   * Combine reachability and queue occupancy into one runtime status payload.
   */
  async getRuntimeStatus(serverMeta?: ComfyRuntimeStatusMeta): Promise<ComfyUIServerRuntimeStatus> {
    const startedAt = Date.now();
    const observedAt = new Date().toISOString();
    const backendType = serverMeta?.backend_type ?? this.backendType;
    const capacity = normalizeComfyCapacity(serverMeta?.capacity, this.capacity);
    const runtimeStatusInput = {
      serverMeta,
      apiEndpoint: this.apiEndpoint,
      backendType,
      capacity,
      startedAt,
      observedAt,
    };

    if (backendType === 'modal') {
      try {
        const isConnected = await this.testConnection();
        return buildModalRuntimeStatus({
          ...runtimeStatusInput,
          isConnected,
        });
      } catch (error) {
        return buildRuntimeStatusError({
          ...runtimeStatusInput,
          errorMessage: resolveAxiosErrorMessage(error),
          includeZeroQueueCounts: true,
        });
      }
    }

    try {
      const queueState = await this.getQueueState();
      return buildQueueRuntimeStatus({
        ...runtimeStatusInput,
        queueState,
      });
    } catch (error) {
      return buildRuntimeStatusError({
        ...runtimeStatusInput,
        errorMessage: resolveAxiosErrorMessage(error),
      });
    }
  }

  /**
   * ComfyUI 서버 연결 테스트
   * @returns 연결 가능 여부
   */
  async testConnection(): Promise<boolean> {
    try {
      if (this.isModalBackend()) {
        const response = await axios.get(this.apiEndpoint, {
          timeout: 15000,
          validateStatus: (status) => status < 500,
        });
        return response.status < 500;
      }

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
export function createComfyUIService(apiEndpoint: string, server?: Pick<ComfyUIServerRecord, 'backend_type' | 'capacity'> | null): ComfyUIService {
  return new ComfyUIService(apiEndpoint, {
    backendType: server?.backend_type ?? 'comfyui',
    capacity: server?.capacity,
  });
}
