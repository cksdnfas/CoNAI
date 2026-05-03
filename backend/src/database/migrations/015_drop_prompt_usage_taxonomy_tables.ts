import { Database } from 'better-sqlite3';

export const up = async (db: Database): Promise<void> => {
  console.log('🔄 Running migration: 015_drop_prompt_usage_taxonomy_tables.ts');

  db.prepare('DROP INDEX IF EXISTS idx_prompt_term_relations_source').run();
  db.prepare('DROP INDEX IF EXISTS idx_prompt_term_relations_score').run();
  db.prepare('DROP INDEX IF EXISTS idx_prompt_term_relations_target').run();
  db.prepare('DROP TABLE IF EXISTS prompt_term_relations').run();

  db.prepare('DROP INDEX IF EXISTS idx_prompt_term_similarity_source').run();
  db.prepare('DROP INDEX IF EXISTS idx_prompt_term_similarity_score').run();
  db.prepare('DROP TABLE IF EXISTS prompt_term_similarity_relations').run();

  db.prepare('DROP INDEX IF EXISTS idx_prompt_term_analysis_type').run();
  db.prepare('DROP INDEX IF EXISTS idx_prompt_term_analysis_prompt').run();
  db.prepare('DROP TABLE IF EXISTS prompt_term_analysis').run();

  console.log('✅ Removed legacy prompt usage/taxonomy tables');
};

export const down = async (_db: Database): Promise<void> => {
  console.log('⚠️  Down migration not supported for 015_drop_prompt_usage_taxonomy_tables.ts');
};
