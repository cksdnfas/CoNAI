import axios, { AxiosInstance } from 'axios';
import * as path from 'path';
import * as fs from 'fs';
import FormData from 'form-data';
import { WorkflowRecord, MarkedField, ComfyUIPromptResponse, ComfyUIHistoryResponse, ComfyUIOutputFile } from '../types/workflow';
import type { ComfyUIBackendType, ComfyUIQueueState, ComfyUIServerRecord, ComfyUIServerRuntimeStatus } from '../types/comfyuiServer';
import { runtimePaths } from '../config/runtimePaths';

type ComfyUIQueueResponse = {
  queue_running?: unknown;
  queue_pending?: unknown;
};

type ComfyOutputKind = 'image' | 'animated' | 'video';

export const COMFYUI_EXECUTION_CANCELLED_MESSAGE = '__COMFYUI_EXECUTION_CANCELLED__';

type CollectedComfyOutput = ComfyUIOutputFile & {
  nodeId: string;
  kind: ComfyOutputKind;
};

type WaitForCompletionOptions = {
  shouldCancel?: () => boolean | Promise<boolean>;
  onCancelRequested?: (promptId: string) => void | Promise<void>;
};

type ComfyUIServiceOptions = {
  backendType?: ComfyUIBackendType;
  capacity?: number;
};

type ModalComfyFile = {
  node_id?: string;
  filename?: string;
  data_base64?: string;
  format?: string;
};

type ModalComfyGenerateResponse = {
  images?: ModalComfyFile[];
  videos?: ModalComfyFile[];
  error?: string;
};

export type ComfyUICancelPromptResult = {
  promptId: string;
  matchedRunning: boolean;
  matchedPending: boolean;
  interrupted: boolean;
  deleted: boolean;
};

function normalizeQueueEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>);
  }

  return [];
}

function extractPromptIdFromQueueEntry(entry: unknown): string | null {
  if (Array.isArray(entry)) {
    if (typeof entry[1] === 'string' && entry[1].trim().length > 0) {
      return entry[1].trim();
    }

    for (const item of entry) {
      const nested = extractPromptIdFromQueueEntry(item);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  if (entry && typeof entry === 'object') {
    const record = entry as Record<string, unknown>;
    if (typeof record.prompt_id === 'string' && record.prompt_id.trim().length > 0) {
      return record.prompt_id.trim();
    }
    if (typeof record.id === 'string' && record.id.trim().length > 0) {
      return record.id.trim();
    }

    for (const value of Object.values(record)) {
      const nested = extractPromptIdFromQueueEntry(value);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function collectPromptIds(entries: unknown[]) {
  const promptIds = new Set<string>();
  for (const entry of entries) {
    const promptId = extractPromptIdFromQueueEntry(entry);
    if (promptId) {
      promptIds.add(promptId);
    }
  }
  return [...promptIds];
}

function resolveAxiosErrorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    const responseData = error.response?.data;
    if (typeof responseData === 'string' && responseData.trim().length > 0) {
      return `${error.message} | ${responseData.trim()}`;
    }

    if (responseData && typeof responseData === 'object') {
      try {
        return `${error.message} | ${JSON.stringify(responseData)}`;
      } catch {
        // fall through to the base axios message
      }
    }

    return error.message;
  }
  return error instanceof Error ? error.message : 'Unknown error';
}

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
    try {
      // 다운로드 URL 구성
      const params = new URLSearchParams({
        filename,
        subfolder,
        type
      });
      const url = `/view?${params.toString()}`;

      // 출력 파일 다운로드
      const response = await this.axiosInstance.get(url, {
        responseType: 'arraybuffer'
      });

      // temp 폴더가 없으면 생성
      const tempDir = runtimePaths.tempDir;
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // 고유한 임시 파일명 생성
      const ext = path.extname(filename);
      const uniqueFilename = `comfyui_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${ext}`;
      const tempFilePath = path.join(tempDir, uniqueFilename);

      // temp 폴더에 파일 저장
      fs.writeFileSync(tempFilePath, Buffer.from(response.data));

      return tempFilePath; // 절대 경로 반환
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`ComfyUI output download error: ${error.message}`);
      }
      throw error;
    }
  }

  private resolveOutputKind(bucket: 'images' | 'gifs' | 'videos' | 'files', file: ComfyUIOutputFile): ComfyOutputKind {
    if (bucket === 'videos') {
      return 'video';
    }

    const normalizedFormat = (file.format || '').toLowerCase();
    const extension = path.extname(file.filename).toLowerCase();

    if (normalizedFormat.startsWith('video/') || ['.mp4', '.webm', '.mov', '.mkv', '.avi'].includes(extension)) {
      return 'video';
    }

    if (bucket === 'gifs' || ['.gif', '.webp'].includes(extension)) {
      return 'animated';
    }

    return 'image';
  }

  private parseNodeOrder(nodeId: string): number {
    const match = nodeId.match(/^\d+/);
    return match ? Number(match[0]) : -1;
  }

  /**
   * 히스토리에서 생성된 최종 출력 정보를 추출한다.
   */
  extractOutputInfo(
    history: ComfyUIHistoryResponse,
    promptId: string,
    onlyFinalOutput: boolean = true
  ): CollectedComfyOutput[] {
    const item = history[promptId];
    if (!item || !item.outputs) {
      return [];
    }

    const allOutputs: CollectedComfyOutput[] = [];

    for (const nodeId in item.outputs) {
      const output = item.outputs[nodeId];
      const buckets: Array<'images' | 'gifs' | 'videos' | 'files'> = ['images', 'gifs', 'videos', 'files'];

      for (const bucket of buckets) {
        const files = output[bucket];
        if (!Array.isArray(files)) {
          continue;
        }

        files.forEach((file) => {
          allOutputs.push({
            ...file,
            nodeId,
            kind: this.resolveOutputKind(bucket, file),
          });
        });
      }
    }

    if (onlyFinalOutput && allOutputs.length > 0) {
      const maxNodeOrder = Math.max(...allOutputs.map((file) => this.parseNodeOrder(file.nodeId)));
      const finalOutputs = allOutputs.filter((file) => this.parseNodeOrder(file.nodeId) === maxNodeOrder);

      console.log(`📦 Found ${allOutputs.length} outputs, returning ${finalOutputs.length} final output(s) from node #${maxNodeOrder}`);
      return finalOutputs;
    }

    console.log(`📦 Found ${allOutputs.length} outputs, returning all`);
    return allOutputs;
  }

  /**
   * Wait for one submitted ComfyUI prompt and download its generated outputs.
   */
  async collectGeneratedOutputs(promptId: string, options?: WaitForCompletionOptions & { onlyFinalOutput?: boolean }): Promise<Array<CollectedComfyOutput & { tempPath: string }>> {
    const history = await this.waitForCompletion(promptId, 1800, 2000, options);
    const outputInfos = this.extractOutputInfo(history, promptId, options?.onlyFinalOutput ?? true);

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

  private writeModalOutputToTemp(file: ModalComfyFile, fallbackName: string, kind: ComfyOutputKind): CollectedComfyOutput & { tempPath: string } {
    const encoded = typeof file.data_base64 === 'string' ? file.data_base64 : '';
    if (!encoded) {
      throw new Error(`Modal ComfyUI output ${file.filename ?? fallbackName} did not include data_base64`);
    }

    const filename = path.basename(file.filename || fallbackName);
    const tempDir = runtimePaths.tempDir;
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const ext = path.extname(filename) || (kind === 'video' ? '.mp4' : '.png');
    const tempFilePath = path.join(tempDir, `modal_comfyui_${Date.now()}_${Math.random().toString(36).slice(2, 9)}${ext}`);
    fs.writeFileSync(tempFilePath, Buffer.from(encoded, 'base64'));

    return {
      filename,
      subfolder: '',
      type: 'output',
      format: file.format,
      nodeId: String(file.node_id ?? 'modal'),
      kind,
      tempPath: tempFilePath,
    };
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
      ...imageOutputs.map((file, index) => this.writeModalOutputToTemp(file, `modal_image_${index}.png`, 'image')),
      ...videoOutputs.map((file, index) => this.writeModalOutputToTemp(file, `modal_video_${index}.mp4`, 'video')),
    ];

    if (outputs.length === 0) {
      throw new Error('No outputs generated by Modal ComfyUI');
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
    try {
      const formData = new FormData();
      formData.append('image', imageInput, {
        filename: fileName,
        contentType: options?.contentType || 'image/png'
      });
      formData.append('type', 'input');
      formData.append('overwrite', 'false');

      const response = await this.axiosInstance.post('/upload/image', formData, {
        headers: formData.getHeaders(),
        maxBodyLength: Infinity,
      });

      return response.data?.name || fileName;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`ComfyUI image upload error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Read the current upstream ComfyUI queue state.
   */
  async getQueueState(timeout: number = 5000): Promise<ComfyUIQueueState> {
    try {
      const response = await this.axiosInstance.get<ComfyUIQueueResponse>('/queue', { timeout });
      const runningEntries = normalizeQueueEntries(response.data?.queue_running);
      const pendingEntries = normalizeQueueEntries(response.data?.queue_pending);

      return {
        pending_count: pendingEntries.length,
        running_count: runningEntries.length,
        pending_prompt_ids: collectPromptIds(pendingEntries),
        running_prompt_ids: collectPromptIds(runningEntries),
        is_idle: pendingEntries.length === 0 && runningEntries.length === 0,
      };
    } catch (error) {
      throw new Error(`ComfyUI queue API error: ${resolveAxiosErrorMessage(error)}`);
    }
  }

  /**
   * Combine reachability and queue occupancy into one runtime status payload.
   */
  async getRuntimeStatus(serverMeta?: Pick<ComfyUIServerRecord, 'id' | 'name' | 'endpoint' | 'backend_type' | 'capacity'>): Promise<ComfyUIServerRuntimeStatus> {
    const startedAt = Date.now();
    const observedAt = new Date().toISOString();
    const backendType = serverMeta?.backend_type ?? this.backendType;
    const capacity = Math.max(1, Math.floor(serverMeta?.capacity ?? this.capacity));

    if (backendType === 'modal') {
      try {
        const isConnected = await this.testConnection();
        return {
          server_id: serverMeta?.id ?? 0,
          server_name: serverMeta?.name ?? '',
          endpoint: serverMeta?.endpoint ?? this.apiEndpoint,
          backend_type: backendType,
          capacity,
          available_count: isConnected ? capacity : 0,
          is_connected: isConnected,
          response_time: Date.now() - startedAt,
          error_message: undefined,
          is_idle: isConnected,
          pending_count: 0,
          running_count: 0,
          observed_at: observedAt,
        };
      } catch (error) {
        return {
          server_id: serverMeta?.id ?? 0,
          server_name: serverMeta?.name ?? '',
          endpoint: serverMeta?.endpoint ?? this.apiEndpoint,
          backend_type: backendType,
          capacity,
          available_count: 0,
          is_connected: false,
          response_time: Date.now() - startedAt,
          error_message: resolveAxiosErrorMessage(error),
          is_idle: false,
          pending_count: 0,
          running_count: 0,
          observed_at: observedAt,
        };
      }
    }

    try {
      const queueState = await this.getQueueState();
      return {
        server_id: serverMeta?.id ?? 0,
        server_name: serverMeta?.name ?? '',
        endpoint: serverMeta?.endpoint ?? this.apiEndpoint,
        backend_type: backendType,
        capacity,
        available_count: queueState.is_idle ? 1 : 0,
        is_connected: true,
        response_time: Date.now() - startedAt,
        error_message: undefined,
        is_idle: queueState.is_idle,
        pending_count: queueState.pending_count,
        running_count: queueState.running_count,
        observed_at: observedAt,
      };
    } catch (error) {
      return {
        server_id: serverMeta?.id ?? 0,
        server_name: serverMeta?.name ?? '',
        endpoint: serverMeta?.endpoint ?? this.apiEndpoint,
        backend_type: backendType,
        capacity,
        available_count: 0,
        is_connected: false,
        response_time: Date.now() - startedAt,
        error_message: resolveAxiosErrorMessage(error),
        is_idle: false,
        pending_count: undefined,
        running_count: undefined,
        observed_at: observedAt,
      };
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

/**
 * Collect runtime occupancy status for multiple ComfyUI servers in parallel.
 */
export function buildUnprobedModalRuntimeStatus(server: ComfyUIServerRecord): ComfyUIServerRuntimeStatus {
  const capacity = Math.max(1, Math.floor(server.capacity ?? 10));
  return {
    server_id: server.id,
    server_name: server.name,
    endpoint: server.endpoint,
    backend_type: 'modal',
    capacity,
    available_count: capacity,
    is_connected: true,
    response_time: undefined,
    error_message: undefined,
    is_idle: true,
    pending_count: undefined,
    running_count: undefined,
    observed_at: new Date().toISOString(),
  };
}

export async function getComfyUIServerRuntimeStatuses(servers: ComfyUIServerRecord[]): Promise<ComfyUIServerRuntimeStatus[]> {
  const results = await Promise.allSettled(
    servers.map(async (server) => {
      if (server.backend_type === 'modal') {
        return buildUnprobedModalRuntimeStatus(server);
      }

      const comfyService = new ComfyUIService(server.endpoint, {
        backendType: server.backend_type,
        capacity: server.capacity,
      });
      return comfyService.getRuntimeStatus(server);
    })
  );

  return results.map((result, index) => {
    const server = servers[index];
    if (result.status === 'fulfilled') {
      return result.value;
    }

    return {
      server_id: server.id,
      server_name: server.name,
      endpoint: server.endpoint,
      backend_type: server.backend_type,
      capacity: server.capacity,
      available_count: 0,
      is_connected: false,
      response_time: undefined,
      error_message: resolveAxiosErrorMessage(result.reason),
      is_idle: false,
      pending_count: undefined,
      running_count: undefined,
      observed_at: new Date().toISOString(),
    };
  });
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
    servers: Array<{ id: number; name: string; endpoint: string; backend_type?: ComfyUIBackendType; capacity?: number }>,
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
   * @param workflow 워크플로우 레코드 (미사용, 하위 호환성 유지용)
   * @param promptData Frontend에서 이미 치환된 완전한 ComfyUI workflow 객체
   * @returns 각 서버의 프롬프트 ID
   */
  static async submitToMultipleServers(
    servers: Array<{ id: number; name: string; endpoint: string; backend_type?: ComfyUIBackendType; capacity?: number }>,
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
    servers: Array<{ id: number; name: string; endpoint: string; backend_type?: ComfyUIBackendType; capacity?: number }>
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
