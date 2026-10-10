import type Database from 'better-sqlite3';

/**
 * Posts (게시판): categories, posts, tags, comments, embedded media references and bot calls. Additive and idempotent.
 * Profiles and accounts live elsewhere (llm_chat_profiles, auth.db), so authors are kept by id plus a name snapshot.
 */
export function ensurePostsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS post_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER REFERENCES post_categories(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_post_categories_name ON post_categories(COALESCE(parent_id, 0), name_key);

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER REFERENCES post_categories(id) ON DELETE RESTRICT,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      excerpt TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'hidden')),
      author_type TEXT NOT NULL CHECK (author_type IN ('account', 'profile')),
      author_profile_id INTEGER,
      author_name TEXT NOT NULL,
      owner_account_id INTEGER,
      source TEXT NOT NULL DEFAULT 'manual',
      comment_mode TEXT NOT NULL DEFAULT 'open' CHECK (comment_mode IN ('open', 'closed')),
      pinned INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1,
      comment_count INTEGER NOT NULL DEFAULT 0,
      published_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_posts_list ON posts(status, pinned DESC, published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category_id, status, published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_owner ON posts(owner_account_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_profile ON posts(author_profile_id, published_at DESC);

    CREATE TABLE IF NOT EXISTS post_revisions (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      edited_by_type TEXT NOT NULL,
      edited_by_account_id INTEGER,
      edited_by_profile_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (post_id, revision)
    );

    CREATE TABLE IF NOT EXISTS post_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS post_tag_links (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES post_tags(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (post_id, tag_id)
    );
    CREATE INDEX IF NOT EXISTS idx_post_tag_links_tag ON post_tag_links(tag_id, post_id);

    CREATE TABLE IF NOT EXISTS post_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES post_comments(id) ON DELETE CASCADE,
      quote_comment_id INTEGER,
      author_type TEXT NOT NULL CHECK (author_type IN ('account', 'profile')),
      author_profile_id INTEGER,
      author_name TEXT NOT NULL,
      owner_account_id INTEGER,
      body TEXT NOT NULL,
      mentions TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden', 'deleted')),
      bot_run_id INTEGER,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments(post_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_post_comments_parent ON post_comments(parent_id);

    -- Media a post or comment embeds, extracted from its body on save. file_owner_key: whose file store a file ref is in.
    CREATE TABLE IF NOT EXISTS post_media_refs (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      owner_type TEXT NOT NULL CHECK (owner_type IN ('post', 'comment')),
      owner_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('media', 'audio', 'group', 'file')),
      ref TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      file_owner_key TEXT,
      PRIMARY KEY (owner_type, owner_id, kind, ref)
    );
    CREATE INDEX IF NOT EXISTS idx_post_media_refs_post ON post_media_refs(post_id, owner_type, position);
    CREATE INDEX IF NOT EXISTS idx_post_media_refs_target ON post_media_refs(kind, ref);

    CREATE TABLE IF NOT EXISTS post_bot_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      trigger_comment_id INTEGER REFERENCES post_comments(id) ON DELETE SET NULL,
      profile_id INTEGER NOT NULL,
      profile_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'skipped', 'cancelled')),
      run_as_account_id INTEGER,
      requested_by_account_id INTEGER,
      chain_root_comment_id INTEGER,
      chain_depth INTEGER NOT NULL DEFAULT 0,
      result_comment_id INTEGER,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_post_bot_runs_status ON post_bot_runs(status, id);
    CREATE INDEX IF NOT EXISTS idx_post_bot_runs_post ON post_bot_runs(post_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_post_bot_runs_profile ON post_bot_runs(profile_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_post_bot_runs_requester ON post_bot_runs(requested_by_account_id, created_at);
  `);
  // The chat reply a post or comment was written from (a bot's tool call, a board call's answer).
  for (const table of ['posts', 'post_comments']) {
    const columns = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name));
    if (!columns.has('source_thread_id')) db.exec(`ALTER TABLE ${table} ADD COLUMN source_thread_id INTEGER`);
    if (!columns.has('source_reply_id')) db.exec(`ALTER TABLE ${table} ADD COLUMN source_reply_id TEXT`);
  }
}
