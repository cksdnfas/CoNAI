import { getUserSettingsDb } from '../database/userSettingsDb';

/**
 * Per-account prompt editor settings (popup triggers, word-suggestion priority, tag underscores).
 * Stored as one JSON row in user_preferences; the editor normalizes the shape, so unknown or old keys are harmless.
 */
const MAX_SETTINGS_BYTES = 8 * 1024;

function settingsKey(accountId: number | null) {
  return `prompt_editor_settings:${accountId ?? 'guest'}`;
}

export class PromptEditorSettingsError extends Error {}

export const PromptEditorSettingsService = {
  read(accountId: number | null): Record<string, unknown> | null {
    const row = getUserSettingsDb().prepare('SELECT value FROM user_preferences WHERE key = ?').get(settingsKey(accountId)) as { value: string } | undefined;
    return row ? JSON.parse(row.value) as Record<string, unknown> : null;
  },

  write(accountId: number | null, settings: unknown): Record<string, unknown> {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new PromptEditorSettingsError('Settings must be an object');
    }
    const value = JSON.stringify(settings);
    if (Buffer.byteLength(value) > MAX_SETTINGS_BYTES) {
      throw new PromptEditorSettingsError('Settings are too large');
    }
    getUserSettingsDb()
      .prepare('INSERT INTO user_preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP')
      .run(settingsKey(accountId), value);
    return settings as Record<string, unknown>;
  },
};
