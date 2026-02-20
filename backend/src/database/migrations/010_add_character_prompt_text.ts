import { Database } from 'better-sqlite3';

export const up = async (db: Database): Promise<void> => {
  console.log('🔄 Running migration: 010_add_character_prompt_text.ts');

  // 1) 컬럼 추가
  const tableInfo = db.prepare(`PRAGMA table_info(media_metadata)`).all() as Array<{ name: string }>;
  const hasCharacterPromptText = tableInfo.some(col => col.name === 'character_prompt_text');

  if (!hasCharacterPromptText) {
    db.prepare('ALTER TABLE media_metadata ADD COLUMN character_prompt_text TEXT DEFAULT NULL').run();
    console.log('✅ Added column: character_prompt_text');
  } else {
    console.log('ℹ️  Column character_prompt_text already exists, skipping');
  }

  // 2) 인덱스 추가 (prefix 검색 대비)
  try {
    db.prepare('CREATE INDEX IF NOT EXISTS idx_metadata_character_prompt_text ON media_metadata(character_prompt_text)').run();
    console.log('✅ Created index: idx_metadata_character_prompt_text');
  } catch (error: any) {
    console.warn('⚠️  Failed to create idx_metadata_character_prompt_text:', error.message);
  }

  // 3) 기존 데이터 백필 (raw_nai_parameters.v4_prompt.caption.char_captions[])
  try {
    const result = db.prepare(`
      UPDATE media_metadata
      SET character_prompt_text = (
        SELECT TRIM(group_concat(TRIM(json_extract(char_item.value, '$.char_caption')), ', '))
        FROM json_each(media_metadata.raw_nai_parameters, '$.v4_prompt.caption.char_captions') AS char_item
        WHERE json_extract(char_item.value, '$.char_caption') IS NOT NULL
          AND TRIM(json_extract(char_item.value, '$.char_caption')) != ''
      )
      WHERE json_valid(raw_nai_parameters) = 1
        AND (character_prompt_text IS NULL OR TRIM(character_prompt_text) = '')
    `).run();

    console.log(`✅ Backfilled character_prompt_text rows: ${result.changes}`);
  } catch (error: any) {
    console.warn('⚠️  Backfill warning (non-fatal):', error.message);
  }

  console.log('✅ Migration 010 completed successfully');
};

export const down = async (db: Database): Promise<void> => {
  console.log('🔄 Rolling back migration: 010_add_character_prompt_text.ts');

  try {
    db.prepare('DROP INDEX IF EXISTS idx_metadata_character_prompt_text').run();
    console.log('✅ Dropped index: idx_metadata_character_prompt_text');
  } catch (error: any) {
    console.warn('⚠️  Failed to drop index idx_metadata_character_prompt_text:', error.message);
  }

  try {
    db.prepare('ALTER TABLE media_metadata DROP COLUMN character_prompt_text').run();
    console.log('✅ Dropped column: character_prompt_text');
  } catch (error: any) {
    console.warn('⚠️  Failed to drop column character_prompt_text:', error.message);
  }
};
