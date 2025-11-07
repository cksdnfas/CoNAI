/**
 * API 공통 설정
 * 모든 API 서비스에서 사용하는 중앙화된 설정
 */

/**
 * API Base URL
 * 환경 변수 VITE_API_URL로 override 가능
 */
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:1566';

/**
 * API 요청 타임아웃 (밀리초)
 */
export const API_TIMEOUT = 30000;

/**
 * 재시도 설정
 */
export const API_RETRY_CONFIG = {
  maxRetries: 3,
  retryDelay: 1000,
};
