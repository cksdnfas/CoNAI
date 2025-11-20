/**
 * External API Provider stored in database
 */
export interface ExternalApiProvider {
  id: number;
  provider_name: string;
  display_name: string;
  api_key: string | null;  // Encrypted in database
  api_secret: string | null;  // Encrypted in database (optional)
  base_url: string | null;
  additional_config: string | null;  // JSON string
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * External API Provider for API responses (with masked keys)
 */
export interface ExternalApiProviderResponse {
  id: number;
  provider_name: string;
  display_name: string;
  api_key_masked: string;  // Masked version: asd3***...***992
  api_secret_masked: string | null;  // Masked version (optional)
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
  api_key?: string;
  api_secret?: string;
  base_url?: string;
  additional_config?: Record<string, any>;
  is_enabled?: boolean;
}

/**
 * Result of API connection test
 */
export interface TestConnectionResult {
  success: boolean;
  message: string;
}
