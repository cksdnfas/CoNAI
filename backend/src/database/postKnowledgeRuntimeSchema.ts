import type Database from 'better-sqlite3';

/** Durable outbox and immutable identities. Runtime job TTL never deletes knowledge history. */
export function ensurePostKnowledgeRuntimeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS post_knowledge_executions (
      execution_id TEXT PRIMARY KEY,
      root_execution_id TEXT NOT NULL,
      account_key TEXT NOT NULL CHECK(length(account_key) > 0),
      account_id INTEGER,
      profile_id INTEGER,
      provider_name TEXT NOT NULL,
      model_id TEXT NOT NULL,
      evaluator_family TEXT NOT NULL,
      trust TEXT NOT NULL CHECK(trust IN ('observed_execution','external_unverified')),
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','failed','cancelled')),
      observed_outcome TEXT NOT NULL DEFAULT 'unknown' CHECK(observed_outcome IN ('unknown','succeeded','failed')),
      root_started_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_post_knowledge_execution_root ON post_knowledge_executions(root_execution_id, account_key);

    CREATE TABLE IF NOT EXISTS post_knowledge_tasks (
      execution_id TEXT PRIMARY KEY REFERENCES post_knowledge_executions(execution_id) ON DELETE CASCADE,
      purpose_kind TEXT NOT NULL,
      purpose_source TEXT NOT NULL DEFAULT 'human_order',
      condition_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS post_knowledge_task_jobs (
      execution_id TEXT NOT NULL REFERENCES post_knowledge_executions(execution_id) ON DELETE CASCADE,
      job_id INTEGER NOT NULL,
      thread_id INTEGER NOT NULL,
      reply_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(execution_id,job_id)
    );

    CREATE TABLE IF NOT EXISTS post_knowledge_searches (
      execution_id TEXT NOT NULL REFERENCES post_knowledge_executions(execution_id) ON DELETE CASCADE,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      task_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(execution_id,post_id)
    );

    CREATE TABLE IF NOT EXISTS post_knowledge_uses (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      comment_id INTEGER,
      content_version INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      comment_revision INTEGER,
      comment_hash TEXT,
      scope TEXT NOT NULL CHECK(scope IN ('body','comment')),
      intervals_json TEXT NOT NULL,
      snapshot_body TEXT,
      task_key TEXT,
      execution_id TEXT NOT NULL REFERENCES post_knowledge_executions(execution_id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      evidence_expired INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_post_knowledge_uses_execution ON post_knowledge_uses(execution_id, created_at);

    CREATE TABLE IF NOT EXISTS post_knowledge_use_assessments (
      id TEXT PRIMARY KEY,
      use_id TEXT NOT NULL REFERENCES post_knowledge_uses(id) ON DELETE CASCADE,
      stage TEXT NOT NULL CHECK(stage IN ('provisional','final')),
      payload_json TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      event_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(use_id,idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS post_evaluation_requests (
      id TEXT PRIMARY KEY,
      unique_key TEXT NOT NULL UNIQUE,
      client_request_key TEXT,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      content_version INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      use_id TEXT REFERENCES post_knowledge_uses(id) ON DELETE SET NULL,
      execution_id TEXT REFERENCES post_knowledge_executions(execution_id),
      task_key TEXT,
      evidence_revision INTEGER NOT NULL DEFAULT 1,
      purpose TEXT NOT NULL CHECK(purpose IN ('document_review','use_review')),
      requester_account_id INTEGER,
      requester_account_key TEXT NOT NULL,
      root_execution_id TEXT NOT NULL,
      root_started_at TEXT NOT NULL,
      provider_name TEXT,
      model_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','skipped','failed','cancelled')),
      attempts INTEGER NOT NULL DEFAULT 0,
      retry_base_attempt INTEGER NOT NULL DEFAULT 0,
      lease_token TEXT,
      lease_until TEXT,
      retry_after TEXT,
      runtime_job_id TEXT,
      total_tokens INTEGER,
      reserved_tokens INTEGER NOT NULL DEFAULT 0,
      reason_code TEXT,
      raw_response TEXT,
      raw_response_expires_at TEXT,
      failure_diagnostic_json TEXT,
      failure_diagnostic_expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_post_evaluation_queue ON post_evaluation_requests(status,retry_after,lease_until);
    CREATE INDEX IF NOT EXISTS idx_post_evaluation_post ON post_evaluation_requests(post_id,created_at);
    CREATE TABLE IF NOT EXISTS post_evaluation_request_uses (
      request_id TEXT NOT NULL REFERENCES post_evaluation_requests(id) ON DELETE CASCADE,
      use_id TEXT NOT NULL REFERENCES post_knowledge_uses(id) ON DELETE CASCADE,
      PRIMARY KEY(request_id,use_id)
    );

    CREATE TABLE IF NOT EXISTS post_evaluation_request_commands (
      account_key TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_id TEXT NOT NULL REFERENCES post_evaluation_requests(id) ON DELETE CASCADE,
      post_id INTEGER NOT NULL,
      content_version INTEGER NOT NULL,
      PRIMARY KEY(account_key,idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS post_evaluation_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL REFERENCES post_evaluation_requests(id) ON DELETE CASCADE,
      attempt INTEGER NOT NULL,
      account_key TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      model_id TEXT NOT NULL,
      actual_tokens INTEGER,
      reserved_tokens INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('reserved','completed','failed','unknown')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(request_id,attempt)
    );
    CREATE INDEX IF NOT EXISTS idx_post_evaluation_usage_account ON post_evaluation_usage(account_key,created_at);

    CREATE TABLE IF NOT EXISTS post_knowledge_proposals (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('create','update')),
      post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
      base_revision INTEGER,
      base_content_version INTEGER,
      base_title TEXT,
      base_body TEXT,
      base_sources_json TEXT NOT NULL DEFAULT '[]',
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      input_json TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      proposer_account_key TEXT NOT NULL,
      proposer_account_id INTEGER,
      proposer_profile_id INTEGER,
      proposer_name TEXT NOT NULL,
      proposer_origin TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','rejected')),
      reviewer_account_key TEXT,
      review_reason TEXT,
      reviewed_at TEXT,
      applied_post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
      applied_revision INTEGER,
      applied_content_version INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(proposer_account_key,proposer_profile_id,idempotency_key)
    );
    -- Null profiles still share one idempotency namespace per account.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_post_knowledge_proposal_idempotence ON post_knowledge_proposals(proposer_account_key,COALESCE(proposer_profile_id,0),idempotency_key);
  `);
  // Development checkpoints and partial rollout databases remain additive and resumable too.
  const additions:Record<string,Record<string,string>>={
    post_knowledge_uses:{task_key:'TEXT'},
    post_knowledge_executions:{observed_outcome:"TEXT NOT NULL DEFAULT 'unknown'"},
    post_knowledge_proposals:{base_sources_json:"TEXT NOT NULL DEFAULT '[]'"},
    post_evaluation_requests:{client_request_key:'TEXT',retry_base_attempt:'INTEGER NOT NULL DEFAULT 0',execution_id:'TEXT REFERENCES post_knowledge_executions(execution_id)',task_key:'TEXT',evidence_revision:'INTEGER NOT NULL DEFAULT 1',failure_diagnostic_json:'TEXT',failure_diagnostic_expires_at:'TEXT'},
  };
  for(const [table,columns] of Object.entries(additions)) {
    const present=new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name:string}>).map(column=>column.name));
    for(const [name,definition] of Object.entries(columns)) if(!present.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_post_evaluation_client_key ON post_evaluation_requests(requester_account_key,client_request_key) WHERE client_request_key IS NOT NULL;
    INSERT OR IGNORE INTO post_evaluation_request_commands(account_key,idempotency_key,request_id,post_id,content_version)
      SELECT requester_account_key,client_request_key,id,post_id,content_version FROM post_evaluation_requests WHERE client_request_key IS NOT NULL;
    INSERT OR IGNORE INTO post_evaluation_request_uses(request_id,use_id) SELECT id,use_id FROM post_evaluation_requests WHERE use_id IS NOT NULL;
    UPDATE post_evaluation_requests SET task_key=(SELECT task_key FROM post_knowledge_uses WHERE id=post_evaluation_requests.use_id)
      WHERE purpose='use_review' AND task_key IS NULL AND use_id IS NOT NULL;
    UPDATE post_evaluation_requests SET execution_id=(SELECT execution_id FROM post_knowledge_uses WHERE id=post_evaluation_requests.use_id)
      WHERE purpose='use_review' AND execution_id IS NULL AND use_id IS NOT NULL;`);
}
