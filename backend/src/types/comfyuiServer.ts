/**
 * ComfyUI 서버 데이터베이스 레코드
 */
export interface ComfyUIServerRecord {
  id: number;
  name: string;
  endpoint: string;
  description?: string;
  routing_tags_json?: string | null;
  routing_tags?: string[];
  is_active: boolean;
  created_date: string;
  updated_date: string;
}

/**
 * ComfyUI 서버 생성 데이터
 */
export interface ComfyUIServerCreateData {
  name: string;
  endpoint: string;
  description?: string;
  routing_tags_json?: string | null;
  is_active?: boolean;
}

/**
 * ComfyUI 서버 업데이트 데이터
 */
export interface ComfyUIServerUpdateData {
  name?: string;
  endpoint?: string;
  description?: string;
  routing_tags_json?: string | null;
  is_active?: boolean;
}

/**
 * 워크플로우-서버 관계 레코드
 */
export interface WorkflowServerRecord {
  id: number;
  workflow_id: number;
  server_id: number;
  is_enabled: boolean;
  created_date: string;
}

/**
 * 서버 상태 정보
 */
export interface ServerStatus {
  server_id: number;
  server_name: string;
  endpoint: string;
  is_connected: boolean;
  response_time?: number; // ms
  error_message?: string;
}

/**
 * Normalized upstream ComfyUI occupancy snapshot.
 */
export interface ComfyUIQueueState {
  pending_count: number;
  running_count: number;
  pending_prompt_ids?: string[];
  running_prompt_ids?: string[];
  is_idle: boolean;
}

/**
 * Runtime status combining connectivity and current upstream occupancy.
 */
export interface ComfyUIServerRuntimeStatus extends ServerStatus {
  is_idle?: boolean;
  pending_count?: number;
  running_count?: number;
  observed_at?: string;
}

/**
 * 병렬 생성 결과
 */
export interface ParallelGenerationResult {
  total_servers: number;
  successful: number;
  failed: number;
  results: Array<{
    server_id: number;
    server_name: string;
    history_id?: number;
    status: 'success' | 'failed';
    error?: string;
  }>;
}

/**
 * API 응답 타입
 */
export interface ComfyUIServerResponse {
  success: boolean;
  data?: any;
  error?: string;
}
