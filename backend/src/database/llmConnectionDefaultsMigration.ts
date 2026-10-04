import type Database from 'better-sqlite3';

const GENERATION_KEYS = ['default_temperature', 'temperature', 'default_max_tokens', 'max_tokens'] as const;

function readNumber(value: unknown) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

/**
 * LLM connections used to carry generation defaults (temperature, max tokens) that chat profiles fell back to. Those
 * now live only on profiles and workflow nodes: copy a connection's defaults into the empty fields of the profiles that
 * use it, then drop them from the connection (and rename the legacy `model` key to `default_model`). Idempotent: a
 * connection without those keys is left as it is.
 */
export function migrateLlmConnectionGenerationDefaults(db: Database.Database): void {
  const connections = db.prepare(`
    SELECT provider_name, additional_config FROM external_api_providers
    WHERE provider_type IN ('llm_openai_compatible', 'llm_ollama') AND additional_config IS NOT NULL
  `).all() as Array<{ provider_name: string; additional_config: string }>;

  const updateConfig = db.prepare('UPDATE external_api_providers SET additional_config = ?, updated_at = CURRENT_TIMESTAMP WHERE provider_name = ?');
  const fillTemperature = db.prepare("UPDATE llm_chat_profiles SET temperature = ? WHERE provider_name = ? AND engine = 'llm' AND temperature IS NULL");
  const fillMaxTokens = db.prepare("UPDATE llm_chat_profiles SET max_tokens = ? WHERE provider_name = ? AND engine = 'llm' AND max_tokens IS NULL");

  db.transaction(() => {
    for (const connection of connections) {
      let config: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(connection.additional_config);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
        config = parsed as Record<string, unknown>;
      } catch {
        continue;
      }
      const hasGenerationKeys = GENERATION_KEYS.some((key) => key in config);
      const hasLegacyModel = 'model' in config;
      if (!hasGenerationKeys && !hasLegacyModel) continue;

      const temperature = readNumber(config.default_temperature) ?? readNumber(config.temperature);
      const maxTokens = readNumber(config.default_max_tokens) ?? readNumber(config.max_tokens);
      if (temperature !== null) fillTemperature.run(temperature, connection.provider_name);
      if (maxTokens !== null) fillMaxTokens.run(Math.round(maxTokens), connection.provider_name);

      const next = { ...config };
      for (const key of GENERATION_KEYS) delete next[key];
      if (hasLegacyModel) {
        if (!next.default_model && typeof config.model === 'string' && config.model.trim()) next.default_model = config.model.trim();
        delete next.model;
      }
      updateConfig.run(JSON.stringify(next), connection.provider_name);
    }
  })();
}
