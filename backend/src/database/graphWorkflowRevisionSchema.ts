import type Database from 'better-sqlite3'

/** Give graph and schedule rows durable revisions, including writes outside the models. */
export function ensureGraphWorkflowRevisionSchema(db: Database.Database) {
  for (const table of ['graph_workflows', 'graph_workflow_schedules']) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'revision')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN revision INTEGER NOT NULL DEFAULT 1`)
    }
  }

  db.exec(`
      CREATE TRIGGER IF NOT EXISTS graph_workflows_advance_revision
      AFTER UPDATE ON graph_workflows
      WHEN NEW.revision = OLD.revision
      BEGIN
        UPDATE graph_workflows SET revision = OLD.revision + 1 WHERE id = NEW.id;
      END;

      DROP TRIGGER IF EXISTS graph_workflow_schedules_advance_revision;
      CREATE TRIGGER IF NOT EXISTS graph_workflow_schedules_advance_revision_v2
      AFTER UPDATE ON graph_workflow_schedules
      WHEN NEW.revision = OLD.revision AND (
        NEW.graph_workflow_id IS NOT OLD.graph_workflow_id OR
        NEW.name IS NOT OLD.name OR
        NEW.schedule_type IS NOT OLD.schedule_type OR
        NEW.status IS NOT OLD.status OR
        NEW.timezone IS NOT OLD.timezone OR
        NEW.run_at IS NOT OLD.run_at OR
        NEW.interval_minutes IS NOT OLD.interval_minutes OR
        NEW.daily_time IS NOT OLD.daily_time OR
        NEW.max_run_count IS NOT OLD.max_run_count OR
        NEW.run_enqueue_count IS NOT OLD.run_enqueue_count OR
        NEW.failure_policy IS NOT OLD.failure_policy OR
        NEW.input_values IS NOT OLD.input_values OR
        NEW.confirmed_graph_version IS NOT OLD.confirmed_graph_version OR
        NEW.confirmed_input_signature IS NOT OLD.confirmed_input_signature OR
        NEW.stop_reason_code IS NOT OLD.stop_reason_code OR
        NEW.stop_reason_message IS NOT OLD.stop_reason_message OR
        NEW.run_as_account_id IS NOT OLD.run_as_account_id
      )
      BEGIN
        UPDATE graph_workflow_schedules SET revision = OLD.revision + 1 WHERE id = NEW.id;
      END;
    `)
}
