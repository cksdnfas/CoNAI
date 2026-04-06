import Database from 'better-sqlite3';

/** Bootstrap core user-settings tables, indexes, and simple column backfills. */
export function createUserSettingsSchema(db: Database.Database): void {
  console.log('📊 Creating user settings tables...');

  // 1. Workflows table (stores ComfyUI workflows)
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL UNIQUE,
      description TEXT,
      workflow_json TEXT NOT NULL,
      marked_fields TEXT,
      api_endpoint VARCHAR(500) DEFAULT 'http://127.0.0.1:8188',
      is_active BOOLEAN DEFAULT 1,
      color VARCHAR(10) DEFAULT '#2196f3',
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. ComfyUI servers table
  db.exec(`
    CREATE TABLE IF NOT EXISTS comfyui_servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL UNIQUE,
      url VARCHAR(500) NOT NULL,
      is_active BOOLEAN DEFAULT 1,
      is_default BOOLEAN DEFAULT 0,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 3. Workflow-Server junction table
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id INTEGER NOT NULL,
      server_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
      FOREIGN KEY (server_id) REFERENCES comfyui_servers(id) ON DELETE CASCADE,
      UNIQUE(workflow_id, server_id)
    )
  `);

  // 4. User preferences table
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 5. Wildcards table
  db.exec(`
    CREATE TABLE IF NOT EXISTS wildcards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_auto_collected INTEGER DEFAULT 0,
      source_path TEXT,
      lora_weight REAL DEFAULT 1.0,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 6. Wildcard items table (for structured wildcards)
  db.exec(`
    CREATE TABLE IF NOT EXISTS wildcard_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wildcard_id INTEGER NOT NULL,
      tool TEXT NOT NULL CHECK(tool IN ('comfyui', 'nai')),
      content TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (wildcard_id) REFERENCES wildcards(id) ON DELETE CASCADE
    )
  `);

  // 7. Custom dropdown lists table (for reusable dropdown options)
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_dropdown_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL UNIQUE,
      description TEXT,
      items TEXT NOT NULL,
      is_auto_collected INTEGER DEFAULT 0,
      source_path TEXT,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 8. External API providers table (for external API authentication)
  db.exec(`
    CREATE TABLE IF NOT EXISTS external_api_providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      provider_type TEXT NOT NULL DEFAULT 'general',
      api_key TEXT,
      api_secret TEXT,
      base_url TEXT,
      additional_config TEXT,
      is_enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 9. Module definitions table (generic NAI/ComfyUI/System module metadata)
  db.exec(`
    CREATE TABLE IF NOT EXISTS module_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      engine_type TEXT NOT NULL CHECK(engine_type IN ('nai', 'comfyui', 'system', 'custom_js')),
      authoring_source TEXT NOT NULL CHECK(authoring_source IN ('nai_form_snapshot', 'comfyui_workflow_wrap', 'manual', 'custom_node_fs')),
      category TEXT,
      source_workflow_id INTEGER,
      template_defaults TEXT NOT NULL,
      exposed_inputs TEXT NOT NULL,
      output_ports TEXT NOT NULL,
      internal_fixed_values TEXT,
      ui_schema TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      color TEXT DEFAULT '#7c4dff',
      external_key TEXT,
      source_path TEXT,
      source_hash TEXT,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (source_workflow_id) REFERENCES workflows(id) ON DELETE SET NULL
    )
  `);

  // 10. Graph workflow folders table (explorer tree)
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_workflow_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      parent_id INTEGER,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES graph_workflow_folders(id) ON DELETE CASCADE
    )
  `);

  // 11. Graph workflows table (node/edge documents)
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_workflows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      graph_json TEXT NOT NULL,
      folder_id INTEGER,
      version INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (folder_id) REFERENCES graph_workflow_folders(id) ON DELETE SET NULL
    )
  `);

  // 12. Graph workflow versions table (history snapshots)
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_workflow_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id INTEGER NOT NULL,
      version INTEGER NOT NULL,
      graph_json TEXT NOT NULL,
      changelog TEXT,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workflow_id) REFERENCES graph_workflows(id) ON DELETE CASCADE,
      UNIQUE(workflow_id, version)
    )
  `);

  // 13. Graph executions table (future runtime execution tracking)
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      graph_workflow_id INTEGER NOT NULL,
      graph_version INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft', 'queued', 'running', 'completed', 'failed', 'cancelled')) DEFAULT 'draft',
      execution_plan TEXT,
      started_at DATETIME,
      completed_at DATETIME,
      error_message TEXT,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      failed_node_id TEXT,
      FOREIGN KEY (graph_workflow_id) REFERENCES graph_workflows(id) ON DELETE CASCADE
    )
  `);

  // 14. Graph execution artifacts table (future intermediate image/text/blob tracking)
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_execution_artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id INTEGER NOT NULL,
      node_id TEXT NOT NULL,
      port_key TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      storage_path TEXT,
      metadata TEXT,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (execution_id) REFERENCES graph_executions(id) ON DELETE CASCADE
    )
  `);

  // 15. Graph execution logs table (node-level timeline/logging)
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_execution_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id INTEGER NOT NULL,
      node_id TEXT,
      level TEXT NOT NULL CHECK(level IN ('info', 'warn', 'error')) DEFAULT 'info',
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (execution_id) REFERENCES graph_executions(id) ON DELETE CASCADE
    )
  `);

  // 16. Graph execution final results table (explicit workflow-declared final outputs)
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_execution_final_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id INTEGER NOT NULL,
      final_node_id TEXT NOT NULL,
      source_artifact_id INTEGER NOT NULL,
      source_node_id TEXT NOT NULL,
      source_port_key TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (execution_id) REFERENCES graph_executions(id) ON DELETE CASCADE,
      FOREIGN KEY (source_artifact_id) REFERENCES graph_execution_artifacts(id) ON DELETE CASCADE,
      UNIQUE (execution_id, final_node_id)
    )
  `);

  // ===== MIGRATION: Add missing columns BEFORE creating indexes =====
  // Helper function to check if column exists
  const hasColumn = (tableName: string, columnName: string): boolean => {
    const pragma = db.prepare(`PRAGMA table_info(${tableName})`).all() as any[];
    return pragma.some((col: any) => col.name === columnName);
  };

  // Migrate wildcards table
  if (!hasColumn('wildcards', 'is_auto_collected')) {
    console.log('  Migrating wildcards: adding is_auto_collected column');
    db.exec('ALTER TABLE wildcards ADD COLUMN is_auto_collected INTEGER DEFAULT 0');
  }
  if (!hasColumn('wildcards', 'source_path')) {
    console.log('  Migrating wildcards: adding source_path column');
    db.exec('ALTER TABLE wildcards ADD COLUMN source_path TEXT');
  }
  if (!hasColumn('wildcards', 'lora_weight')) {
    console.log('  Migrating wildcards: adding lora_weight column');
    db.exec('ALTER TABLE wildcards ADD COLUMN lora_weight REAL DEFAULT 1.0');
  }
  if (!hasColumn('wildcards', 'parent_id')) {
    console.log('  Migrating wildcards: adding parent_id column');
    db.exec('ALTER TABLE wildcards ADD COLUMN parent_id INTEGER DEFAULT NULL');
  }
  if (!hasColumn('wildcards', 'include_children')) {
    console.log('  Migrating wildcards: adding include_children column');
    db.exec('ALTER TABLE wildcards ADD COLUMN include_children INTEGER DEFAULT 0');
  }
  if (!hasColumn('wildcards', 'type')) {
    console.log('  Migrating wildcards: adding type column');
    db.exec("ALTER TABLE wildcards ADD COLUMN type TEXT CHECK(type IN ('wildcard', 'chain')) DEFAULT 'wildcard'");
  }
  if (!hasColumn('wildcards', 'chain_option')) {
    console.log('  Migrating wildcards: adding chain_option column');
    db.exec("ALTER TABLE wildcards ADD COLUMN chain_option TEXT CHECK(chain_option IN ('replace', 'append')) DEFAULT 'replace'");
  }
  if (!hasColumn('wildcards', 'only_children')) {
    console.log('  Migrating wildcards: adding only_children column');
    db.exec('ALTER TABLE wildcards ADD COLUMN only_children INTEGER DEFAULT 0');
  }

  // Migrate custom_dropdown_lists table
  if (!hasColumn('custom_dropdown_lists', 'is_auto_collected')) {
    console.log('  Migrating custom_dropdown_lists: adding is_auto_collected column');
    db.exec('ALTER TABLE custom_dropdown_lists ADD COLUMN is_auto_collected INTEGER DEFAULT 0');
  }
  if (!hasColumn('custom_dropdown_lists', 'source_path')) {
    console.log('  Migrating custom_dropdown_lists: adding source_path column');
    db.exec('ALTER TABLE custom_dropdown_lists ADD COLUMN source_path TEXT');
  }

  // Migrate external_api_providers table
  if (!hasColumn('external_api_providers', 'provider_type')) {
    console.log('  Migrating external_api_providers: adding provider_type column');
    db.exec("ALTER TABLE external_api_providers ADD COLUMN provider_type TEXT NOT NULL DEFAULT 'general'");
  }

  // Migrate graph_workflow_folders table
  if (!hasColumn('graph_workflow_folders', 'description')) {
    console.log('  Migrating graph_workflow_folders: adding description column');
    db.exec('ALTER TABLE graph_workflow_folders ADD COLUMN description TEXT');
  }

  // Migrate graph_workflows table
  if (!hasColumn('graph_workflows', 'folder_id')) {
    console.log('  Migrating graph_workflows: adding folder_id column');
    db.exec('ALTER TABLE graph_workflows ADD COLUMN folder_id INTEGER');
  }

  // Migrate graph_executions table
  if (!hasColumn('graph_executions', 'failed_node_id')) {
    console.log('  Migrating graph_executions: adding failed_node_id column');
    db.exec('ALTER TABLE graph_executions ADD COLUMN failed_node_id TEXT');
  }

  // Create indexes (now safe - all columns exist)
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_workflows_name ON workflows(name)',
    'CREATE INDEX IF NOT EXISTS idx_workflows_is_active ON workflows(is_active)',
    'CREATE INDEX IF NOT EXISTS idx_workflows_created_date ON workflows(created_date)',
    'CREATE INDEX IF NOT EXISTS idx_comfyui_servers_name ON comfyui_servers(name)',
    'CREATE INDEX IF NOT EXISTS idx_comfyui_servers_active ON comfyui_servers(is_active)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_servers_workflow ON workflow_servers(workflow_id)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_servers_server ON workflow_servers(server_id)',
    'CREATE INDEX IF NOT EXISTS idx_user_preferences_key ON user_preferences(key)',
    'CREATE INDEX IF NOT EXISTS idx_wildcards_name ON wildcards(name)',
    'CREATE INDEX IF NOT EXISTS idx_wildcards_is_auto_collected ON wildcards(is_auto_collected)',
    'CREATE INDEX IF NOT EXISTS idx_wildcards_parent_id ON wildcards(parent_id)',
    'CREATE INDEX IF NOT EXISTS idx_wildcard_items_wildcard_id ON wildcard_items(wildcard_id)',
    'CREATE INDEX IF NOT EXISTS idx_wildcard_items_tool ON wildcard_items(tool)',
    'CREATE INDEX IF NOT EXISTS idx_custom_dropdown_lists_name ON custom_dropdown_lists(name)',
    'CREATE INDEX IF NOT EXISTS idx_custom_dropdown_lists_created_date ON custom_dropdown_lists(created_date)',
    'CREATE INDEX IF NOT EXISTS idx_custom_dropdown_lists_is_auto_collected ON custom_dropdown_lists(is_auto_collected)',
    'CREATE INDEX IF NOT EXISTS idx_external_api_providers_name ON external_api_providers(provider_name)',
    'CREATE INDEX IF NOT EXISTS idx_external_api_providers_is_enabled ON external_api_providers(is_enabled)',
    'CREATE INDEX IF NOT EXISTS idx_external_api_providers_type ON external_api_providers(provider_type)',
    'CREATE INDEX IF NOT EXISTS idx_module_definitions_name ON module_definitions(name)',
    'CREATE INDEX IF NOT EXISTS idx_module_definitions_engine_type ON module_definitions(engine_type)',
    'CREATE INDEX IF NOT EXISTS idx_module_definitions_source_workflow ON module_definitions(source_workflow_id)',
    'CREATE INDEX IF NOT EXISTS idx_module_definitions_active ON module_definitions(is_active)',
    'CREATE INDEX IF NOT EXISTS idx_module_definitions_authoring_source ON module_definitions(authoring_source)',
    'CREATE INDEX IF NOT EXISTS idx_graph_workflow_folders_parent_id ON graph_workflow_folders(parent_id)',
    'CREATE INDEX IF NOT EXISTS idx_graph_workflows_name ON graph_workflows(name)',
    'CREATE INDEX IF NOT EXISTS idx_graph_workflows_folder_id ON graph_workflows(folder_id)',
    'CREATE INDEX IF NOT EXISTS idx_graph_workflows_active ON graph_workflows(is_active)',
    'CREATE INDEX IF NOT EXISTS idx_graph_workflow_versions_workflow_id ON graph_workflow_versions(workflow_id)',
    'CREATE INDEX IF NOT EXISTS idx_graph_executions_workflow_id ON graph_executions(graph_workflow_id)',
    'CREATE INDEX IF NOT EXISTS idx_graph_executions_status ON graph_executions(status)',
    'CREATE INDEX IF NOT EXISTS idx_graph_executions_failed_node ON graph_executions(failed_node_id)',
    'CREATE INDEX IF NOT EXISTS idx_graph_execution_artifacts_execution_id ON graph_execution_artifacts(execution_id)',
    'CREATE INDEX IF NOT EXISTS idx_graph_execution_artifacts_node_port ON graph_execution_artifacts(node_id, port_key)',
    'CREATE INDEX IF NOT EXISTS idx_graph_execution_logs_execution_id ON graph_execution_logs(execution_id)',
    'CREATE INDEX IF NOT EXISTS idx_graph_execution_logs_node_id ON graph_execution_logs(node_id)',
    'CREATE INDEX IF NOT EXISTS idx_graph_execution_logs_level ON graph_execution_logs(level)',
    'CREATE INDEX IF NOT EXISTS idx_graph_execution_final_results_execution_id ON graph_execution_final_results(execution_id)',
    'CREATE INDEX IF NOT EXISTS idx_graph_execution_final_results_source_artifact_id ON graph_execution_final_results(source_artifact_id)'
  ];

  indexes.forEach(sql => db.exec(sql));

  // Insert default language setting
  db.prepare(`INSERT OR IGNORE INTO user_preferences (key, value) VALUES (?, ?)`)
    .run('language', 'en');

  // Insert default Civitai provider
  db.prepare(`
    INSERT OR IGNORE INTO external_api_providers (provider_name, display_name, is_enabled)
    VALUES (?, ?, ?)
  `).run('civitai', 'Civitai', 1);

  console.log('  ✅ User settings tables created (16 tables + indexes)');

}
