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

type NodeRefs = { slots: Map<number, number>; profiles: Map<string, number> }

function positiveId(value: unknown) {
  const id = Number(value)
  return value !== null && value !== '' && Number.isSafeInteger(id) && id > 0 ? id : null
}

function add<K>(map: Map<K, number>, key: K) {
  map.set(key, (map.get(key) ?? 0) + 1)
}

/** Saved graph-workflow model nodes by the row or profile they name; the graphs are JSON documents, so they are parsed. */
function workflowNodeRefs(): NodeRefs {
  const db = getUserSettingsDb()
  const refs: NodeRefs = { slots: new Map(), profiles: new Map() }
  const roleByModule = new Map<number, ModelRole>()
  for (const row of db.prepare('SELECT id, internal_fixed_values FROM module_definitions WHERE internal_fixed_values LIKE ?').all('%"system.%') as Array<{ id: number; internal_fixed_values: string | null }>) {
    let operationKey: unknown
    try { operationKey = JSON.parse(row.internal_fixed_values ?? '{}')?.operation_key } catch { continue }
    if (typeof operationKey === 'string' && MODEL_NODE_ROLES[operationKey]) roleByModule.set(row.id, MODEL_NODE_ROLES[operationKey])
  }
  if (roleByModule.size === 0) return refs
  for (const row of db.prepare("SELECT graph_json FROM graph_workflows WHERE graph_json LIKE '%model_slot_id%' OR graph_json LIKE '%profile_id%'").iterate() as Iterable<{ graph_json: string }>) {
    let nodes: unknown
    try { nodes = JSON.parse(row.graph_json)?.nodes } catch { continue }
    if (!Array.isArray(nodes)) continue
    for (const node of nodes) {
      const role = node ? roleByModule.get(Number(node.module_id)) : undefined
      if (!role) continue
      const slotId = positiveId(node.input_values?.model_slot_id)
      const profileId = positiveId(node.input_values?.profile_id)
      if (slotId !== null) add(refs.slots, slotId)
      else if (profileId !== null) add(refs.profiles, `${profileId}:${role}`)
    }
  }
  return refs
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
