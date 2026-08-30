import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { McpHttpSettings } from '@conai/shared';
import { runtimePaths } from '../config/runtimePaths';

const MCP_HTTP_SETTINGS_FILE_PATH = path.join(runtimePaths.basePath, 'config', 'mcp-http.json');
const MCP_API_KEY_PREFIX = 'conai_mcp_';

function generateApiKey(): string {
  return `${MCP_API_KEY_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
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

function createDefaultSettings(): McpHttpSettings {
  return {
    enabled: false,
    apiKey: generateApiKey(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeSettings(value: unknown): McpHttpSettings {
  if (!value || typeof value !== 'object') {
    return createDefaultSettings();
  }

  const record = value as Record<string, unknown>;
  const rawApiKey = record.apiKey;
  const hasValidKey = isValidApiKey(rawApiKey);
  return {
    enabled: record.enabled === true && hasValidKey,
    apiKey: hasValidKey ? rawApiKey : generateApiKey(),
    updatedAt: normalizeUpdatedAt(record.updatedAt),
  };
}

class McpHttpSettingsService {
  private settings: McpHttpSettings | null = null;

  private saveSettings(settings: McpHttpSettings): McpHttpSettings {
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
    return { ...settings };
  }

  loadSettings(): McpHttpSettings {
    if (this.settings) {
      return { ...this.settings };
    }

    if (!fs.existsSync(MCP_HTTP_SETTINGS_FILE_PATH)) {
      return this.saveSettings(createDefaultSettings());
    }

    try {
      const rawSettings = JSON.parse(fs.readFileSync(MCP_HTTP_SETTINGS_FILE_PATH, 'utf8'));
      const normalizedSettings = normalizeSettings(rawSettings);
      if (JSON.stringify(rawSettings) !== JSON.stringify(normalizedSettings)) {
        return this.saveSettings(normalizedSettings);
      }

      this.settings = normalizedSettings;
      return { ...normalizedSettings };
    } catch (error) {
      console.error('[MCP] Failed to load HTTP settings; disabling the endpoint:', error);
      return this.saveSettings(createDefaultSettings());
    }
  }

  updateEnabled(enabled: boolean): McpHttpSettings {
    const current = this.loadSettings();
    return this.saveSettings({
      ...current,
      enabled,
      updatedAt: new Date().toISOString(),
    });
  }

  rotateApiKey(): McpHttpSettings {
    const current = this.loadSettings();
    return this.saveSettings({
      ...current,
      apiKey: generateApiKey(),
      updatedAt: new Date().toISOString(),
    });
  }

  isAuthorized(candidate: string | null): boolean {
    if (!candidate) {
      return false;
    }

    const expected = this.loadSettings().apiKey;
    const expectedDigest = crypto.createHash('sha256').update(expected).digest();
    const candidateDigest = crypto.createHash('sha256').update(candidate).digest();
    return crypto.timingSafeEqual(expectedDigest, candidateDigest);
  }
}

export const mcpHttpSettingsService = new McpHttpSettingsService();
