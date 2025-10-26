-- Create comfyui_servers table
CREATE TABLE IF NOT EXISTS comfyui_servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name VARCHAR(255) NOT NULL UNIQUE,
  endpoint VARCHAR(500) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT 1,
  created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_comfyui_servers_is_active ON comfyui_servers(is_active);

-- Insert default server
INSERT OR IGNORE INTO comfyui_servers (name, endpoint, description)
VALUES ('Local ComfyUI', 'http://127.0.0.1:8188', '로컬 ComfyUI 서버');
