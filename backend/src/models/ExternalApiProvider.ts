import { getUserSettingsDb } from '../database/userSettingsDb';
import { ExternalApiService } from '../services/externalApiService';
import type {
  ExternalApiProvider as ExternalApiProviderType,
  ExternalApiProviderResponse,
  CreateExternalApiProviderInput,
  UpdateExternalApiProviderInput,
} from '../types/externalApi';

/**
 * External API Provider Model
 * Manages external API credentials with encryption
 */
export class ExternalApiProvider {
  /**
   * Find all providers (returns masked API keys)
   */
  static findAll(): ExternalApiProviderResponse[] {
    const db = getUserSettingsDb();
    const rows = db.prepare(`
      SELECT * FROM external_api_providers
      ORDER BY created_at DESC
    `).all() as ExternalApiProviderType[];

    return rows.map(row => this.toResponse(row));
  }

  /**
   * Find provider by name (returns masked API key)
   */
  static findByName(providerName: string): ExternalApiProviderResponse | null {
    const db = getUserSettingsDb();
    const row = db.prepare(`
      SELECT * FROM external_api_providers
      WHERE provider_name = ?
    `).get(providerName) as ExternalApiProviderType | undefined;

    if (!row) {
      return null;
    }

    return this.toResponse(row);
  }

  /**
   * Get decrypted API key for a provider (for internal use only - NOT exposed via API)
   * @param providerName - Provider name
   * @returns Decrypted API key or null
   */
  static getDecryptedKey(providerName: string): string | null {
    const db = getUserSettingsDb();
    const row = db.prepare(`
      SELECT api_key, is_enabled FROM external_api_providers
      WHERE provider_name = ?
    `).get(providerName) as { api_key: string | null; is_enabled: number } | undefined;

    if (!row || !row.is_enabled || !row.api_key) {
      return null;
    }

    try {
      return ExternalApiService.decrypt(row.api_key);
    } catch (error) {
      console.error(`Failed to decrypt API key for ${providerName}:`, error);
      return null;
    }
  }

  /**
   * Get decrypted API secret for a provider (for internal use only - NOT exposed via API)
   * @param providerName - Provider name
   * @returns Decrypted API secret or null
   */
  static getDecryptedSecret(providerName: string): string | null {
    const db = getUserSettingsDb();
    const row = db.prepare(`
      SELECT api_secret, is_enabled FROM external_api_providers
      WHERE provider_name = ?
    `).get(providerName) as { api_secret: string | null; is_enabled: number } | undefined;

    if (!row || !row.is_enabled || !row.api_secret) {
      return null;
    }

    try {
      return ExternalApiService.decrypt(row.api_secret);
    } catch (error) {
      console.error(`Failed to decrypt API secret for ${providerName}:`, error);
      return null;
    }
  }

  /**
   * Create a new provider
   */
  static create(input: CreateExternalApiProviderInput): number {
    const db = getUserSettingsDb();

    // Encrypt API key and secret if provided
    const encryptedKey = input.api_key ? ExternalApiService.encrypt(input.api_key) : null;
    const encryptedSecret = input.api_secret ? ExternalApiService.encrypt(input.api_secret) : null;

    // Serialize additional config
    const additionalConfig = input.additional_config
      ? JSON.stringify(input.additional_config)
      : null;

    const result = db.prepare(`
      INSERT INTO external_api_providers (
        provider_name,
        display_name,
        api_key,
        api_secret,
        base_url,
        additional_config,
        is_enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.provider_name,
      input.display_name,
      encryptedKey,
      encryptedSecret,
      input.base_url || null,
      additionalConfig,
      input.is_enabled !== undefined ? (input.is_enabled ? 1 : 0) : 1
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Update an existing provider
   */
  static update(providerName: string, input: UpdateExternalApiProviderInput): boolean {
    const db = getUserSettingsDb();

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];

    if (input.display_name !== undefined) {
      updates.push('display_name = ?');
      values.push(input.display_name);
    }

    if (input.api_key !== undefined) {
      updates.push('api_key = ?');
      values.push(input.api_key ? ExternalApiService.encrypt(input.api_key) : null);
    }

    if (input.api_secret !== undefined) {
      updates.push('api_secret = ?');
      values.push(input.api_secret ? ExternalApiService.encrypt(input.api_secret) : null);
    }

    if (input.base_url !== undefined) {
      updates.push('base_url = ?');
      values.push(input.base_url || null);
    }

    if (input.additional_config !== undefined) {
      updates.push('additional_config = ?');
      values.push(input.additional_config ? JSON.stringify(input.additional_config) : null);
    }

    if (input.is_enabled !== undefined) {
      updates.push('is_enabled = ?');
      values.push(input.is_enabled ? 1 : 0);
    }

    if (updates.length === 0) {
      return false;
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(providerName);

    const result = db.prepare(`
      UPDATE external_api_providers
      SET ${updates.join(', ')}
      WHERE provider_name = ?
    `).run(...values);

    return result.changes > 0;
  }

  /**
   * Delete a provider
   */
  static delete(providerName: string): boolean {
    const db = getUserSettingsDb();
    const result = db.prepare(`
      DELETE FROM external_api_providers
      WHERE provider_name = ?
    `).run(providerName);

    return result.changes > 0;
  }

  /**
   * Toggle provider enabled status
   */
  static toggleEnabled(providerName: string, isEnabled: boolean): boolean {
    const db = getUserSettingsDb();
    const result = db.prepare(`
      UPDATE external_api_providers
      SET is_enabled = ?, updated_at = CURRENT_TIMESTAMP
      WHERE provider_name = ?
    `).run(isEnabled ? 1 : 0, providerName);

    return result.changes > 0;
  }

  /**
   * Check if provider exists
   */
  static exists(providerName: string): boolean {
    const db = getUserSettingsDb();
    const row = db.prepare(`
      SELECT 1 FROM external_api_providers
      WHERE provider_name = ?
    `).get(providerName);

    return !!row;
  }

  /**
   * Convert database row to API response (with masked keys)
   */
  private static toResponse(row: ExternalApiProviderType): ExternalApiProviderResponse {
    // Decrypt to get original length for proper masking
    let maskedKey = '********';
    let maskedSecret: string | null = null;

    if (row.api_key) {
      try {
        const decryptedKey = ExternalApiService.decrypt(row.api_key);
        maskedKey = ExternalApiService.maskApiKey(decryptedKey);
      } catch (error) {
        console.error(`Failed to decrypt API key for masking: ${row.provider_name}`);
      }
    }

    if (row.api_secret) {
      try {
        const decryptedSecret = ExternalApiService.decrypt(row.api_secret);
        maskedSecret = ExternalApiService.maskApiKey(decryptedSecret);
      } catch (error) {
        console.error(`Failed to decrypt API secret for masking: ${row.provider_name}`);
      }
    }

    return {
      id: row.id,
      provider_name: row.provider_name,
      display_name: row.display_name,
      api_key_masked: maskedKey,
      api_secret_masked: maskedSecret,
      base_url: row.base_url,
      additional_config: row.additional_config ? JSON.parse(row.additional_config) : null,
      is_enabled: !!row.is_enabled,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
