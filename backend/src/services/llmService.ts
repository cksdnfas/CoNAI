import { ExternalApiProvider } from '../models/ExternalApiProvider';
import type {
  LLMConfig,
  LLMProviderPreset,
  LLMProviderName,
  LLMChatRequest,
  LLMChatResponse,
  LLMModelsResponse,
  LLMModelInfo,
} from '../types/externalApi';

/**
 * LLM Provider Presets
 */
export const LLM_PROVIDER_PRESETS: Record<LLMProviderName, LLMProviderPreset> = {
  openai: {
    provider_name: 'openai',
    display_name: 'OpenAI (GPT)',
    default_base_url: 'https://api.openai.com/v1',
    requires_api_key: true,
    supports_model_list: true,
    default_models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
  },
  anthropic: {
    provider_name: 'anthropic',
    display_name: 'Anthropic (Claude)',
    default_base_url: 'https://api.anthropic.com/v1',
    requires_api_key: true,
    supports_model_list: false,
    default_models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
  },
  google: {
    provider_name: 'google',
    display_name: 'Google (Gemini)',
    default_base_url: 'https://generativelanguage.googleapis.com/v1beta',
    requires_api_key: true,
    supports_model_list: true,
    default_models: ['gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.0-pro'],
  },
  lmstudio: {
    provider_name: 'lmstudio',
    display_name: 'LM Studio',
    default_base_url: 'http://localhost:1234/v1',
    requires_api_key: false,
    supports_model_list: true,
    default_models: [],
  },
  ollama: {
    provider_name: 'ollama',
    display_name: 'Ollama',
    default_base_url: 'http://localhost:11434',
    requires_api_key: false,
    supports_model_list: true,
    default_models: [],
  },
};

/**
 * LLM Service
 * Handles LLM API calls for different providers
 */
export class LLMService {
  /**
   * Get LLM provider presets
   */
  static getPresets(): LLMProviderPreset[] {
    return Object.values(LLM_PROVIDER_PRESETS);
  }

  /**
   * Get a specific preset by name
   */
  static getPreset(providerName: string): LLMProviderPreset | null {
    return LLM_PROVIDER_PRESETS[providerName as LLMProviderName] || null;
  }

  /**
   * Get available models for a provider
   */
  static async getModels(providerName: string): Promise<LLMModelsResponse> {
    const provider = ExternalApiProvider.findByName(providerName);
    if (!provider) {
      return { success: false, error: 'Provider not found' };
    }

    const apiKey = ExternalApiProvider.getDecryptedKey(providerName);
    const baseUrl = provider.base_url || LLM_PROVIDER_PRESETS[providerName as LLMProviderName]?.default_base_url;

    if (!baseUrl) {
      return { success: false, error: 'Base URL not configured' };
    }

    try {
      switch (providerName) {
        case 'openai':
          return await this.getOpenAIModels(apiKey!, baseUrl);
        case 'anthropic':
          return this.getAnthropicModels();
        case 'google':
          return await this.getGoogleModels(apiKey!, baseUrl);
        case 'lmstudio':
          return await this.getLMStudioModels(baseUrl);
        case 'ollama':
          return await this.getOllamaModels(baseUrl);
        default:
          return { success: false, error: 'Unknown provider' };
      }
    } catch (error) {
      console.error(`Failed to get models for ${providerName}:`, error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Send a chat request to an LLM provider
   */
  static async chat(providerName: string, request: LLMChatRequest): Promise<LLMChatResponse> {
    const provider = ExternalApiProvider.findByName(providerName);
    if (!provider) {
      return { success: false, error: 'Provider not found' };
    }

    if (!provider.is_enabled) {
      return { success: false, error: 'Provider is disabled' };
    }

    const apiKey = ExternalApiProvider.getDecryptedKey(providerName);
    const config = provider.additional_config as LLMConfig | null;
    const baseUrl = provider.base_url || LLM_PROVIDER_PRESETS[providerName as LLMProviderName]?.default_base_url;

    if (!baseUrl) {
      return { success: false, error: 'Base URL not configured' };
    }

    const model = config?.model;
    if (!model) {
      return { success: false, error: 'Model not configured' };
    }

    try {
      switch (providerName) {
        case 'openai':
          return await this.chatOpenAI(apiKey!, baseUrl, model, request, config);
        case 'anthropic':
          return await this.chatAnthropic(apiKey!, baseUrl, model, request, config);
        case 'google':
          return await this.chatGoogle(apiKey!, baseUrl, model, request, config);
        case 'lmstudio':
          return await this.chatOpenAICompatible(baseUrl, model, request, config);
        case 'ollama':
          return await this.chatOllama(baseUrl, model, request, config);
        default:
          return { success: false, error: 'Unknown provider' };
      }
    } catch (error) {
      console.error(`Chat request failed for ${providerName}:`, error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Test LLM provider connection
   */
  static async testConnection(providerName: string): Promise<boolean> {
    const provider = ExternalApiProvider.findByName(providerName);
    if (!provider) {
      return false;
    }

    const apiKey = ExternalApiProvider.getDecryptedKey(providerName);
    const preset = LLM_PROVIDER_PRESETS[providerName as LLMProviderName];

    if (preset?.requires_api_key && !apiKey) {
      return false;
    }

    const baseUrl = provider.base_url || preset?.default_base_url;
    if (!baseUrl) {
      return false;
    }

    try {
      switch (providerName) {
        case 'openai':
          return await this.testOpenAIConnection(apiKey!, baseUrl);
        case 'anthropic':
          return await this.testAnthropicConnection(apiKey!, baseUrl);
        case 'google':
          return await this.testGoogleConnection(apiKey!, baseUrl);
        case 'lmstudio':
          return await this.testLMStudioConnection(baseUrl);
        case 'ollama':
          return await this.testOllamaConnection(baseUrl);
        default:
          return false;
      }
    } catch (error) {
      console.error(`Connection test failed for ${providerName}:`, error);
      return false;
    }
  }

  // ===== OpenAI / OpenAI-Compatible =====

  private static async getOpenAIModels(apiKey: string, baseUrl: string): Promise<LLMModelsResponse> {
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.statusText}`);
    }

    const data = await response.json() as { data: Array<{ id: string }> };
    const models: LLMModelInfo[] = data.data
      .filter((m) => m.id.includes('gpt'))
      .map((m) => ({
        id: m.id,
        name: m.id,
      }));

    return { success: true, models };
  }

  private static async chatOpenAI(
    apiKey: string,
    baseUrl: string,
    model: string,
    request: LLMChatRequest,
    config: LLMConfig | null
  ): Promise<LLMChatResponse> {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        max_tokens: request.max_tokens || config?.max_tokens || 4096,
        temperature: request.temperature ?? config?.temperature ?? 1,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as any;
      throw new Error(errorData.error?.message || response.statusText);
    }

    const data = await response.json() as any;
    return {
      success: true,
      content: data.choices[0]?.message?.content || '',
      usage: data.usage,
    };
  }

  private static async chatOpenAICompatible(
    baseUrl: string,
    model: string,
    request: LLMChatRequest,
    config: LLMConfig | null
  ): Promise<LLMChatResponse> {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        max_tokens: request.max_tokens || config?.max_tokens || 4096,
        temperature: request.temperature ?? config?.temperature ?? 1,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as any;
      throw new Error(errorData.error?.message || response.statusText);
    }

    const data = await response.json() as any;
    return {
      success: true,
      content: data.choices[0]?.message?.content || '',
      usage: data.usage,
    };
  }

  private static async testOpenAIConnection(apiKey: string, baseUrl: string): Promise<boolean> {
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });
    return response.ok;
  }

  // ===== Anthropic =====

  private static getAnthropicModels(): LLMModelsResponse {
    // Anthropic doesn't have a models endpoint, return preset list
    const models: LLMModelInfo[] = LLM_PROVIDER_PRESETS.anthropic.default_models.map(id => ({
      id,
      name: id,
    }));
    return { success: true, models };
  }

  private static async chatAnthropic(
    apiKey: string,
    baseUrl: string,
    model: string,
    request: LLMChatRequest,
    config: LLMConfig | null
  ): Promise<LLMChatResponse> {
    // Extract system message if present
    const systemMessage = request.messages.find(m => m.role === 'system');
    const otherMessages = request.messages.filter(m => m.role !== 'system');

    const response = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: request.max_tokens || config?.max_tokens || 4096,
        temperature: request.temperature ?? config?.temperature ?? 1,
        system: systemMessage?.content || config?.default_system_prompt,
        messages: otherMessages.map(m => ({
          role: m.role,
          content: m.content,
        })),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as any;
      throw new Error(errorData.error?.message || response.statusText);
    }

    const data = await response.json() as any;
    return {
      success: true,
      content: data.content[0]?.text || '',
      usage: {
        prompt_tokens: data.usage?.input_tokens || 0,
        completion_tokens: data.usage?.output_tokens || 0,
        total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      },
    };
  }

  private static async testAnthropicConnection(apiKey: string, baseUrl: string): Promise<boolean> {
    // Anthropic doesn't have a simple test endpoint, we'll try a minimal request
    const response = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });
    return response.ok;
  }

  // ===== Google Gemini =====

  private static async getGoogleModels(apiKey: string, baseUrl: string): Promise<LLMModelsResponse> {
    const response = await fetch(`${baseUrl}/models?key=${apiKey}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.statusText}`);
    }

    const data = await response.json() as any;
    const models: LLMModelInfo[] = data.models
      .filter((m: any) => m.name.includes('gemini'))
      .map((m: any) => ({
        id: m.name.replace('models/', ''),
        name: m.displayName || m.name.replace('models/', ''),
        description: m.description,
      }));

    return { success: true, models };
  }

  private static async chatGoogle(
    apiKey: string,
    baseUrl: string,
    model: string,
    request: LLMChatRequest,
    config: LLMConfig | null
  ): Promise<LLMChatResponse> {
    // Convert messages to Gemini format
    const systemInstruction = request.messages.find(m => m.role === 'system')?.content || config?.default_system_prompt;
    const contents = request.messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const response = await fetch(
      `${baseUrl}/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
          contents,
          generationConfig: {
            maxOutputTokens: request.max_tokens || config?.max_tokens || 4096,
            temperature: request.temperature ?? config?.temperature ?? 1,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as any;
      throw new Error(errorData.error?.message || response.statusText);
    }

    const data = await response.json() as any;
    return {
      success: true,
      content: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
      usage: {
        prompt_tokens: data.usageMetadata?.promptTokenCount || 0,
        completion_tokens: data.usageMetadata?.candidatesTokenCount || 0,
        total_tokens: data.usageMetadata?.totalTokenCount || 0,
      },
    };
  }

  private static async testGoogleConnection(apiKey: string, baseUrl: string): Promise<boolean> {
    const response = await fetch(`${baseUrl}/models?key=${apiKey}`);
    return response.ok;
  }

  // ===== LM Studio =====

  private static async getLMStudioModels(baseUrl: string): Promise<LLMModelsResponse> {
    try {
      const response = await fetch(`${baseUrl}/models`);

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
      }

      const data = await response.json() as any;
      const models: LLMModelInfo[] = data.data.map((m: any) => ({
        id: m.id,
        name: m.id,
      }));

      return { success: true, models };
    } catch (error) {
      // LM Studio might not be running
      return { success: false, error: 'LM Studio server not reachable' };
    }
  }

  private static async testLMStudioConnection(baseUrl: string): Promise<boolean> {
    try {
      const response = await fetch(`${baseUrl}/models`);
      return response.ok;
    } catch {
      return false;
    }
  }

  // ===== Ollama =====

  private static async getOllamaModels(baseUrl: string): Promise<LLMModelsResponse> {
    try {
      const response = await fetch(`${baseUrl}/api/tags`);

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
      }

      const data = await response.json() as any;
      const models: LLMModelInfo[] = (data.models || []).map((m: any) => ({
        id: m.name,
        name: m.name,
        description: `Size: ${Math.round((m.size || 0) / 1024 / 1024 / 1024 * 10) / 10}GB`,
      }));

      return { success: true, models };
    } catch (error) {
      return { success: false, error: 'Ollama server not reachable' };
    }
  }

  private static async chatOllama(
    baseUrl: string,
    model: string,
    request: LLMChatRequest,
    config: LLMConfig | null
  ): Promise<LLMChatResponse> {
    const systemMessage = request.messages.find(m => m.role === 'system');

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        stream: false,
        options: {
          temperature: request.temperature ?? config?.temperature ?? 1,
          num_predict: request.max_tokens || config?.max_tokens || 4096,
        },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as any;
      throw new Error(errorData.error || response.statusText);
    }

    const data = await response.json() as any;
    return {
      success: true,
      content: data.message?.content || '',
      usage: {
        prompt_tokens: data.prompt_eval_count || 0,
        completion_tokens: data.eval_count || 0,
        total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
    };
  }

  private static async testOllamaConnection(baseUrl: string): Promise<boolean> {
    try {
      const response = await fetch(`${baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
