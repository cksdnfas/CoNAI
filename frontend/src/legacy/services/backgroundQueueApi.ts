import apiClient from './api/apiClient';
import type { BackgroundQueueStatus } from '../types/folder';

/**
 * 백그라운드 큐 상태 조회
 */
export const getQueueStatus = async (): Promise<BackgroundQueueStatus> => {
  const response = await apiClient.get('/api/background-queue/status');
  return response.data.data;
};

/**
 * 백그라운드 큐 초기화
 */
export const clearQueue = async (): Promise<{ message: string }> => {
  const response = await apiClient.post('/api/background-queue/clear', null);
  return response.data.data;
};

/**
 * 자동 태깅 수동 트리거
 */
export const triggerAutoTag = async (): Promise<{ message: string }> => {
  const response = await apiClient.post('/api/background-queue/trigger-auto-tag', null);
  return response.data.data;
};

/**
 * 해시 미생성 이미지 통계 조회
 */
export const getHashStats = async (): Promise<{
  totalImages: number;
  imagesWithoutHash: number;
  imagesWithHash: number;
  completionPercentage: number;
}> => {
  const response = await apiClient.get('/api/images/similarity/stats');
  return response.data.data;
};

/**
 * 해시 재생성 작업 트리거
 */
export const rebuildHashes = async (): Promise<{
  message: string;
  processed: number;
  failed: number;
  total: number;
  remaining: number;
}> => {
  const response = await apiClient.post('/api/images/similarity/rebuild-hashes', null);
  return response.data.data;
};

export const backgroundQueueApi = {
  getQueueStatus,
  clearQueue,
  triggerAutoTag,
  getHashStats,
  rebuildHashes
};
