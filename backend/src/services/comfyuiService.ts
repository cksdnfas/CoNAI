import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import { WorkflowRecord, MarkedField, ComfyUIPromptResponse, ComfyUIHistoryResponse } from '../types/workflow';
import type { ComfyUIBackendType, ComfyUIQueueState, ComfyUIServerRecord, ComfyUIServerRuntimeStatus } from '../types/comfyuiServer';
import type { GenerationQueueLiveProgress } from '../types/generationQueue';
import { ComfyProgressMonitor } from './comfyui/comfyProgressMonitor';
import { resolveAxiosErrorMessage } from './comfyui/errors';
import { downloadComfyOutputFile, uploadComfyInputImage } from './comfyui/fileTransfer';
import {
  buildComfyUIQueueState,
  extractComfyQueueEntries,
  COMFY_QUEUE_JOB_MARKER_KEY,
  type ComfyUIQueueEntries,
  type ComfyUIQueueEntry,
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
export const COMFYUI_NODE_VALIDATION_FAILURE_CODE = 'comfy_node_validation';

export function buildComfyQueueClientId(queueJobId: number) {
  return `conai-job-${queueJobId}`;
}

/** Preserve structured Comfy node errors while remaining compatible with queue error messages. */
export class ComfyUINodeValidationError extends Error {
  readonly nodeErrors: Record<string, unknown>;
  readonly queueFailureCode = COMFYUI_NODE_VALIDATION_FAILURE_CODE;
  readonly queueFailureMessage: string;

  constructor(nodeErrors: Record<string, unknown>) {
    const summaries = Object.entries(nodeErrors).map(([nodeId, nodeError]) => {
      const boundedNodeId = nodeId.slice(0, 80);
      if (!nodeError || typeof nodeError !== 'object' || Array.isArray(nodeError)) {
        return `node ${boundedNodeId}`;
      }

      const record = nodeError as Record<string, unknown>;
      const classType = typeof record.class_type === 'string' ? ` (${record.class_type.slice(0, 80)})` : '';
      const firstError = Array.isArray(record.errors) && record.errors[0] && typeof record.errors[0] === 'object'
        ? record.errors[0] as Record<string, unknown>
        : null;
      const extraInfo = firstError?.extra_info && typeof firstError.extra_info === 'object' && !Array.isArray(firstError.extra_info)
        ? firstError.extra_info as Record<string, unknown>
        : null;
      const inputName = typeof extraInfo?.input_name === 'string' ? ` input ${extraInfo.input_name.slice(0, 80)}` : '';
      const detail = typeof firstError?.message === 'string' ? `: ${firstError.message.slice(0, 240)}` : '';
      return `node ${boundedNodeId}${classType}${inputName}${detail}`;
    });
    const summary = summaries.length > 0 ? summaries.slice(0, 4).join('; ') : 'unknown node';
    const message = `ComfyUI node errors: ${summary}`;
    super(message);
    this.name = 'ComfyUINodeValidationError';
    this.nodeErrors = nodeErrors;
    this.queueFailureMessage = message;
  }
}

function readComfyNodeErrors(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const nodeErrors = (value as Record<string, unknown>).node_errors;
  return nodeErrors && typeof nodeErrors === 'object' && !Array.isArray(nodeErrors)
    ? nodeErrors as Record<string, unknown>
    : null;
}

const HISTORY_POLL_TIMEOUT_MS = 10000;
// 연속 실패 5회까지는 재시도하고, 그 다음(6회째) 실패에서 생성을 포기한다.
const TOLERATED_CONSECUTIVE_HISTORY_POLL_FAILURES = 5;
const HISTORY_POLL_BACKOFF_MAX_MS = 30000;
// 취소 요청은 워커 슬롯을 붙잡고 있으므로 인스턴스 기본 타임아웃(30분)을 쓰면 안 된다.
const CANCEL_REQUEST_TIMEOUT_MS = 10000;

type WaitForCompletionOptions = {
  shouldCancel?: () => boolean | Promise<boolean>;
  onCancelRequested?: (promptId: string) => void | Promise<void>;
  /** 취소 시 폴링/백오프 대기(최대 30초)에 갇히지 않도록 하는 인메모리 시그널 */
  signal?: AbortSignal;
};

type ComfyUIServiceOptions = {
  backendType?: ComfyUIBackendType;
  capacity?: number;
};

export type ComfySubmitPromptOptions = {
  signal?: AbortSignal;
  /** PJ-3: `/queue` 역매칭용 CoNAI 잡 마커 */
  queueJobId?: number | null;
  /**
   * PJ-2: 응답에서 prompt_id 를 읽은 **바로 그 tick**에 호출된다.
   * await 홉이 끼면 핸들 미지속 창이 다시 열리므로 반드시 동기 콜백이어야 한다.
   */
  onAccepted?: (promptId: string) => void;
};

export type ComfyCancelPromptOptions = {
  /** prompt id 가 유실됐거나 큐 항목과 어긋날 때 쓰는 CoNAI 잡 마커 */
  queueJobId?: number | null;
};

export type ComfyUICancelPromptResult = {
  promptId: string;
  /** 마커 역매칭으로 뒤늦게 확인한 실제 prompt id (없으면 요청에 쓴 값) */
  resolvedPromptId: string | null;
  matchedRunning: boolean;
  matchedPending: boolean;
  matchedByMarker: boolean;
  interrupted: boolean;
  deleted: boolean;
  /** 상류 큐가 실행 중이라고 보고했지만 prompt id를 확인할 수 없어 /interrupt를 건너뛴 경우 */
  runningIdsUnresolved: boolean;
};

type ComfyAbandonedCancelCarrier = {
  comfyAbandonedCancelResult?: ComfyUICancelPromptResult | null
}

/**
 * GEN-8 의 give-up/timeout 경로는 살아 있는 프롬프트를 버린다.
 * best-effort 취소 결과를 에러에 실어 보내야 호출부가 `provider_cancel_state` 로 남기고,
 * 확인되지 않은 경우 orphan reconciler 에 넘길 수 있다(예전에는 console.warn 후 유실됐다).
 */
function attachComfyAbandonedCancelResult(error: Error, result: ComfyUICancelPromptResult | null) {
  (error as Error & ComfyAbandonedCancelCarrier).comfyAbandonedCancelResult = result;
  return error;
}

/** Read the best-effort cancellation outcome recorded when a live prompt was abandoned. */
export function resolveComfyAbandonedCancelResult(error: unknown): ComfyUICancelPromptResult | null | undefined {
  const carrier = error && typeof error === 'object' ? error as ComfyAbandonedCancelCarrier : null;
  return carrier && 'comfyAbandonedCancelResult' in carrier ? carrier.comfyAbandonedCancelResult : undefined;
}

/** 취소 시그널이 오면 남은 대기를 즉시 포기한다(대기 자체는 실패로 처리하지 않는다). */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise(resolve => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
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

  /** Prepare one job-scoped live progress socket. The caller starts it before POST /prompt. */
  createProgressMonitor(
    queueJobId: number,
    workflow: Record<string, any>,
    onProgress: (progress: GenerationQueueLiveProgress) => void,
  ) {
    return new ComfyProgressMonitor(this.apiEndpoint, buildComfyQueueClientId(queueJobId), workflow, onProgress);
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
   * @param options 취소 시그널 / 잡 마커 / 접수 즉시 콜백
   * @returns ComfyUI 프롬프트 ID
   */
  async submitPrompt(workflow: any, options?: ComfySubmitPromptOptions): Promise<string> {
    const queueJobId = options?.queueJobId ?? null;
    const requestBody: Record<string, unknown> = {
      prompt: workflow
    };

    if (queueJobId !== null && queueJobId !== undefined) {
      // PJ-3: prompt_id 를 못 받아도 /queue 에서 우리 잡을 되찾을 수 있게 마커를 각인한다.
      requestBody.client_id = buildComfyQueueClientId(queueJobId);
      requestBody.extra_data = {
        [COMFY_QUEUE_JOB_MARKER_KEY]: queueJobId,
      };
    }

    try {
      const response = await this.axiosInstance.post<ComfyUIPromptResponse>('/prompt', requestBody, {
        signal: options?.signal,
      });

      const promptId = response.data.prompt_id;
      // PJ-2: 파싱과 지속 사이에 await 홉을 두지 않는다. node_errors 검사보다도 먼저 커밋한다.
      // (node_errors 로 실패하더라도 이미 accepted 라 정상 정리 대상이 되므로 그 편이 안전하다.)
      options?.onAccepted?.(promptId);

      if (response.data.node_errors && Object.keys(response.data.node_errors).length > 0) {
        throw new ComfyUINodeValidationError(response.data.node_errors);
      }

      return promptId;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const nodeErrors = readComfyNodeErrors(error.response?.data);
        if (nodeErrors && Object.keys(nodeErrors).length > 0) {
          throw new ComfyUINodeValidationError(nodeErrors);
        }

        // 실패 분류기가 code/status 를 볼 수 있도록 원인을 붙여서 감싼다.
        const apiError = new Error(`ComfyUI API error: ${resolveAxiosErrorMessage(error)}`) as Error & { cause?: unknown };
        apiError.cause = error;
        throw apiError;
      }
      throw error;
    }
  }

  /**
   * ComfyUI 히스토리 조회
   * @param promptId ComfyUI 프롬프트 ID
   * @returns 히스토리 데이터
   */
  async getHistory(promptId: string, timeoutMs?: number, signal?: AbortSignal): Promise<ComfyUIHistoryResponse> {
    try {
      const response = await this.axiosInstance.get<ComfyUIHistoryResponse>(
        `/history/${promptId}`,
        {
          ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
          ...(signal ? { signal } : {}),
        },
      );
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

    let consecutivePollFailures = 0;
    for (let i = 0; i < maxAttempts; i++) {
      await maybeCancel();

      let history: ComfyUIHistoryResponse;
      try {
        // Short per-poll timeout so a transient stall fails this poll, not the whole generation.
        history = await this.getHistory(promptId, HISTORY_POLL_TIMEOUT_MS, options?.signal);
        consecutivePollFailures = 0;
      } catch (pollError) {
        // 취소로 끊긴 폴링은 실패 카운트가 아니라 취소 확정 경로로 보낸다.
        if (options?.signal?.aborted) {
          await maybeCancel();
          throw new Error(COMFYUI_EXECUTION_CANCELLED_MESSAGE);
        }

        consecutivePollFailures += 1;
        if (consecutivePollFailures > TOLERATED_CONSECUTIVE_HISTORY_POLL_FAILURES) {
          const cancelResult = await this.cancelPromptBestEffort(promptId);
          throw attachComfyAbandonedCancelResult(
            new Error(
              `ComfyUI history polling failed ${consecutivePollFailures} times in a row: ${pollError instanceof Error ? pollError.message : String(pollError)}`,
            ),
            cancelResult,
          );
        }

        const backoffMs = Math.min(intervalMs * 2 ** consecutivePollFailures, HISTORY_POLL_BACKOFF_MAX_MS);
        await abortableSleep(backoffMs, options?.signal);
        continue;
      }

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
      await abortableSleep(intervalMs, options?.signal);
    }

    const timeoutCancelResult = await this.cancelPromptBestEffort(promptId);
    throw attachComfyAbandonedCancelResult(
      new Error(`ComfyUI execution timeout after ${maxAttempts * intervalMs / 1000} seconds`),
      timeoutCancelResult,
    );
  }

  /**
   * Best-effort upstream cancellation so an abandoned prompt does not keep generating orphaned output.
   * 결과를 돌려주어 호출부가 `provider_cancel_state` 로 승격 기록할 수 있게 한다(실패는 orphan 으로 남는다).
   */
  async cancelPromptBestEffort(promptId: string, options?: ComfyCancelPromptOptions): Promise<ComfyUICancelPromptResult | null> {
    try {
      return await this.cancelPrompt(promptId, options);
    } catch (cancelError) {
      console.warn(
        `⚠️ Failed best-effort ComfyUI cancellation for prompt ${promptId}:`,
        cancelError instanceof Error ? cancelError.message : cancelError,
      );
      return null;
    }
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
        signal: options?.signal,
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
  async cancelPrompt(promptId: string, options?: ComfyCancelPromptOptions): Promise<ComfyUICancelPromptResult> {
    const normalizedPromptId = typeof promptId === 'string' ? promptId.trim() : '';
    const queueJobId = options?.queueJobId ?? null;
    if (!normalizedPromptId && queueJobId === null) {
      throw new Error('ComfyUI prompt cancellation requires a prompt id or a CoNAI queue job marker');
    }

    if (this.isModalBackend()) {
      return {
        promptId: normalizedPromptId,
        resolvedPromptId: normalizedPromptId || null,
        matchedRunning: false,
        matchedPending: false,
        matchedByMarker: false,
        interrupted: false,
        deleted: false,
        runningIdsUnresolved: false,
      };
    }

    try {
      const entries = await this.getQueueEntries();
      // GEN-6 불변식: prompt id 또는 우리 마커로 "확실히 우리 잡"임을 입증한 항목만 건드린다.
      const matchesOurJob = (entry: ComfyUIQueueEntry) =>
        (normalizedPromptId.length > 0 && entry.promptId === normalizedPromptId)
        || (queueJobId !== null && entry.conaiQueueJobId === queueJobId);

      const pendingMatch = entries.pending.find(matchesOurJob) ?? null;
      const runningMatch = entries.running.find(matchesOurJob) ?? null;
      const matchedPending = pendingMatch !== null;
      const matchedRunning = runningMatch !== null;
      const matchedByMarker = (pendingMatch !== null && pendingMatch.promptId !== normalizedPromptId)
        || (runningMatch !== null && runningMatch.promptId !== normalizedPromptId);
      const resolvedPromptId = pendingMatch?.promptId ?? runningMatch?.promptId ?? (normalizedPromptId || null);

      // 프록시/포크 서버가 prompt id 없는 queue_running 항목을 돌려주면 우리 잡인지 확인할 수 없다.
      // 이때도 /interrupt는 보내지 않지만(타인 잡 중단 위험), 상류 생성이 그대로 완주해 산출물이
      // 고아가 되므로 별도 상태로 남겨 추적할 수 있게 한다.
      const runningIdsUnresolved = !matchedRunning
        && entries.running.length > 0
        && entries.running.every((entry) => entry.promptId === null && entry.conaiQueueJobId === null);
      if (runningIdsUnresolved) {
        console.warn(
          `⚠️ ComfyUI queue reports ${entries.running.length} running prompt(s) without resolvable prompt ids; skipping /interrupt for ${normalizedPromptId || `job ${queueJobId}`} (upstream generation may finish and orphan its output)`,
        );
      }

      let deleted = false;
      if (matchedPending && resolvedPromptId) {
        await this.axiosInstance.post('/queue', {
          delete: [resolvedPromptId],
        }, { timeout: CANCEL_REQUEST_TIMEOUT_MS });
        deleted = true;
      }

      let interrupted = false;
      if (matchedRunning) {
        await this.axiosInstance.post('/interrupt', {}, { timeout: CANCEL_REQUEST_TIMEOUT_MS });
        interrupted = true;
      }

      return {
        promptId: normalizedPromptId,
        resolvedPromptId,
        matchedRunning,
        matchedPending,
        matchedByMarker,
        interrupted,
        deleted,
        runningIdsUnresolved,
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
   * Read upstream queue entries with their CoNAI job markers so a lost prompt id can still be matched.
   */
  async getQueueEntries(timeout: number = 5000): Promise<ComfyUIQueueEntries> {
    try {
      const response = await this.axiosInstance.get<ComfyUIQueueResponse>('/queue', { timeout });
      return extractComfyQueueEntries(response.data);
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
