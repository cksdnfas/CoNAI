import { Database } from 'better-sqlite3';

export const up = async (db: Database): Promise<void> => {
  console.log('🔄 Running migration: 021_add_graph_execution_node_io.ts');

  db.prepare(`
    CREATE TABLE IF NOT EXISTS graph_execution_node_io (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id INTEGER NOT NULL,
      node_id TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('input', 'output')),
      port_key TEXT NOT NULL,
      source_node_id TEXT,
      source_port_key TEXT,
      output_index INTEGER NOT NULL DEFAULT 1,
      artifact_type TEXT,
      ref_kind TEXT,
      ref_value TEXT,
      summary TEXT,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (execution_id) REFERENCES graph_executions(id) ON DELETE CASCADE
    )
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_graph_execution_node_io_execution_node
    ON graph_execution_node_io(execution_id, node_id)
  `).run();
  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_graph_execution_node_io_execution_direction
    ON graph_execution_node_io(execution_id, direction)
  `).run();

  console.log('✅ Created graph_execution_node_io compact ledger');
};

export const down = async (db: Database): Promise<void> => {
  console.log('🔄 Rolling back migration: 021_add_graph_execution_node_io.ts');

  db.prepare('DROP INDEX IF EXISTS idx_graph_execution_node_io_execution_direction').run();
  db.prepare('DROP INDEX IF EXISTS idx_graph_execution_node_io_execution_node').run();
  db.prepare('DROP TABLE IF EXISTS graph_execution_node_io').run();

  console.log('✅ Dropped graph_execution_node_io compact ledger');
};
