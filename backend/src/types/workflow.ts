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
  jsonPath: string; // JSON 경로 (예: "6.inputs.text")
  type: 'text' | 'number' | 'select' | 'textarea';
  default_value?: any;
  placeholder?: string;
  options?: string[]; // select 타입인 경우 선택 옵션
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
 * 생성 히스토리 레코드
 */
export interface GenerationHistoryRecord {
  id: number;
  workflow_id: number;
  prompt_data: string; // JSON string
  status: 'pending' | 'processing' | 'completed' | 'failed';
  comfyui_prompt_id?: string;
  generated_image_id?: number;
  error_message?: string;
  execution_time?: number; // 초 단위
  created_date: string;
}

/**
 * 생성 히스토리 생성 데이터
 */
export interface GenerationHistoryCreateData {
  workflow_id: number;
  prompt_data: Record<string, any>;
  status?: 'pending' | 'processing' | 'completed' | 'failed';
  comfyui_prompt_id?: string;
  generated_image_id?: number;
  error_message?: string;
  execution_time?: number;
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
  comfyui_prompt_id?: string;
  generated_image_id?: number;
  generated_image?: any; // enriched image record
  error_message?: string;
  execution_time?: number;
  created_date: string;
}
