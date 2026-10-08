import type Database from 'better-sqlite3';

/**
 * Library hashes that user.db still points at (chat profiles, chat messages, asset slots, card media, graph
 * workflows, preferences ...).
 *
 * Those references live in typed columns *and* inside JSON blobs, and new features keep adding more, so instead of
 * a per-feature list this scans every user table for 32/48-hex tokens. A false positive (a random 32-hex id that is
 * not a media hash) only keeps one more orphan row, which is the safe direction.
 */

const MEDIA_HASH_TOKEN = /\b(?:[0-9a-f]{48}|[0-9a-f]{32})\b/gi;
const PAGE_SIZE = 200;

/**
 * Tables that never hold a reference worth keeping media for: job bookkeeping, generation history (already
 * pruned when its media is gone), execution logs and request captures. Skipping them keeps the scan short.
 */
const EXCLUDED_TABLES = new Set([
  'runtime_jobs',
  'generation_queue_jobs',
  'generation_queue_idempotency',
  'api_generation_history',
  'graph_executions',
  'graph_execution_logs',
  'graph_execution_node_io',
  'graph_execution_artifacts',
  'chat_request_captures',
  'stored_file_entries',
  'chat_file_attachments',
]);

export interface UserMediaReferenceScanHooks {
  yield?: () => Promise<void>;
  throwIfCancelled?: () => void;
}

export interface UserMediaReferenceScan {
  hashes: Set<string>;
  scannedTables: string[];
  skippedTables: string[];
}

function addTokens(target: Set<string>, value: unknown): void {
  if (typeof value !== 'string' || value.length < 32) {
    return;
  }

  for (const match of value.matchAll(MEDIA_HASH_TOKEN)) {
    target.add(match[0].toLowerCase());
  }
}

function listScannableTables(db: Database.Database): string[] {
  const rows = db.prepare(`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `).all() as Array<{ name: string; sql: string | null }>;

  // FTS shadow tables (`<vtab>_data`, `_content` ...) only copy their parent's text.
  const virtualTables = rows
    .filter((row) => /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(row.sql ?? ''))
    .map((row) => row.name);

  return rows
    .map((row) => row.name)
    .filter((name) => !EXCLUDED_TABLES.has(name))
    .filter((name) => !virtualTables.some((parent) => name === parent || name.startsWith(`${parent}_`)))
    .sort();
}

/** Text-ish columns of one table; integer/real columns can never hold a hex token. */
function listTextColumns(db: Database.Database, table: string): string[] {
  const columns = db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all() as Array<{ name: string; type: string }>;
  return columns
    .filter((column) => !/^(INTEGER|INT|REAL|BOOLEAN|DATETIME|DATE|NUMERIC)$/i.test(column.type.trim()))
    .map((column) => column.name);
}

/** Scan user.db page by page (rowid keyset) and collect every media-hash-shaped token. */
export async function collectUserDbMediaReferences(
  db: Database.Database,
  hooks: UserMediaReferenceScanHooks = {},
): Promise<UserMediaReferenceScan> {
  const hashes = new Set<string>();
  const scannedTables: string[] = [];
  const skippedTables: string[] = [];

  for (const table of listScannableTables(db)) {
    hooks.throwIfCancelled?.();
    const columns = listTextColumns(db, table);
    if (columns.length === 0) {
      continue;
    }

    const quotedTable = `"${table.replace(/"/g, '""')}"`;
    const columnList = columns.map((column) => `"${column.replace(/"/g, '""')}"`).join(', ');
    let page: Database.Statement;
    try {
      page = db.prepare(`SELECT rowid AS __rid, ${columnList} FROM ${quotedTable} WHERE rowid > ? ORDER BY rowid LIMIT ${PAGE_SIZE}`);
    } catch {
      // WITHOUT ROWID tables have no keyset handle; none of ours hold references today.
      skippedTables.push(table);
      continue;
    }

    let lastRowId = 0;
    for (;;) {
      const rows = page.all(lastRowId) as Array<Record<string, unknown> & { __rid: number }>;
      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        for (const column of columns) {
          addTokens(hashes, row[column]);
        }
      }

      lastRowId = rows[rows.length - 1].__rid;
      if (hooks.yield) {
        await hooks.yield();
      }
    }

    scannedTables.push(table);
  }

  return { hashes, scannedTables, skippedTables };
}
