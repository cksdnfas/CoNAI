-- Migration: Add Workflow Tracking for ComfyUI
-- Purpose: Enable workflow-specific filtering for ComfyUI generation history
-- Date: 2025-01-XX

-- Add workflow tracking columns
ALTER TABLE api_generation_history ADD COLUMN workflow_id INTEGER;
ALTER TABLE api_generation_history ADD COLUMN workflow_name TEXT;

-- Create index for workflow-based queries
CREATE INDEX IF NOT EXISTS idx_api_gen_workflow_id ON api_generation_history(workflow_id);

-- Create composite index for service_type + workflow_id (optimal for ComfyUI workflow filtering)
CREATE INDEX IF NOT EXISTS idx_api_gen_service_workflow ON api_generation_history(service_type, workflow_id);
