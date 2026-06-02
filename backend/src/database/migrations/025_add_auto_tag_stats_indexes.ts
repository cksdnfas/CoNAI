import { Database } from 'better-sqlite3';

export const up = async (db: Database): Promise<void> => {
  console.log('🔄 Running migration: 025_add_auto_tag_stats_indexes.ts');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auto_tag_stats_tagged
      ON media_metadata(composite_hash)
      WHERE auto_tags IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_auto_tag_stats_untagged
      ON media_metadata(composite_hash)
      WHERE auto_tags IS NULL;

    CREATE INDEX IF NOT EXISTS idx_auto_tag_stats_root_rating
      ON media_metadata(
        json_extract(auto_tags, '$.rating.general'),
        json_extract(auto_tags, '$.rating.sensitive'),
        json_extract(auto_tags, '$.rating.questionable'),
        json_extract(auto_tags, '$.rating.explicit')
      )
      WHERE json_type(auto_tags, '$.rating') = 'object';

    CREATE INDEX IF NOT EXISTS idx_auto_tag_stats_root_character
      ON media_metadata(composite_hash)
      WHERE json_type(auto_tags, '$.character') = 'object';

    CREATE INDEX IF NOT EXISTS idx_auto_tag_stats_root_model
      ON media_metadata(json_extract(auto_tags, '$.model'))
      WHERE json_extract(auto_tags, '$.model') IS NOT NULL;
  `);

  console.log('✅ Added auto-tag stats hot-path indexes');
};

export const down = async (_db: Database): Promise<void> => {
  console.log('⚠️  Down migration not supported for 025_add_auto_tag_stats_indexes.ts');
};
