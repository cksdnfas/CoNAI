import type { Database } from 'better-sqlite3';

/** Keep public readiness independent of the owner preview and resumable video derivatives. */
export const up = async (db: Database): Promise<void> => {
  const columns = db.prepare('PRAGMA table_info(media_metadata)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'metadata_extraction_status')) {
    // Existing media retains its visibility. New registrations explicitly start pending.
    db.exec("ALTER TABLE media_metadata ADD COLUMN metadata_extraction_status TEXT NOT NULL DEFAULT 'completed'");
    // Old in-memory metadata work may have been interrupted at restart; verify pending rows again.
    db.exec("UPDATE media_metadata SET metadata_extraction_status = 'pending' WHERE postprocess_status = 'pending'");
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_media_metadata_extraction_pending
      ON media_metadata(composite_hash) WHERE metadata_extraction_status = 'pending';
    CREATE TABLE IF NOT EXISTS generated_video_optimizations (
      composite_hash TEXT PRIMARY KEY REFERENCES media_metadata(composite_hash) ON DELETE CASCADE,
      source_path TEXT NOT NULL,
      source_size INTEGER NOT NULL,
      source_mtime REAL NOT NULL,
      crf INTEGER NOT NULL,
      audio_bitrate INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      output_path TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      lease_until INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_generated_video_optimizations_pending
      ON generated_video_optimizations(status, lease_until);
  `);
};

export const down = async (_db: Database): Promise<void> => {
  // Preserve media and recoverable jobs when rolling back application code.
};
