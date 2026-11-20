import type { Database } from 'better-sqlite3';

// 043 tracks membership identities. A conversion keeps the identity but changes the manual and auto totals.
export const up = async (db: Database): Promise<void> => {
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_image_groups_aggregate_collection_type
    AFTER UPDATE OF collection_type ON image_groups WHEN OLD.collection_type IS NOT NEW.collection_type
    BEGIN UPDATE aggregate_versions SET version = version + 1 WHERE scope = 'groups'; END;`);
};

export const down = async (db: Database): Promise<void> => {
  db.exec('DROP TRIGGER IF EXISTS trg_image_groups_aggregate_collection_type');
};
