import type { ComfyUIBackendType, ComfyUIQueueState, ComfyUIServerRecord, ComfyUIServerRuntimeStatus } from '../../types/comfyuiServer';

export type ComfyRuntimeStatusMeta = Pick<ComfyUIServerRecord, 'id' | 'name' | 'endpoint' | 'backend_type' | 'capacity'>;

type RuntimeStatusBaseInput = {
  serverMeta?: ComfyRuntimeStatusMeta;
  apiEndpoint: string;
  backendType: ComfyUIBackendType;
  capacity: number;
  startedAt?: number;
  observedAt: string;
};

function buildRuntimeStatusBase(input: RuntimeStatusBaseInput) {
  return {
    server_id: input.serverMeta?.id ?? 0,
    server_name: input.serverMeta?.name ?? '',
    endpoint: input.serverMeta?.endpoint ?? input.apiEndpoint,
    backend_type: input.backendType,
    capacity: input.capacity,
    response_time: input.startedAt === undefined ? undefined : Date.now() - input.startedAt,
    observed_at: input.observedAt,
  };
}

export function normalizeComfyCapacity(capacity: number | undefined, fallback: number): number {
  return Math.max(1, Math.floor(capacity ?? fallback));
}

export function buildModalRuntimeStatus(
  input: RuntimeStatusBaseInput & { isConnected: boolean; errorMessage?: string }
): ComfyUIServerRuntimeStatus {
  return {
    ...buildRuntimeStatusBase(input),
    available_count: input.isConnected ? input.capacity : 0,
    is_connected: input.isConnected,
    error_message: input.errorMessage,
    is_idle: input.isConnected,
    pending_count: 0,
    running_count: 0,
  };
}

export function buildQueueRuntimeStatus(
  input: RuntimeStatusBaseInput & { queueState: ComfyUIQueueState }
): ComfyUIServerRuntimeStatus {
  return {
    ...buildRuntimeStatusBase(input),
    available_count: input.queueState.is_idle ? 1 : 0,
    is_connected: true,
    error_message: undefined,
    is_idle: input.queueState.is_idle,
    pending_count: input.queueState.pending_count,
    running_count: input.queueState.running_count,
  };
}

export function buildRuntimeStatusError(
  input: RuntimeStatusBaseInput & { errorMessage: string; includeZeroQueueCounts?: boolean }
): ComfyUIServerRuntimeStatus {
  return {
    ...buildRuntimeStatusBase(input),
    available_count: 0,
    is_connected: false,
    error_message: input.errorMessage,
    is_idle: false,
    pending_count: input.includeZeroQueueCounts ? 0 : undefined,
    running_count: input.includeZeroQueueCounts ? 0 : undefined,
  };
}

export function buildUnprobedModalRuntimeStatus(server: ComfyUIServerRecord): ComfyUIServerRuntimeStatus {
  const capacity = normalizeComfyCapacity(server.capacity, 10);
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
