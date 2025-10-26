import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { runtimePaths } from '../config/runtimePaths';

/**
 * Data migration from images.db to user-settings.db
 * Tables to migrate:
 * - workflows
 * - comfyui_servers
 * - workflow_servers
 * - user_preferences
 */
export function migrateToUserSettingsDb(): void {
  const imagesDbPath = runtimePaths.databaseFile;
  const userSettingsDbPath = path.join(runtimePaths.databaseDir, 'user-settings.db');

  if (!fs.existsSync(imagesDbPath)) {
    console.log('⚠️  images.db not found - skipping migration');
    return;
  }

  if (!fs.existsSync(userSettingsDbPath)) {
    console.log('⚠️  user-settings.db not found - run initialization first');
    return;
  }

  const imagesDb = new Database(imagesDbPath);
  const userSettingsDb = new Database(userSettingsDbPath);

  try {
    console.log('🔄 Starting data migration to user-settings.db...');

    // Check if tables exist in images.db
    const checkTable = (tableName: string): boolean => {
      const result = imagesDb.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).get(tableName);
      return !!result;
    };

    // Start transaction
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
        console.log(`✅ Migrated ${workflows.length} workflows`);
      } else {
        console.log('  ℹ️  No workflows to migrate');
      }
    } else {
      console.log('  ℹ️  workflows table not found in images.db');
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
        console.log(`✅ Migrated ${servers.length} servers`);
      } else {
        console.log('  ℹ️  No servers to migrate');
      }
    } else {
      console.log('  ℹ️  comfyui_servers table not found in images.db');
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
        console.log(`✅ Migrated ${workflowServers.length} workflow-server links`);
      } else {
        console.log('  ℹ️  No workflow-server links to migrate');
      }
    } else {
      console.log('  ℹ️  workflow_servers table not found in images.db');
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
        console.log(`✅ Migrated ${prefs.length} user preferences`);
      } else {
        console.log('  ℹ️  No user preferences to migrate');
      }
    } else {
      console.log('  ℹ️  user_preferences table not found in images.db');
    }

    // Commit transaction
    userSettingsDb.exec('COMMIT');

    if (totalMigrated > 0) {
      console.log(`\n🎉 Data migration completed successfully! (${totalMigrated} records)`);
      console.log('   Next step: Run migration 015 to remove tables from images.db');
    } else {
      console.log('  ℹ️  No data to migrate (tables already empty or migrated)');
    }

  } catch (error) {
    userSettingsDb.exec('ROLLBACK');
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    imagesDb.close();
    userSettingsDb.close();
  }
}

// Allow direct execution
if (require.main === module) {
  try {
    migrateToUserSettingsDb();
  } catch (error) {
    console.error('Migration script failed:', error);
    process.exit(1);
  }
}
