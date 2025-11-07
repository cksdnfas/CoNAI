import axios from 'axios';
import type { BackgroundQueueStatus } from '../types/folder';
import { API_BASE_URL } from './api/config';

/**
 * 백그라운드 큐 상태 조회
 */
export const getQueueStatus = async (): Promise<BackgroundQueueStatus> => {
  const response = await axios.get(`${API_BASE_URL}/api/background-queue/status`);
  return response.data.data;
};

/**
 * 백그라운드 큐 초기화
 */
export const clearQueue = async (): Promise<{ message: string }> => {
  const response = await axios.post(`${API_BASE_URL}/api/background-queue/clear`);
  return response.data.data;
};

/**
 * 자동 태깅 수동 트리거
 */
export const triggerAutoTag = async (): Promise<{ message: string }> => {
  const response = await axios.post(`${API_BASE_URL}/api/background-queue/trigger-auto-tag`);
  return response.data.data;
};

export const backgroundQueueApi = {
  getQueueStatus,
  clearQueue,
  triggerAutoTag
};
