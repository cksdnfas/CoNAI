import { getUserSettingsDb } from '../database/userSettingsDb'
import {
  ModuleDefinitionRecord,
  ModuleDefinitionCreateData,
  ModuleDefinitionUpdateData,
} from '../types/moduleGraph'
import { buildUpdateQuery, filterDefined, sqlLiteral } from '../utils/dynamicUpdate'

function stringifyJson(value: unknown) {
  return JSON.stringify(value ?? null)
}

export class ModuleDefinitionModel {
  static create(moduleData: ModuleDefinitionCreateData): number {
    const db = getUserSettingsDb()
    const info = db.prepare(`
      INSERT INTO module_definitions (
        name, description, engine_type, authoring_source, category, source_workflow_id,
        template_defaults, exposed_inputs, output_ports, internal_fixed_values, ui_schema,
        version, is_active, color, external_key, source_path, source_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      moduleData.name,
      moduleData.description || null,
      moduleData.engine_type,
      moduleData.authoring_source,
      moduleData.category || null,
      moduleData.source_workflow_id ?? null,
      stringifyJson(moduleData.template_defaults),
      stringifyJson(moduleData.exposed_inputs),
      stringifyJson(moduleData.output_ports),
      moduleData.internal_fixed_values ? stringifyJson(moduleData.internal_fixed_values) : null,
      moduleData.ui_schema ? stringifyJson(moduleData.ui_schema) : null,
      moduleData.version ?? 1,
      moduleData.is_active !== undefined ? (moduleData.is_active ? 1 : 0) : 1,
      moduleData.color || '#7c4dff',
      moduleData.external_key || null,
      moduleData.source_path || null,
      moduleData.source_hash || null,
    )

    return info.lastInsertRowid as number
  }

  static findById(id: number): ModuleDefinitionRecord | null {
    const db = getUserSettingsDb()
    const row = db.prepare('SELECT * FROM module_definitions WHERE id = ?').get(id) as ModuleDefinitionRecord | undefined
    return row || null
  }

  static findAll(activeOnly = false): ModuleDefinitionRecord[] {
    const db = getUserSettingsDb()
    let query = 'SELECT * FROM module_definitions'
    if (activeOnly) {
      query += ' WHERE is_active = 1'
    }
    query += ' ORDER BY created_date DESC'

    return db.prepare(query).all() as ModuleDefinitionRecord[]
  }

  static update(id: number, moduleData: ModuleDefinitionUpdateData): boolean {
    const db = getUserSettingsDb()
    const cleanData: Record<string, unknown> = {
      ...moduleData,
      template_defaults: moduleData.template_defaults !== undefined ? stringifyJson(moduleData.template_defaults) : undefined,
      exposed_inputs: moduleData.exposed_inputs !== undefined ? stringifyJson(moduleData.exposed_inputs) : undefined,
      output_ports: moduleData.output_ports !== undefined ? stringifyJson(moduleData.output_ports) : undefined,
      internal_fixed_values: moduleData.internal_fixed_values !== undefined
        ? (moduleData.internal_fixed_values ? stringifyJson(moduleData.internal_fixed_values) : null)
        : undefined,
      ui_schema: moduleData.ui_schema !== undefined ? stringifyJson(moduleData.ui_schema) : undefined,
      is_active: moduleData.is_active !== undefined ? (moduleData.is_active ? 1 : 0) : undefined,
      external_key: moduleData.external_key,
      source_path: moduleData.source_path,
      source_hash: moduleData.source_hash,
    }

    const updates = filterDefined(cleanData)
    if (Object.keys(updates).length === 0) {
      return false
    }

    const finalUpdates = {
      ...updates,
      updated_date: sqlLiteral('CURRENT_TIMESTAMP'),
    }

    const { sql, values } = buildUpdateQuery('module_definitions', finalUpdates, { id })
    const info = db.prepare(sql).run(...values)
    return info.changes > 0
  }

  static delete(id: number): boolean {
    const db = getUserSettingsDb()
    const info = db.prepare('DELETE FROM module_definitions WHERE id = ?').run(id)
    return info.changes > 0
  }

  static existsByName(name: string, excludeId?: number): boolean {
    const db = getUserSettingsDb()
    let query = 'SELECT 1 FROM module_definitions WHERE name = ?'
    const params: Array<string | number> = [name]

    if (excludeId !== undefined) {
      query += ' AND id != ?'
      params.push(excludeId)
    }

    const row = db.prepare(query).get(...params)
    return !!row
  }

  static findByExternalKey(externalKey: string): ModuleDefinitionRecord | null {
    const db = getUserSettingsDb()
    const row = db.prepare('SELECT * FROM module_definitions WHERE external_key = ?').get(externalKey) as ModuleDefinitionRecord | undefined
    return row || null
  }
}
