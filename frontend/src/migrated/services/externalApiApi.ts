import apiClient from './api/apiClient';

/**
 * Provider type classification
 */
export type ProviderType = 'general';

/**
 * External API Provider (with masked API keys)
 */
export interface ExternalApiProvider {
  id: number;
  provider_name: string;
  display_name: string;
  provider_type: ProviderType;
  api_key_masked: string;
  api_secret_masked: string | null;
  base_url: string | null;
  additional_config: Record<string, any> | null;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Input for creating a new provider
 */
export interface CreateExternalApiProviderInput {
  provider_name: string;
  display_name: string;
  provider_type?: ProviderType;
  api_key?: string;
  api_secret?: string;
  base_url?: string;
  additional_config?: Record<string, any>;
  is_enabled?: boolean;
}

/**
 * Input for updating an existing provider
 */
export interface UpdateExternalApiProviderInput {
  display_name?: string;
  provider_type?: ProviderType;
  api_key?: string;
  api_secret?: string;
  base_url?: string;
  additional_config?: Record<string, any>;
  is_enabled?: boolean;
}

/**
 * API response wrapper
 */
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * Connection test result
 */
export interface TestConnectionResult {
  success: boolean;
  message: string;
}

/**
 * External API service
 */
export const externalApiApi = {
  /**
   * Get all external API providers
   */
  async getProviders(): Promise<ExternalApiProvider[]> {
    const response = await apiClient.get<ApiResponse<ExternalApiProvider[]>>(
      '/api/external-api/providers'
    );

    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to fetch providers');
    }

    return response.data.data || [];
  },

  /**
   * Get a specific provider by name
   */
  async getProvider(name: string): Promise<ExternalApiProvider> {
    const response = await apiClient.get<ApiResponse<ExternalApiProvider>>(
      `/api/external-api/providers/${encodeURIComponent(name)}`
    );

    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Provider not found');
    }

    return response.data.data;
  },

  /**
   * Create a new provider
   */
  async createProvider(input: CreateExternalApiProviderInput): Promise<ExternalApiProvider> {
    const response = await apiClient.post<ApiResponse<ExternalApiProvider>>(
      '/api/external-api/providers',
      input
    );

    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Failed to create provider');
    }

    return response.data.data;
  },

  /**
   * Update an existing provider
   */
  async updateProvider(
    name: string,
    input: UpdateExternalApiProviderInput
  ): Promise<ExternalApiProvider> {
    const response = await apiClient.put<ApiResponse<ExternalApiProvider>>(
      `/api/external-api/providers/${encodeURIComponent(name)}`,
      input
    );

    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Failed to update provider');
    }

    return response.data.data;
  },

  /**
   * Delete a provider
   */
  async deleteProvider(name: string): Promise<void> {
    const response = await apiClient.delete<ApiResponse<void>>(
      `/api/external-api/providers/${encodeURIComponent(name)}`
    );

    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to delete provider');
    }
  },

  /**
   * Toggle provider enabled status
   */
  async toggleProvider(name: string, isEnabled: boolean): Promise<ExternalApiProvider> {
    const response = await apiClient.patch<ApiResponse<ExternalApiProvider>>(
      `/api/external-api/providers/${encodeURIComponent(name)}/toggle`,
      { is_enabled: isEnabled }
    );

    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Failed to toggle provider');
    }

    return response.data.data;
  },

  /**
   * Test API connection
   */
  async testConnection(name: string): Promise<TestConnectionResult> {
    const response = await apiClient.post<TestConnectionResult>(
      `/api/external-api/providers/${encodeURIComponent(name)}/test`,
      {}
    );

    return response.data;
  },
};
