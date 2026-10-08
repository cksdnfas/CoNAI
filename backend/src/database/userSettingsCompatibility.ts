import type Database from 'better-sqlite3';
import { ensureFileStoreSchema } from './fileStoreSchema';
import { ensureChatAssetSchema } from './chatAssetSchema';
import { ensureBuiltinSystemModules as ensureBuiltinSystemModulesInDb } from './userSettingsBuiltinModules';

function hasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  const pragma = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return pragma.some((column) => column.name === columnName);
}

/** Keep representative ComfyUI server state unique after legacy schema reconciliation. */
function ensureComfyUIServerSingleDefaultIndex(db: Database.Database): void {
  const tableRow = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='comfyui_servers'").get();
  if (!tableRow) {
    return;
  }

  if (!hasColumn(db, 'comfyui_servers', 'is_default')) {
    db.exec('ALTER TABLE comfyui_servers ADD COLUMN is_default BOOLEAN DEFAULT 0');
  }

  db.exec(`
    UPDATE comfyui_servers
    SET is_default = 0
    WHERE backend_type = 'modal'
      AND is_default = 1
  `);

  db.exec(`
    UPDATE comfyui_servers
    SET is_default = 0
    WHERE is_default = 1
      AND id NOT IN (
        SELECT id
        FROM comfyui_servers
        WHERE is_default = 1
          AND backend_type != 'modal'
        ORDER BY id DESC
        LIMIT 1
      )
  `);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_comfyui_servers_single_default ON comfyui_servers(is_default) WHERE is_default = 1');
}

/** Ensure custom-node related module_definition indexes exist after schema reconciliation. */
function ensureModuleDefinitionCompatibilityIndexes(db: Database.Database): void {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_module_definitions_external_key ON module_definitions(external_key)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_module_definitions_authoring_source ON module_definitions(authoring_source)');
}

/** Schema pieces that live outside createUserSettingsSchema, plus invariants re-checked on every startup. */
export function ensureUserSettingsCompatibility(db: Database.Database): void {
  ensureChatAssetSchema(db);
  ensureFileStoreSchema(db);
  ensureComfyUIServerSingleDefaultIndex(db);
  ensureModuleDefinitionCompatibilityIndexes(db);
  ensureBuiltinSystemModulesInDb(db);
}
