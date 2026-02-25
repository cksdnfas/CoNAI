import apiClient from './api/apiClient';

/**
 * 파일 검증 결과
 */
export interface VerificationResult {
  totalChecked: number;
  missingFound: number;
  deletedRecords: number;
  duration: number;
  errors: Array<{
    fileId: number;
    filePath: string;
    error: string;
  }>;
}

/**
 * 파일 검증 로그
 */
export interface VerificationLog {
  id: number;
  verification_date: string;
  total_checked: number;
  missing_found: number;
  deleted_records: number;
  duration_ms: number;
  verification_type: string;
  error_count: number;
  error_details: string | null;
}

/**
 * 파일 검증 통계
 */
export interface VerificationStats {
  totalFiles: number;
  missingFiles: number;
  lastVerificationDate: string | null;
  lastVerificationResult: VerificationLog | null;
}

/**
 * 파일 검증 진행 상황
 */
export interface VerificationProgress {
  isRunning: boolean;
  totalFiles: number;
  checkedFiles: number;
  missingFiles: number;
  startTime: number;
  progressPercentage: number;
}

/**
 * 파일 검증 설정
 */
export interface FileVerificationSettings {
  enabled: boolean;
  interval: number;
}

/**
 * 파일 검증 API 클라이언트
 */
export const fileVerificationApi = {
  /**
   * 파일 검증 통계 조회
   */
  async getStats(): Promise<VerificationStats> {
    const response = await apiClient.get('/api/file-verification/stats');
    return response.data.data || response.data;
  },

  /**
   * 현재 검증 진행 상황 조회
   */
  async getProgress(): Promise<VerificationProgress> {
    const response = await apiClient.get('/api/file-verification/progress');
    return response.data.data || response.data;
  },

  /**
   * 파일 검증 수동 실행
   */
  async triggerVerification(): Promise<{ success: boolean; result: VerificationResult }> {
    const response = await apiClient.post('/api/file-verification/verify');
    return response.data;
  },

  /**
   * 최근 검증 로그 조회
   */
  async getLogs(limit: number = 50): Promise<VerificationLog[]> {
    const response = await apiClient.get('/api/file-verification/logs', {
      params: { limit },
    });
    return response.data.data || response.data;
  },

  /**
   * 파일 검증 설정 조회
   */
  async getSettings(): Promise<FileVerificationSettings> {
    const response = await apiClient.get('/api/file-verification/settings');
    return response.data.data || response.data;
  },

  /**
   * 파일 검증 설정 업데이트
   */
  async updateSettings(
    settings: Partial<FileVerificationSettings>
  ): Promise<{ success: boolean; settings: FileVerificationSettings }> {
    const response = await apiClient.put('/api/file-verification/settings', settings);
    return response.data;
  },
};
