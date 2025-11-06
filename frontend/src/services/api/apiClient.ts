/**
 * API Client Configuration
 *
 * Provides centralized axios instance with:
 * - Base URL configuration
 * - Request/Response interceptors
 * - Error handling
 * - Retry logic (future enhancement)
 */

import axios from 'axios';
import { getBackendOrigin } from '../../utils/backend';

/**
 * API Base URL
 * Dynamically determined from backend configuration
 */
export const API_BASE_URL = getBackendOrigin();

/**
 * Axios instance with shared configuration
 *
 * Features:
 * - JSON content type by default
 * - Base URL from environment/config
 * - Interceptors for common error handling
 */
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Request Interceptor
 * Add common headers, authentication tokens, etc.
 */
apiClient.interceptors.request.use(
  (config) => {
    // Future: Add authentication headers here if needed
    // config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * Response Interceptor
 * Handle common response patterns and errors
 */
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    // Future: Add global error handling, retry logic, etc.
    // if (error.response?.status === 401) {
    //   // Handle unauthorized
    // }
    return Promise.reject(error);
  }
);

export default apiClient;
