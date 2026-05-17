import { Database } from 'better-sqlite3';

export const up = async (db: Database): Promise<void> => {
  console.log('🔄 Running migration: 018_add_media_postprocess_visibility.ts');

  const tableInfo = db.prepare(`PRAGMA table_info(media_metadata)`).all() as Array<{ name: string }>;
  const existingColumns = new Set(tableInfo.map((column) => column.name));

  if (!existingColumns.has('postprocess_status')) {
    db.prepare(`
      ALTER TABLE media_metadata
      ADD COLUMN postprocess_status TEXT NOT NULL DEFAULT 'ready'
    `).run();
    console.log('✅ Added column: media_metadata.postprocess_status');
  }

  if (!existingColumns.has('postprocess_completed_at')) {
    db.prepare(`
      ALTER TABLE media_metadata
      ADD COLUMN postprocess_completed_at DATETIME DEFAULT NULL
    `).run();
    console.log('✅ Added column: media_metadata.postprocess_completed_at');
  }

  db.prepare(`
    UPDATE media_metadata
    SET postprocess_status = 'ready',
        postprocess_completed_at = COALESCE(postprocess_completed_at, metadata_updated_date, CURRENT_TIMESTAMP)
    WHERE postprocess_status IS NULL OR postprocess_status != 'pending'
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_metadata_postprocess_status
    ON media_metadata(postprocess_status)
  `).run();

  console.log('✅ Media postprocess visibility columns ready');
};

export const down = async (_db: Database): Promise<void> => {
  console.log('⚠️  Rolling back media postprocess visibility columns is not supported.');
};
