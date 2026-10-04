import type { Database } from 'better-sqlite3';

function hasColumn(db: Database, table: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

/**
 * Still images get a pixel-exact identity: SHA-256 of the decoded pixels (and size). Until now their identity was the
 * greyscale perceptual hashes, so recoloured or barely different images merged into one. Existing rows keep their
 * ids; `pixel_hash` is filled lazily the first time a look-alike file has to be told apart from them.
 */
export const up = async (db: Database): Promise<void> => {
  if (!hasColumn(db, 'media_metadata', 'pixel_hash')) {
    db.exec('ALTER TABLE media_metadata ADD COLUMN pixel_hash TEXT DEFAULT NULL');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_media_metadata_pixel_hash ON media_metadata(pixel_hash) WHERE pixel_hash IS NOT NULL');
};

export const down = async (db: Database): Promise<void> => {
  db.exec('DROP INDEX IF EXISTS idx_media_metadata_pixel_hash');
  // The additive column stays: dropping it would rebuild media_metadata (see the 036 cascade trap).
};
