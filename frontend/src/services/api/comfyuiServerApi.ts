import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:1666/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

export interface ComfyUIServer {
  id: number;
  name: string;
  endpoint: string;
  description?: string;
  is_active: boolean;
  created_date: string;
  updated_date: string;
}

export interface ServerStatus {
  server_id: number;
  server_name: string;
  endpoint: string;
  isConnected: boolean;
  response_time?: number;
  error?: string;
}

export const comfyuiServerApi = {
  // 서버 목록 조회
  getAllServers: async (activeOnly: boolean = false) => {
    const response = await api.get('/comfyui-servers', {
      params: { active: activeOnly }
    });
    return response.data;
  },

  // 서버 상세 조회
  getServer: async (id: number) => {
    const response = await api.get(`/comfyui-servers/${id}`);
    return response.data;
  },

  // 서버 생성
  createServer: async (data: {
    name: string;
    endpoint: string;
    description?: string;
    is_active?: boolean;
  }) => {
    const response = await api.post('/comfyui-servers', data);
    return response.data;
  },

  // 서버 수정
  updateServer: async (id: number, data: Partial<ComfyUIServer>) => {
    const response = await api.put(`/comfyui-servers/${id}`, data);
    return response.data;
  },

  // 서버 삭제
  deleteServer: async (id: number) => {
    const response = await api.delete(`/comfyui-servers/${id}`);
    return response.data;
  },

  // 서버 연결 테스트
  testConnection: async (id: number) => {
    const response = await api.get(`/comfyui-servers/${id}/test-connection`);
    return response.data;
  },

  // 모든 서버 연결 테스트
  testAllConnections: async () => {
    const response = await api.get('/comfyui-servers/test-all-connections');
    return response.data;
  },

  // 서버를 사용하는 워크플로우 목록
  getServerWorkflows: async (id: number) => {
    const response = await api.get(`/comfyui-servers/${id}/workflows`);
    return response.data;
  }
};
