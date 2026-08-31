import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { McpHttpApiKey, McpHttpScope, McpHttpSettings } from '@conai/shared';
import { runtimePaths } from '../config/runtimePaths';

const MCP_HTTP_SETTINGS_FILE_PATH = path.join(runtimePaths.basePath, 'config', 'mcp-http.json');
const MCP_API_KEY_PREFIX = 'conai_mcp_';
const MCP_KEY_ID_PREFIX = 'mcpkey_';
export const MCP_HTTP_SCOPES: readonly McpHttpScope[] = ['read', 'generate', 'organize', 'backup', 'restore'];

type StoredMcpHttpSettings = McpHttpSettings & {
  signingSecret: string;
};

export interface McpHttpAuthentication {
  keyId: string;
  keyName: string;
  scopes: McpHttpScope[];
}

function generateApiKey(): string {
  return `${MCP_API_KEY_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
}

function generateKeyId(): string {
  return `${MCP_KEY_ID_PREFIX}${crypto.randomBytes(9).toString('base64url')}`;
}

function generateSigningSecret(): string {
  return crypto.randomBytes(48).toString('base64url');
}

function isValidApiKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.startsWith(MCP_API_KEY_PREFIX)
    && value.length >= MCP_API_KEY_PREFIX.length + 43;
}

function normalizeUpdatedAt(value: unknown): string {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }

  return new Date().toISOString();
}

function normalizeScopes(value: unknown, fallback: readonly McpHttpScope[] = MCP_HTTP_SCOPES): McpHttpScope[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const allowed = new Set<McpHttpScope>(MCP_HTTP_SCOPES);
  const normalized = Array.from(new Set(value.filter((scope): scope is McpHttpScope => (
    typeof scope === 'string' && allowed.has(scope as McpHttpScope)
  ))));
  return normalized.length > 0 ? normalized : [...fallback];
}

function normalizeKey(value: unknown, index: number): McpHttpApiKey | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (!isValidApiKey(record.apiKey)) {
    return null;
  }

  const now = new Date().toISOString();
  return {
    id: typeof record.id === 'string' && record.id.trim() ? record.id.trim() : generateKeyId(),
    name: typeof record.name === 'string' && record.name.trim() ? record.name.trim().slice(0, 80) : `MCP 키 ${index + 1}`,
    apiKey: record.apiKey,
    scopes: normalizeScopes(record.scopes),
    createdAt: normalizeUpdatedAt(record.createdAt ?? now),
    updatedAt: normalizeUpdatedAt(record.updatedAt ?? now),
  };
}

function createDefaultKey(): McpHttpApiKey {
  const now = new Date().toISOString();
  return {
    id: generateKeyId(),
    name: '기본 키',
    apiKey: generateApiKey(),
    scopes: [...MCP_HTTP_SCOPES],
    createdAt: now,
    updatedAt: now,
  };
}

function createDefaultSettings(): StoredMcpHttpSettings {
  return {
    enabled: false,
    keys: [createDefaultKey()],
    signingSecret: generateSigningSecret(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeSettings(value: unknown): StoredMcpHttpSettings {
  if (!value || typeof value !== 'object') {
    return createDefaultSettings();
  }

  const record = value as Record<string, unknown>;
  const migratedLegacyKey = isValidApiKey(record.apiKey)
    ? [{
        id: generateKeyId(),
        name: '기본 키',
        apiKey: record.apiKey,
        scopes: [...MCP_HTTP_SCOPES],
        createdAt: normalizeUpdatedAt(record.updatedAt),
        updatedAt: normalizeUpdatedAt(record.updatedAt),
      } satisfies McpHttpApiKey]
    : [];
  const keys = (Array.isArray(record.keys) ? record.keys : migratedLegacyKey)
    .map(normalizeKey)
    .filter((key): key is McpHttpApiKey => key !== null);

  return {
    enabled: record.enabled === true && keys.length > 0,
    keys: keys.length > 0 ? keys : [createDefaultKey()],
    signingSecret: typeof record.signingSecret === 'string' && record.signingSecret.length >= 43
      ? record.signingSecret
      : generateSigningSecret(),
    updatedAt: normalizeUpdatedAt(record.updatedAt),
  };
}

function publicSettings(settings: StoredMcpHttpSettings): McpHttpSettings {
  return {
    enabled: settings.enabled,
    keys: settings.keys.map((key) => ({ ...key, scopes: [...key.scopes] })),
    updatedAt: settings.updatedAt,
  };
}

class McpHttpSettingsService {
  private settings: StoredMcpHttpSettings | null = null;

  private saveSettings(settings: StoredMcpHttpSettings): McpHttpSettings {
    fs.mkdirSync(path.dirname(MCP_HTTP_SETTINGS_FILE_PATH), { recursive: true });
    fs.writeFileSync(MCP_HTTP_SETTINGS_FILE_PATH, JSON.stringify(settings, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });

    try {
      fs.chmodSync(MCP_HTTP_SETTINGS_FILE_PATH, 0o600);
    } catch {
      // Some Windows filesystems do not expose POSIX permission bits.
    }

    this.settings = settings;
    return publicSettings(settings);
  }

  private loadStoredSettings(): StoredMcpHttpSettings {
    if (this.settings) {
      return this.settings;
    }

    if (!fs.existsSync(MCP_HTTP_SETTINGS_FILE_PATH)) {
      this.saveSettings(createDefaultSettings());
      return this.settings!;
    }

    try {
      const rawSettings = JSON.parse(fs.readFileSync(MCP_HTTP_SETTINGS_FILE_PATH, 'utf8'));
      const normalizedSettings = normalizeSettings(rawSettings);
      if (JSON.stringify(rawSettings) !== JSON.stringify(normalizedSettings)) {
        this.saveSettings(normalizedSettings);
      } else {
        this.settings = normalizedSettings;
      }
      return this.settings!;
    } catch (error) {
      console.error('[MCP] Failed to load HTTP settings; disabling the endpoint:', error);
      this.saveSettings(createDefaultSettings());
      return this.settings!;
    }
  }

  loadSettings(): McpHttpSettings {
    return publicSettings(this.loadStoredSettings());
  }

  updateEnabled(enabled: boolean): McpHttpSettings {
    const current = this.loadStoredSettings();
    return this.saveSettings({
      ...current,
      enabled: enabled && current.keys.length > 0,
      updatedAt: new Date().toISOString(),
    });
  }

  createApiKey(name: string, scopes: unknown): McpHttpSettings {
    const normalizedName = name.trim().slice(0, 80);
    if (!normalizedName) {
      throw new Error('name is required');
    }

    const current = this.loadStoredSettings();
    const now = new Date().toISOString();
    return this.saveSettings({
      ...current,
      keys: [...current.keys, {
        id: generateKeyId(),
        name: normalizedName,
        apiKey: generateApiKey(),
        scopes: normalizeScopes(scopes, ['read']),
        createdAt: now,
        updatedAt: now,
      }],
      updatedAt: now,
    });
  }

  rotateApiKey(keyId?: string): McpHttpSettings {
    const current = this.loadStoredSettings();
    const targetId = keyId || current.keys[0]?.id;
    if (!targetId || !current.keys.some((key) => key.id === targetId)) {
      throw new Error('MCP key not found');
    }

    const now = new Date().toISOString();
    return this.saveSettings({
      ...current,
      keys: current.keys.map((key) => key.id === targetId ? { ...key, apiKey: generateApiKey(), updatedAt: now } : key),
      updatedAt: now,
    });
  }

  updateApiKey(keyId: string, name: string, scopes: unknown): McpHttpSettings {
    const current = this.loadStoredSettings();
    if (!current.keys.some((key) => key.id === keyId)) {
      throw new Error('MCP key not found');
    }
    const normalizedName = name.trim().slice(0, 80);
    if (!normalizedName) throw new Error('name is required');
    const now = new Date().toISOString();
    return this.saveSettings({
      ...current,
      keys: current.keys.map((key) => key.id === keyId
        ? { ...key, name: normalizedName, scopes: normalizeScopes(scopes, ['read']), updatedAt: now }
        : key),
      updatedAt: now,
    });
  }

  revokeApiKey(keyId: string): McpHttpSettings {
    const current = this.loadStoredSettings();
    if (!current.keys.some((key) => key.id === keyId)) {
      throw new Error('MCP key not found');
    }

    const now = new Date().toISOString();
    const keys = current.keys.filter((key) => key.id !== keyId);
    return this.saveSettings({
      ...current,
      enabled: keys.length > 0 ? current.enabled : false,
      keys,
      updatedAt: now,
    });
  }

  authenticate(candidate: string | null): McpHttpAuthentication | null {
    if (!candidate) {
      return null;
    }

    const candidateDigest = crypto.createHash('sha256').update(candidate).digest();
    for (const key of this.loadStoredSettings().keys) {
      const expectedDigest = crypto.createHash('sha256').update(key.apiKey).digest();
      if (crypto.timingSafeEqual(expectedDigest, candidateDigest)) {
        return { keyId: key.id, keyName: key.name, scopes: [...key.scopes] };
      }
    }
    return null;
  }

  isAuthorized(candidate: string | null): boolean {
    return this.authenticate(candidate) !== null;
  }

  getSigningSecret(): string {
    return this.loadStoredSettings().signingSecret;
  }
}

export const mcpHttpSettingsService = new McpHttpSettingsService();
