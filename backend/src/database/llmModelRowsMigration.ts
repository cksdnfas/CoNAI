import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

const MODEL_CONNECTION_TYPES = ['llm_openai_compatible', 'llm_ollama', 'decision_typesafe'];
const TYPESAFE_DEFAULT_MODEL = 'jev-latest';

type Connection = { provider_name: string; provider_type: string; additional_config: string | null };

type ProfileRow = {
  id: number;
  engine: string | null;
  provider_name: string | null;
  model: string | null;
  model_slot_id: number | null;
  summary_provider_name: string | null;
  summary_model: string | null;
  summary_slot_id: number | null;
  translation_provider_name: string | null;
  translation_model: string | null;
  translation_slot_id: number | null;
  suggest_provider_name: string | null;
  suggest_model: string | null;
  suggest_slot_id: number | null;
  judge_provider_name: string | null;
  judge_model: string | null;
  judge_slot_id: number | null;
};

/** Every column that holds an llm_model_slots id, as [table, column]. */
const SLOT_REFERENCES: Array<[string, string]> = [
  ['llm_chat_profiles', 'model_slot_id'],
  ['llm_chat_profiles', 'summary_slot_id'],
  ['llm_chat_profiles', 'translation_slot_id'],
  ['llm_chat_profiles', 'suggest_slot_id'],
  ['llm_chat_profiles', 'judge_slot_id'],
  ['chat_judge_presets', 'model_slot_id'],
  ['chat_judge_presets', 'escalation_slot_id'],
  ['chat_user_profiles', 'model_slot_id'],
  ['codex_chat_threads', 'reaction_model_slot_id'],
];

function parseConfig(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Settings → LLM became "connection ▸ its models": a connection no longer carries a default model, and nothing names a
 * connection + model pair directly any more; everything references a model row (llm_model_slots) instead. This moves
 * the old state over without changing what any profile, judge or workflow node calls:
 * - a connection's default model becomes one of its rows (listed first under it) and the key is dropped;
 * - a profile role / judge / preset that named a connection (+ model, empty meaning the connection's default) points at
 *   that row, created when missing; a summary or suggestion role that named only a model, on the chat's connection,
 *   too; the pair columns are cleared;
 * - rows naming the same connection + model are merged into the oldest, and one row ends up the default.
 * Idempotent: once nothing names a pair or a default model, a run changes nothing.
 */
export function migrateLlmModelRows(db: Database.Database): void {
  const connections = db.prepare(`SELECT provider_name, provider_type, additional_config FROM external_api_providers WHERE provider_type IN (${MODEL_CONNECTION_TYPES.map(() => '?').join(', ')})`).all(...MODEL_CONNECTION_TYPES) as Connection[];
  const byName = new Map(connections.map((connection) => [connection.provider_name, connection]));
  // A connection's default model from its config; a TypeSafe connection without one called TypeSafe's own default.
  const defaultModels = new Map<string, string>();
  for (const connection of connections) {
    const config = parseConfig(connection.additional_config);
    const model = text(config?.default_model) || text(config?.model);
    if (model) defaultModels.set(connection.provider_name, model);
  }
  const defaultModelOf = (providerName: string) => defaultModels.get(providerName) || (byName.get(providerName)?.provider_type === 'decision_typesafe' ? TYPESAFE_DEFAULT_MODEL : '');

  const findRow = db.prepare('SELECT id FROM llm_model_slots WHERE provider_name = ? AND model = ? ORDER BY id ASC LIMIT 1');
  const maxOrder = db.prepare('SELECT MAX(sort_order) AS max FROM llm_model_slots');
  const insertRow = db.prepare('INSERT INTO llm_model_slots (name, provider_name, model, sort_order) VALUES (?, ?, ?, ?)');
  const ensure = (providerName: string, model: string) => {
    const found = findRow.get(providerName, model) as { id: number } | undefined;
    if (found) return found.id;
    const order = ((maxOrder.get() as { max: number | null }).max ?? -1) + 1;
    return Number(insertRow.run(randomUUID(), providerName, model, order).lastInsertRowid);
  };
  /** The row for a named connection + model (empty: the connection's default model); null when nothing can be called. */
  const rowFor = (providerName: string | null, model: string | null) => {
    const name = text(providerName);
    const connection = name ? byName.get(name) : undefined;
    if (!connection) return null;
    const resolved = text(model) || defaultModelOf(name);
    return resolved ? ensure(name, resolved) : null;
  };
  const slotExists = db.prepare('SELECT id, provider_name FROM llm_model_slots WHERE id = ?');
  const liveSlot = (id: number | null) => (id === null ? null : (slotExists.get(id) as { id: number; provider_name: string } | undefined) ?? null);
  const defaultRow = () => db.prepare('SELECT id, provider_name FROM llm_model_slots WHERE is_default = 1 ORDER BY id ASC LIMIT 1').get() as { id: number; provider_name: string } | undefined;

  db.transaction(() => {
    // Connection defaults first, so each lands at the top of its connection.
    for (const [providerName, model] of defaultModels) ensure(providerName, model);

    const profiles = db.prepare(`
      SELECT id, engine, provider_name, model, model_slot_id, summary_provider_name, summary_model, summary_slot_id,
        translation_provider_name, translation_model, translation_slot_id, suggest_provider_name, suggest_model, suggest_slot_id,
        judge_provider_name, judge_model, judge_slot_id
      FROM llm_chat_profiles
    `).all() as ProfileRow[];
    const updateProfile = db.prepare(`
      UPDATE llm_chat_profiles SET
        provider_name = @provider_name, model = @model, model_slot_id = @model_slot_id,
        summary_provider_name = NULL, summary_model = NULL, summary_slot_id = @summary_slot_id,
        translation_provider_name = NULL, translation_model = NULL, translation_slot_id = @translation_slot_id,
        suggest_provider_name = NULL, suggest_model = NULL, suggest_slot_id = @suggest_slot_id,
        judge_provider_name = NULL, judge_model = NULL, judge_slot_id = @judge_slot_id
      WHERE id = @id
    `);
    for (const profile of profiles) {
      const engine = profile.engine ?? 'llm';
      const hasPairs = [profile.summary_provider_name, profile.summary_model, profile.translation_provider_name, profile.translation_model, profile.suggest_provider_name, profile.suggest_model, profile.judge_provider_name, profile.judge_model].some((value) => text(value))
        || (engine === 'llm' && (text(profile.provider_name) || text(profile.model)));
      if (!hasPairs) continue;

      // The chat role (API LLM only; Codex / Claude keep their own model in `model`).
      let chatSlot = liveSlot(profile.model_slot_id)?.id ?? null;
      if (engine === 'llm' && chatSlot === null && text(profile.provider_name)) chatSlot = rowFor(profile.provider_name, profile.model);
      const chatConnection = engine === 'llm' ? (chatSlot !== null ? liveSlot(chatSlot)?.provider_name : defaultRow()?.provider_name) ?? null : null;

      const helper = (slotId: number | null, providerName: string | null, model: string | null, inherits: boolean) => {
        const live = liveSlot(slotId)?.id ?? null;
        if (live !== null) return live;
        if (text(providerName)) return rowFor(providerName, model);
        // Summary / suggestions with only a model of their own ran on the chat's connection with it.
        if (inherits && engine === 'llm' && text(model) && chatConnection) return rowFor(chatConnection, model);
        return null;
      };

      updateProfile.run({
        id: profile.id,
        provider_name: engine === 'llm' ? '' : profile.provider_name ?? '',
        model: engine === 'llm' ? null : profile.model,
        model_slot_id: engine === 'llm' ? chatSlot : null,
        summary_slot_id: helper(profile.summary_slot_id, profile.summary_provider_name, profile.summary_model, true),
        translation_slot_id: helper(profile.translation_slot_id, profile.translation_provider_name, profile.translation_model, false),
        suggest_slot_id: helper(profile.suggest_slot_id, profile.suggest_provider_name, profile.suggest_model, true),
        judge_slot_id: liveSlot(profile.judge_slot_id)?.id ?? (text(profile.judge_provider_name) ? rowFor(profile.judge_provider_name, profile.judge_model) : null),
      });
    }

    const presets = db.prepare('SELECT id, provider_name, model, model_slot_id, escalation_provider_name, escalation_model, escalation_slot_id FROM chat_judge_presets').all() as Array<{ id: number; provider_name: string | null; model: string | null; model_slot_id: number | null; escalation_provider_name: string | null; escalation_model: string | null; escalation_slot_id: number | null }>;
    const updatePreset = db.prepare("UPDATE chat_judge_presets SET provider_name = NULL, model = '', escalation_provider_name = NULL, escalation_model = '', model_slot_id = ?, escalation_slot_id = ? WHERE id = ?");
    for (const preset of presets) {
      if (![preset.provider_name, preset.model, preset.escalation_provider_name, preset.escalation_model].some((value) => text(value))) continue;
      updatePreset.run(
        liveSlot(preset.model_slot_id)?.id ?? (text(preset.provider_name) ? rowFor(preset.provider_name, preset.model) : null),
        liveSlot(preset.escalation_slot_id)?.id ?? (text(preset.escalation_provider_name) ? rowFor(preset.escalation_provider_name, preset.escalation_model) : null),
        preset.id,
      );
    }

    // Merge rows naming the same connection + model into the oldest.
    const duplicates = db.prepare(`
      SELECT a.id AS drop_id, MIN(b.id) AS keep_id, a.is_default AS was_default FROM llm_model_slots a
      JOIN llm_model_slots b ON b.provider_name = a.provider_name AND b.model = a.model AND b.id < a.id
      GROUP BY a.id
    `).all() as Array<{ drop_id: number; keep_id: number; was_default: number }>;
    for (const { drop_id: dropId, keep_id: keepId, was_default: wasDefault } of duplicates) {
      for (const [table, column] of SLOT_REFERENCES) db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(keepId, dropId);
      db.prepare('DELETE FROM llm_model_slots WHERE id = ?').run(dropId);
      if (wasDefault === 1) db.prepare('UPDATE llm_model_slots SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END').run(keepId);
    }

    // Exactly one default while LLM rows exist (a TypeSafe model never is one): the most used LLM row when none is marked.
    const llmRows = `SELECT s.id FROM llm_model_slots s JOIN external_api_providers p ON p.provider_name = s.provider_name WHERE p.provider_type IN ('llm_openai_compatible', 'llm_ollama')`;
    const marked = db.prepare(`${llmRows} AND s.is_default = 1 ORDER BY s.id ASC`).all() as Array<{ id: number }>;
    if (marked.length > 0) db.prepare('UPDATE llm_model_slots SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END').run(marked[0].id);
    if (marked.length === 0) {
      db.prepare('UPDATE llm_model_slots SET is_default = 0').run();
      const uses = new Map<number, number>();
      for (const [table, column] of SLOT_REFERENCES) {
        for (const row of db.prepare(`SELECT ${column} AS id, COUNT(*) AS n FROM ${table} WHERE ${column} IS NOT NULL GROUP BY ${column}`).all() as Array<{ id: number; n: number }>) {
          uses.set(row.id, (uses.get(row.id) ?? 0) + row.n);
        }
      }
      const rows = db.prepare(`${llmRows} ORDER BY s.sort_order ASC, s.id ASC`).all() as Array<{ id: number }>;
      const pick = [...rows].sort((a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0))[0];
      if (pick) db.prepare('UPDATE llm_model_slots SET is_default = 1 WHERE id = ?').run(pick.id);
    }

    // The connections' default model keys are now rows.
    const updateConfig = db.prepare('UPDATE external_api_providers SET additional_config = ?, updated_at = CURRENT_TIMESTAMP WHERE provider_name = ?');
    for (const connection of connections) {
      const config = parseConfig(connection.additional_config);
      if (!config || (!('default_model' in config) && !('model' in config))) continue;
      const next = { ...config };
      delete next.default_model;
      delete next.model;
      updateConfig.run(JSON.stringify(next), connection.provider_name);
    }
  })();
}
