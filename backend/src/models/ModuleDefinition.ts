import { getUserSettingsDb } from '../database/userSettingsDb'
import { GraphWorkflowModel } from './GraphWorkflow'
import {
  GraphWorkflowDocument,
  ModuleDefinitionRecord,
  ModuleDefinitionCreateData,
  ModuleDefinitionUpdateData,
  ModulePortDefinition,
} from '../types/moduleGraph'
import { buildUpdateQuery, filterDefined, sqlLiteral } from '../utils/dynamicUpdate'

function stringifyJson(value: unknown) {
  return JSON.stringify(value ?? null)
}

export type ModuleDefinitionGraphReconcileResult = {
  graph: GraphWorkflowDocument
  changed: boolean
  removedEdgeIds: string[]
  prunedInputValueKeys: Array<{ nodeId: string; keys: string[] }>
  removedExposedInputIds: string[]
}

type ModuleDefinitionGraphReconcilePorts = Pick<ModuleDefinitionUpdateData, 'exposed_inputs' | 'output_ports'>

function parseGraphJson(value: string): GraphWorkflowDocument | null {
  try {
    const parsed = JSON.parse(value) as Partial<GraphWorkflowDocument>
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      return null
    }
    return parsed as GraphWorkflowDocument
  } catch {
    return null
  }
}

function createPortKeySet(ports: ModulePortDefinition[] | undefined) {
  return ports ? new Set(ports.map((port) => port.key)) : null
}

export function reconcileGraphForModuleDefinitionUpdate(
  graph: GraphWorkflowDocument,
  moduleId: number,
  ports: ModuleDefinitionGraphReconcilePorts,
): ModuleDefinitionGraphReconcileResult {
  const inputKeys = createPortKeySet(ports.exposed_inputs)
  const outputKeys = createPortKeySet(ports.output_ports)
  const affectedNodeIds = new Set(graph.nodes
    .filter((node) => node.module_id === moduleId)
    .map((node) => node.id))

  if (affectedNodeIds.size === 0 || (!inputKeys && !outputKeys)) {
    return {
      graph,
      changed: false,
      removedEdgeIds: [],
      prunedInputValueKeys: [],
      removedExposedInputIds: [],
    }
  }

  const prunedInputValueKeys: Array<{ nodeId: string; keys: string[] }> = []
  const nodes = graph.nodes.map((node) => {
    if (!inputKeys || !affectedNodeIds.has(node.id) || !node.input_values) {
      return node
    }

    const nextInputValues = Object.fromEntries(
      Object.entries(node.input_values).filter(([key]) => inputKeys.has(key)),
    )
    const removedKeys = Object.keys(node.input_values).filter((key) => !inputKeys.has(key))
    if (removedKeys.length === 0) {
      return node
    }

    prunedInputValueKeys.push({ nodeId: node.id, keys: removedKeys })
    const nextNode = { ...node }
    if (Object.keys(nextInputValues).length > 0) {
      nextNode.input_values = nextInputValues
    } else {
      delete nextNode.input_values
    }
    return nextNode
  })

  const removedEdgeIds: string[] = []
  const edges = graph.edges.filter((edge) => {
    const sourcePortRemoved = outputKeys
      && affectedNodeIds.has(edge.source_node_id)
      && !outputKeys.has(edge.source_port_key)
    const targetPortRemoved = inputKeys
      && affectedNodeIds.has(edge.target_node_id)
      && !inputKeys.has(edge.target_port_key)

    if (sourcePortRemoved || targetPortRemoved) {
      removedEdgeIds.push(edge.id)
      return false
    }
    return true
  })

  let metadata = graph.metadata
  const removedExposedInputIds: string[] = []
  if (inputKeys && graph.metadata?.exposed_inputs) {
    const exposedInputs = graph.metadata.exposed_inputs.filter((input) => {
      const belongsToUpdatedModule = input.module_id === moduleId || affectedNodeIds.has(input.node_id)
      const removed = belongsToUpdatedModule && !inputKeys.has(input.port_key)
      if (removed) {
        removedExposedInputIds.push(input.id)
        return false
      }
      return true
    })
    metadata = {
      ...graph.metadata,
      exposed_inputs: exposedInputs,
    }
  }

  const changed = removedEdgeIds.length > 0
    || prunedInputValueKeys.length > 0
    || removedExposedInputIds.length > 0

  return {
    graph: changed ? { ...graph, nodes, edges, metadata } : graph,
    changed,
    removedEdgeIds,
    prunedInputValueKeys,
    removedExposedInputIds,
  }
}

function reconcileSavedGraphWorkflowsForModuleDefinitionUpdate(
  moduleId: number,
  ports: ModuleDefinitionGraphReconcilePorts,
) {
  if (!ports.exposed_inputs && !ports.output_ports) {
    return 0
  }

  let updatedCount = 0
  for (const workflow of GraphWorkflowModel.findAll(false)) {
    const graph = parseGraphJson(workflow.graph_json)
    if (!graph) {
      continue
    }

    const result = reconcileGraphForModuleDefinitionUpdate(graph, moduleId, ports)
    if (!result.changed) {
      continue
    }

    if (GraphWorkflowModel.update(workflow.id, { graph: result.graph })) {
      updatedCount += 1
    }
  }

  return updatedCount
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
    const updated = info.changes > 0
    if (updated) {
      reconcileSavedGraphWorkflowsForModuleDefinitionUpdate(id, moduleData)
    }
    return updated
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
