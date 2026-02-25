/**
 * API 공통 설정
 * 모든 API 서비스에서 사용하는 중앙화된 설정
 */

import { getBackendOrigin } from '../../utils/backend';

/**
 * API Base URL
 * utils/backend.ts의 런타임 계산 로직 사용
 */
export const API_BASE_URL = getBackendOrigin();

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
