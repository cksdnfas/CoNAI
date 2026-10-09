import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

const LLM_CONNECTION_TYPES = ['llm_openai_compatible', 'llm_ollama'];
const LEGACY_KEYS = ['provider_name', 'model'];

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function hasId(value: unknown) {
  const id = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isSafeInteger(id) && id > 0;
}

/**
 * LLM 호출 nodes saved before model rows name a connection (`provider_name`, + `model`, empty meaning the connection's
 * primary model). They now pick a model row (`model_slot_id`) like everything else: the row of that connection + model,
 * created when missing, or for an empty model the connection's primary row (the default row when it is on that
 * connection, else its first) — the model the node called before. The pair keys are dropped. A node that already
 * names a row or a profile only loses the leftover keys. Graphs whose connection is gone (or is not an LLM connection)
 * are left alone: the node still runs them the old way and fails as before. Idempotent.
 */
export function migrateWorkflowLlmNodes(db: Database.Database): void {
  const modules = new Set(
    (db.prepare('SELECT id, internal_fixed_values FROM module_definitions WHERE internal_fixed_values LIKE ?').all('%system.call_llm%') as Array<{ id: number; internal_fixed_values: string | null }>)
      .filter((row) => {
        try { return JSON.parse(row.internal_fixed_values ?? '{}')?.operation_key === 'system.call_llm'; } catch { return false; }
      })
      .map((row) => row.id),
  );
  if (modules.size === 0) return;
  const graphs = db.prepare(`SELECT id, graph_json FROM graph_workflows WHERE graph_json LIKE '%"provider_name"%'`).all() as Array<{ id: number; graph_json: string }>;
  if (graphs.length === 0) return;

  const connections = new Set((db.prepare(`SELECT provider_name FROM external_api_providers WHERE provider_type IN (${LLM_CONNECTION_TYPES.map(() => '?').join(', ')})`).all(...LLM_CONNECTION_TYPES) as Array<{ provider_name: string }>).map((row) => row.provider_name));
  const findRow = db.prepare('SELECT id FROM llm_model_slots WHERE provider_name = ? AND model = ? ORDER BY id ASC LIMIT 1');
  const primaryRow = db.prepare('SELECT id FROM llm_model_slots WHERE provider_name = ? ORDER BY is_default DESC, sort_order ASC, id ASC LIMIT 1');
  const maxOrder = db.prepare('SELECT MAX(sort_order) AS max FROM llm_model_slots');
  const insertRow = db.prepare('INSERT INTO llm_model_slots (name, provider_name, model, sort_order) VALUES (?, ?, ?, ?)');
  /** The row a saved connection + model called; null when the connection is gone or has no model to call. */
  const rowFor = (providerName: string, model: string) => {
    if (!connections.has(providerName)) return null;
    if (!model) return (primaryRow.get(providerName) as { id: number } | undefined)?.id ?? null;
    const found = findRow.get(providerName, model) as { id: number } | undefined;
    if (found) return found.id;
    const order = ((maxOrder.get() as { max: number | null }).max ?? -1) + 1;
    created = true;
    return Number(insertRow.run(randomUUID(), providerName, model, order).lastInsertRowid);
  };
  let created = false;
  const updateGraph = db.prepare('UPDATE graph_workflows SET graph_json = ? WHERE id = ?');

  db.transaction(() => {
    for (const graph of graphs) {
      let parsed: { nodes?: unknown } | null;
      try { parsed = JSON.parse(graph.graph_json); } catch { continue; }
      if (!parsed || !Array.isArray(parsed.nodes)) continue;
      let changed = false;
      for (const node of parsed.nodes as Array<{ module_id?: unknown; input_values?: Record<string, unknown> }>) {
        const values = node?.input_values;
        if (!values || typeof values !== 'object' || !modules.has(Number(node.module_id))) continue;
        if (!('provider_name' in values)) continue;
        // Without a connection the pair never meant anything (the node now takes the ★ default row).
        const providerName = text(values.provider_name);
        if (providerName && !hasId(values.model_slot_id) && !hasId(values.profile_id)) {
          const slotId = rowFor(providerName, text(values.model));
          if (slotId === null) continue;
          values.model_slot_id = slotId;
        }
        for (const key of LEGACY_KEYS) delete values[key];
        changed = true;
      }
      if (changed) updateGraph.run(JSON.stringify(parsed), graph.id);
    }
    // A row created while no LLM row existed becomes the default (one LLM row is always the default).
    const llmRows = `SELECT s.id FROM llm_model_slots s JOIN external_api_providers p ON p.provider_name = s.provider_name WHERE p.provider_type IN (${LLM_CONNECTION_TYPES.map((type) => `'${type}'`).join(', ')})`;
    if (created && !db.prepare(`${llmRows} AND s.is_default = 1`).get()) {
      const first = db.prepare(`${llmRows} ORDER BY s.sort_order ASC, s.id ASC LIMIT 1`).get() as { id: number } | undefined;
      if (first) db.prepare('UPDATE llm_model_slots SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END').run(first.id);
    }
  })();
}
