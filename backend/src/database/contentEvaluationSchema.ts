import type Database from 'better-sqlite3';

/** Additive metadata only; no existing posts are enqueued by a migration. */
export function ensureContentEvaluationSchema(db: Database.Database): void {
  db.exec([
    "CREATE TABLE IF NOT EXISTS content_evaluation_settings (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, definition_version INTEGER NOT NULL, model_slot_id INTEGER, topics_json TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS content_evaluation_versions (version INTEGER PRIMARY KEY, definition_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);",
    "CREATE TABLE IF NOT EXISTS post_topic_evaluation_requests (",
    "id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,",
    "fingerprint TEXT NOT NULL, generation INTEGER NOT NULL, content_hash TEXT NOT NULL, definition_version INTEGER NOT NULL,",
    "definition_json TEXT NOT NULL, model_key TEXT NOT NULL, provider_name TEXT, model_id TEXT, model_label TEXT,",
    "source TEXT NOT NULL CHECK(source IN ('automatic','manual')), post_status TEXT NOT NULL,",
    "account_id INTEGER, account_key TEXT NOT NULL, status TEXT NOT NULL, reason_code TEXT,",
    "attempts INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until TEXT, retry_after TEXT, runtime_job_id TEXT,",
    "result_json TEXT, coverage TEXT NOT NULL DEFAULT 'full', input_characters INTEGER, total_characters INTEGER,",
    "created_at TEXT NOT NULL, finished_at TEXT, UNIQUE(fingerprint,generation))",
    "; CREATE INDEX IF NOT EXISTS idx_post_topic_latest ON post_topic_evaluation_requests(post_id,id DESC)",
    "; CREATE INDEX IF NOT EXISTS idx_post_topic_queue ON post_topic_evaluation_requests(status,retry_after,id)",
    "; CREATE TABLE IF NOT EXISTS post_topic_evaluation_commands (account_key TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_id INTEGER NOT NULL REFERENCES post_topic_evaluation_requests(id) ON DELETE CASCADE, command_json TEXT NOT NULL, PRIMARY KEY(account_key,idempotency_key))",
    "; CREATE TABLE IF NOT EXISTS post_topic_evaluation_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER REFERENCES post_topic_evaluation_requests(id) ON DELETE SET NULL, attempt INTEGER NOT NULL, call_index INTEGER NOT NULL, account_key TEXT NOT NULL, reserved_tokens INTEGER NOT NULL, actual_tokens INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(request_id,attempt,call_index))",
    "; CREATE INDEX IF NOT EXISTS idx_post_topic_usage ON post_topic_evaluation_usage(account_key,created_at)",
    "; INSERT OR IGNORE INTO content_evaluation_settings(id,revision,definition_version,model_slot_id,topics_json) VALUES(1,1,1,NULL,'[]')",
    "; INSERT OR IGNORE INTO content_evaluation_versions(version,definition_json) VALUES(1,'{\"modelSlotId\":null,\"topics\":[]}')",
  ].join('\n') + ';');
}
