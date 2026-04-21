import { Database } from 'better-sqlite3';

export const up = async (db: Database): Promise<void> => {
  console.log('🔄 Running migration: 012_add_prompt_term_relations.ts');

  db.prepare(`
    CREATE TABLE IF NOT EXISTS prompt_term_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_type TEXT NOT NULL,
      source_prompt TEXT NOT NULL,
      target_prompt TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      shared_count INTEGER NOT NULL DEFAULT 0,
      score REAL NOT NULL DEFAULT 0,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(prompt_type, source_prompt, target_prompt, relation_type)
    )
  `).run();

  db.prepare('CREATE INDEX IF NOT EXISTS idx_prompt_term_relations_source ON prompt_term_relations(prompt_type, relation_type, source_prompt)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_prompt_term_relations_score ON prompt_term_relations(prompt_type, relation_type, score DESC)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_prompt_term_relations_target ON prompt_term_relations(prompt_type, relation_type, target_prompt)').run();
};

export const down = async (db: Database): Promise<void> => {
  console.log('🔄 Reverting migration: 012_add_prompt_term_relations.ts');
  db.prepare('DROP INDEX IF EXISTS idx_prompt_term_relations_source').run();
  db.prepare('DROP INDEX IF EXISTS idx_prompt_term_relations_score').run();
  db.prepare('DROP INDEX IF EXISTS idx_prompt_term_relations_target').run();
  db.prepare('DROP TABLE IF EXISTS prompt_term_relations').run();
};
