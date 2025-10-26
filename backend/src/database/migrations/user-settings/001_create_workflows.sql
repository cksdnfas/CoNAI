-- Create workflows table
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
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_workflows_name ON workflows(name);
CREATE INDEX IF NOT EXISTS idx_workflows_is_active ON workflows(is_active);
CREATE INDEX IF NOT EXISTS idx_workflows_created_date ON workflows(created_date);
