import type { Database } from 'better-sqlite3';

export const up = async (db: Database): Promise<void> => {
  db.exec(`CREATE TABLE IF NOT EXISTS group_resources (
    id INTEGER PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    resource_key TEXT NOT NULL,
    reference TEXT NOT NULL,
    label TEXT NOT NULL,
    UNIQUE(group_id, resource_key)
  )`);
};
export const down = async (_db: Database): Promise<void> => { /* Keep resource references. */ };
