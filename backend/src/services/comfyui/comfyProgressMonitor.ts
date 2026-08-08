import WebSocket, { type RawData } from 'ws';
import type { GenerationQueueLiveProgress, GenerationQueueProgressPhase } from '../../types/generationQueue';

const INITIAL_CONNECT_TIMEOUT_MS = 5000;
const RECONNECT_DELAY_MS = 1000;
/** 연속 실패 시 지수 백오프 상한 — /ws 불통 환경에서 잡 생애 내내 1conn/s 를 여는 누수를 막는다. */
const RECONNECT_DELAY_MAX_MS = 30_000;
/** 첫 경고 이후에도 이 횟수마다 다시 경고해, 조용히 재연결만 도는 상태를 드러낸다. */
const RECONNECT_REWARN_EVERY_ATTEMPTS = 30;
const PROGRESS_EMIT_INTERVAL_MS = 250;
const MAX_PENDING_EVENTS = 16;

type ComfyWorkflow = Record<string, any>;

export interface ParsedComfyProgressEvent {
  promptId: string | null;
  progress: GenerationQueueLiveProgress;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNodeId(value: unknown) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function readFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function resolveNodeLabel(workflow: ComfyWorkflow, nodeId: string | null) {
  if (!nodeId) {
    return null;
  }

  const node = asRecord(workflow[nodeId]);
  const metadata = asRecord(node?._meta);
  return readString(metadata?.title) ?? readString(node?.class_type) ?? `Node ${nodeId}`;
}

/** Convert one ComfyUI JSON event into the small progress contract used by CoNAI. */
export function parseComfyProgressEvent(
  rawMessage: string,
  workflow: ComfyWorkflow,
  nowMs = Date.now(),
): ParsedComfyProgressEvent | null {
  let message: Record<string, unknown>;
  try {
    message = asRecord(JSON.parse(rawMessage) as unknown) ?? {};
  } catch {
    return null;
  }

  const type = readString(message.type);
  const data = asRecord(message.data);
  if (!type || !data) {
    return null;
  }

  const promptId = readString(data.prompt_id);
  const updatedAt = new Date(nowMs).toISOString();

  if (type === 'execution_start') {
    return {
      promptId,
      progress: {
        source: 'comfyui_ws',
        phase: 'preparing',
        node_id: null,
        node_label: null,
        value: null,
        max: null,
        percent: null,
        updated_at: updatedAt,
      },
    };
  }

  if (type === 'executing') {
    const nodeId = readNodeId(data.node);
    return {
      promptId,
      progress: {
        source: 'comfyui_ws',
        phase: nodeId === null ? 'finalizing' : 'executing',
        node_id: nodeId,
        node_label: resolveNodeLabel(workflow, nodeId),
        value: null,
        max: null,
        percent: null,
        updated_at: updatedAt,
      },
    };
  }

  if (type === 'progress') {
    const nodeId = readNodeId(data.node);
    const value = readFiniteNumber(data.value);
    const max = readFiniteNumber(data.max);
    if (value === null || max === null || max <= 0) {
      return null;
    }

    return {
      promptId,
      progress: {
        source: 'comfyui_ws',
        phase: 'sampling',
        node_id: nodeId,
        node_label: resolveNodeLabel(workflow, nodeId),
        value,
        max,
        percent: Math.round(Math.min(100, Math.max(0, (value / max) * 100))),
        updated_at: updatedAt,
      },
    };
  }

  if (type === 'execution_success') {
    return {
      promptId,
      progress: {
        source: 'comfyui_ws',
        phase: 'finalizing',
        node_id: null,
        node_label: null,
        value: null,
        max: null,
        percent: null,
        updated_at: updatedAt,
      },
    };
  }

  return null;
}

/**
 * 잡당 정확히 2회뿐인 경계 페이즈만 즉시 발행한다.
 *
 * `executing` 은 그래프 노드마다 1프레임씩 도착하므로(50~80노드 워크플로우는 시작 직후
 * 1초 안에 그만큼의 버스트) `sampling` 과 함께 250ms 코얼레싱을 태운다. 마지막 프레임은
 * trailing 타이머가 보존하므로 노드 전환 표시가 사라지지는 않는다.
 */
export function isImmediateProgressPhase(phase: GenerationQueueProgressPhase): boolean {
  return phase === 'preparing' || phase === 'finalizing';
}

/** Build the direct ComfyUI WebSocket URL without dropping an endpoint base path. */
export function buildComfyProgressWebSocketUrl(apiEndpoint: string, clientId: string) {
  const url = new URL(apiEndpoint);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/ws`;
  url.search = '';
  url.searchParams.set('clientId', clientId);
  return url.toString();
}

/**
 * One job-scoped ComfyUI progress connection.
 *
 * The connection opens before POST /prompt, then accepts only events carrying the
 * accepted prompt id. Reconnect-only `executing` frames without prompt_id are
 * deliberately ignored so another prompt can never leak into this job.
 */
export class ComfyProgressMonitor {
  private socket: WebSocket | null = null;
  private expectedPromptId: string | null = null;
  private pendingEvents: ParsedComfyProgressEvent[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingProgress: GenerationQueueLiveProgress | null = null;
  private lastEmittedAt = 0;
  private stopped = false;
  private warned = false;
  private abortSignal: AbortSignal | null = null;

  constructor(
    private readonly apiEndpoint: string,
    private readonly clientId: string,
    private readonly workflow: ComfyWorkflow,
    private readonly onProgress: (progress: GenerationQueueLiveProgress) => void,
  ) {}

  /** Open the first socket before prompt submission. Failure keeps the history-polling fallback alive. */
  async start(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      this.stopped = true;
      return;
    }

    if (signal) {
      this.abortSignal = signal;
      signal.addEventListener('abort', this.handleAbort, { once: true });
    }

    await this.connect(true);
  }

  /** Bind the socket to the exact prompt id returned by POST /prompt. */
  setPromptId(promptId: string) {
    this.expectedPromptId = promptId;
    const latestMatchingEvent = [...this.pendingEvents].reverse().find((event) => event.promptId === promptId);
    this.pendingEvents = [];
    if (latestMatchingEvent) {
      this.emit(latestMatchingEvent.progress);
    }
  }

  close() {
    this.stopped = true;
    if (this.abortSignal) {
      this.abortSignal.removeEventListener('abort', this.handleAbort);
      this.abortSignal = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    this.pendingProgress = null;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close();
    }
  }

  private readonly handleAbort = () => {
    this.close();
  };

  private async connect(waitForInitialResult: boolean): Promise<void> {
    if (this.stopped || this.socket) {
      return;
    }

    await new Promise<void>((resolve) => {
      const socket = new WebSocket(buildComfyProgressWebSocketUrl(this.apiEndpoint, this.clientId));
      this.socket = socket;
      let settled = false;
      const settle = () => {
        if (!settled) {
          settled = true;
          clearTimeout(connectTimeout);
          resolve();
        }
      };
      const connectTimeout = setTimeout(() => {
        if (socket.readyState === WebSocket.CONNECTING) {
          socket.terminate();
        }
        settle();
      }, INITIAL_CONNECT_TIMEOUT_MS);

      socket.once('open', () => {
        this.reconnectAttempts = 0;
        settle();
      });
      socket.on('message', (data: RawData, isBinary: boolean) => {
        if (!isBinary) {
          this.handleMessage(data.toString());
        }
      });
      socket.once('error', (error) => {
        if (!this.warned) {
          this.warned = true;
          console.warn(`⚠️ ComfyUI live progress unavailable for ${this.clientId}; using queue ETA fallback:`, error instanceof Error ? error.message : error);
        }
        settle();
      });
      socket.once('close', () => {
        if (this.socket === socket) {
          this.socket = null;
        }
        settle();
        this.scheduleReconnect();
      });

      if (!waitForInitialResult) {
        settle();
      }
    });
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) {
      return;
    }

    this.reconnectAttempts += 1;
    if (this.reconnectAttempts % RECONNECT_REWARN_EVERY_ATTEMPTS === 0) {
      console.warn(`⚠️ ComfyUI progress socket for ${this.clientId} still unreachable after ${this.reconnectAttempts} attempts; queue ETA fallback remains active.`);
    }

    const delayMs = Math.min(RECONNECT_DELAY_MS * 2 ** Math.max(0, this.reconnectAttempts - 1), RECONNECT_DELAY_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect(false);
    }, delayMs);
  }

  private handleMessage(rawMessage: string) {
    // 프롬프트에 바인딩된 뒤에는 파싱 전에 저비용 문자열 검사로 타 프롬프트/브로드캐스트
    // 프레임을 거른다. 같은 서버에 모니터가 N개면 모든 프레임이 N번 JSON.parse 되기 때문이다.
    // (문자열 포함 = 후보일 뿐이므로, 통과한 프레임은 여전히 아래 정식 필터를 거친다.)
    if (this.expectedPromptId && !rawMessage.includes(this.expectedPromptId)) {
      return;
    }

    const event = parseComfyProgressEvent(rawMessage, this.workflow);
    if (!event) {
      return;
    }

    if (!this.expectedPromptId) {
      if (event.promptId) {
        this.pendingEvents.push(event);
        if (this.pendingEvents.length > MAX_PENDING_EVENTS) {
          this.pendingEvents.shift();
        }
      }
      return;
    }

    if (event.promptId !== this.expectedPromptId) {
      return;
    }

    this.emit(event.progress);
  }

  private emit(progress: GenerationQueueLiveProgress) {
    const now = Date.now();
    const isImmediate = isImmediateProgressPhase(progress.phase);
    const waitMs = Math.max(0, PROGRESS_EMIT_INTERVAL_MS - (now - this.lastEmittedAt));
    if (isImmediate || waitMs === 0) {
      if (this.emitTimer) {
        clearTimeout(this.emitTimer);
        this.emitTimer = null;
      }
      this.pendingProgress = null;
      this.dispatch(progress);
      return;
    }

    this.pendingProgress = progress;
    if (!this.emitTimer) {
      this.emitTimer = setTimeout(() => {
        this.emitTimer = null;
        const pending = this.pendingProgress;
        this.pendingProgress = null;
        if (pending) {
          this.dispatch(pending);
        }
      }, waitMs);
    }
  }

  private dispatch(progress: GenerationQueueLiveProgress) {
    this.lastEmittedAt = Date.now();
    try {
      this.onProgress(progress);
    } catch (error) {
      console.warn(`⚠️ Failed to publish ComfyUI progress for ${this.clientId}:`, error);
    }
  }
}
