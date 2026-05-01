import Database from 'better-sqlite3'

function hasTable(db: Database.Database, table: string) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { name: string } | undefined
  return Boolean(row)
}

function hasColumn(db: Database.Database, table: string, column: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return columns.some((entry) => entry.name === column)
}

export const up = async (db: Database.Database): Promise<void> => {
  if (!hasTable(db, 'comfyui_servers')) {
    return
  }

  if (!hasColumn(db, 'comfyui_servers', 'backend_type')) {
    db.exec("ALTER TABLE comfyui_servers ADD COLUMN backend_type TEXT NOT NULL DEFAULT 'comfyui'")
  }

  if (!hasColumn(db, 'comfyui_servers', 'capacity')) {
    db.exec('ALTER TABLE comfyui_servers ADD COLUMN capacity INTEGER NOT NULL DEFAULT 1')
  }
}

export const down = async (): Promise<void> => {
  // SQLite cannot drop columns safely without table rebuild; keep additive columns.
}
