
import { Database } from 'better-sqlite3';

export const up = async (db: Database): Promise<void> => {
    console.log('🔄 Running migration: 006_create_auto_prompt_tables.ts');

    // 1. auto_prompt_collection 테이블 생성 (prompt_collection 구조 복사)
    db.prepare(`
    CREATE TABLE IF NOT EXISTS auto_prompt_collection (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt TEXT NOT NULL,
      usage_count INTEGER DEFAULT 0,
      group_id INTEGER,
      synonyms TEXT, -- JSON array string
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

    // 인덱스 생성
    db.prepare('CREATE INDEX IF NOT EXISTS idx_auto_prompt_collection_prompt ON auto_prompt_collection(prompt)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_auto_prompt_collection_usage ON auto_prompt_collection(usage_count DESC)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_auto_prompt_collection_group ON auto_prompt_collection(group_id)').run();

    // 2. auto_prompt_groups 테이블 생성 (parent_id 포함)
    db.prepare(`
    CREATE TABLE IF NOT EXISTS auto_prompt_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_name TEXT NOT NULL UNIQUE,
      display_order INTEGER DEFAULT 0,
      is_visible INTEGER DEFAULT 1,
      parent_id INTEGER, -- 계층 구조를 위한 부모 그룹 ID
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

    db.prepare('CREATE INDEX IF NOT EXISTS idx_auto_prompt_groups_order ON auto_prompt_groups(display_order)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_auto_prompt_groups_parent ON auto_prompt_groups(parent_id)').run();
};

export const down = async (db: Database): Promise<void> => {
    console.log('🔄 Reverting migration: 006_create_auto_prompt_tables.ts');
    db.prepare('DROP TABLE IF EXISTS auto_prompt_collection').run();
    db.prepare('DROP TABLE IF EXISTS auto_prompt_groups').run();
};
