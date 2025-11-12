import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:1566/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

export interface Wildcard {
  id: number;
  name: string;
  description?: string;
  created_date: string;
  updated_date: string;
}

export interface WildcardItem {
  id: number;
  wildcard_id: number;
  tool: 'comfyui' | 'nai';
  content: string;
  order_index: number;
  created_date: string;
}

export interface WildcardWithItems extends Wildcard {
  items: WildcardItem[];
}

export interface ToolItems {
  comfyui: string[];
  nai: string[];
}

export interface WildcardCreateData {
  name: string;
  description?: string;
  items: ToolItems;
}

export interface WildcardUpdateData {
  name?: string;
  description?: string;
  items?: ToolItems;
}

export interface ParseRequest {
  text: string;
  tool: 'comfyui' | 'nai';
  count?: number;
}

export interface ParseResponse {
  original: string;
  results: string[];
  usedWildcards: string[];
}

export interface WildcardStatistics {
  totalWildcards: number;
  itemsByTool: {
    comfyui: number;
    nai: number;
  };
  totalItems: number;
  averageItemsPerWildcard: number;
}

export interface CircularCheckResponse {
  hasCircularReference: boolean;
  circularPath: string[];
}

export interface LoraScanRequest {
  folderPath: string;
  loraWeight: number;
  duplicateHandling: 'number' | 'parent';
}

export interface LoraScanLog {
  timestamp: string;
  folderPath: string;
  loraWeight: number;
  duplicateHandling: 'number' | 'parent';
  totalWildcards: number;
  totalItems: number;
  wildcards: Array<{
    id: number;
    name: string;
    itemCount: number;
    folderName: string;
  }>;
}

export interface LoraScanResponse {
  created: number;
  log: LoraScanLog;
}

export const wildcardApi = {
  /**
   * 모든 와일드카드 조회
   */
  getAllWildcards: async (withItems: boolean = true) => {
    const response = await api.get<{ success: boolean; data: WildcardWithItems[] }>(
      '/wildcards',
      { params: { withItems } }
    );
    return response.data;
  },

  /**
   * 특정 와일드카드 조회
   */
  getWildcard: async (id: number) => {
    const response = await api.get<{ success: boolean; data: WildcardWithItems }>(
      `/wildcards/${id}`
    );
    return response.data;
  },

  /**
   * 와일드카드 생성
   */
  createWildcard: async (data: WildcardCreateData) => {
    const response = await api.post<{
      success: boolean;
      data: WildcardWithItems;
      warning?: string;
    }>(
      '/wildcards',
      data
    );
    return response.data;
  },

  /**
   * 와일드카드 수정
   */
  updateWildcard: async (id: number, data: WildcardUpdateData) => {
    const response = await api.put<{
      success: boolean;
      data: WildcardWithItems;
      warning?: string;
    }>(
      `/wildcards/${id}`,
      data
    );
    return response.data;
  },

  /**
   * 와일드카드 삭제
   */
  deleteWildcard: async (id: number) => {
    const response = await api.delete<{ success: boolean; message: string }>(
      `/wildcards/${id}`
    );
    return response.data;
  },

  /**
   * 와일드카드 파싱 (프리뷰용)
   */
  parseWildcards: async (parseRequest: ParseRequest) => {
    const response = await api.post<{ success: boolean; data: ParseResponse }>(
      '/wildcards/parse',
      parseRequest
    );
    return response.data;
  },

  /**
   * 와일드카드 통계
   */
  getStatistics: async () => {
    const response = await api.get<{ success: boolean; data: WildcardStatistics }>(
      '/wildcards/stats/summary'
    );
    return response.data;
  },

  /**
   * 순환 참조 검사
   */
  checkCircularReference: async (id: number) => {
    const response = await api.get<{ success: boolean; data: CircularCheckResponse }>(
      `/wildcards/${id}/circular-check`
    );
    return response.data;
  },

  /**
   * LORA 폴더 스캔하여 와일드카드 자동 생성
   */
  scanLoraFolder: async (scanRequest: LoraScanRequest) => {
    const response = await api.post<{ success: boolean; data: LoraScanResponse }>(
      '/wildcards/scan-lora-folder',
      scanRequest
    );
    return response.data;
  },

  /**
   * 마지막 LORA 스캔 로그 조회
   */
  getLastScanLog: async () => {
    const response = await api.get<{ success: boolean; data: LoraScanLog | null }>(
      '/wildcards/last-scan-log'
    );
    return response.data;
  }
};
