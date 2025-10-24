import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:1566/api';

export interface Workflow {
  id: number;
  name: string;
  description?: string;
  workflow_json: string;
  marked_fields?: MarkedField[];
  api_endpoint: string;
  is_active: boolean;
  created_date: string;
  updated_date: string;
}

export interface MarkedField {
  id: string;
  label: string;
  jsonPath: string;
  type: 'text' | 'number' | 'select' | 'textarea';
  default_value?: any;
  placeholder?: string;
  options?: string[];
  required?: boolean;
  min?: number;
  max?: number;
}

export interface GenerationHistory {
  id: number;
  workflow_id: number;
  prompt_data: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  comfyui_prompt_id?: string;
  generated_image_id?: number;
  generated_image?: any;
  error_message?: string;
  execution_time?: number;
  created_date: string;
}

export const workflowApi = {
  // 워크플로우 목록 조회
  getAllWorkflows: async (activeOnly: boolean = false) => {
    const response = await axios.get(`${API_BASE_URL}/workflows`, {
      params: { active: activeOnly }
    });
    return response.data;
  },

  // 워크플로우 상세 조회
  getWorkflow: async (id: number) => {
    const response = await axios.get(`${API_BASE_URL}/workflows/${id}`);
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
    const response = await axios.post(`${API_BASE_URL}/workflows`, data);
    return response.data;
  },

  // 워크플로우 수정
  updateWorkflow: async (id: number, data: Partial<Workflow>) => {
    const response = await axios.put(`${API_BASE_URL}/workflows/${id}`, data);
    return response.data;
  },

  // 워크플로우 삭제
  deleteWorkflow: async (id: number) => {
    const response = await axios.delete(`${API_BASE_URL}/workflows/${id}`);
    return response.data;
  },

  // 이미지 생성 (단일 서버)
  generateImage: async (id: number, promptData: Record<string, any>) => {
    const response = await axios.post(`${API_BASE_URL}/workflows/${id}/generate`, {
      prompt_data: promptData
    });
    return response.data;
  },

  // 특정 서버로 이미지 생성
  generateImageOnServer: async (id: number, serverId: number, promptData: Record<string, any>, groupId?: number) => {
    const response = await axios.post(`${API_BASE_URL}/workflows/${id}/generate`, {
      prompt_data: promptData,
      server_id: serverId,
      groupId: groupId
    });
    return response.data;
  },

  // 이미지 생성 (병렬 - 멀티 서버)
  generateImageParallel: async (id: number, promptData: Record<string, any>) => {
    const response = await axios.post(`${API_BASE_URL}/workflows/${id}/generate-parallel`, {
      prompt_data: promptData
    });
    return response.data;
  },

  // 생성 히스토리 조회
  getHistory: async (id: number, page: number = 1, limit: number = 20) => {
    const response = await axios.get(`${API_BASE_URL}/workflows/${id}/history`, {
      params: { page, limit }
    });
    return response.data;
  },

  // 생성 상태 조회
  getGenerationStatus: async (historyId: number) => {
    const response = await axios.get(`${API_BASE_URL}/workflows/history/${historyId}`);
    return response.data;
  },

  // 연결된 서버 목록 조회
  getWorkflowServers: async (id: number) => {
    const response = await axios.get(`${API_BASE_URL}/workflows/${id}/servers`);
    return response.data;
  },

  // 서버 연결
  linkServers: async (id: number, serverIds: number[]) => {
    const response = await axios.post(`${API_BASE_URL}/workflows/${id}/servers`, {
      server_ids: serverIds
    });
    return response.data;
  },

  // 서버 연결 해제
  unlinkServer: async (id: number, serverId: number) => {
    const response = await axios.delete(`${API_BASE_URL}/workflows/${id}/servers/${serverId}`);
    return response.data;
  }
};
