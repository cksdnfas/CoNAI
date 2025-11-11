import axios from 'axios';
import type {
  WatchedFolder,
  WatchedFolderCreate,
  WatchedFolderUpdate,
  FolderScanResult,
  ScanAllSummary,
  PathValidationResult,
  WatcherStatusInfo,
  WatcherHealthCheck
} from '../types/folder';
import { API_BASE_URL } from './api/apiClient';

/**
 * 폴더 목록 조회
 */
export const getFolders = async (params?: {
  active_only?: boolean;
}): Promise<WatchedFolder[]> => {
  const response = await axios.get(`${API_BASE_URL}/api/folders`, { params, withCredentials: true });
  return response.data.data;
};

/**
 * 특정 폴더 정보 조회
 */
export const getFolder = async (id: number): Promise<WatchedFolder> => {
  const response = await axios.get(`${API_BASE_URL}/api/folders/${id}`, { withCredentials: true });
  return response.data.data;
};

/**
 * 폴더 추가
 */
export const addFolder = async (folderData: WatchedFolderCreate): Promise<{
  id: number;
  folder: WatchedFolder;
  message: string;
}> => {
  const response = await axios.post(`${API_BASE_URL}/api/folders`, folderData, { withCredentials: true });
  return response.data.data;
};

/**
 * 폴더 업데이트
 */
export const updateFolder = async (
  id: number,
  updates: WatchedFolderUpdate
): Promise<{ folder: WatchedFolder; message: string }> => {
  const response = await axios.patch(`${API_BASE_URL}/api/folders/${id}`, updates, { withCredentials: true });
  return response.data.data;
};

/**
 * 폴더 삭제
 */
export const deleteFolder = async (
  id: number,
  deleteFiles: boolean = false
): Promise<{ message: string }> => {
  const response = await axios.delete(`${API_BASE_URL}/api/folders/${id}`, {
    params: { delete_files: deleteFiles },
    withCredentials: true
  });
  return response.data.data;
};

/**
 * 폴더 스캔 실행
 */
export const scanFolder = async (
  id: number,
  fullRescan: boolean = false
): Promise<FolderScanResult> => {
  const response = await axios.post(`${API_BASE_URL}/api/folders/${id}/scan`, null, {
    params: { full: fullRescan },
    withCredentials: true
  });
  return response.data.data;
};

/**
 * 모든 활성 폴더 스캔
 */
export const scanAllFolders = async (): Promise<ScanAllSummary> => {
  const response = await axios.post(`${API_BASE_URL}/api/folders/scan-all`, null, { withCredentials: true });
  return response.data.data;
};

/**
 * 폴더 경로 유효성 검사
 */
export const validateFolderPath = async (folderPath: string): Promise<PathValidationResult> => {
  const response = await axios.post(`${API_BASE_URL}/api/folders/validate-path`, {
    folder_path: folderPath
  }, { withCredentials: true });
  return response.data.data;
};

/**
 * 실시간 감시 시작
 */
export const startWatcher = async (id: number): Promise<{ message: string; status: WatcherStatusInfo }> => {
  const response = await axios.post(`${API_BASE_URL}/api/folders/${id}/watcher/start`, null, { withCredentials: true });
  return response.data.data;
};

/**
 * 실시간 감시 중지
 */
export const stopWatcher = async (id: number): Promise<{ message: string }> => {
  const response = await axios.post(`${API_BASE_URL}/api/folders/${id}/watcher/stop`, null, { withCredentials: true });
  return response.data.data;
};

/**
 * 실시간 감시 재시작
 */
export const restartWatcher = async (id: number): Promise<{ message: string; status: WatcherStatusInfo }> => {
  const response = await axios.post(`${API_BASE_URL}/api/folders/${id}/watcher/restart`, null, { withCredentials: true });
  return response.data.data;
};

/**
 * 감시자 상태 조회
 */
export const getWatcherStatus = async (id: number): Promise<WatcherStatusInfo> => {
  const response = await axios.get(`${API_BASE_URL}/api/folders/${id}/watcher/status`, { withCredentials: true });
  return response.data.data;
};

/**
 * 모든 감시자 헬스체크
 */
export const getWatchersHealth = async (): Promise<WatcherHealthCheck> => {
  const response = await axios.get(`${API_BASE_URL}/api/folders/watchers/health`, { withCredentials: true });
  return response.data.data;
};

export const folderApi = {
  getFolders,
  getFolder,
  addFolder,
  updateFolder,
  deleteFolder,
  scanFolder,
  scanAllFolders,
  validateFolderPath,
  startWatcher,
  stopWatcher,
  restartWatcher,
  getWatcherStatus,
  getWatchersHealth
};
