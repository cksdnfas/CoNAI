-- API Generation History Database Schema
-- Purpose: Track image generation history from ComfyUI and NovelAI APIs

CREATE TABLE IF NOT EXISTS api_generation_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Generation Basic Info
  service_type TEXT NOT NULL CHECK(service_type IN ('comfyui', 'novelai')),
  generation_status TEXT NOT NULL DEFAULT 'pending' CHECK(generation_status IN ('pending', 'processing', 'completed', 'failed')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,

  -- ComfyUI Specific Fields
  comfyui_workflow TEXT,                -- Substituted API workflow JSON
  comfyui_prompt_id TEXT,               -- ComfyUI prompt ID for tracking

  -- NovelAI Specific Fields
  nai_model TEXT,                       -- Model used (e.g., 'nai-diffusion-3')
  nai_sampler TEXT,                     -- Sampler algorithm
  nai_seed INTEGER,                     -- Seed value
  nai_steps INTEGER,                    -- Number of steps
  nai_scale REAL,                       -- CFG Scale
  nai_parameters TEXT,                  -- Full NAI parameters as JSON

  -- Common Fields
  positive_prompt TEXT,                 -- Positive prompt text
  negative_prompt TEXT,                 -- Negative prompt text
  width INTEGER,                        -- Image width
  height INTEGER,                       -- Image height

  -- Image Path Information (stored in uploads/API/images/)
  original_path TEXT,                   -- Original image path
  thumbnail_path TEXT,                  -- Thumbnail path
  optimized_path TEXT,                  -- Optimized image path
  file_size INTEGER,                    -- File size in bytes

  -- Linked Image ID (from main images.db)
  linked_image_id INTEGER,              -- Reference to images table in main DB

  -- Error and Metadata
  error_message TEXT,                   -- Error message if generation failed
  metadata TEXT                         -- Additional metadata as JSON
);

-- Indexes for Performance Optimization
CREATE INDEX IF NOT EXISTS idx_api_gen_service_type ON api_generation_history(service_type);
CREATE INDEX IF NOT EXISTS idx_api_gen_status ON api_generation_history(generation_status);
CREATE INDEX IF NOT EXISTS idx_api_gen_created_at ON api_generation_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_gen_linked_image ON api_generation_history(linked_image_id);
