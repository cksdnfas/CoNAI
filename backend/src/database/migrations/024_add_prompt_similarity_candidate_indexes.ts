import { Database } from 'better-sqlite3';

export const up = async (db: Database): Promise<void> => {
  console.log('🔄 Running migration: 024_add_prompt_similarity_candidate_indexes.ts');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_prompt_similarity_pos_candidates
      ON media_metadata (
        prompt_similarity_algorithm,
        prompt_similarity_version,
        pos_prompt_fingerprint,
        rating_score,
        postprocess_status,
        composite_hash
      )
      WHERE pos_prompt_fingerprint IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_prompt_similarity_neg_candidates
      ON media_metadata (
        prompt_similarity_algorithm,
        prompt_similarity_version,
        neg_prompt_fingerprint,
        rating_score,
        postprocess_status,
        composite_hash
      )
      WHERE neg_prompt_fingerprint IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_prompt_similarity_auto_candidates
      ON media_metadata (
        prompt_similarity_algorithm,
        prompt_similarity_version,
        auto_prompt_fingerprint,
        rating_score,
        postprocess_status,
        composite_hash
      )
      WHERE auto_prompt_fingerprint IS NOT NULL;
  `);

  console.log('✅ Added prompt similarity candidate indexes');
};

export const down = async (_db: Database): Promise<void> => {
  console.log('⚠️  Down migration not supported for 024_add_prompt_similarity_candidate_indexes.ts');
};
