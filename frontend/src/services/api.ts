import axios from 'axios';
import { getBackendOrigin } from '../utils/backend';
import type { ImageRecord, ImageListResponse, UploadResponse, ImageSearchParams, AutoTagSearchParams, UploadProgressEvent } from '../types/image';
import type {
  GroupRecord,
  GroupResponse,
  GroupWithStats,
  GroupCreateData,
  GroupUpdateData,
  AutoCollectResult,
  ComplexSearchRequest,
  ComplexSearchResponse
} from '@comfyui-image-manager/shared';
import type {
  PromptCollectionResponse,
  PromptGroupRecord,
  PromptGroupData,
  PromptGroupWithPrompts,
  PromptGroupResponse,
  GenerationHistoryRecord,
  GenerationHistoryFilters,
  GenerationHistoryResponse,
  GenerationHistoryStatistics,
  CreateComfyUIHistoryRequest,
  CreateNAIHistoryRequest
} from '@comfyui-image-manager/shared';

export const API_BASE_URL = getBackendOrigin();
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 이미지 관련 API (✅ composite_hash 기반으로 완전 전환)
export const imageApi = {
  // 이미지 목록 조회
  getImages: async (page: number = 1, limit: number = 25): Promise<ImageListResponse> => {
    const response = await api.get(`/api/images?page=${page}&limit=${limit}`);
    return response.data;
  },

  // 이미지 검색
  searchImages: async (params: ImageSearchParams): Promise<ImageListResponse> => {
    const response = await api.post('/api/images/search', params);
    return response.data;
  },

  // 오토태그 기반 이미지 검색
  searchByAutoTags: async (params: AutoTagSearchParams): Promise<ImageListResponse> => {
    const response = await api.post('/api/images/search-by-autotags', params);
    return response.data;
  },

  // 복합 필터 검색 (Complex Filter System)
  searchComplex: async (request: ComplexSearchRequest): Promise<ComplexSearchResponse> => {
    const response = await api.post('/api/images/search/complex', request);
    return response.data;
  },

  // 복잡한 검색 조건에 맞는 이미지 composite_hash 목록 조회 (랜덤 선택용)
  searchComplexIds: async (request: ComplexSearchRequest): Promise<{ success: boolean; data?: { composite_hashes: string[]; total: number }; error?: string }> => {
    const response = await api.post('/api/images/search/complex/ids', request);
    return response.data;
  },

  // 이미지 업로드 (단일)
  uploadImage: async (file: File): Promise<UploadResponse> => {
    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await api.post('/api/images/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 413) {
        return {
          success: false,
          error: '파일 크기가 너무 큽니다. 최대 50MB까지 업로드할 수 있습니다.'
        };
      }

      return {
        success: false,
        error: error.response?.data?.error || error.message || '업로드 중 오류가 발생했습니다.'
      };
    }
  },

  // 이미지 업로드 (다중)
  uploadImages: async (files: File[]): Promise<UploadResponse[]> => {
    try {
      const formData = new FormData();
      files.forEach(file => {
        formData.append('images', file);
      });

      const response = await api.post('/api/images/upload-multiple', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      // 백엔드 응답 구조에 맞게 처리
      if (response.data.success && response.data.data) {
        const { uploaded, failed } = response.data.data;
        const results: UploadResponse[] = [];

        // 성공한 업로드들을 UploadResponse 형태로 변환
        uploaded.forEach((item: any) => {
          results.push({
            success: true,
            data: item
          });
        });

        // 실패한 업로드들을 UploadResponse 형태로 변환
        failed.forEach((item: any) => {
          results.push({
            success: false,
            error: item.error
          });
        });

        return results;
      }

      // 실패한 경우
      return [{
        success: false,
        error: response.data.error || '업로드에 실패했습니다.'
      }];
    } catch (error: any) {
      // 특정 에러 처리
      if (error.response?.status === 400 && error.response?.data?.error?.includes('LIMIT_FILE_COUNT')) {
        return [{
          success: false,
          error: '업로드 파일 개수가 제한을 초과했습니다.'
        }];
      }

      if (error.response?.status === 413) {
        return [{
          success: false,
          error: '파일 크기가 너무 큽니다. 파일당 최대 50MB까지 업로드할 수 있습니다.'
        }];
      }

      return [{
        success: false,
        error: error.response?.data?.error || error.message || '업로드 중 오류가 발생했습니다.'
      }];
    }
  },

  // 이미지 업로드 (다중 - SSE 스트리밍)
  uploadImagesWithProgress: async (
    files: File[],
    onProgress: (event: UploadProgressEvent) => void
  ): Promise<void> => {
    const formData = new FormData();
    files.forEach(file => {
      formData.append('images', file);
    });

    const response = await fetch(`${API_BASE_URL}/api/images/upload-multiple-stream`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // 청크를 문자열로 디코딩하여 버퍼에 추가
        buffer += decoder.decode(value, { stream: true });

        // 라인 단위로 분리
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 마지막 불완전한 라인은 버퍼에 유지

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6)) as UploadProgressEvent;
              onProgress(event);
            } catch (parseError) {
              console.warn('Failed to parse SSE event:', line, parseError);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },

  // ✅ 이미지 상세 조회 (composite_hash 기반)
  getImage: async (compositeHash: string): Promise<{ success: boolean; data?: ImageRecord; error?: string }> => {
    const response = await api.get(`/api/images/${compositeHash}`);
    return response.data;
  },

  // ✅ 이미지 삭제 (composite_hash 기반)
  deleteImage: async (compositeHash: string): Promise<{ success: boolean; error?: string }> => {
    const response = await api.delete(`/api/images/${compositeHash}`);
    return response.data;
  },

  // ✅ 다중 이미지 삭제 (composite_hash 기반)
  deleteImages: async (compositeHashes: string[]): Promise<{ success: boolean; error?: string }[]> => {
    const promises = compositeHashes.map(hash => imageApi.deleteImage(hash));
    return Promise.all(promises);
  },

  // ✅ 이미지 다운로드 URL 생성 (composite_hash 기반)
  getDownloadUrl: (compositeHash: string, type: 'original' | 'optimized' = 'original'): string => {
    return `${API_BASE_URL}/api/images/${compositeHash}/download/${type}`;
  },

  // ✅ 썸네일 URL 생성 (composite_hash 기반)
  getThumbnailUrl: (compositeHash: string): string => {
    return `${API_BASE_URL}/api/images/${compositeHash}/thumbnail`;
  },

  // ✅ 최적화 이미지 URL 생성 (composite_hash 기반)
  getOptimizedUrl: (compositeHash: string): string => {
    return `${API_BASE_URL}/api/images/${compositeHash}/optimized`;
  },

  // 랜덤 이미지 조회
  getRandomImage: async (): Promise<{ success: boolean; data?: ImageRecord; error?: string }> => {
    const response = await api.get('/api/images/random');
    return response.data;
  },

  // 검색 조건에 맞는 랜덤 이미지 조회
  getRandomFromSearch: async (params: ImageSearchParams): Promise<{ success: boolean; data?: ImageRecord; error?: string }> => {
    const response = await api.post('/api/images/random-from-search', params);
    return response.data;
  },

  // ✅ 검색 조건에 맞는 이미지 composite_hash 목록 조회 (랜덤 선택용)
  searchImageIds: async (params: ImageSearchParams): Promise<{ success: boolean; data?: { composite_hashes: string[]; total: number }; error?: string }> => {
    const response = await api.post('/api/images/search/ids', params);
    return response.data;
  },
};

// 그룹 관련 API
export const groupApi = {
  // 모든 그룹 조회 (통계 포함)
  getGroups: async (): Promise<{ success: boolean; data?: GroupWithStats[]; error?: string }> => {
    const response = await api.get('/api/groups');
    return response.data;
  },

  // 특정 그룹 조회
  getGroup: async (id: number): Promise<{ success: boolean; data?: GroupRecord; error?: string }> => {
    const response = await api.get(`/api/groups/${id}`);
    return response.data;
  },

  // 새 그룹 생성
  createGroup: async (groupData: GroupCreateData): Promise<GroupResponse> => {
    const response = await api.post('/api/groups', groupData);
    return response.data;
  },

  // 그룹 업데이트
  updateGroup: async (id: number, groupData: GroupUpdateData): Promise<GroupResponse> => {
    const response = await api.put(`/api/groups/${id}`, groupData);
    return response.data;
  },

  // 그룹 삭제
  deleteGroup: async (id: number): Promise<GroupResponse> => {
    const response = await api.delete(`/api/groups/${id}`);
    return response.data;
  },

  // 특정 그룹의 이미지 목록 조회
  getGroupImages: async (
    id: number,
    page: number = 1,
    limit: number = 20,
    collectionType?: 'manual' | 'auto'
  ): Promise<GroupResponse> => {
    let url = `/api/groups/${id}/images?page=${page}&limit=${limit}`;
    if (collectionType) {
      url += `&collection_type=${collectionType}`;
    }
    const response = await api.get(url);
    return response.data;
  },

  // ✅ 이미지를 그룹에 수동 추가 (composite_hash 기반)
  addImageToGroup: async (groupId: number, compositeHash: string, orderIndex: number = 0): Promise<GroupResponse> => {
    const response = await api.post(`/api/groups/${groupId}/images`, {
      composite_hash: compositeHash,
      order_index: orderIndex
    });
    return response.data;
  },

  // ✅ 여러 이미지를 그룹에 수동 추가 (composite_hash 기반)
  addImagesToGroup: async (groupId: number, compositeHashes: string[]): Promise<GroupResponse> => {
    const response = await api.post(`/api/groups/${groupId}/images/bulk`, {
      composite_hashes: compositeHashes
    });
    return response.data;
  },

  // ✅ 그룹에서 이미지 제거 (composite_hash 기반)
  removeImageFromGroup: async (groupId: number, compositeHash: string): Promise<GroupResponse> => {
    const response = await api.delete(`/api/groups/${groupId}/images/${compositeHash}`);
    return response.data;
  },

  // ✅ 그룹에서 여러 이미지 제거 (composite_hash 기반)
  removeImagesFromGroup: async (groupId: number, compositeHashes: string[]): Promise<{ success: boolean; removed: number; errors: string[] }> => {
    let removedCount = 0;
    const errors: string[] = [];

    for (const compositeHash of compositeHashes) {
      try {
        const response = await api.delete(`/api/groups/${groupId}/images/${compositeHash}`);
        if (response.data.success) {
          removedCount++;
        } else {
          errors.push(`Image ${compositeHash}: ${response.data.error || 'Failed to remove'}`);
        }
      } catch (error: any) {
        errors.push(`Image ${compositeHash}: ${error.response?.data?.error || error.message || 'Failed to remove'}`);
      }
    }

    return {
      success: errors.length === 0,
      removed: removedCount,
      errors
    };
  },

  // 그룹의 자동수집 실행
  runAutoCollection: async (id: number): Promise<{ success: boolean; data?: AutoCollectResult; error?: string }> => {
    const response = await api.post(`/api/groups/${id}/auto-collect`);
    return response.data;
  },

  // 모든 그룹의 자동수집 실행
  runAllAutoCollection: async (): Promise<{ success: boolean; data?: any; error?: string }> => {
    const response = await api.post('/api/groups/auto-collect-all');
    return response.data;
  },

  // 그룹 썸네일 URL 생성
  getThumbnailUrl: (id: number): string => {
    return `${API_BASE_URL}/api/groups/${id}/thumbnail`;
  },

  // 그룹의 랜덤 이미지 조회
  getRandomImageFromGroup: async (id: number): Promise<{ success: boolean; data?: ImageRecord; error?: string }> => {
    const response = await api.get(`/api/groups/${id}/random-image`);
    return response.data;
  },

  // ✅ 그룹에 속한 이미지 composite_hash 목록 조회 (랜덤 선택용)
  getImageIdsForGroup: async (id: number): Promise<{ success: boolean; data?: { composite_hashes: string[]; total: number }; error?: string }> => {
    const response = await api.get(`/api/groups/${id}/image-ids`);
    return response.data;
  },
};

// 프롬프트 수집 관련 API
export const promptCollectionApi = {
  // 프롬프트 검색
  searchPrompts: async (
    query: string = '',
    type: 'positive' | 'negative' | 'both' = 'both',
    page: number = 1,
    limit: number = 20,
    sortBy: 'usage_count' | 'created_at' | 'prompt' = 'usage_count',
    sortOrder: 'ASC' | 'DESC' = 'DESC',
    groupId?: number | null
  ): Promise<PromptCollectionResponse & { pagination?: any; group_info?: any }> => {
    let url = `/api/prompt-collection/search?q=${encodeURIComponent(query)}&type=${type}&page=${page}&limit=${limit}&sortBy=${sortBy}&sortOrder=${sortOrder}`;
    if (groupId !== undefined) {
      url += `&group_id=${groupId}`;
    }
    const response = await api.get(url);
    return response.data;
  },

  // 프롬프트 삭제
  deletePrompt: async (promptId: number, type: 'positive' | 'negative' = 'positive'): Promise<PromptCollectionResponse> => {
    const response = await api.delete(`/api/prompt-collection/${promptId}?type=${type}`);
    return response.data;
  },

  // 프롬프트를 그룹에 할당
  assignPromptToGroup: async (
    promptId: number,
    groupId: number | null,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptCollectionResponse> => {
    const response = await api.put('/api/prompt-collection/assign-group', {
      prompt_id: promptId,
      group_id: groupId,
      type
    });
    return response.data;
  },

  // 프롬프트 대량 할당
  batchAssignPromptsToGroup: async (
    prompts: string[],
    groupId: number | null,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptCollectionResponse & { created?: number; updated?: number; failed?: string[] }> => {
    const response = await api.post('/api/prompt-collection/batch-assign', {
      prompts,
      group_id: groupId,
      type
    });
    return response.data;
  },

  // 프롬프트 통계 조회
  getStatistics: async (): Promise<PromptCollectionResponse> => {
    const response = await api.get('/api/prompt-collection/statistics');
    return response.data;
  },

  // 인기 프롬프트 조회
  getTopPrompts: async (
    limit: number = 20,
    type: 'positive' | 'negative' | 'both' = 'both'
  ): Promise<PromptCollectionResponse> => {
    const response = await api.get(`/api/prompt-collection/top?limit=${limit}&type=${type}`);
    return response.data;
  },

  // 동의어 설정
  setSynonyms: async (
    mainPrompt: string,
    synonyms: string[],
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptCollectionResponse> => {
    const response = await api.post('/api/prompt-collection/synonyms', {
      mainPrompt,
      synonyms,
      type
    });
    return response.data;
  },

  // 동의어 제거
  removeSynonym: async (
    promptId: number,
    synonym: string,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptCollectionResponse> => {
    const response = await api.delete(`/api/prompt-collection/synonyms/${promptId}`, {
      data: { synonym, type }
    });
    return response.data;
  },
};

// 프롬프트 그룹 관련 API
export const promptGroupApi = {
  // 모든 그룹 조회
  getGroups: async (
    includeHidden: boolean = false,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<{ success: boolean; data?: PromptGroupWithPrompts[]; error?: string }> => {
    const response = await api.get(`/api/prompt-groups?include_hidden=${includeHidden}&type=${type}`);
    return response.data;
  },

  // 특정 그룹 조회
  getGroup: async (
    id: number,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<{ success: boolean; data?: PromptGroupRecord; error?: string }> => {
    const response = await api.get(`/api/prompt-groups/${id}?type=${type}`);
    return response.data;
  },

  // 특정 그룹의 프롬프트 목록 조회
  getGroupPrompts: async (
    id: number,
    type: 'positive' | 'negative' = 'positive',
    page: number = 1,
    limit: number = 20
  ): Promise<PromptGroupResponse> => {
    const response = await api.get(`/api/prompt-groups/${id}/prompts?type=${type}&page=${page}&limit=${limit}`);
    return response.data;
  },

  // 새 그룹 생성
  createGroup: async (
    groupData: PromptGroupData,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptGroupResponse> => {
    const response = await api.post(`/api/prompt-groups?type=${type}`, groupData);
    return response.data;
  },

  // 그룹 정보 업데이트
  updateGroup: async (
    id: number,
    groupData: PromptGroupData,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptGroupResponse> => {
    const response = await api.put(`/api/prompt-groups/${id}`, { ...groupData, type });
    return response.data;
  },

  // 그룹 삭제
  deleteGroup: async (
    id: number,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptGroupResponse> => {
    const response = await api.delete(`/api/prompt-groups/${id}?type=${type}`);
    return response.data;
  },

  // 프롬프트를 다른 그룹으로 이동
  movePromptToGroup: async (
    promptId: number,
    targetGroupId: number | null,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptGroupResponse> => {
    const response = await api.put('/api/prompt-groups/move-prompt', {
      prompt_id: promptId,
      target_group_id: targetGroupId,
      type
    });
    return response.data;
  },

  // 그룹 순서 일괄 업데이트
  updateGroupOrders: async (
    groupOrders: { id: number; display_order: number }[],
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptGroupResponse> => {
    const response = await api.put('/api/prompt-groups/reorder', {
      group_orders: groupOrders,
      type
    });
    return response.data;
  },
};

// NovelAI 관련 API
export const naiApi = {
  // NovelAI 로그인 (이메일/비밀번호)
  login: async (username: string, password: string): Promise<{ accessToken: string; expiresAt: string }> => {
    const response = await api.post('/api/nai/auth/login', { username, password });
    return response.data;
  },

  // NovelAI 로그인 (토큰)
  loginWithToken: async (token: string): Promise<{ accessToken: string; expiresAt: string }> => {
    const response = await api.post('/api/nai/auth/login-with-token', { token });
    return response.data;
  },

  // NovelAI 이미지 생성
  generateImage: async (
    token: string,
    params: {
      prompt: string;
      negative_prompt?: string;
      model?: string;
      width?: number;
      height?: number;
      steps?: number;
      scale?: number;
      sampler?: string;
      n_samples?: number;
      sm?: boolean;
      sm_dyn?: boolean;
      cfg_rescale?: number;
      noise_schedule?: string;
      uncond_scale?: number;
      qualityToggle?: boolean;
      seed?: number;
      groupId?: number;
      // img2img/inpaint 관련
      image?: string;
      strength?: number;
      noise?: number;
      mask?: string;
      // Vibe Transfer
      reference_image_multiple?: string[];
      reference_strength_multiple?: number[];
    }
  ): Promise<{
    historyIds: number[];
    count: number;
    metadata: {
      prompt: string;
      negative_prompt: string;
      seed: number;
      resolution: string;
      steps: number;
      scale: number;
      sampler: string;
      model: string;
    };
  }> => {
    const response = await api.post('/api/nai/generate/image', params, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    return response.data;
  }
};

// Generation History API (Image Generation Page only)
export const generationHistoryApi = {
  // Get all generation history with filters
  getAll: async (filters?: GenerationHistoryFilters): Promise<GenerationHistoryResponse> => {
    const params = new URLSearchParams();
    if (filters?.service_type) params.append('service_type', filters.service_type);
    if (filters?.generation_status) params.append('generation_status', filters.generation_status);
    if (filters?.limit) params.append('limit', filters.limit.toString());
    if (filters?.offset) params.append('offset', filters.offset.toString());

    const response = await api.get(`/api/generation-history?${params.toString()}`);
    return response.data;
  },

  // Get recent generation history
  getRecent: async (limit: number = 50): Promise<{ success: boolean; records: GenerationHistoryRecord[] }> => {
    const response = await api.get(`/api/generation-history/recent?limit=${limit}`);
    return response.data;
  },

  // Get generation statistics
  getStatistics: async (): Promise<{ success: boolean; statistics: GenerationHistoryStatistics }> => {
    const response = await api.get('/api/generation-history/statistics');
    return response.data;
  },

  // Get specific history by ID
  getById: async (id: number): Promise<{ success: boolean; record: GenerationHistoryRecord }> => {
    const response = await api.get(`/api/generation-history/${id}`);
    return response.data;
  },

  // Create ComfyUI history
  createComfyUI: async (data: CreateComfyUIHistoryRequest): Promise<{ success: boolean; historyId: number; message: string }> => {
    const response = await api.post('/api/generation-history/comfyui', data);
    return response.data;
  },

  // Create NovelAI history
  createNovelAI: async (data: CreateNAIHistoryRequest): Promise<{ success: boolean; historyId: number; message: string }> => {
    const response = await api.post('/api/generation-history/novelai', data);
    return response.data;
  },

  // Upload image for history
  uploadImage: async (historyId: number, imageBlob: Blob): Promise<{ success: boolean; message: string }> => {
    const formData = new FormData();
    formData.append('image', imageBlob, 'generated.png');

    const response = await api.post(`/api/generation-history/${historyId}/upload-image`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    return response.data;
  },

  // Delete history
  delete: async (id: number): Promise<{ success: boolean; message: string }> => {
    const response = await api.delete(`/api/generation-history/${id}`);
    return response.data;
  },

  // Get generation history by workflow ID (ComfyUI only)
  getByWorkflow: async (
    workflowId: number,
    filters?: Omit<GenerationHistoryFilters, 'workflow_id'>
  ): Promise<GenerationHistoryResponse> => {
    const params = new URLSearchParams();
    if (filters?.generation_status) params.append('generation_status', filters.generation_status);
    if (filters?.limit) params.append('limit', filters.limit.toString());
    if (filters?.offset) params.append('offset', filters.offset.toString());

    const response = await api.get(`/api/generation-history/workflow/${workflowId}?${params.toString()}`);
    return response.data;
  },

  // Get workflow statistics (ComfyUI only)
  getWorkflowStatistics: async (workflowId: number): Promise<{
    success: boolean;
    statistics: {
      total: number;
      completed: number;
      failed: number;
      pending: number;
      processing: number;
    };
    workflowId: number;
  }> => {
    const response = await api.get(`/api/generation-history/workflow/${workflowId}/statistics`);
    return response.data;
  }
};

export default api;
