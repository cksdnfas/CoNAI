import Database from 'better-sqlite3';

/**
 * Add feed_visibility policy to rating_tiers so each tier can control feed rendering.
 */
export const up = async (db: Database.Database): Promise<void> => {
  console.log('🔧 Adding feed_visibility to rating_tiers...');

  const columns = db.prepare(`PRAGMA table_info(rating_tiers)`).all() as Array<{ name: string }>;
  const hasFeedVisibility = columns.some((column) => column.name === 'feed_visibility');

  if (!hasFeedVisibility) {
    db.exec(`ALTER TABLE rating_tiers ADD COLUMN feed_visibility VARCHAR(10) NOT NULL DEFAULT 'show'`);
  }

  db.exec(`UPDATE rating_tiers SET feed_visibility = COALESCE(feed_visibility, 'show')`);

  console.log('✅ rating_tiers.feed_visibility ready\n');
};

export const down = async (_db: Database.Database): Promise<void> => {
  console.log('⚠️  Rolling back rating_tiers.feed_visibility is not implemented.');
};
