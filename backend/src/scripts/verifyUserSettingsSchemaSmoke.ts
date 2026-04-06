import fs from 'fs'
import os from 'os'
import path from 'path'

type TableExpectation = {
  table: string
  requiredColumns: string[]
}

const TABLE_EXPECTATIONS: TableExpectation[] = [
  {
    table: 'workflows',
    requiredColumns: ['id', 'name', 'description', 'workflow_json', 'marked_fields', 'api_endpoint', 'is_active', 'color', 'created_date', 'updated_date'],
  },
  {
    table: 'comfyui_servers',
    requiredColumns: ['id', 'name', 'endpoint', 'description', 'is_active', 'is_default', 'created_date', 'updated_date'],
  },
  {
    table: 'workflow_servers',
    requiredColumns: ['id', 'workflow_id', 'server_id', 'is_enabled', 'created_date'],
  },
  {
    table: 'user_preferences',
    requiredColumns: ['id', 'key', 'value', 'created_at', 'updated_at'],
  },
  {
    table: 'wildcards',
    requiredColumns: ['id', 'name', 'description', 'is_auto_collected', 'source_path', 'lora_weight', 'parent_id', 'include_children', 'type', 'chain_option', 'only_children', 'created_date', 'updated_date'],
  },
  {
    table: 'wildcard_items',
    requiredColumns: ['id', 'wildcard_id', 'tool', 'content', 'order_index', 'weight', 'created_date'],
  },
  {
    table: 'custom_dropdown_lists',
    requiredColumns: ['id', 'name', 'description', 'items', 'is_auto_collected', 'source_path', 'created_date', 'updated_date'],
  },
  {
    table: 'external_api_providers',
    requiredColumns: ['id', 'provider_name', 'display_name', 'provider_type', 'api_key', 'api_secret', 'base_url', 'additional_config', 'is_enabled', 'created_at', 'updated_at'],
  },
  {
    table: 'module_definitions',
    requiredColumns: ['id', 'name', 'description', 'engine_type', 'authoring_source', 'category', 'source_workflow_id', 'template_defaults', 'exposed_inputs', 'output_ports', 'internal_fixed_values', 'ui_schema', 'version', 'is_active', 'color', 'external_key', 'source_path', 'source_hash', 'created_date', 'updated_date'],
  },
  {
    table: 'graph_workflow_folders',
    requiredColumns: ['id', 'name', 'description', 'parent_id', 'created_date', 'updated_date'],
  },
  {
    table: 'graph_workflows',
    requiredColumns: ['id', 'name', 'description', 'graph_json', 'folder_id', 'version', 'is_active', 'created_date', 'updated_date'],
  },
  {
    table: 'graph_workflow_versions',
    requiredColumns: ['id', 'workflow_id', 'version', 'graph_json', 'changelog', 'created_date'],
  },
  {
    table: 'graph_executions',
    requiredColumns: ['id', 'graph_workflow_id', 'graph_version', 'status', 'execution_plan', 'started_at', 'completed_at', 'error_message', 'created_date', 'updated_date', 'failed_node_id'],
  },
  {
    table: 'graph_execution_artifacts',
    requiredColumns: ['id', 'execution_id', 'node_id', 'port_key', 'artifact_type', 'storage_path', 'metadata', 'created_date'],
  },
  {
    table: 'graph_execution_logs',
    requiredColumns: ['id', 'execution_id', 'node_id', 'level', 'event_type', 'message', 'details', 'created_date'],
  },
  {
    table: 'graph_execution_final_results',
    requiredColumns: ['id', 'execution_id', 'final_node_id', 'source_artifact_id', 'source_node_id', 'source_port_key', 'artifact_type', 'created_date'],
  },
]

async function main() {
  const tempBasePath = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-user-db-smoke-'))
  process.env.RUNTIME_BASE_PATH = tempBasePath

  let closeUserSettingsDb: (() => void) | null = null

  try {
    const { ensureRuntimeDirectories } = await import('../config/runtimePaths')
    const userSettings = await import('../database/userSettingsDb')
    closeUserSettingsDb = userSettings.closeUserSettingsDb

    ensureRuntimeDirectories()
    userSettings.initializeUserSettingsDb()

    const db = userSettings.getUserSettingsDb()
    const failures: string[] = []

    for (const expectation of TABLE_EXPECTATIONS) {
      const columns = db.prepare(`PRAGMA table_info(${expectation.table})`).all() as Array<{ name: string }>
      if (columns.length === 0) {
        failures.push(`${expectation.table}: table missing`)
        continue
      }

      const columnNames = new Set(columns.map((column) => column.name))
      const missingColumns = expectation.requiredColumns.filter((column) => !columnNames.has(column))
      if (missingColumns.length > 0) {
        failures.push(`${expectation.table}: missing columns -> ${missingColumns.join(', ')}`)
      }
    }

    if (failures.length > 0) {
      throw new Error(`User settings schema smoke failed\n${failures.map((failure) => `- ${failure}`).join('\n')}`)
    }

    console.log(`✅ User settings schema smoke passed (${TABLE_EXPECTATIONS.length} tables checked)`)
  } finally {
    try {
      closeUserSettingsDb?.()
    } catch {
      // Ignore cleanup errors from partially initialized runs.
    }

    fs.rmSync(tempBasePath, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
