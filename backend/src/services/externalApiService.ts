import crypto from 'crypto';
import type { ProviderType } from '../types/externalApi';

/**
 * External API Service
 * Handles encryption/decryption of API keys and connection testing
 */
export class ExternalApiService {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly IV_LENGTH = 16;
  private static readonly AUTH_TAG_LENGTH = 16;
  private static readonly SALT_LENGTH = 32;
  private static readonly DEFAULT_ENCRYPTION_SECRET = 'comfyui-image-manager-default-secret-key-change-this';

  /**
   * Get encryption key from environment or generate a consistent one
   */
  private static getEncryptionKey(): Buffer {
    const secret = process.env.API_KEY_ENCRYPTION_SECRET || this.DEFAULT_ENCRYPTION_SECRET;

    // Derive a 32-byte key from the secret using SHA-256
    return crypto.createHash('sha256').update(secret).digest();
  }

  /**
   * Return whether a non-default encryption secret is configured.
   */
  static hasCustomEncryptionSecret(): boolean {
    const secret = process.env.API_KEY_ENCRYPTION_SECRET;
    return typeof secret === 'string'
      && secret.trim().length > 0
      && secret !== this.DEFAULT_ENCRYPTION_SECRET;
  }

  /**
   * Encrypt an API key
   * @param plaintext - The API key to encrypt
   * @returns Encrypted string in format: iv:authTag:encryptedData
   */
  static encrypt(plaintext: string): string {
    if (!plaintext) {
      return '';
    }

    const key = this.getEncryptionKey();
    const iv = crypto.randomBytes(this.IV_LENGTH);
    const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Return format: iv:authTag:encryptedData
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt an API key
   * @param encryptedData - The encrypted string in format: iv:authTag:encryptedData
   * @returns Decrypted API key
   */
  static decrypt(encryptedData: string): string {
    if (!encryptedData) {
      return '';
    }

    try {
      const key = this.getEncryptionKey();
      const parts = encryptedData.split(':');

      if (parts.length !== 3) {
        throw new Error('Invalid encrypted data format');
      }

      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const encrypted = parts[2];

      const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      console.error('Failed to decrypt API key:', error);
      throw new Error('Failed to decrypt API key');
    }
  }

  /**
   * Mask an API key for display (show first 4 and last 4 characters)
   * @param apiKey - The API key to mask
   * @returns Masked string in format: asd3***...***992
   */
  static maskApiKey(apiKey: string | null | undefined): string {
    if (!apiKey || apiKey.length <= 8) {
      return '********';
    }

    const firstPart = apiKey.substring(0, 4);
    const lastPart = apiKey.substring(apiKey.length - 4);

    return `${firstPart}***...***${lastPart}`;
  }

  /**
   * Resolve whether one provider type can be enabled without an API key.
   */
  static allowsMissingApiKey(providerType: ProviderType | string | undefined) {
    return providerType === 'llm_openai_compatible' || providerType === 'llm_ollama';
  }

  /**
   * Normalize one stored base URL and append a relative path.
   */
  private static buildProviderUrl(baseUrl: string | null | undefined, path: string) {
    const normalizedBaseUrl = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : '';
    if (!normalizedBaseUrl) {
      return null;
    }

    return `${normalizedBaseUrl}${path}`;
  }

  /**
   * Test Civitai API connection.
   */
  static async testCivitaiConnection(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch('https://civitai.com/api/v1/models?limit=1', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      return response.ok;
    } catch (error) {
      console.error('Civitai connection test failed:', error);
      return false;
    }
  }

  /**
   * Test one OpenAI-compatible endpoint such as LM Studio or a remote provider.
   */
  static async testOpenAiCompatibleConnection(baseUrl: string, apiKey?: string | null): Promise<boolean> {
    try {
      const requestUrl = this.buildProviderUrl(baseUrl, '/models');
      if (!requestUrl) {
        return false;
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey && apiKey.trim()) {
        headers.Authorization = `Bearer ${apiKey.trim()}`;
      }

      const response = await fetch(requestUrl, {
        method: 'GET',
        headers,
      });

      return response.ok;
    } catch (error) {
      console.error('OpenAI-compatible connection test failed:', error);
      return false;
    }
  }

  /**
   * Test one Ollama endpoint.
   */
  static async testOllamaConnection(baseUrl: string): Promise<boolean> {
    try {
      const requestUrl = this.buildProviderUrl(baseUrl, '/api/tags');
      if (!requestUrl) {
        return false;
      }

      const response = await fetch(requestUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      return response.ok;
    } catch (error) {
      console.error('Ollama connection test failed:', error);
      return false;
    }
  }

  /**
   * Test API connection based on provider type.
   */
  static async testConnection(params: {
    providerName: string;
    providerType?: ProviderType | string;
    apiKey?: string | null;
    baseUrl?: string | null;
  }): Promise<boolean> {
    const { providerName, providerType, apiKey, baseUrl } = params;

    switch (providerType) {
      case 'llm_openai_compatible':
        return baseUrl ? this.testOpenAiCompatibleConnection(baseUrl, apiKey) : false;
      case 'llm_ollama':
        return baseUrl ? this.testOllamaConnection(baseUrl) : false;
      default:
        switch (providerName) {
          case 'civitai':
            return apiKey ? this.testCivitaiConnection(apiKey) : false;
          default:
            console.warn(`No connection test available for provider: ${providerName}`);
            return false;
        }
    }
  }
}
