import apiClient from './apiClient';

export interface Workflow {
  id: number;
  name: string;
  description?: string;
  workflow_json: string;
  marked_fields?: MarkedField[];
  api_endpoint: string;
  is_active: boolean;
  color: string;
  created_date: string;
  updated_date: string;
}

export interface MarkedField {
  id: string;
  label: string;
  jsonPath: string;
  type: 'text' | 'number' | 'select' | 'textarea' | 'image';
  default_value?: any;
  placeholder?: string;
  dropdown_list_name?: string; // 커스텀 드롭다운 목록 이름 (참조)
  options?: string[]; // select 타입인 경우 선택 옵션 (직접 입력 또는 폴백용)
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
}

export interface GenerationHistory {
  id: number;
  workflow_id: number;
  prompt_data: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  comfyui_prompt_id?: string;
  generated_image_id?: string;  // composite_hash of the generated image
  generated_image?: any;
  error_message?: string;
  execution_time?: number;
  created_date: string;
}

export const workflowApi = {
  // 워크플로우 목록 조회
  getAllWorkflows: async (activeOnly: boolean = false) => {
    const response = await apiClient.get('/api/workflows', {
      params: { active: activeOnly }
    });
    return response.data;
  },

  // 워크플로우 상세 조회
  getWorkflow: async (id: number) => {
    const response = await apiClient.get(`/api/workflows/${id}`);
    return response.data;
  },

  // 워크플로우 생성
  createWorkflow: async (data: {
    name: string;
    description?: string;
    workflow_json: string;
    marked_fields?: MarkedField[];
    is_active?: boolean;
  }) => {
    const response = await apiClient.post('/api/workflows', data);
    return response.data;
  },

  // 워크플로우 수정
  updateWorkflow: async (id: number, data: Partial<Workflow>) => {
    const response = await apiClient.put(`/api/workflows/${id}`, data);
    return response.data;
  },

  // 워크플로우 삭제
  deleteWorkflow: async (id: number) => {
    const response = await apiClient.delete(`/api/workflows/${id}`);
    return response.data;
  },

  // 이미지 생성 (단일 서버)
  generateImage: async (id: number, promptData: Record<string, any>) => {
    const response = await apiClient.post(`/api/workflows/${id}/generate`, {
      prompt_data: promptData
    });
    return response.data;
  },

  // 특정 서버로 이미지 생성
  generateImageOnServer: async (id: number, serverId: number, promptData: Record<string, any>, groupId?: number) => {
    const response = await apiClient.post(`/api/workflows/${id}/generate`, {
      prompt_data: promptData,
      server_id: serverId,
      groupId: groupId
    });
    return response.data;
  },

  // 이미지 생성 (병렬 - 멀티 서버)
  generateImageParallel: async (id: number, promptData: Record<string, any>) => {
    const response = await apiClient.post(`/api/workflows/${id}/generate-parallel`, {
      prompt_data: promptData
    });
    return response.data;
  },

  // 생성 히스토리 조회
  getHistory: async (id: number, page: number = 1, limit: number = 20) => {
    const response = await apiClient.get(`/api/workflows/${id}/history`, {
      params: { page, limit }
    });
    return response.data;
  },

  // 생성 상태 조회
  getGenerationStatus: async (historyId: number) => {
    const response = await apiClient.get(`/api/workflows/history/${historyId}`);
    return response.data;
  },

  // 연결된 서버 목록 조회
  getWorkflowServers: async (id: number) => {
    const response = await apiClient.get(`/api/workflows/${id}/servers`);
    return response.data;
  },

  // 서버 연결
  linkServers: async (id: number, serverIds: number[]) => {
    const response = await apiClient.post(`/api/workflows/${id}/servers`, {
      server_ids: serverIds
    });
    return response.data;
  },

  // 서버 연결 해제
  unlinkServer: async (id: number, serverId: number) => {
    const response = await apiClient.delete(`/api/workflows/${id}/servers/${serverId}`);
    return response.data;
  },

  // Canvas 폴더 이미지 목록 조회
  getCanvasImages: async () => {
    const response = await apiClient.get('/api/workflows/canvas-images');
    return response.data;
  }
};
