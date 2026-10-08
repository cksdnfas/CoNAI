import type Database from 'better-sqlite3';

/**
 * audio.db: the sound-effect workspace (projects → groups → candidates), kept apart from the image library.
 *
 * Audio blobs are content-addressed (`audio_files.hash` = SHA-256 of the bytes) and shared by every candidate that
 * points at them; a blob leaves the store only when no candidate row (live or soft-deleted) references it.
 * `audio_purged_files` remembers the rows of a blob sent to the RecycleBin, so restoring the file there re-attaches it.
 *
 * Additive and idempotent: CREATE IF NOT EXISTS plus column checks, run on every open.
 */
export function ensureAudioSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audio_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      description TEXT NOT NULL DEFAULT '',
      created_by_account_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audio_groups (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES audio_projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      label TEXT,
      description TEXT NOT NULL DEFAULT '',
      is_inbox INTEGER NOT NULL DEFAULT 0 CHECK (is_inbox IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK ((is_inbox = 1 AND label IS NULL) OR (is_inbox = 0 AND label IS NOT NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_audio_groups_label ON audio_groups(project_id, label COLLATE NOCASE) WHERE label IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_audio_groups_inbox ON audio_groups(project_id) WHERE is_inbox = 1;
    CREATE INDEX IF NOT EXISTS idx_audio_groups_project ON audio_groups(project_id, created_at);

    CREATE TABLE IF NOT EXISTS audio_files (
      hash TEXT PRIMARY KEY CHECK (length(hash) = 64),
      ext TEXT NOT NULL,
      size INTEGER NOT NULL,
      duration REAL,
      sample_rate INTEGER,
      channels INTEGER,
      codec TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audio_candidates (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES audio_groups(id) ON DELETE CASCADE,
      file_hash TEXT NOT NULL REFERENCES audio_files(hash),
      parent_id TEXT REFERENCES audio_candidates(id) ON DELETE SET NULL,
      origin TEXT NOT NULL CHECK (origin IN ('generated', 'uploaded', 'edited', 'imported')),
      name TEXT NOT NULL,
      review TEXT NOT NULL DEFAULT 'pending' CHECK (review IN ('pending', 'selected', 'rejected')),
      notes TEXT NOT NULL DEFAULT '',
      edit_json TEXT,
      provenance_json TEXT,
      order_id TEXT,
      job_id TEXT,
      source_key TEXT UNIQUE,
      created_by_account_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audio_candidates_group ON audio_candidates(group_id, deleted_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_audio_candidates_file ON audio_candidates(file_hash);
    CREATE INDEX IF NOT EXISTS idx_audio_candidates_parent ON audio_candidates(parent_id);
    CREATE INDEX IF NOT EXISTS idx_audio_candidates_deleted ON audio_candidates(deleted_at) WHERE deleted_at IS NOT NULL;

    CREATE TABLE IF NOT EXISTS audio_group_comments (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES audio_groups(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
      revision INTEGER NOT NULL DEFAULT 1,
      completion_note TEXT NOT NULL DEFAULT '',
      completed_at TEXT,
      author_account_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audio_group_comments_group ON audio_group_comments(group_id, status, created_at);

    CREATE TABLE IF NOT EXISTS audio_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audio_purged_files (
      hash TEXT PRIMARY KEY,
      file_json TEXT NOT NULL,
      candidates_json TEXT NOT NULL,
      purged_at TEXT NOT NULL
    );

    -- Generation. The workflow itself lives on the generation side (user.db workflows, kind = 'audio'); a binding
    -- only says which of its marked fields carry the prompt, the length and the seed.
    CREATE TABLE IF NOT EXISTS audio_workflow_bindings (
      workflow_id INTEGER PRIMARY KEY,
      prompt_field_id TEXT NOT NULL,
      seconds_field_id TEXT NOT NULL,
      seed_field_id TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
      compat_json TEXT,
      compat_checked_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_audio_workflow_bindings_default ON audio_workflow_bindings(is_default) WHERE is_default = 1;

    -- One order = count queue jobs (one candidate each), seeds base_seed + idx. The order and its job rows are written
    -- before anything is queued, so a crash between the two leaves rows without job_id that a reconcile re-queues.
    CREATE TABLE IF NOT EXISTS audio_orders (
      id TEXT PRIMARY KEY,
      request_scope TEXT NOT NULL,
      request_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      group_id TEXT NOT NULL REFERENCES audio_groups(id) ON DELETE CASCADE,
      workflow_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      seconds REAL NOT NULL,
      count INTEGER NOT NULL,
      base_seed INTEGER NOT NULL,
      server_id INTEGER,
      server_tag TEXT,
      created_by_account_id INTEGER,
      created_by_account_type TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (request_scope, request_key)
    );
    CREATE INDEX IF NOT EXISTS idx_audio_orders_group ON audio_orders(group_id, created_at);

    CREATE TABLE IF NOT EXISTS audio_order_jobs (
      order_id TEXT NOT NULL REFERENCES audio_orders(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      seed INTEGER NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 1,
      job_id INTEGER UNIQUE,
      status_cache TEXT NOT NULL DEFAULT 'pending',
      candidate_id TEXT,
      error TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (order_id, idx)
    );
    CREATE INDEX IF NOT EXISTS idx_audio_order_jobs_pending ON audio_order_jobs(order_id) WHERE job_id IS NULL;

    -- Import from the old standalone SFX manager. Projects, groups and comments it created are remembered by their old
    -- ids so a second run reuses them; candidates use source_key 'legacy:<old id>'. Its workflows are kept here (not
    -- registered on the generation side) until an admin registers one.
    CREATE TABLE IF NOT EXISTS audio_legacy_import_map (
      kind TEXT NOT NULL CHECK (kind IN ('project', 'group', 'comment')),
      legacy_id TEXT NOT NULL,
      new_id TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      PRIMARY KEY (kind, legacy_id)
    );
    CREATE TABLE IF NOT EXISTS audio_legacy_workflows (
      legacy_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version INTEGER NOT NULL,
      prompt_json TEXT NOT NULL,
      mapping_json TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      registered_workflow_id INTEGER,
      imported_at TEXT NOT NULL
    );
  `);
}
