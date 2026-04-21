import { Database } from 'better-sqlite3';

export const up = async (db: Database): Promise<void> => {
  console.log('🔄 Running migration: 013_add_prompt_taxonomy_tables.ts');

  db.prepare(`
    CREATE TABLE IF NOT EXISTS prompt_term_analysis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_type TEXT NOT NULL,
      prompt TEXT NOT NULL,
      normalized_prompt TEXT NOT NULL,
      inferred_type TEXT NOT NULL,
      subtype TEXT DEFAULT NULL,
      cluster_id TEXT DEFAULT NULL,
      canonical_prompt TEXT DEFAULT NULL,
      analysis_version INTEGER NOT NULL DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(prompt_type, prompt)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS prompt_term_similarity_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_type TEXT NOT NULL,
      source_prompt TEXT NOT NULL,
      target_prompt TEXT NOT NULL,
      relation_kind TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      evidence_json TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(prompt_type, source_prompt, target_prompt, relation_kind)
    )
  `).run();

  db.prepare('CREATE INDEX IF NOT EXISTS idx_prompt_term_analysis_type ON prompt_term_analysis(prompt_type, inferred_type, cluster_id)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_prompt_term_analysis_prompt ON prompt_term_analysis(prompt_type, prompt)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_prompt_term_similarity_source ON prompt_term_similarity_relations(prompt_type, relation_kind, source_prompt)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_prompt_term_similarity_score ON prompt_term_similarity_relations(prompt_type, relation_kind, score DESC)').run();
};

export const down = async (db: Database): Promise<void> => {
  console.log('🔄 Reverting migration: 013_add_prompt_taxonomy_tables.ts');
  db.prepare('DROP INDEX IF EXISTS idx_prompt_term_analysis_type').run();
  db.prepare('DROP INDEX IF EXISTS idx_prompt_term_analysis_prompt').run();
  db.prepare('DROP INDEX IF EXISTS idx_prompt_term_similarity_source').run();
  db.prepare('DROP INDEX IF EXISTS idx_prompt_term_similarity_score').run();
  db.prepare('DROP TABLE IF EXISTS prompt_term_similarity_relations').run();
  db.prepare('DROP TABLE IF EXISTS prompt_term_analysis').run();
};
