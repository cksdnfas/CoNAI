import crypto from 'crypto';

/**
 * External API Service
 * Handles encryption/decryption of API keys and connection testing
 */
export class ExternalApiService {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly IV_LENGTH = 16;
  private static readonly AUTH_TAG_LENGTH = 16;
  private static readonly SALT_LENGTH = 32;

  /**
   * Get encryption key from environment or generate a consistent one
   */
  private static getEncryptionKey(): Buffer {
    const secret = process.env.API_KEY_ENCRYPTION_SECRET || 'comfyui-image-manager-default-secret-key-change-this';

    // Derive a 32-byte key from the secret using SHA-256
    return crypto.createHash('sha256').update(secret).digest();
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
   * Test Civitai API connection
   * @param apiKey - The API key to test
   * @returns True if connection is successful
   */
  static async testCivitaiConnection(apiKey: string): Promise<boolean> {
    try {
      // Test with Civitai API - just check if we get a valid response
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
   * Test API connection based on provider type
   * @param providerName - The provider name (e.g., 'civitai')
   * @param apiKey - The decrypted API key
   * @returns True if connection is successful
   */
  static async testConnection(providerName: string, apiKey: string): Promise<boolean> {
    switch (providerName) {
      case 'civitai':
        return this.testCivitaiConnection(apiKey);

      // Add more providers here as needed
      default:
        console.warn(`No connection test available for provider: ${providerName}`);
        return false;
    }
  }
}
