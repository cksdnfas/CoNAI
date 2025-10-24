-- Migration: Add group assignment support to generation history
-- Date: 2025-01-XX
-- Description: Add assigned_group_id column to support manual group assignment during image generation

-- Add assigned_group_id column to store user-selected group for automatic assignment
ALTER TABLE api_generation_history ADD COLUMN assigned_group_id INTEGER;

-- Add index for faster group-based queries
CREATE INDEX IF NOT EXISTS idx_api_generation_history_assigned_group
ON api_generation_history(assigned_group_id);
