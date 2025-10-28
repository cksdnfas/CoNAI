import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:1566/api';

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

export const wildcardApi = {
  /**
   * 모든 와일드카드 조회
   */
  getAllWildcards: async (withItems: boolean = true) => {
    const response = await axios.get<{ success: boolean; data: WildcardWithItems[] }>(
      `${API_BASE_URL}/wildcards`,
      { params: { withItems } }
    );
    return response.data;
  },

  /**
   * 특정 와일드카드 조회
   */
  getWildcard: async (id: number) => {
    const response = await axios.get<{ success: boolean; data: WildcardWithItems }>(
      `${API_BASE_URL}/wildcards/${id}`
    );
    return response.data;
  },

  /**
   * 와일드카드 생성
   */
  createWildcard: async (data: WildcardCreateData) => {
    const response = await axios.post<{
      success: boolean;
      data: WildcardWithItems;
      warning?: string;
    }>(
      `${API_BASE_URL}/wildcards`,
      data
    );
    return response.data;
  },

  /**
   * 와일드카드 수정
   */
  updateWildcard: async (id: number, data: WildcardUpdateData) => {
    const response = await axios.put<{
      success: boolean;
      data: WildcardWithItems;
      warning?: string;
    }>(
      `${API_BASE_URL}/wildcards/${id}`,
      data
    );
    return response.data;
  },

  /**
   * 와일드카드 삭제
   */
  deleteWildcard: async (id: number) => {
    const response = await axios.delete<{ success: boolean; message: string }>(
      `${API_BASE_URL}/wildcards/${id}`
    );
    return response.data;
  },

  /**
   * 와일드카드 파싱 (프리뷰용)
   */
  parseWildcards: async (parseRequest: ParseRequest) => {
    const response = await axios.post<{ success: boolean; data: ParseResponse }>(
      `${API_BASE_URL}/wildcards/parse`,
      parseRequest
    );
    return response.data;
  },

  /**
   * 와일드카드 통계
   */
  getStatistics: async () => {
    const response = await axios.get<{ success: boolean; data: WildcardStatistics }>(
      `${API_BASE_URL}/wildcards/stats/summary`
    );
    return response.data;
  },

  /**
   * 순환 참조 검사
   */
  checkCircularReference: async (id: number) => {
    const response = await axios.get<{ success: boolean; data: CircularCheckResponse }>(
      `${API_BASE_URL}/wildcards/${id}/circular-check`
    );
    return response.data;
  }
};
