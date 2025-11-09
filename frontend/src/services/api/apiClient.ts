/**
 * API Client Configuration
 *
 * Provides centralized axios instance with:
 * - Base URL configuration
 * - Request/Response interceptors
 * - Error handling
 * - Request deduplication
 * - In-memory caching for GET requests
 */

import axios, { type InternalAxiosRequestConfig, type AxiosResponse } from 'axios';
import { getBackendOrigin } from '../../utils/backend';

/**
 * API Base URL
 * Dynamically determined from backend configuration
 */
export const API_BASE_URL = getBackendOrigin();

/**
 * Cache entry structure
 */
interface CacheEntry {
  data: AxiosResponse;
  timestamp: number;
}

/**
 * Request cache with TTL (Time To Live)
 * Only caches GET requests to prevent stale data
 */
class RequestCache {
  private cache = new Map<string, CacheEntry>();
  private defaultTTL = 5 * 60 * 1000; // 5 minutes default TTL

  /**
   * Generate cache key from request config
   */
  private getCacheKey(config: InternalAxiosRequestConfig | { url?: string; params?: any; method?: string }): string {
    const url = config.url || '';
    const params = JSON.stringify(config.params || {});
    return `${config.method}:${url}?${params}`;
  }

  /**
   * Check if cache entry is still valid
   */
  private isValid(entry: CacheEntry, ttl: number): boolean {
    return Date.now() - entry.timestamp < ttl;
  }

  /**
   * Get cached response if available and valid
   */
  get(config: InternalAxiosRequestConfig | { url?: string; params?: any; method?: string }, ttl?: number): AxiosResponse | null {
    const key = this.getCacheKey(config);
    const entry = this.cache.get(key);

    if (!entry) return null;

    const effectiveTTL = ttl ?? this.defaultTTL;
    if (!this.isValid(entry, effectiveTTL)) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Store response in cache
   */
  set(config: InternalAxiosRequestConfig, response: AxiosResponse): void {
    const key = this.getCacheKey(config);
    this.cache.set(key, {
      data: response,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear specific cache entry
   */
  clear(config: InternalAxiosRequestConfig | { url?: string; params?: any; method?: string }): void {
    const key = this.getCacheKey(config);
    this.cache.delete(key);
  }

  /**
   * Clear all cache entries
   */
  clearAll(): void {
    this.cache.clear();
  }

  /**
   * Clear cache entries matching a pattern
   */
  clearPattern(pattern: RegExp): void {
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key);
      }
    }
  }
}

/**
 * Request deduplication to prevent duplicate in-flight requests
 */
class RequestDeduplicator {
  private pendingRequests = new Map<string, Promise<AxiosResponse>>();

  /**
   * Generate request key
   */
  private getRequestKey(config: InternalAxiosRequestConfig | { url?: string; params?: any; method?: string }): string {
    const url = config.url || '';
    const params = JSON.stringify(config.params || {});
    return `${config.method}:${url}?${params}`;
  }

  /**
   * Get pending request if exists, otherwise create new one
   */
  deduplicate(
    config: InternalAxiosRequestConfig | { url?: string; params?: any; method?: string },
    requestFn: () => Promise<AxiosResponse>
  ): Promise<AxiosResponse> {
    const key = this.getRequestKey(config);

    // Return existing pending request
    const pending = this.pendingRequests.get(key);
    if (pending) {
      return pending;
    }

    // Create new request
    const promise = requestFn()
      .finally(() => {
        // Clean up after request completes
        this.pendingRequests.delete(key);
      });

    this.pendingRequests.set(key, promise);
    return promise;
  }

  /**
   * Clear all pending requests
   */
  clear(): void {
    this.pendingRequests.clear();
  }
}

// Initialize cache and deduplicator
const cache = new RequestCache();
const deduplicator = new RequestDeduplicator();

/**
 * Axios instance with shared configuration
 *
 * Features:
 * - JSON content type by default
 * - Base URL from environment/config
 * - Request deduplication for identical requests
 * - Response caching for GET requests
 */
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Request Interceptor
 * - Add authentication headers
 * - Check cache for GET requests
 * - Deduplicate identical in-flight requests
 */
apiClient.interceptors.request.use(
  (config) => {
    // Future: Add authentication headers here if needed
    // config.headers.Authorization = `Bearer ${token}`;

    // Only cache and deduplicate GET requests
    if (config.method?.toLowerCase() === 'get') {
      // Check cache first
      const cached = cache.get(config);
      if (cached) {
        // Return cached response by rejecting with special marker
        return Promise.reject({
          __cached: true,
          response: cached,
        });
      }
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * Response Interceptor
 * - Handle cached responses
 * - Cache successful GET responses
 * - Handle errors
 */
apiClient.interceptors.response.use(
  (response) => {
    // Cache successful GET responses
    if (response.config.method?.toLowerCase() === 'get') {
      cache.set(response.config, response);
    }
    return response;
  },
  (error) => {
    // Handle cached responses
    if (error.__cached) {
      return Promise.resolve(error.response);
    }

    // Future: Add retry logic for transient errors
    // if (error.response?.status === 429) {
    //   // Rate limited - could implement exponential backoff
    // }

    return Promise.reject(error);
  }
);

/**
 * Enhanced request wrapper with deduplication
 */
const originalRequest = apiClient.request.bind(apiClient);
apiClient.request = function <T = any, D = any>(config: InternalAxiosRequestConfig<D> | any): Promise<AxiosResponse<T>> {
  // Only deduplicate GET requests
  if (config.method?.toLowerCase() === 'get') {
    return deduplicator.deduplicate(config, () => originalRequest(config));
  }
  return originalRequest(config);
};

/**
 * Export cache control utilities
 */
export const cacheControl = {
  clear: () => cache.clearAll(),
  clearPattern: (pattern: RegExp) => cache.clearPattern(pattern),
  clearUrl: (url: string) => cache.clearPattern(new RegExp(url)),
};

export default apiClient;
