import axios from 'axios';
import type {
  WatchedFolder,
  WatchedFolderCreate,
  WatchedFolderUpdate,
  FolderScanResult,
  ScanAllSummary,
  PathValidationResult,
  FolderType
} from '../types/folder';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:1566';

/**
 * 폴더 목록 조회
 */
export const getFolders = async (params?: {
  type?: FolderType;
  active_only?: boolean;
}): Promise<WatchedFolder[]> => {
  const response = await axios.get(`${API_BASE_URL}/api/folders`, { params });
  return response.data.data;
};

/**
 * 특정 폴더 정보 조회
 */
export const getFolder = async (id: number): Promise<WatchedFolder> => {
  const response = await axios.get(`${API_BASE_URL}/api/folders/${id}`);
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
  const response = await axios.post(`${API_BASE_URL}/api/folders`, folderData);
  return response.data.data;
};

/**
 * 폴더 업데이트
 */
export const updateFolder = async (
  id: number,
  updates: WatchedFolderUpdate
): Promise<{ folder: WatchedFolder; message: string }> => {
  const response = await axios.patch(`${API_BASE_URL}/api/folders/${id}`, updates);
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
    params: { delete_files: deleteFiles }
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
    params: { full: fullRescan }
  });
  return response.data.data;
};

/**
 * 모든 활성 폴더 스캔
 */
export const scanAllFolders = async (): Promise<ScanAllSummary> => {
  const response = await axios.post(`${API_BASE_URL}/api/folders/scan-all`);
  return response.data.data;
};

/**
 * 폴더 경로 유효성 검사
 */
export const validateFolderPath = async (folderPath: string): Promise<PathValidationResult> => {
  const response = await axios.post(`${API_BASE_URL}/api/folders/validate-path`, {
    folder_path: folderPath
  });
  return response.data.data;
};

/**
 * 기본 업로드 폴더 조회
 */
export const getDefaultFolder = async (): Promise<WatchedFolder> => {
  const response = await axios.get(`${API_BASE_URL}/api/folders/default`);
  return response.data.data;
};

/**
 * 기본 업로드 폴더 경로 변경
 */
export const updateDefaultFolder = async (
  folderPath: string
): Promise<{ folder: WatchedFolder; message: string }> => {
  const response = await axios.patch(`${API_BASE_URL}/api/folders/default`, {
    folder_path: folderPath
  });
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
  getDefaultFolder,
  updateDefaultFolder
};
