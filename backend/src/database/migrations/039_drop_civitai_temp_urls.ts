import type { Database } from 'better-sqlite3';

/**
 * Civitai post upload is gone (Civitai blocks automated posting), so its temporary image links go too. The table only
 * references media_metadata, nothing references it, so dropping it touches no other rows.
 */
export const up = async (db: Database): Promise<void> => {
  db.exec('DROP TABLE IF EXISTS civitai_temp_urls');
};

export const down = async (): Promise<void> => {
  // The feature was removed; nothing recreates the table.
};
