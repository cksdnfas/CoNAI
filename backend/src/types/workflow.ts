/**
 * 워크플로우 데이터베이스 레코드
 */
export interface WorkflowRecord {
  id: number;
  name: string;
  description?: string;
  workflow_json: string;
  marked_fields?: string; // JSON string: MarkedField[]
  api_endpoint: string;
  is_active: boolean;
  is_public_page: boolean;
  public_slug?: string | null;
  color: string;
  created_date: string;
  updated_date: string;
}

/**
 * 워크플로우 JSON에서 마킹된 필드 정보
 */
export interface MarkedField {
  id: string; // 고유 식별자 (예: "positive_prompt")
  label: string; // 사용자에게 표시될 라벨 (예: "Positive Prompt")
  description?: string; // 필드 사용 가이드 (MCP 및 사용자용)
  jsonPath: string; // JSON 경로 (예: "6.inputs.text")
  type: 'text' | 'number' | 'select' | 'textarea' | 'image';
  default_collapsed?: boolean;
  simple_upload_only?: boolean;
  default_value?: any;
  placeholder?: string;
  dropdown_list_name?: string; // 커스텀 드롭다운 목록 이름 (참조)
  options?: string[]; // select 타입인 경우 선택 옵션 (직접 입력 또는 폴백용)
  required?: boolean;
  min?: number; // number 타입인 경우 최소값
  max?: number; // number 타입인 경우 최대값
}

/**
 * 워크플로우 생성 데이터
 */
export interface WorkflowCreateData {
  name: string;
  description?: string;
  workflow_json: string;
  marked_fields?: MarkedField[];
  api_endpoint?: string;
  is_active?: boolean;
  is_public_page?: boolean;
  public_slug?: string | null;
  color?: string;
}

/**
 * 워크플로우 업데이트 데이터
 */
export interface WorkflowUpdateData {
  name?: string;
  description?: string;
  workflow_json?: string;
  marked_fields?: MarkedField[];
  api_endpoint?: string;
  is_active?: boolean;
  is_public_page?: boolean;
  public_slug?: string | null;
  color?: string;
}

/**
 * 이미지 생성 요청 데이터
 */
export interface GenerationRequest {
  workflow_id: number;
  prompt_data: Record<string, any>; // {field_id: value}
}

/**
 * ComfyUI API 응답 타입
 */
export interface ComfyUIPromptResponse {
  prompt_id: string;
  number: number;
  node_errors?: Record<string, any>;
}

export interface ComfyUIHistoryItem {
  prompt: any[];
  outputs: Record<string, {
    images?: Array<{
      filename: string;
      subfolder: string;
      type: string;
    }>;
  }>;
  status: {
    status_str: string;
    completed: boolean;
    messages?: any[];
  };
}

export interface ComfyUIHistoryResponse {
  [promptId: string]: ComfyUIHistoryItem;
}

/**
 * API 응답 타입
 */
export interface WorkflowResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export interface GenerationStatusResponse {
  id: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  provider_job_id?: string; // Preferred runtime-owned upstream job id (e.g. ComfyUI prompt id)
  comfyui_prompt_id?: string; // Legacy alias for compatibility
  generated_image_id?: string; // composite_hash (48-character string)
  generated_image?: any; // enriched image record
  error_message?: string;
  execution_time?: number; // Deprecated, not used in api_generation_history
  created_date: string;
}
