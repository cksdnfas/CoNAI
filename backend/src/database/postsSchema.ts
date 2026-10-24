import type Database from 'better-sqlite3';
import { POST_MEDIA_EMBED_PATTERN } from '@conai/shared';
import { ensurePostKnowledgeRuntimeSchema } from './postKnowledgeRuntimeSchema';
import { ensureContentEvaluationSchema } from './contentEvaluationSchema';

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
    CREATE INDEX IF NOT EXISTS idx_post_comments_thread_page ON post_comments(post_id, parent_id, created_at DESC, id DESC);

    -- Media a post or comment embeds, extracted from its body on save. file_owner_key records provenance, not a file-access boundary.
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS post_knowledge (
      post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      content_version INTEGER NOT NULL DEFAULT 1,
      content_hash TEXT NOT NULL,
      review_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK(review_status IN ('unreviewed','verified','needs_review')),
      verified_content_version INTEGER,
      replacement_post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_post_knowledge_review ON post_knowledge(enabled,deleted_at,review_status,post_id);
    CREATE TABLE IF NOT EXISTS post_knowledge_versions (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      content_version INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      post_revision INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      sources_json TEXT NOT NULL DEFAULT '[]',
      post_status TEXT NOT NULL DEFAULT 'draft' CHECK(post_status IN ('draft','published','hidden')),
      changed_by TEXT NOT NULL,
      change_reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(post_id,content_version)
    );
    CREATE INDEX IF NOT EXISTS idx_post_knowledge_version_hash ON post_knowledge_versions(post_id,content_hash);
    CREATE TABLE IF NOT EXISTS post_knowledge_media_refs (
      post_id INTEGER NOT NULL,
      content_version INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('media','audio','group','file')),
      ref TEXT NOT NULL,
      position INTEGER NOT NULL,
      file_owner_key TEXT,
      PRIMARY KEY(post_id,content_version,kind,ref),
      FOREIGN KEY(post_id,content_version) REFERENCES post_knowledge_versions(post_id,content_version) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_post_knowledge_media_files ON post_knowledge_media_refs(kind,ref,file_owner_key);
    CREATE TRIGGER IF NOT EXISTS post_knowledge_media_refs_immutable BEFORE UPDATE ON post_knowledge_media_refs
      BEGIN SELECT RAISE(ABORT,'Knowledge attachment references are immutable'); END;
    CREATE TABLE IF NOT EXISTS post_knowledge_sources (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      source_json TEXT NOT NULL,
      PRIMARY KEY(post_id,position)
    );
    CREATE TABLE IF NOT EXISTS post_aliases (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL,
      PRIMARY KEY(post_id,name_key)
    );
    CREATE INDEX IF NOT EXISTS idx_post_aliases_name ON post_aliases(name_key,post_id);
    CREATE TABLE IF NOT EXISTS post_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      target_post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
      target_comment_id INTEGER,
      display_name TEXT NOT NULL,
      relation TEXT NOT NULL CHECK(relation IN ('reference','unresolved'))
    );
    CREATE INDEX IF NOT EXISTS idx_post_links_backlink ON post_links(target_post_id,post_id);
    CREATE TABLE IF NOT EXISTS post_assessment_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      content_version INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      logical_key TEXT NOT NULL,
      actor_key TEXT NOT NULL CHECK(length(actor_key)>0),
      evaluator TEXT NOT NULL CHECK(evaluator IN ('human','use_ai','judge')),
      evaluator_family TEXT NOT NULL,
      profile_id INTEGER,
      root_execution_id TEXT,
      purpose TEXT NOT NULL,
      quality TEXT NOT NULL CHECK(quality IN ('up','down','abstain')),
      task_fit TEXT NOT NULL CHECK(task_fit IN ('useful','unsuitable','unknown')),
      task_key TEXT,
      reason_code TEXT,
      reason TEXT NOT NULL DEFAULT '',
      evidence_quote TEXT NOT NULL DEFAULT '',
      phase TEXT NOT NULL CHECK(phase IN ('provisional','final')),
      self_assessment INTEGER NOT NULL DEFAULT 0,
      evidence_sufficient INTEGER NOT NULL DEFAULT 1,
      public_reason INTEGER NOT NULL DEFAULT 1,
      idempotency_key TEXT NOT NULL,
      use_id TEXT,
      request_id TEXT,
      execution_started_at TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(actor_key,idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_post_assessment_document ON post_assessment_events(post_id,content_hash,id);
    CREATE TRIGGER IF NOT EXISTS post_assessment_events_immutable BEFORE UPDATE ON post_assessment_events
      BEGIN SELECT RAISE(ABORT,'Assessment events are immutable'); END;
    CREATE TABLE IF NOT EXISTS post_assessment_heads (
      logical_key TEXT PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES post_assessment_events(id)
    );
    CREATE TABLE IF NOT EXISTS post_knowledge_search_receipts (
      token TEXT PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      content_hash TEXT NOT NULL,
      account_key TEXT NOT NULL,
      task_key TEXT NOT NULL,
      query_text TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      UNIQUE(account_key,post_id,content_hash,task_key)
    );
    CREATE INDEX IF NOT EXISTS idx_post_knowledge_receipt_expiry ON post_knowledge_search_receipts(expires_at);
    CREATE TABLE IF NOT EXISTS post_assessment_moderations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      target_event_id INTEGER NOT NULL REFERENCES post_assessment_events(id),
      replacement_event_id INTEGER NOT NULL REFERENCES post_assessment_events(id),
      reviewer_account_key TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('invalidate','correct')),
      reason TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(reviewer_account_key,idempotency_key)
    );
    CREATE TRIGGER IF NOT EXISTS post_assessment_moderations_immutable BEFORE UPDATE ON post_assessment_moderations
      BEGIN SELECT RAISE(ABORT,'Assessment moderation audit is immutable'); END;
    CREATE TABLE IF NOT EXISTS post_knowledge_purge_previews (
      token TEXT PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      account_key TEXT NOT NULL,
      expected_revision INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS post_knowledge_deletions (
      preview_token TEXT PRIMARY KEY,
      post_id INTEGER NOT NULL,
      expected_revision INTEGER NOT NULL,
      account_key TEXT NOT NULL,
      deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS post_quality_stats (
      post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
      content_hash TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      settings_hash TEXT NOT NULL,
      last_event_id INTEGER NOT NULL,
      stats_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS post_review_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      content_version INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('designate','undesignate','verify','request_review','report_error','resolve_issue','trash','restore','content_change')),
      actor_key TEXT NOT NULL,
      related_issue_id INTEGER REFERENCES post_review_events(id),
      related_assessment_id INTEGER REFERENCES post_assessment_events(id),
      reason TEXT NOT NULL DEFAULT '',
      evidence_quote TEXT NOT NULL DEFAULT '',
      public_reason INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_post_review_document ON post_review_events(post_id,action,id);
    CREATE TRIGGER IF NOT EXISTS post_review_events_immutable BEFORE UPDATE ON post_review_events
      BEGIN SELECT RAISE(ABORT,'Review events are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS post_knowledge_versions_immutable BEFORE UPDATE ON post_knowledge_versions
      BEGIN SELECT RAISE(ABORT,'Knowledge versions are immutable'); END;
  `);
  const knowledgeVersionColumns = new Set((db.prepare('PRAGMA table_info(post_knowledge_versions)').all() as Array<{ name: string }>).map(column => column.name));
  if (!knowledgeVersionColumns.has('post_status')) db.exec("ALTER TABLE post_knowledge_versions ADD COLUMN post_status TEXT NOT NULL DEFAULT 'draft'");
  const reviewColumns = new Set((db.prepare('PRAGMA table_info(post_review_events)').all() as Array<{ name: string }>).map(column => column.name));
  if (!reviewColumns.has('public_reason')) db.exec('ALTER TABLE post_review_events ADD COLUMN public_reason INTEGER NOT NULL DEFAULT 0');
  const assessmentColumns = new Set((db.prepare('PRAGMA table_info(post_assessment_events)').all() as Array<{ name: string }>).map(column => column.name));
  for (const [name,definition] of Object.entries({event_kind:"TEXT NOT NULL DEFAULT 'assessment'",moderator_account_key:'TEXT',supersedes_event_id:'INTEGER REFERENCES post_assessment_events(id)',moderation_reason:'TEXT'}))
    if (!assessmentColumns.has(name)) db.exec(`ALTER TABLE post_assessment_events ADD COLUMN ${name} ${definition}`);
  // Backfill known versions conservatively: only current server provenance or an existing shared-file record.
  const versions = db.prepare(`SELECT v.post_id,v.content_version,v.body,p.owner_account_id FROM post_knowledge_versions v
    JOIN posts p ON p.id=v.post_id WHERE NOT EXISTS(SELECT 1 FROM post_knowledge_media_refs r WHERE r.post_id=v.post_id AND r.content_version=v.content_version)`).all() as Array<{ post_id: number; content_version: number; body: string; owner_account_id: number | null }>;
  if (versions.length) {
    const provenance = db.prepare("SELECT file_owner_key FROM post_media_refs WHERE post_id=? AND owner_type='post' AND kind='file' AND ref=?");
    const ownerFile = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='stored_file_entries'").get()
      ? db.prepare("SELECT owner_key FROM stored_file_entries WHERE id=? AND kind='file' AND deleted_at IS NULL") : null;
    const insert = db.prepare('INSERT OR IGNORE INTO post_knowledge_media_refs(post_id,content_version,kind,ref,position,file_owner_key) VALUES(?,?,?,?,?,?)');
    db.transaction(() => {
      for (const version of versions) {
        let position = 0;
        for (const match of version.body.matchAll(POST_MEDIA_EMBED_PATTERN)) {
          const kind = match[1],rawRef = match[2];
          const valid = kind==='media' ? /^(?:[a-f0-9]{48}|[a-f0-9]{32})(?:\.[a-z0-9]{1,5})?$/i.test(rawRef)
            : kind==='audio' ? /^[A-Za-z0-9_-]{1,64}$/.test(rawRef) : kind==='group' ? /^[1-9]\d{0,9}$/.test(rawRef) : /^[a-f0-9]{32}$/i.test(rawRef);
          if (!valid) continue;
          const ref = kind==='media' ? rawRef.replace(/\.[a-z0-9]{1,5}$/i,'').toLowerCase() : kind==='file' ? rawRef.toLowerCase() : rawRef;
          let ownerKey: string | null = null;
          if (kind === 'file') {
            const known = provenance.get(version.post_id,ref) as { file_owner_key: string } | undefined;
            const own = ownerFile?.get(ref) as { owner_key: string } | undefined;
            ownerKey = known?.file_owner_key ?? own?.owner_key ?? null;
            if (!ownerKey) continue;
          }
          insert.run(version.post_id,version.content_version,kind,ref,position++,ownerKey);
        }
      }
    })();
  }
  ensurePostKnowledgeRuntimeSchema(db);
  ensureContentEvaluationSchema(db);
}
