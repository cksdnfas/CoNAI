-- Create workflow_servers relationship table
CREATE TABLE IF NOT EXISTS workflow_servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id INTEGER NOT NULL,
  server_id INTEGER NOT NULL,
  is_enabled BOOLEAN DEFAULT 1,
  created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
  FOREIGN KEY (server_id) REFERENCES comfyui_servers(id) ON DELETE CASCADE,
  UNIQUE(workflow_id, server_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_workflow_servers_workflow_id ON workflow_servers(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_servers_server_id ON workflow_servers(server_id);
