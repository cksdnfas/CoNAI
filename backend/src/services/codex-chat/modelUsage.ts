import { getUserSettingsDb } from '../../database/userSettingsDb'
import { resolveProfileModel } from './chatModelRoles'
import { ChatProfileStore } from './chatProfiles'

export type ModelUsage = {
  /** Saved workflow LLM nodes per model row: nodes reach a row through the profile they chat as. */
  slots: Array<{ id: number; workflowNodes: number }>
}

/** Saved graph-workflow LLM nodes (system.call_llm) per chat profile id; the graphs are JSON documents, so they are parsed. */
function workflowNodesByProfile(): Map<number, number> {
  const db = getUserSettingsDb()
  const counts = new Map<number, number>()
  const llmModules = new Set(
    (db.prepare('SELECT id, internal_fixed_values FROM module_definitions WHERE internal_fixed_values LIKE ?').all('%system.call_llm%') as Array<{ id: number; internal_fixed_values: string | null }>)
      .filter((row) => {
        try { return JSON.parse(row.internal_fixed_values ?? '{}')?.operation_key === 'system.call_llm' } catch { return false }
      })
      .map((row) => row.id),
  )
  if (llmModules.size === 0) return counts
  for (const row of db.prepare('SELECT graph_json FROM graph_workflows WHERE graph_json LIKE ?').iterate('%profile_id%') as Iterable<{ graph_json: string }>) {
    let nodes: unknown
    try { nodes = JSON.parse(row.graph_json)?.nodes } catch { continue }
    if (!Array.isArray(nodes)) continue
    for (const node of nodes) {
      if (!node || !llmModules.has(Number(node.module_id))) continue
      const profileId = Number(node.input_values?.profile_id)
      if (Number.isSafeInteger(profileId) && profileId > 0) counts.set(profileId, (counts.get(profileId) ?? 0) + 1)
    }
  }
  return counts
}

/** Where each model row is used by saved workflow nodes (the rest of a row's usage comes with the row itself). */
export function buildModelUsage(): ModelUsage {
  const nodesByProfile = workflowNodesByProfile()
  const slotNodes = new Map<number, number>()
  for (const profile of ChatProfileStore.list()) {
    const nodes = nodesByProfile.get(profile.id) ?? 0
    if (nodes === 0 || profile.engine !== 'llm') continue
    const slotId = resolveProfileModel(profile, 'chat')?.slotId ?? null
    if (slotId !== null) slotNodes.set(slotId, (slotNodes.get(slotId) ?? 0) + nodes)
  }
  return { slots: [...slotNodes].map(([id, workflowNodes]) => ({ id, workflowNodes })) }
}
