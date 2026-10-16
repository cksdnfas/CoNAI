import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

const ROUTE_KEYS = ['chat', 'summary', 'translation', 'suggest', 'judge'] as const;

/** Columns that pick a model for chat-side work; a reference to the old ★ row moves to the chat route. */
const CHAT_REFERENCES: Array<[string, string]> = [
  ['llm_chat_profiles', 'model_slot_id'],
  ['llm_chat_profiles', 'summary_slot_id'],
  ['llm_chat_profiles', 'translation_slot_id'],
  ['llm_chat_profiles', 'suggest_slot_id'],
  ['chat_judge_presets', 'escalation_slot_id'],
  ['chat_user_profiles', 'model_slot_id'],
  ['codex_chat_threads', 'reaction_model_slot_id'],
];

/** Columns that pick a judge; a reference to the old ⚖ row moves to the judge route. */
const JUDGE_REFERENCES: Array<[string, string]> = [
  ['llm_chat_profiles', 'judge_slot_id'],
  ['chat_judge_presets', 'model_slot_id'],
  ['content_evaluation_settings', 'model_slot_id'],
];

/** Workflow node operations whose `model_slot_id` picks a judge rather than a chat model. */
const JUDGE_NODE_OPERATIONS = new Set(['system.judge_text']);
const MODEL_NODE_OPERATIONS = new Set(['system.call_llm', 'system.translate_text', 'system.judge_text', 'system.chat_profile_reply', 'system.draft_appearance_tags']);

function tableHasColumn(db: Database.Database, table: string, column: string) {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((entry) => entry.name === column);
}

/**
 * Representative models (대표모델): route rows in llm_model_slots that point at a model row. The five built-in routes
 * (one per part) are created once; the chat route takes over the ★ default row and the judge route the ⚖ default judge.
 * Everything that held the ★ / ⚖ row itself — new profiles, imported cards and proposals wrote the ★ id straight in —
 * is moved onto the route, so pointing the route elsewhere later reaches it. A saved pick of any other row stays.
 * Runs once: when the built-in routes exist it changes nothing.
 */
export function migrateLlmModelRoutes(db: Database.Database): void {
  const existing = new Set((db.prepare('SELECT route_key FROM llm_model_slots WHERE is_route = 1 AND route_key IS NOT NULL').all() as Array<{ route_key: string }>).map((row) => row.route_key));
  if (ROUTE_KEYS.every((key) => existing.has(key))) return;
  const firstRun = existing.size === 0;

  db.transaction(() => {
    const star = db.prepare('SELECT id FROM llm_model_slots WHERE is_route = 0 AND is_default = 1 ORDER BY id ASC LIMIT 1').get() as { id: number } | undefined;
    const judge = db.prepare('SELECT id FROM llm_model_slots WHERE is_route = 0 AND is_default_judge = 1 ORDER BY id ASC LIMIT 1').get() as { id: number } | undefined;
    const insert = db.prepare("INSERT INTO llm_model_slots (name, provider_name, model, sort_order, is_route, route_key, target_slot_id) VALUES (?, '', '', ?, 1, ?, ?)");
    const routeIds = new Map<string, number>();
    ROUTE_KEYS.forEach((key, index) => {
      if (existing.has(key)) return;
      const target = key === 'chat' ? star?.id ?? null : key === 'judge' ? judge?.id ?? null : null;
      routeIds.set(key, Number(insert.run(randomUUID(), index, key, target).lastInsertRowid));
    });
    if (!firstRun) return;

    const chatRoute = routeIds.get('chat');
    const judgeRoute = routeIds.get('judge');
    const repoint = (references: Array<[string, string]>, from: number | undefined, to: number | undefined) => {
      if (from === undefined || to === undefined) return;
      for (const [table, column] of references) {
        if (tableHasColumn(db, table, column)) db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(to, from);
      }
    };
    repoint(CHAT_REFERENCES, star?.id, chatRoute);
    repoint(JUDGE_REFERENCES, judge?.id, judgeRoute);

    // Workflow nodes keep their pick in the graph JSON.
    const operationByModule = new Map<number, string>();
    for (const row of db.prepare('SELECT id, internal_fixed_values FROM module_definitions WHERE internal_fixed_values LIKE ?').all('%"system.%') as Array<{ id: number; internal_fixed_values: string | null }>) {
      try {
        const key = JSON.parse(row.internal_fixed_values ?? '{}')?.operation_key;
        if (typeof key === 'string' && MODEL_NODE_OPERATIONS.has(key)) operationByModule.set(row.id, key);
      } catch { /* not a system node */ }
    }
    if (operationByModule.size === 0) return;
    const updateGraph = db.prepare('UPDATE graph_workflows SET graph_json = ? WHERE id = ?');
    for (const graph of db.prepare("SELECT id, graph_json FROM graph_workflows WHERE graph_json LIKE '%model_slot_id%'").all() as Array<{ id: number; graph_json: string }>) {
      let parsed: { nodes?: unknown } | null;
      try { parsed = JSON.parse(graph.graph_json); } catch { continue; }
      if (!parsed || !Array.isArray(parsed.nodes)) continue;
      let changed = false;
      for (const node of parsed.nodes as Array<{ module_id?: unknown; input_values?: Record<string, unknown> }>) {
        const operation = node ? operationByModule.get(Number(node.module_id)) : undefined;
        const values = node?.input_values;
        if (!operation || !values || typeof values !== 'object') continue;
        const current = Number(values.model_slot_id);
        const isJudge = JUDGE_NODE_OPERATIONS.has(operation);
        const [from, to] = isJudge ? [judge?.id, judgeRoute] : [star?.id, chatRoute];
        if (from !== undefined && to !== undefined && current === from) {
          values.model_slot_id = to;
          changed = true;
        }
      }
      if (changed) updateGraph.run(JSON.stringify(parsed), graph.id);
    }
  })();
}
