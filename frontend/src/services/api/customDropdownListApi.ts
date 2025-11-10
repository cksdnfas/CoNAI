import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:1566/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

export interface CustomDropdownList {
  id: number;
  name: string;
  description?: string;
  items: string[];
  is_auto_collected: boolean;
  source_path?: string;
  created_date: string;
  updated_date: string;
}

export interface CreateCustomDropdownListData {
  name: string;
  description?: string;
  items: string[];
}

export interface UpdateCustomDropdownListData {
  name?: string;
  description?: string;
  items?: string[];
}

export interface ComfyUIModelFolder {
  folderName: string;
  displayName: string;
  files: string[];
}

export interface ScanComfyUIModelsResponse {
  success: boolean;
  data: {
    scannedFolders: number;
    createdLists: number;
    isRescan: boolean;
    message: string;
  };
}

export const customDropdownListApi = {
  // 모든 커스텀 드롭다운 목록 조회
  getAllLists: async () => {
    const response = await api.get('/custom-dropdown-lists');
    return response.data;
  },

  // 특정 커스텀 드롭다운 목록 조회
  getList: async (id: number) => {
    const response = await api.get(`/custom-dropdown-lists/${id}`);
    return response.data;
  },

  // 커스텀 드롭다운 목록 생성
  createList: async (data: CreateCustomDropdownListData) => {
    const response = await api.post('/custom-dropdown-lists', data);
    return response.data;
  },

  // 커스텀 드롭다운 목록 수정
  updateList: async (id: number, data: UpdateCustomDropdownListData) => {
    const response = await api.put(`/custom-dropdown-lists/${id}`, data);
    return response.data;
  },

  // 커스텀 드롭다운 목록 삭제
  deleteList: async (id: number) => {
    const response = await api.delete(`/custom-dropdown-lists/${id}`);
    return response.data;
  },

  // ComfyUI 모델 스캔
  scanComfyUIModels: async (modelsPath: string): Promise<ScanComfyUIModelsResponse> => {
    const response = await api.post('/custom-dropdown-lists/scan-comfyui-models', {
      modelsPath
    });
    return response.data;
  },
};
