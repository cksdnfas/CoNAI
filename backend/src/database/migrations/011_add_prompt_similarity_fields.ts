import { Database } from 'better-sqlite3';

export const up = async (db: Database): Promise<void> => {
  console.log('🔄 Running migration: 011_add_prompt_similarity_fields.ts');

  const tableInfo = db.prepare(`PRAGMA table_info(media_metadata)`).all() as Array<{ name: string }>;
  const existingColumns = new Set(tableInfo.map((column) => column.name));

  const columns: Array<{ name: string; sql: string }> = [
    { name: 'prompt_similarity_algorithm', sql: 'ALTER TABLE media_metadata ADD COLUMN prompt_similarity_algorithm TEXT DEFAULT NULL' },
    { name: 'prompt_similarity_version', sql: 'ALTER TABLE media_metadata ADD COLUMN prompt_similarity_version INTEGER DEFAULT NULL' },
    { name: 'pos_prompt_normalized', sql: 'ALTER TABLE media_metadata ADD COLUMN pos_prompt_normalized TEXT DEFAULT NULL' },
    { name: 'neg_prompt_normalized', sql: 'ALTER TABLE media_metadata ADD COLUMN neg_prompt_normalized TEXT DEFAULT NULL' },
    { name: 'auto_prompt_normalized', sql: 'ALTER TABLE media_metadata ADD COLUMN auto_prompt_normalized TEXT DEFAULT NULL' },
    { name: 'pos_prompt_fingerprint', sql: 'ALTER TABLE media_metadata ADD COLUMN pos_prompt_fingerprint TEXT DEFAULT NULL' },
    { name: 'neg_prompt_fingerprint', sql: 'ALTER TABLE media_metadata ADD COLUMN neg_prompt_fingerprint TEXT DEFAULT NULL' },
    { name: 'auto_prompt_fingerprint', sql: 'ALTER TABLE media_metadata ADD COLUMN auto_prompt_fingerprint TEXT DEFAULT NULL' },
    { name: 'prompt_similarity_updated_date', sql: 'ALTER TABLE media_metadata ADD COLUMN prompt_similarity_updated_date DATETIME DEFAULT NULL' },
  ];

  for (const column of columns) {
    if (existingColumns.has(column.name)) {
      console.log(`⚠️  Column ${column.name} already exists, skipping`);
      continue;
    }

    db.prepare(column.sql).run();
    console.log(`✅ Added column: ${column.name}`);
  }
};

export const down = async (_db: Database): Promise<void> => {
  console.log('⚠️  Down migration not supported for 011_add_prompt_similarity_fields.ts');
};
