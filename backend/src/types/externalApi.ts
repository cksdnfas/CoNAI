/**
 * Provider type classification
 */
export type ProviderType = 'general' | 'llm';

/**
 * LLM Provider identifiers
 */
export type LLMProviderName = 'openai' | 'anthropic' | 'google' | 'lmstudio' | 'ollama';

/**
 * LLM-specific configuration stored in additional_config
 */
export interface LLMConfig {
  model: string;                    // Selected model (e.g., 'gpt-4o', 'claude-3-5-sonnet')
  available_models?: string[];      // Cached list of available models
  max_tokens?: number;              // Maximum tokens for response
  temperature?: number;             // Temperature (0-2, default 1)
  organization_id?: string;         // OpenAI organization ID (optional)
  default_system_prompt?: string;   // Default system prompt
}

/**
 * LLM Provider preset definition
 */
export interface LLMProviderPreset {
  provider_name: LLMProviderName;
  display_name: string;
  default_base_url: string;
  requires_api_key: boolean;
  supports_model_list: boolean;
  default_models: string[];
}

/**
 * External API Provider stored in database
 */
export interface ExternalApiProvider {
  id: number;
  provider_name: string;
  display_name: string;
  provider_type: ProviderType;
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
  provider_type: ProviderType;
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
 * Result of API connection test
 */
export interface TestConnectionResult {
  success: boolean;
  message: string;
}

/**
 * LLM Chat Message
 */
export interface LLMChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * LLM Chat Request
 */
export interface LLMChatRequest {
  messages: LLMChatMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

/**
 * LLM Chat Response
 */
export interface LLMChatResponse {
  success: boolean;
  content?: string;
  error?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * LLM Model Info
 */
export interface LLMModelInfo {
  id: string;
  name: string;
  description?: string;
}

/**
 * LLM Models List Response
 */
export interface LLMModelsResponse {
  success: boolean;
  models?: LLMModelInfo[];
  error?: string;
}
