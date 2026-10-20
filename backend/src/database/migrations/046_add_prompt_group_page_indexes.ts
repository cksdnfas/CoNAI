import type { Database } from 'better-sqlite3';

const TABLES = ['prompt_collection', 'negative_prompt_collection', 'auto_prompt_collection'] as const;

// EXPLAIN on 100k rows per table: group index + temporary ORDER BY B-tree
// becomes a single ordered index search, including group_id IS NULL.
export const up = async (db: Database): Promise<void> => {
  for (const table of TABLES) {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_group_usage_prompt
      ON ${table}(group_id, usage_count DESC, prompt ASC)`);
  }
};

export const down = async (db: Database): Promise<void> => {
  for (const table of TABLES) {
    db.exec(`DROP INDEX IF EXISTS idx_${table}_group_usage_prompt`);
  }
};
