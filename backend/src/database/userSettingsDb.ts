import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import {
  attachMainImagesDatabase,
  bootstrapUnifiedUserDb,
  cleanupLegacyUserSettingsDb,
  ensureApiGenerationHistoryTable,
  migrateLegacyApiGenerationHistory,
  USER_DB_PATH,
  USER_SETTINGS_MIGRATIONS_PATH,
} from './userSettingsBootstrap';

export let userSettingsDb: Database.Database;


/**
 * Initialize User Settings database
 */
export function initializeUserSettingsDb(): void {
  try {
    // Ensure database directory exists
    const dbDir = path.dirname(USER_DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const bootstrapResult = bootstrapUnifiedUserDb();
    const isNewDatabase = !fs.existsSync(USER_DB_PATH);

    userSettingsDb = new Database(USER_DB_PATH);

    if (isNewDatabase) {
      console.log('✅ New unified user database created');
    } else {
      console.log('✅ Connected to existing unified user database');
    }

    runMigrations();
    attachMainImagesDatabase(userSettingsDb);
    ensureApiGenerationHistoryTable(userSettingsDb);
    migrateLegacyApiGenerationHistory(userSettingsDb);
    cleanupLegacyUserSettingsDb(bootstrapResult.copiedLegacyUserSettingsDb);
  } catch (error) {
    console.error('Failed to initialize unified user database:', error);
    throw error;
  }
}

/**
 * Create migrations tracking table
 */
function createMigrationsTable(): void {
  userSettingsDb.exec(`
    CREATE TABLE IF NOT EXISTS user_settings_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version VARCHAR(255) NOT NULL UNIQUE,
      applied_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/**
 * Get list of applied migrations
 */
function getAppliedMigrations(): string[] {
  const rows = userSettingsDb.prepare('SELECT version FROM user_settings_migrations ORDER BY version').all() as { version: string }[];
  return rows.map(row => row.version);
}

/**
 * Record a migration as applied
 */
function recordMigration(version: string): void {
  userSettingsDb.prepare('INSERT INTO user_settings_migrations (version) VALUES (?)').run(version);
}

/**
 * Create all user settings tables if they don't exist
 */
function createTables(): void {
  console.log('📊 Creating user settings tables...');

  // 1. Workflows table (stores ComfyUI workflows)
  userSettingsDb.exec(`
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
  userSettingsDb.exec(`
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
  userSettingsDb.exec(`
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
  userSettingsDb.exec(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 5. Wildcards table
  userSettingsDb.exec(`
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
  userSettingsDb.exec(`
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
  userSettingsDb.exec(`
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
  userSettingsDb.exec(`
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
  userSettingsDb.exec(`
    CREATE TABLE IF NOT EXISTS module_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      engine_type TEXT NOT NULL CHECK(engine_type IN ('nai', 'comfyui', 'system')),
      authoring_source TEXT NOT NULL CHECK(authoring_source IN ('nai_form_snapshot', 'comfyui_workflow_wrap', 'manual')),
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
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (source_workflow_id) REFERENCES workflows(id) ON DELETE SET NULL
    )
  `);

  // 10. Graph workflows table (node/edge documents)
  userSettingsDb.exec(`
    CREATE TABLE IF NOT EXISTS graph_workflows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      graph_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 11. Graph workflow versions table (history snapshots)
  userSettingsDb.exec(`
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

  // 12. Graph executions table (future runtime execution tracking)
  userSettingsDb.exec(`
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

  // 13. Graph execution artifacts table (future intermediate image/text/blob tracking)
  userSettingsDb.exec(`
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

  // 14. Graph execution logs table (node-level timeline/logging)
  userSettingsDb.exec(`
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

  // ===== MIGRATION: Add missing columns BEFORE creating indexes =====
  // Helper function to check if column exists
  const hasColumn = (tableName: string, columnName: string): boolean => {
    const pragma = userSettingsDb.prepare(`PRAGMA table_info(${tableName})`).all() as any[];
    return pragma.some((col: any) => col.name === columnName);
  };

  // Migrate wildcards table
  if (!hasColumn('wildcards', 'is_auto_collected')) {
    console.log('  Migrating wildcards: adding is_auto_collected column');
    userSettingsDb.exec('ALTER TABLE wildcards ADD COLUMN is_auto_collected INTEGER DEFAULT 0');
  }
  if (!hasColumn('wildcards', 'source_path')) {
    console.log('  Migrating wildcards: adding source_path column');
    userSettingsDb.exec('ALTER TABLE wildcards ADD COLUMN source_path TEXT');
  }
  if (!hasColumn('wildcards', 'lora_weight')) {
    console.log('  Migrating wildcards: adding lora_weight column');
    userSettingsDb.exec('ALTER TABLE wildcards ADD COLUMN lora_weight REAL DEFAULT 1.0');
  }
  if (!hasColumn('wildcards', 'parent_id')) {
    console.log('  Migrating wildcards: adding parent_id column');
    userSettingsDb.exec('ALTER TABLE wildcards ADD COLUMN parent_id INTEGER DEFAULT NULL');
  }
  if (!hasColumn('wildcards', 'include_children')) {
    console.log('  Migrating wildcards: adding include_children column');
    userSettingsDb.exec('ALTER TABLE wildcards ADD COLUMN include_children INTEGER DEFAULT 0');
  }
  if (!hasColumn('wildcards', 'type')) {
    console.log('  Migrating wildcards: adding type column');
    userSettingsDb.exec("ALTER TABLE wildcards ADD COLUMN type TEXT CHECK(type IN ('wildcard', 'chain')) DEFAULT 'wildcard'");
  }
  if (!hasColumn('wildcards', 'chain_option')) {
    console.log('  Migrating wildcards: adding chain_option column');
    userSettingsDb.exec("ALTER TABLE wildcards ADD COLUMN chain_option TEXT CHECK(chain_option IN ('replace', 'append')) DEFAULT 'replace'");
  }
  if (!hasColumn('wildcards', 'only_children')) {
    console.log('  Migrating wildcards: adding only_children column');
    userSettingsDb.exec('ALTER TABLE wildcards ADD COLUMN only_children INTEGER DEFAULT 0');
  }

  // Migrate custom_dropdown_lists table
  if (!hasColumn('custom_dropdown_lists', 'is_auto_collected')) {
    console.log('  Migrating custom_dropdown_lists: adding is_auto_collected column');
    userSettingsDb.exec('ALTER TABLE custom_dropdown_lists ADD COLUMN is_auto_collected INTEGER DEFAULT 0');
  }
  if (!hasColumn('custom_dropdown_lists', 'source_path')) {
    console.log('  Migrating custom_dropdown_lists: adding source_path column');
    userSettingsDb.exec('ALTER TABLE custom_dropdown_lists ADD COLUMN source_path TEXT');
  }

  // Migrate external_api_providers table
  if (!hasColumn('external_api_providers', 'provider_type')) {
    console.log('  Migrating external_api_providers: adding provider_type column');
    userSettingsDb.exec("ALTER TABLE external_api_providers ADD COLUMN provider_type TEXT NOT NULL DEFAULT 'general'");
  }

  // Migrate graph_executions table
  if (!hasColumn('graph_executions', 'failed_node_id')) {
    console.log('  Migrating graph_executions: adding failed_node_id column');
    userSettingsDb.exec('ALTER TABLE graph_executions ADD COLUMN failed_node_id TEXT');
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
    'CREATE INDEX IF NOT EXISTS idx_graph_workflows_name ON graph_workflows(name)',
    'CREATE INDEX IF NOT EXISTS idx_graph_workflows_active ON graph_workflows(is_active)',
    'CREATE INDEX IF NOT EXISTS idx_graph_workflow_versions_workflow_id ON graph_workflow_versions(workflow_id)',
    'CREATE INDEX IF NOT EXISTS idx_graph_executions_workflow_id ON graph_executions(graph_workflow_id)',
    'CREATE INDEX IF NOT EXISTS idx_graph_executions_status ON graph_executions(status)',
    'CREATE INDEX IF NOT EXISTS idx_graph_executions_failed_node ON graph_executions(failed_node_id)',
    'CREATE INDEX IF NOT EXISTS idx_graph_execution_artifacts_execution_id ON graph_execution_artifacts(execution_id)',
    'CREATE INDEX IF NOT EXISTS idx_graph_execution_artifacts_node_port ON graph_execution_artifacts(node_id, port_key)',
    'CREATE INDEX IF NOT EXISTS idx_graph_execution_logs_execution_id ON graph_execution_logs(execution_id)',
    'CREATE INDEX IF NOT EXISTS idx_graph_execution_logs_node_id ON graph_execution_logs(node_id)',
    'CREATE INDEX IF NOT EXISTS idx_graph_execution_logs_level ON graph_execution_logs(level)'
  ];

  indexes.forEach(sql => userSettingsDb.exec(sql));

  // Insert default language setting
  userSettingsDb.prepare(`INSERT OR IGNORE INTO user_preferences (key, value) VALUES (?, ?)`)
    .run('language', 'en');

  // Insert default Civitai provider
  userSettingsDb.prepare(`
    INSERT OR IGNORE INTO external_api_providers (provider_name, display_name, is_enabled)
    VALUES (?, ?, ?)
  `).run('civitai', 'Civitai', 1);

  console.log('  ✅ User settings tables created (14 tables + indexes)');

  // Run migrations for existing tables
  migrateExistingTables();
}

/**
 * Migrate existing tables to new schema
 * Handles complex schema migrations that require table recreation
 * Note: Simple column additions are now handled in createTables() before index creation
 */
function migrateExistingTables(): void {
  console.log('🔄 Checking for complex schema migrations...');

  try {
    // Helper function to check if column exists
    const hasColumn = (tableName: string, columnName: string): boolean => {
      const pragma = userSettingsDb.prepare(`PRAGMA table_info(${tableName})`).all() as any[];
      return pragma.some((col: any) => col.name === columnName);
    };

    // Migrate wildcard_items table - check if old schema exists
    if (hasColumn('wildcard_items', 'item_text')) {
      console.log('  Migrating wildcard_items table to new schema...');

      // Create temporary table with new schema
      userSettingsDb.exec(`
        CREATE TABLE IF NOT EXISTS wildcard_items_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          wildcard_id INTEGER NOT NULL,
          tool TEXT NOT NULL CHECK(tool IN ('comfyui', 'nai')) DEFAULT 'comfyui',
          content TEXT NOT NULL,
          order_index INTEGER NOT NULL DEFAULT 0,
          created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (wildcard_id) REFERENCES wildcards(id) ON DELETE CASCADE
        )
      `);

      // Copy data from old table to new (assuming all items are comfyui by default)
      userSettingsDb.exec(`
        INSERT INTO wildcard_items_new (id, wildcard_id, tool, content, order_index, created_date)
        SELECT id, wildcard_id, 'comfyui', item_text, 0, created_at
        FROM wildcard_items
      `);

      // Drop old table and rename new one
      userSettingsDb.exec('DROP TABLE wildcard_items');
      userSettingsDb.exec('ALTER TABLE wildcard_items_new RENAME TO wildcard_items');

      // Recreate index
      userSettingsDb.exec('CREATE INDEX IF NOT EXISTS idx_wildcard_items_wildcard_id ON wildcard_items(wildcard_id)');
      userSettingsDb.exec('CREATE INDEX IF NOT EXISTS idx_wildcard_items_tool ON wildcard_items(tool)');

      console.log('  ✅ wildcard_items table migrated successfully');
    } else {
      console.log('  ✓ No complex migrations needed');
    }

    // Migrate wildcard_items table - add weight column if missing
    if (!hasColumn('wildcard_items', 'weight')) {
      console.log('  Migrating wildcard_items: adding weight column');
      userSettingsDb.exec('ALTER TABLE wildcard_items ADD COLUMN weight REAL DEFAULT 1.0');
    }

    console.log('  ✅ Schema migration complete');
  } catch (error) {
    console.error('  ⚠️ Error during schema migration:', error);
    // Don't throw - let the app continue with existing schema
  }
}

/**
 * Recreate module_definitions when an older database still restricts engine_type to nai/comfyui.
 */
function ensureModuleDefinitionsSupportsSystemEngine(): void {
  const schemaRow = userSettingsDb
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='module_definitions'")
    .get() as { sql?: string } | undefined;

  if (!schemaRow?.sql || schemaRow.sql.includes("'system'")) {
    return;
  }

  console.log('🔧 Updating module_definitions schema to support system engine...');

  try {
    userSettingsDb.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE module_definitions__new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        engine_type TEXT NOT NULL CHECK(engine_type IN ('nai', 'comfyui', 'system')),
        authoring_source TEXT NOT NULL CHECK(authoring_source IN ('nai_form_snapshot', 'comfyui_workflow_wrap', 'manual')),
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
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (source_workflow_id) REFERENCES workflows(id) ON DELETE SET NULL
      );

      INSERT INTO module_definitions__new (
        id, name, description, engine_type, authoring_source, category, source_workflow_id,
        template_defaults, exposed_inputs, output_ports, internal_fixed_values, ui_schema,
        version, is_active, color, created_date, updated_date
      )
      SELECT
        id, name, description, engine_type, authoring_source, category, source_workflow_id,
        template_defaults, exposed_inputs, output_ports, internal_fixed_values, ui_schema,
        version, is_active, color, created_date, updated_date
      FROM module_definitions;

      DROP TABLE module_definitions;
      ALTER TABLE module_definitions__new RENAME TO module_definitions;
      COMMIT;
    `);
  } catch (error) {
    userSettingsDb.exec('ROLLBACK;');
    throw error;
  }
}

/**
 * Recreate graph_workflows when an older database still enforces unique workflow names.
 */
function ensureGraphWorkflowsAllowDuplicateNames(): void {
  const schemaRow = userSettingsDb
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='graph_workflows'")
    .get() as { sql?: string } | undefined;

  if (!schemaRow?.sql || !schemaRow.sql.toUpperCase().includes('NAME TEXT NOT NULL UNIQUE')) {
    return;
  }

  console.log('🔧 Updating graph_workflows schema to allow duplicate workflow names...');

  userSettingsDb.exec('PRAGMA foreign_keys = OFF;');

  try {
    userSettingsDb.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE graph_workflows__new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        graph_json TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        is_active INTEGER DEFAULT 1,
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO graph_workflows__new (
        id, name, description, graph_json, version, is_active, created_date, updated_date
      )
      SELECT
        id, name, description, graph_json, version, is_active, created_date, updated_date
      FROM graph_workflows;

      DROP TABLE graph_workflows;
      ALTER TABLE graph_workflows__new RENAME TO graph_workflows;
      CREATE INDEX IF NOT EXISTS idx_graph_workflows_name ON graph_workflows(name);
      CREATE INDEX IF NOT EXISTS idx_graph_workflows_active ON graph_workflows(is_active);
      COMMIT;
    `);
  } catch (error) {
    userSettingsDb.exec('ROLLBACK;');
    throw error;
  } finally {
    userSettingsDb.exec('PRAGMA foreign_keys = ON;');
  }
}

/**
 * Seed built-in system-native workflow modules that should always be available.
 */
function ensureBuiltinSystemModules(): void {
  const insertIfMissing = (
    name: string,
    description: string,
    category: string,
    exposedInputs: unknown,
    outputPorts: unknown,
    internalFixedValues: unknown,
    uiSchema: unknown,
    color: string,
  ) => {
    const existing = userSettingsDb
      .prepare('SELECT id FROM module_definitions WHERE name = ?')
      .get(name) as { id: number } | undefined;

    if (existing) {
      return;
    }

    userSettingsDb.prepare(`
      INSERT INTO module_definitions (
        name, description, engine_type, authoring_source, category,
        template_defaults, exposed_inputs, output_ports, internal_fixed_values, ui_schema,
        version, is_active, color
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      description,
      'system',
      'manual',
      category,
      JSON.stringify({}),
      JSON.stringify(exposedInputs),
      JSON.stringify(outputPorts),
      JSON.stringify(internalFixedValues),
      JSON.stringify(uiSchema),
      1,
      1,
      color,
    );
  };

  insertIfMissing(
    'Random Prompt From Group',
    'Pick one prompt entry from a stored prompt group and expose it as reusable workflow text.',
    'prompt-source',
    [
      {
        key: 'group_name',
        label: 'Group Name',
        direction: 'input',
        data_type: 'text',
        required: false,
        multiple: false,
        description: 'Exact prompt group name to sample from when group_id is not provided.',
      },
      {
        key: 'group_id',
        label: 'Group ID',
        direction: 'input',
        data_type: 'number',
        required: false,
        multiple: false,
        description: 'Prompt group id. If set, this wins over group_name.',
      },
      {
        key: 'type',
        label: 'Collection Type',
        direction: 'input',
        data_type: 'text',
        required: false,
        multiple: false,
        default_value: 'positive',
        description: 'positive, negative, or auto',
      },
      {
        key: 'seed',
        label: 'Seed',
        direction: 'input',
        data_type: 'number',
        required: false,
        multiple: false,
        description: 'Optional deterministic selector seed.',
      },
    ],
    [
      {
        key: 'prompt',
        label: 'Prompt',
        direction: 'output',
        data_type: 'prompt',
        required: true,
        multiple: false,
      },
      {
        key: 'text',
        label: 'Text',
        direction: 'output',
        data_type: 'text',
        required: true,
        multiple: false,
      },
      {
        key: 'entry_json',
        label: 'Entry JSON',
        direction: 'output',
        data_type: 'json',
        required: false,
        multiple: false,
      },
    ],
    { operation_key: 'system.random_prompt_from_group' },
    [
      {
        key: 'group_name',
        label: 'Group Name',
        data_type: 'text',
        placeholder: '예: Character Pose / Costume / Auto Tags',
      },
      {
        key: 'group_id',
        label: 'Group ID',
        data_type: 'number',
      },
      {
        key: 'type',
        label: 'Collection Type',
        data_type: 'select',
        default_value: 'positive',
        options: ['positive', 'negative', 'auto'],
      },
      {
        key: 'seed',
        label: 'Seed',
        data_type: 'number',
      },
    ],
    '#26a69a',
  );

  insertIfMissing(
    'Find Similar Images',
    'Search the active library for visually similar images based on one input image.',
    'retrieval',
    [
      {
        key: 'image',
        label: 'Image',
        direction: 'input',
        data_type: 'image',
        required: true,
        multiple: false,
        description: 'Input image used as the similarity search target.',
      },
      {
        key: 'limit',
        label: 'Limit',
        direction: 'input',
        data_type: 'number',
        required: false,
        multiple: false,
        default_value: 12,
        description: 'Maximum number of similar images to return.',
      },
      {
        key: 'threshold',
        label: 'Threshold',
        direction: 'input',
        data_type: 'number',
        required: false,
        multiple: false,
        default_value: 15,
        description: 'Maximum perceptual hash distance allowed for matches.',
      },
      {
        key: 'include_prompt',
        label: 'Include Prompt',
        direction: 'input',
        data_type: 'boolean',
        required: false,
        multiple: false,
        default_value: true,
        description: 'Include prompt metadata in each returned match record.',
      },
    ],
    [
      {
        key: 'matches',
        label: 'Matches',
        direction: 'output',
        data_type: 'json',
        required: true,
        multiple: false,
      },
    ],
    { operation_key: 'system.find_similar_images' },
    [
      {
        key: 'limit',
        label: 'Limit',
        data_type: 'number',
        default_value: 12,
      },
      {
        key: 'threshold',
        label: 'Threshold',
        data_type: 'number',
        default_value: 15,
      },
      {
        key: 'include_prompt',
        label: 'Include Prompt',
        data_type: 'checkbox',
        default_value: true,
      },
    ],
    '#42a5f5',
  );

  insertIfMissing(
    'Load Prompt From Reference',
    'Resolve one image reference into reusable prompt text and metadata.',
    'retrieval',
    [
      {
        key: 'reference',
        label: 'Reference',
        direction: 'input',
        data_type: 'json',
        required: false,
        multiple: false,
        description: 'Structured reference JSON, such as the output of Find Similar Images.',
      },
      {
        key: 'composite_hash',
        label: 'Composite Hash',
        direction: 'input',
        data_type: 'text',
        required: false,
        multiple: false,
        description: 'Direct image composite hash. If set, this wins over reference JSON.',
      },
      {
        key: 'index',
        label: 'Index',
        direction: 'input',
        data_type: 'number',
        required: false,
        multiple: false,
        default_value: 0,
        description: 'Which item to read when the reference contains an items array.',
      },
    ],
    [
      {
        key: 'prompt',
        label: 'Prompt',
        direction: 'output',
        data_type: 'prompt',
        required: true,
        multiple: false,
      },
      {
        key: 'text',
        label: 'Text',
        direction: 'output',
        data_type: 'text',
        required: true,
        multiple: false,
      },
      {
        key: 'metadata',
        label: 'Metadata',
        direction: 'output',
        data_type: 'json',
        required: false,
        multiple: false,
      },
    ],
    { operation_key: 'system.load_prompt_from_reference' },
    [
      {
        key: 'composite_hash',
        label: 'Composite Hash',
        data_type: 'text',
      },
      {
        key: 'index',
        label: 'Index',
        data_type: 'number',
        default_value: 0,
      },
    ],
    '#66bb6a',
  );

  insertIfMissing(
    'Load Image From Reference',
    'Resolve one image reference into an actual graph image artifact.',
    'retrieval',
    [
      {
        key: 'reference',
        label: 'Reference',
        direction: 'input',
        data_type: 'json',
        required: false,
        multiple: false,
        description: 'Structured reference JSON, such as the output of Find Similar Images.',
      },
      {
        key: 'composite_hash',
        label: 'Composite Hash',
        direction: 'input',
        data_type: 'text',
        required: false,
        multiple: false,
        description: 'Direct image composite hash. If set, this wins over reference JSON.',
      },
      {
        key: 'index',
        label: 'Index',
        direction: 'input',
        data_type: 'number',
        required: false,
        multiple: false,
        default_value: 0,
        description: 'Which item to read when the reference contains an items array.',
      },
    ],
    [
      {
        key: 'image',
        label: 'Image',
        direction: 'output',
        data_type: 'image',
        required: true,
        multiple: false,
      },
      {
        key: 'image_ref',
        label: 'Image Reference',
        direction: 'output',
        data_type: 'json',
        required: false,
        multiple: false,
      },
    ],
    { operation_key: 'system.load_image_from_reference' },
    [
      {
        key: 'composite_hash',
        label: 'Composite Hash',
        data_type: 'text',
      },
      {
        key: 'index',
        label: 'Index',
        data_type: 'number',
        default_value: 0,
      },
    ],
    '#29b6f6',
  );

  insertIfMissing(
    'Random Image From Library',
    'Pick one random image from the active library and expose it as a reusable graph image.',
    'retrieval',
    [],
    [
      {
        key: 'image',
        label: 'Image',
        direction: 'output',
        data_type: 'image',
        required: true,
        multiple: false,
      },
      {
        key: 'image_ref',
        label: 'Image Reference',
        direction: 'output',
        data_type: 'json',
        required: false,
        multiple: false,
      },
      {
        key: 'metadata',
        label: 'Metadata',
        direction: 'output',
        data_type: 'json',
        required: false,
        multiple: false,
      },
    ],
    { operation_key: 'system.random_image_from_library' },
    [],
    '#7e57c2',
  );

  insertIfMissing(
    'Extract Tags From Image',
    'Run the configured image tagger on one image input and expose prompt-friendly tags.',
    'analysis',
    [
      {
        key: 'image',
        label: 'Image',
        direction: 'input',
        data_type: 'image',
        required: true,
        multiple: false,
        description: 'Input image used for tag extraction.',
      },
    ],
    [
      {
        key: 'tags_text',
        label: 'Tags Text',
        direction: 'output',
        data_type: 'text',
        required: true,
        multiple: false,
      },
      {
        key: 'tags_prompt',
        label: 'Tags Prompt',
        direction: 'output',
        data_type: 'prompt',
        required: true,
        multiple: false,
      },
      {
        key: 'tags_json',
        label: 'Tags JSON',
        direction: 'output',
        data_type: 'json',
        required: false,
        multiple: false,
      },
    ],
    { operation_key: 'system.extract_tags_from_image' },
    [],
    '#ab47bc',
  );

  insertIfMissing(
    'Extract Artist From Image',
    'Run the configured Kaloscope artist tagger on one image input and expose artist/style hints.',
    'analysis',
    [
      {
        key: 'image',
        label: 'Image',
        direction: 'input',
        data_type: 'image',
        required: true,
        multiple: false,
        description: 'Input image used for artist/style extraction.',
      },
    ],
    [
      {
        key: 'artist_text',
        label: 'Artist Text',
        direction: 'output',
        data_type: 'text',
        required: true,
        multiple: false,
      },
      {
        key: 'artist_prompt',
        label: 'Artist Prompt',
        direction: 'output',
        data_type: 'prompt',
        required: true,
        multiple: false,
      },
      {
        key: 'artist_json',
        label: 'Artist JSON',
        direction: 'output',
        data_type: 'json',
        required: false,
        multiple: false,
      },
    ],
    { operation_key: 'system.extract_artist_from_image' },
    [],
    '#ef5350',
  );
}

/**
 * Run all migration files in order
 */
function runMigrations(): void {
  // Create migrations tracking table
  createMigrationsTable();

  // Check if migrations folder exists
  if (!fs.existsSync(USER_SETTINGS_MIGRATIONS_PATH)) {
    console.log('📊 No migrations folder found, creating tables directly...');
    createTables();
    ensureModuleDefinitionsSupportsSystemEngine();
    ensureGraphWorkflowsAllowDuplicateNames();
    ensureBuiltinSystemModules();
    return;
  }

  console.log(`📂 Using user settings migrations from: ${USER_SETTINGS_MIGRATIONS_PATH}`);

  // Get already applied migrations
  const appliedMigrations = getAppliedMigrations();

  const files = fs.readdirSync(USER_SETTINGS_MIGRATIONS_PATH)
    .filter(file => file.endsWith('.sql'))
    .sort();

  // Filter out already applied migrations
  const pendingMigrations = files.filter(file => !appliedMigrations.includes(file));

  if (pendingMigrations.length === 0) {
    console.log('  ✓ All migrations already applied');
    ensureModuleDefinitionsSupportsSystemEngine();
    ensureGraphWorkflowsAllowDuplicateNames();
    ensureBuiltinSystemModules();
    return;
  }

  for (const file of pendingMigrations) {
    const filePath = path.join(USER_SETTINGS_MIGRATIONS_PATH, file);
    const sql = fs.readFileSync(filePath, 'utf8');

    try {
      userSettingsDb.exec(sql);
      recordMigration(file);
      console.log(`  ✓ Migration applied: ${file}`);
    } catch (error) {
      console.error(`  ✗ Migration failed: ${file}`, error);
      throw error;
    }
  }

  ensureModuleDefinitionsSupportsSystemEngine();
  ensureGraphWorkflowsAllowDuplicateNames();
  ensureBuiltinSystemModules();
}

/**
 * Close database connection
 */
export function closeUserSettingsDb(): void {
  if (userSettingsDb) {
    userSettingsDb.close();
    console.log('User Settings database connection closed');
  }
}

/**
 * Get database instance (use with caution)
 */
export function getUserSettingsDb(): Database.Database {
  if (!userSettingsDb) {
    throw new Error('User Settings database not initialized');
  }
  return userSettingsDb;
}
