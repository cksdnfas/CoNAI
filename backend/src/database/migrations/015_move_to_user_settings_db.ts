import Database from 'better-sqlite3';
import { userSettingsDb } from '../userSettingsDb';

/**
 * Migration 015: Move user settings tables to separate DB WITH AUTOMATIC DATA MIGRATION
 *
 * Tables moved to user-settings.db:
 * - workflows
 * - comfyui_servers
 * - workflow_servers
 * - user_preferences
 *
 * This migration automatically migrates existing data before removing tables.
 * Safe for both new installations and upgrades from previous versions.
 */

/**
 * Automatically migrate data from images.db to user-settings.db
 */
async function migrateDataToUserSettingsDb(imagesDb: Database.Database): Promise<void> {
  const checkTable = (tableName: string): boolean => {
    const result = imagesDb.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(tableName);
    return !!result;
  };

  console.log('📦 Migrating existing data to user-settings.db...');

  try {
    userSettingsDb.exec('BEGIN TRANSACTION');

    let totalMigrated = 0;

    // 1. Migrate workflows
    if (checkTable('workflows')) {
      const workflows = imagesDb.prepare('SELECT * FROM workflows').all();
      if (workflows.length > 0) {
        const insertWorkflow = userSettingsDb.prepare(`
          INSERT OR IGNORE INTO workflows (id, name, description, workflow_json, marked_fields,
            api_endpoint, is_active, color, created_date, updated_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        workflows.forEach((w: any) => {
          insertWorkflow.run(
            w.id, w.name, w.description, w.workflow_json, w.marked_fields,
            w.api_endpoint, w.is_active, w.color || '#2196f3',
            w.created_date, w.updated_date
          );
        });
        totalMigrated += workflows.length;
        console.log(`  ✓ Migrated ${workflows.length} workflows`);
      } else {
        console.log('  ℹ️  No workflows to migrate');
      }
    } else {
      console.log('  ℹ️  workflows table not found (new installation)');
    }

    // 2. Migrate comfyui_servers
    if (checkTable('comfyui_servers')) {
      const servers = imagesDb.prepare('SELECT * FROM comfyui_servers').all();
      if (servers.length > 0) {
        const insertServer = userSettingsDb.prepare(`
          INSERT OR IGNORE INTO comfyui_servers (id, name, endpoint, description, is_active,
            created_date, updated_date)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        servers.forEach((s: any) => {
          insertServer.run(
            s.id, s.name, s.endpoint, s.description, s.is_active,
            s.created_date, s.updated_date
          );
        });
        totalMigrated += servers.length;
        console.log(`  ✓ Migrated ${servers.length} servers`);
      } else {
        console.log('  ℹ️  No servers to migrate');
      }
    } else {
      console.log('  ℹ️  comfyui_servers table not found (new installation)');
    }

    // 3. Migrate workflow_servers
    if (checkTable('workflow_servers')) {
      const workflowServers = imagesDb.prepare('SELECT * FROM workflow_servers').all();
      if (workflowServers.length > 0) {
        const insertWS = userSettingsDb.prepare(`
          INSERT OR IGNORE INTO workflow_servers (id, workflow_id, server_id, is_enabled, created_date)
          VALUES (?, ?, ?, ?, ?)
        `);
        workflowServers.forEach((ws: any) => {
          insertWS.run(ws.id, ws.workflow_id, ws.server_id, ws.is_enabled, ws.created_date);
        });
        totalMigrated += workflowServers.length;
        console.log(`  ✓ Migrated ${workflowServers.length} workflow-server links`);
      } else {
        console.log('  ℹ️  No workflow-server links to migrate');
      }
    } else {
      console.log('  ℹ️  workflow_servers table not found (new installation)');
    }

    // 4. Migrate user_preferences
    if (checkTable('user_preferences')) {
      const prefs = imagesDb.prepare('SELECT * FROM user_preferences').all();
      if (prefs.length > 0) {
        const insertPref = userSettingsDb.prepare(`
          INSERT OR IGNORE INTO user_preferences (id, key, value, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `);
        prefs.forEach((p: any) => {
          insertPref.run(p.id, p.key, p.value, p.created_at, p.updated_at);
        });
        totalMigrated += prefs.length;
        console.log(`  ✓ Migrated ${prefs.length} user preferences`);
      } else {
        console.log('  ℹ️  No user preferences to migrate');
      }
    } else {
      console.log('  ℹ️  user_preferences table not found (new installation)');
    }

    userSettingsDb.exec('COMMIT');

    if (totalMigrated > 0) {
      console.log(`✅ Successfully migrated ${totalMigrated} records to user-settings.db`);
    } else {
      console.log('✅ No data to migrate (new installation or already migrated)');
    }

  } catch (error) {
    userSettingsDb.exec('ROLLBACK');
    console.error('❌ Data migration failed:', error);
    throw error;
  }
}

export const up = async (db: Database.Database): Promise<void> => {
  console.log('🔄 Moving user settings tables to separate database...');

  // STEP 1: Automatic data migration
  console.log('📋 Step 1/3: Migrating existing data...');
  try {
    await migrateDataToUserSettingsDb(db);
  } catch (error) {
    console.error('❌ Data migration failed - aborting to prevent data loss');
    throw new Error('Migration 015 aborted: Cannot proceed without successful data migration');
  }

  // STEP 2: Drop indexes
  console.log('📋 Step 2/3: Removing indexes from images.db...');
  const indexes = [
    'idx_workflows_name',
    'idx_workflows_is_active',
    'idx_workflows_created_date',
    'idx_comfyui_servers_is_active',
    'idx_workflow_servers_workflow_id',
    'idx_workflow_servers_server_id',
    'idx_user_preferences_key'
  ];

  indexes.forEach(indexName => {
    try {
      db.exec(`DROP INDEX IF EXISTS ${indexName}`);
    } catch (err) {
      console.warn(`  ⚠️  Warning dropping index ${indexName}:`, err);
    }
  });

  // STEP 3: Drop tables (respecting FK constraints order)
  console.log('📋 Step 3/3: Removing tables from images.db...');
  const tables = ['workflow_servers', 'workflows', 'comfyui_servers', 'user_preferences'];

  tables.forEach(tableName => {
    try {
      db.exec(`DROP TABLE IF EXISTS ${tableName}`);
      console.log(`  ✓ Dropped table ${tableName}`);
    } catch (err) {
      console.warn(`  ⚠️  Warning dropping table ${tableName}:`, err);
    }
  });

  console.log('✅ User settings tables successfully moved to user-settings.db');
  console.log('   All data has been preserved during migration');
};

export const down = async (db: Database.Database): Promise<void> => {
  console.log('⚠️  Migration 015 rollback not supported');
  console.log('   To restore, you must:');
  console.log('   1. Restore images.db from backup');
  console.log('   2. Or manually recreate tables and copy data back from user-settings.db');
  throw new Error('Cannot rollback migration 015 - restore from database backup');
};
