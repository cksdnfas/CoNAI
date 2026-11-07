import { getUserSettingsDb } from '../../database/userSettingsDb'
import { resolveProfileModel } from './chatModelRoles'
import { ChatProfileStore } from './chatProfiles'
import type { ModelRole } from './modelSlots'

export type ModelUsage = {
  /** Saved workflow LLM nodes per model row: nodes name a row, or reach one through the profile they use. */
  slots: Array<{ id: number; workflowNodes: number }>
}

/** Workflow nodes that call a model, with the profile role they use when they name a profile instead of a row. */
const MODEL_NODE_ROLES: Record<string, ModelRole> = {
  'system.call_llm': 'chat',
  'system.translate_text': 'translation',
  'system.judge_text': 'chat',
  'system.chat_profile_reply': 'chat',
  'system.draft_appearance_tags': 'summary',
}

type NodeRefs = { slots: Map<number, number>; llmSlots: Map<number, number>; profiles: Map<string, number> }
type ModelNode = { module_id: number; input_values?: Record<string, unknown> }

function positiveId(value: unknown) {
  const id = Number(value)
  return value !== null && value !== '' && Number.isSafeInteger(id) && id > 0 ? id : null
}

function add<K>(map: Map<K, number>, key: K) {
  map.set(key, (map.get(key) ?? 0) + 1)
}

/** Only registered model operations own model_slot_id; preserve all other graph data when rewriting one. */
function* workflowModelNodes() {
  const db = getUserSettingsDb()
  const operations = new Map<number, { role: ModelRole; judge: boolean }>()
  for (const row of db.prepare('SELECT id, internal_fixed_values FROM module_definitions WHERE internal_fixed_values LIKE ?').all('%"system.%') as Array<{ id: number; internal_fixed_values: string | null }>) {
    let operationKey: unknown
    try { operationKey = JSON.parse(row.internal_fixed_values ?? '{}')?.operation_key } catch { continue }
    if (typeof operationKey === 'string' && MODEL_NODE_ROLES[operationKey]) operations.set(row.id, { role: MODEL_NODE_ROLES[operationKey], judge: operationKey === 'system.judge_text' })
  }
  if (!operations.size) return
  for (const row of db.prepare("SELECT id, graph_json FROM graph_workflows WHERE graph_json LIKE '%model_slot_id%' OR graph_json LIKE '%profile_id%'").iterate() as Iterable<{ id: number; graph_json: string }>) {
    let graph: { nodes: ModelNode[] }
    try { graph = JSON.parse(row.graph_json) } catch { continue }
    if (!Array.isArray(graph?.nodes)) continue
    const nodes = graph.nodes.flatMap((node) => {
      const operation = node ? operations.get(Number(node.module_id)) : undefined
      return operation ? [{ node, ...operation }] : []
    })
    yield { id: row.id, graph, nodes }
  }
}

/** Saved graph-workflow model nodes by the row or profile they name. */
export function workflowNodeRefs(): NodeRefs {
  const refs: NodeRefs = { slots: new Map(), llmSlots: new Map(), profiles: new Map() }
  for (const { nodes } of workflowModelNodes()) {
    for (const { node, role, judge } of nodes) {
      const slotId = positiveId(node.input_values?.model_slot_id)
      const profileId = positiveId(node.input_values?.profile_id)
      if (slotId !== null) {
        add(refs.slots, slotId)
        if (!judge) add(refs.llmSlots, slotId)
      } else if (profileId !== null && node.input_values?.model_slot_removed !== true) add(refs.profiles, `${profileId}:${role}`)
    }
  }
  return refs
}

/** Called inside the model-removal transaction; the graph revision trigger invalidates stale editor saves. */
export function replaceWorkflowModelReferences(ids: number[], replacement: number | null) {
  const removed = new Set(ids)
  const updates: Array<[string, number]> = []
  for (const { id, graph, nodes } of workflowModelNodes()) {
    let changed = false
    for (const { node } of nodes) {
      const values = node.input_values
      if (!values || !removed.has(positiveId(values.model_slot_id) ?? 0)) continue
      values.model_slot_id = replacement
      // Null ordinarily means "use the default"; explicit removal instead requires choosing a model again.
      if (replacement === null) values.model_slot_removed = true
      else delete values.model_slot_removed
      changed = true
    }
    if (changed) updates.push([JSON.stringify(graph), id])
  }
  // better-sqlite3 disallows writes while the graph iterator is active.
  const update = getUserSettingsDb().prepare('UPDATE graph_workflows SET graph_json = ? WHERE id = ?')
  for (const values of updates) update.run(...values)
}

/** Where each model row is used by saved workflow nodes (the rest of a row's usage comes with the row itself). */
export function buildModelUsage(): ModelUsage {
  const refs = workflowNodeRefs()
  const slotNodes = new Map(refs.slots)
  if (refs.profiles.size > 0) {
    for (const profile of ChatProfileStore.list()) {
      if (profile.engine !== 'llm') continue
      for (const role of new Set(Object.values(MODEL_NODE_ROLES))) {
        const nodes = refs.profiles.get(`${profile.id}:${role}`) ?? 0
        if (nodes === 0) continue
        // A profile without a translation row translates with its chat model.
        const slotId = (resolveProfileModel(profile, role) ?? resolveProfileModel(profile, 'chat'))?.slotId ?? null
        if (slotId !== null) slotNodes.set(slotId, (slotNodes.get(slotId) ?? 0) + nodes)
      }
    }
  }
  return { slots: [...slotNodes].map(([id, workflowNodes]) => ({ id, workflowNodes })) }
}
