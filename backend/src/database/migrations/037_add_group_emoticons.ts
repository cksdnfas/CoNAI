import type { Database } from 'better-sqlite3';

function hasColumn(db: Database, table: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

/**
 * Emoticon groups: a custom group flagged for chat use, whose images carry keywords. The keywords live on the
 * membership row, so the same image can answer to different words in different groups. NULL keywords mean "use the
 * file name"; an empty JSON array means the image has no keyword (not offered to the model).
 */
export const up = async (db: Database): Promise<void> => {
  if (!hasColumn(db, 'groups', 'emoticon_enabled')) {
    db.exec('ALTER TABLE groups ADD COLUMN emoticon_enabled INTEGER NOT NULL DEFAULT 0');
  }
  if (!hasColumn(db, 'image_groups', 'emote_keywords')) {
    db.exec('ALTER TABLE image_groups ADD COLUMN emote_keywords TEXT DEFAULT NULL');
  }
};

export const down = async (): Promise<void> => {
  // Additive columns are kept: dropping them would rebuild groups / image_groups (see the 036 cascade trap).
};
